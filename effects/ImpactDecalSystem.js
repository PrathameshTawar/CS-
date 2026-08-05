/**
 * ImpactDecalSystem.ts
 *
 * Persistent impact decals — bullet holes and scorch marks — that sit on
 * world surfaces. Decals are pooled oriented quads with a procedural radial
 * texture; the oldest decal is recycled when the pool is full, and every
 * decal fades out over its lifetime so the world doesn't accumulate clutter.
 *
 * Fully procedural — the bullet-hole texture is painted on a canvas.
 *
 * @module Rendering
 */
import * as THREE from 'three';
const POOL_SIZE = 180;
const DEFAULT_LIFE = 14;
export class ImpactDecalSystem {
    group = new THREE.Group();
    decals = [];
    up = new THREE.Vector3(0, 1, 0);
    q = new THREE.Quaternion();
    baseTex;
    bloodTex;
    bloodPoolTex;
    constructor(scene) {
        this.baseTex = this.makeBulletHoleTexture();
        this.bloodTex = this.makeBloodSplatterTexture();
        this.bloodPoolTex = this.makeBloodPoolTexture();
        const geo = new THREE.PlaneGeometry(1, 1);
        for (let i = 0; i < POOL_SIZE; i++) {
            const mat = new THREE.MeshBasicMaterial({
                map: this.baseTex ?? undefined,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.renderOrder = 5;
            this.group.add(mesh);
            this.decals.push({ mesh, mat, life: 0, maxLife: DEFAULT_LIFE, active: false });
        }
        scene.add(this.group);
    }
    /** Procedural radial bullet-hole texture (dark center + scorch halo). */
    makeBulletHoleTexture() {
        // Node/jest guard — some test envs define a partial `document` mock.
        if (typeof document === 'undefined' || typeof document.createElement !== 'function')
            return null;
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(8,8,10,0.95)');
        grad.addColorStop(0.35, 'rgba(15,14,16,0.8)');
        grad.addColorStop(0.7, 'rgba(30,26,22,0.35)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        // Jagged hole edge
        ctx.fillStyle = 'rgba(10,10,12,0.9)';
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const r = 6 + Math.random() * 4;
            ctx.beginPath();
            ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }
    /** Procedural directional blood splatter decal texture. */
    makeBloodSplatterTexture() {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function')
            return null;
        const size = 128;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        // Core crimson splatter
        const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(150,5,5,0.95)');
        grad.addColorStop(0.4, 'rgba(110,3,3,0.85)');
        grad.addColorStop(0.8, 'rgba(60,0,0,0.4)');
        grad.addColorStop(1, 'rgba(20,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        // Splatters & droplets around the edge
        ctx.fillStyle = 'rgba(125,10,10,0.9)';
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 16 + Math.random() * 38;
            ctx.beginPath();
            ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 2 + Math.random() * 4, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }
    /** Procedural floor blood pool decal texture. */
    makeBloodPoolTexture() {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function')
            return null;
        const size = 128;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(95,5,5,0.96)');
        grad.addColorStop(0.5, 'rgba(65,2,2,0.9)');
        grad.addColorStop(0.85, 'rgba(35,0,0,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }
    /** Spawn a bullet hole at the impact point, oriented along the normal. */
    spawnBulletHole(position, normal, scale = 0.06) {
        const d = this.next();
        if (!d)
            return;
        this.q.setFromUnitVectors(this.up, new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
        const rot = Math.random() * Math.PI;
        d.mesh.quaternion.copy(this.q);
        d.mesh.rotateZ(rot);
        d.mesh.position.set(position.x + normal.x * 0.02, position.y + normal.y * 0.02, position.z + normal.z * 0.02);
        const s = scale * (0.7 + Math.random() * 0.6);
        d.mesh.scale.set(s, s, 1);
        d.mat.map = this.baseTex ?? null;
        d.mat.color.setHex(0xffffff);
        d.mat.opacity = 0.92;
        d.life = 0;
        d.maxLife = DEFAULT_LIFE;
        d.active = true;
        d.mesh.visible = true;
    }
    /** Spawn a larger scorch mark (grenades / explosions). */
    spawnScorch(position, radius = 0.5) {
        const d = this.next();
        if (!d)
            return;
        // Scorch lays flat on the ground plane
        d.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        d.mesh.position.set(position.x, position.y + 0.03, position.z);
        const s = radius * (0.8 + Math.random() * 0.5);
        d.mesh.scale.set(s, s, 1);
        d.mat.map = this.baseTex ?? null;
        d.mat.color.setHex(0xffffff);
        d.mat.opacity = 0.6;
        d.life = 0;
        d.maxLife = DEFAULT_LIFE * 2.2;
        d.active = true;
        d.mesh.visible = true;
    }
    /** Spawn a directional wall blood splatter decal along the impact normal. */
    spawnBloodSplatter(position, normal, scale = 0.55) {
        const d = this.next();
        if (!d)
            return;
        this.q.setFromUnitVectors(this.up, new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
        const rot = Math.random() * Math.PI;
        d.mesh.quaternion.copy(this.q);
        d.mesh.rotateZ(rot);
        d.mesh.position.set(position.x + normal.x * 0.025, position.y + normal.y * 0.025, position.z + normal.z * 0.025);
        const s = scale * (0.8 + Math.random() * 0.4);
        d.mesh.scale.set(s, s, 1);
        d.mat.map = this.bloodTex ?? null;
        d.mat.color.setHex(0xffffff);
        d.mat.opacity = 0.93;
        d.life = 0;
        d.maxLife = DEFAULT_LIFE * 1.8;
        d.active = true;
        d.mesh.visible = true;
    }
    /** Spawn an elliptical floor blood pool decal under killed enemies. */
    spawnBloodPool(position, scale = 1.1) {
        const d = this.next();
        if (!d)
            return;
        d.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        d.mesh.position.set(position.x, position.y + 0.025, position.z);
        const s = scale * (0.9 + Math.random() * 0.3);
        d.mesh.scale.set(s, s * 0.85, 1);
        d.mat.map = this.bloodPoolTex ?? null;
        d.mat.color.setHex(0xffffff);
        d.mat.opacity = 0.88;
        d.life = 0;
        d.maxLife = DEFAULT_LIFE * 2.5;
        d.active = true;
        d.mesh.visible = true;
    }
    next() {
        for (const d of this.decals) {
            if (!d.active)
                return d;
        }
        // Recycle the oldest
        let oldest = this.decals[0];
        for (const d of this.decals) {
            if (d.life > oldest.life)
                oldest = d;
        }
        return oldest;
    }
    update(deltaTime) {
        for (const d of this.decals) {
            if (!d.active)
                continue;
            d.life += deltaTime;
            if (d.life >= d.maxLife) {
                d.active = false;
                d.mesh.visible = false;
                continue;
            }
            // Fade out over the last 25% of life
            const fadeStart = d.maxLife * 0.75;
            if (d.life > fadeStart) {
                const t = 1 - (d.life - fadeStart) / (d.maxLife - fadeStart);
                d.mat.opacity = Math.max(0, d.mat.opacity * (t > 0.5 ? 1 : 0.7));
            }
        }
    }
    clear() {
        for (const d of this.decals) {
            d.active = false;
            d.mesh.visible = false;
            d.mat.opacity = 0;
        }
    }
    dispose() {
        this.baseTex?.dispose();
        this.bloodTex?.dispose();
        this.bloodPoolTex?.dispose();
        for (const d of this.decals) {
            d.mesh.geometry.dispose();
            d.mat.dispose();
        }
        this.group.removeFromParent();
    }
}
//# sourceMappingURL=ImpactDecalSystem.js.map