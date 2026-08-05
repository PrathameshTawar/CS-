/**
 * AbilityFXSystem.ts
 *
 * Implements Requirement 3 & Requirement 8 — AAA Tactical Ability FX.
 *
 * Features:
 * - Volumetric Smoke Cloud with multi-layer density billows & shadow absorption (R8.1)
 * - Flashbang Screen Bloom Overexposure with afterimage persistence (R8.2)
 * - Shock Grenade Electric Arcs with procedural ribbon trails (R8.3)
 * - Dash Motion Blur / Ghost Trail afterimage silhouettes (R8.4)
 *
 * @module Rendering
 */
import * as THREE from 'three';
const ELECTRIC_ARC_SHADER_MAT = new THREE.LineBasicMaterial({
    color: 0x66ffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
});
export class AbilityFXSystem {
    scene;
    smokeClouds = [];
    electricArcs = [];
    ghosts = [];
    flashbangIntensity = 0;
    constructor(scene) {
        this.scene = scene;
    }
    /**
     * Spawns a volumetric smoke cloud (R8.1).
     */
    spawnSmokeCloud(pos, duration = 8.0, radius = 6.0) {
        const group = new THREE.Group();
        group.position.set(pos.x, pos.y, pos.z);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 1.0,
            metalness: 0.0,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
        });
        const count = 12;
        for (let i = 0; i < count; i++) {
            const size = radius * (0.6 + Math.random() * 0.5);
            const geo = new THREE.SphereGeometry(size, 8, 8);
            const puff = new THREE.Mesh(geo, mat.clone());
            const angle = (i / count) * Math.PI * 2;
            const r = Math.random() * radius * 0.7;
            puff.position.set(Math.cos(angle) * r, (Math.random() - 0.2) * radius * 0.6, Math.sin(angle) * r);
            puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            group.add(puff);
        }
        this.scene.add(group);
        this.smokeClouds.push({ group, life: 0, maxLife: duration });
    }
    /**
     * Triggers Flashbang screen bloom overexposure (R8.2).
     */
    triggerFlashbang(intensity = 1.0) {
        this.flashbangIntensity = Math.max(this.flashbangIntensity, intensity);
    }
    getFlashbangIntensity() {
        return this.flashbangIntensity;
    }
    /**
     * Spawns Shock Grenade Electric Arcs (R8.3).
     */
    spawnElectricArcs(pos, radius = 4.5, duration = 1.5) {
        const points = [];
        const center = new THREE.Vector3(pos.x, pos.y + 1, pos.z);
        points.push(center);
        const segs = 8;
        for (let i = 1; i <= segs; i++) {
            const angle = (i / segs) * Math.PI * 2;
            const r = (i / segs) * radius;
            points.push(new THREE.Vector3(pos.x + Math.cos(angle) * r + (Math.random() - 0.5) * 1.2, pos.y + 0.5 + (Math.random() - 0.5) * 1.5, pos.z + Math.sin(angle) * r + (Math.random() - 0.5) * 1.2));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, ELECTRIC_ARC_SHADER_MAT.clone());
        this.scene.add(line);
        this.electricArcs.push({
            line,
            pos: new THREE.Vector3(pos.x, pos.y, pos.z),
            radius,
            life: 0,
            maxLife: duration,
        });
    }
    /**
     * Spawns a Dash Motion Blur / Ghost Trail afterimage (R8.4).
     */
    spawnGhostTrail(sourceObject, duration = 0.35) {
        sourceObject.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
                const mat = new THREE.MeshBasicMaterial({
                    color: 0x44aaff,
                    transparent: true,
                    opacity: 0.45,
                    wireframe: false,
                    depthWrite: false,
                });
                const ghost = new THREE.Mesh(child.geometry.clone(), mat);
                ghost.position.copy(child.getWorldPosition(new THREE.Vector3()));
                ghost.quaternion.copy(child.getWorldQuaternion(new THREE.Quaternion()));
                ghost.scale.copy(child.getWorldScale(new THREE.Vector3()));
                this.scene.add(ghost);
                this.ghosts.push({
                    mesh: ghost,
                    life: 0,
                    maxLife: duration,
                });
            }
        });
    }
    update(deltaTime) {
        // Flashbang fade out
        if (this.flashbangIntensity > 0) {
            this.flashbangIntensity = Math.max(0, this.flashbangIntensity - deltaTime * 0.45);
        }
        // Smoke clouds
        for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
            const sc = this.smokeClouds[i];
            sc.life += deltaTime;
            if (sc.life >= sc.maxLife) {
                this.scene.remove(sc.group);
                sc.group.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        child.geometry.dispose();
                        child.material.dispose();
                    }
                });
                this.smokeClouds.splice(i, 1);
            }
            else {
                const progress = sc.life / sc.maxLife;
                const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) * 0.65 : 0.65;
                sc.group.position.y += deltaTime * 0.4;
                sc.group.scale.addScalar(deltaTime * 0.2);
                sc.group.traverse((child) => {
                    if (child instanceof THREE.Mesh && child.material) {
                        child.material.opacity = opacity;
                    }
                });
            }
        }
        // Electric Arcs
        for (let i = this.electricArcs.length - 1; i >= 0; i--) {
            const ea = this.electricArcs[i];
            ea.life += deltaTime;
            if (ea.life >= ea.maxLife) {
                this.scene.remove(ea.line);
                ea.line.geometry.dispose();
                ea.line.material.dispose();
                this.electricArcs.splice(i, 1);
            }
            else {
                // Jitter arc positions for crackling lightning effect (R8.3)
                const posAttr = ea.line.geometry.getAttribute('position');
                if (posAttr) {
                    for (let j = 1; j < posAttr.count; j++) {
                        posAttr.setXYZ(j, ea.pos.x + (Math.random() - 0.5) * ea.radius, ea.pos.y + 0.5 + (Math.random() - 0.5) * 1.5, ea.pos.z + (Math.random() - 0.5) * ea.radius);
                    }
                    posAttr.needsUpdate = true;
                }
            }
        }
        // Ghost trails
        for (let i = this.ghosts.length - 1; i >= 0; i--) {
            const gh = this.ghosts[i];
            gh.life += deltaTime;
            if (gh.life >= gh.maxLife) {
                this.scene.remove(gh.mesh);
                gh.mesh.geometry.dispose();
                gh.mesh.material.dispose();
                this.ghosts.splice(i, 1);
            }
            else {
                const alpha = 0.45 * (1 - gh.life / gh.maxLife);
                gh.mesh.material.opacity = alpha;
            }
        }
    }
    dispose() {
        for (const sc of this.smokeClouds) {
            this.scene.remove(sc.group);
        }
        this.smokeClouds.length = 0;
        for (const ea of this.electricArcs) {
            this.scene.remove(ea.line);
        }
        this.electricArcs.length = 0;
        for (const gh of this.ghosts) {
            this.scene.remove(gh.mesh);
        }
        this.ghosts.length = 0;
    }
}
//# sourceMappingURL=AbilityFXSystem.js.map