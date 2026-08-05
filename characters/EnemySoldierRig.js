/**
 * EnemySoldierRig.ts
 *
 * Procedural soldier characters for enemy AI. Each class (scout, heavy,
 * sniper, engineer, medic) gets a distinct silhouette: helmet, torso armor,
 * backpack, class-specific weapon and emissive class accents. A simple
 * procedural walk cycle swings the legs/arms, a hit-flash whitens the
 * materials on damage, and death plays a short fall + dissolve.
 *
 * Fully procedural — no external meshes or textures.
 *
 * @module Rendering
 */
import * as THREE from 'three';
const CLASS_ACCENT = {
    scout: 0x66ff66,
    heavy: 0xff5544,
    sniper: 0x44aaff,
    engineer: 0xffaa33,
    medic: 0x33ffaa,
};
export class EnemySoldierRig {
    group = new THREE.Group();
    legL;
    legR;
    armL;
    armR;
    bodyMesh;
    materials = [];
    accentMat;
    walkPhase = 0;
    flashT = 0;
    deathT = 0;
    dead = false;
    baseScale;
    dissolveUniforms = {
        uDissolve: { value: -5.0 },
        uDissolveEdgeColor: { value: new THREE.Color(0xff6611) },
    };
    constructor(def, scale = 1) {
        this.baseScale = def.scale * scale;
        this.accentMat = new THREE.MeshStandardMaterial({
            color: CLASS_ACCENT[def.id] ?? 0x66ff66,
            emissive: CLASS_ACCENT[def.id] ?? 0x66ff66,
            emissiveIntensity: 0.9,
            roughness: 0.4,
        });
        const cloth = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.82, metalness: 0.05 });
        const armor = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.42, metalness: 0.6 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.55, metalness: 0.5 });
        this.materials.push(cloth, armor, dark, this.accentMat);
        for (const mat of this.materials) {
            mat.onBeforeCompile = (shader) => {
                shader.uniforms.uDissolve = this.dissolveUniforms.uDissolve;
                shader.uniforms.uDissolveEdgeColor = this.dissolveUniforms.uDissolveEdgeColor;
                shader.vertexShader = `
          varying vec3 vWorldPosDissolve;
          ${shader.vertexShader}
        `.replace('#include <worldpos_vertex>', `
          #include <worldpos_vertex>
          vWorldPosDissolve = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `);
                shader.fragmentShader = `
          uniform float uDissolve;
          uniform vec3 uDissolveEdgeColor;
          varying vec3 vWorldPosDissolve;
          ${shader.fragmentShader}
        `.replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          float dNoise = sin(vWorldPosDissolve.x * 16.0) * 0.2 + cos(vWorldPosDissolve.y * 16.0) * 0.2 + sin(vWorldPosDissolve.z * 16.0) * 0.2;
          float dVal = vWorldPosDissolve.y * 0.45 + dNoise;
          if (dVal < uDissolve) discard;
          if (dVal < uDissolve + 0.18) {
            float edge = (uDissolve + 0.18 - dVal) / 0.18;
            gl_FragColor.rgb += uDissolveEdgeColor * edge * 3.5;
          }
          `);
            };
        }
        const h = def.scale;
        // --- Legs (pivot at hip) ---
        this.legL = this.makeLeg(dark, h);
        this.legR = this.makeLeg(dark, h);
        this.group.add(this.legL, this.legR);
        // --- Torso ---
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26 * h, 0.52 * h, 4, 8), cloth);
        torso.position.y = 0.92 * h;
        torso.castShadow = true;
        this.group.add(torso);
        this.bodyMesh = torso;
        // Chest armor plate (heavy gets a bigger plate)
        const plateH = def.id === 'heavy' ? 0.36 : 0.3;
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42 * h, plateH * h, 0.16 * h), armor);
        chest.position.set(0, 0.98 * h, 0.06 * h);
        this.group.add(chest);
        // Class backpack
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3 * h, 0.34 * h, 0.16 * h), def.id === 'medic' ? this.accentMat : dark);
        pack.position.set(0, 1.02 * h, -0.24 * h);
        this.group.add(pack);
        // --- Arms (hold weapon) ---
        this.armL = this.makeArm(cloth, h, true);
        this.armR = this.makeArm(cloth, h, false);
        this.group.add(this.armL, this.armR);
        // --- Head + helmet ---
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16 * h, 12, 10), cloth);
        head.position.y = 1.52 * h;
        this.group.add(head);
        const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175 * h, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
        helmet.position.y = 1.55 * h;
        this.group.add(helmet);
        // Visor accent
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2 * h, 0.05 * h, 0.06 * h), this.accentMat);
        visor.position.set(0, 1.5 * h, 0.14 * h);
        this.group.add(visor);
        // --- Weapon by class ---
        this.buildWeapon(def, dark, h);
        // --- Class ring (kept for readability, now on the ground) ---
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34 * h, 0.035 * h, 6, 24), this.accentMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        this.group.add(ring);
        this.group.scale.setScalar(this.baseScale);
    }
    makeLeg(mat, h) {
        const g = new THREE.Group();
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * h, 0.42 * h, 3, 6), mat);
        thigh.position.y = -0.21 * h;
        g.add(thigh);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12 * h, 0.1 * h, 0.22 * h), mat);
        boot.position.set(0, -0.44 * h, 0.03 * h);
        g.add(boot);
        g.position.set(0.12 * h, 0.68 * h, 0);
        return g;
    }
    makeArm(mat, h, left) {
        const g = new THREE.Group();
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06 * h, 0.3 * h, 3, 6), mat);
        upper.position.y = -0.15 * h;
        g.add(upper);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055 * h, 8, 6), mat);
        hand.position.set(0, -0.34 * h, 0.05 * h);
        g.add(hand);
        g.position.set((left ? -1 : 1) * 0.3 * h, 1.18 * h, 0);
        g.rotation.z = left ? 0.12 : -0.12;
        return g;
    }
    buildWeapon(def, dark, h) {
        const gun = new THREE.Group();
        const body = new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.75, roughness: 0.3 });
        this.materials.push(body);
        const box = new THREE.BoxGeometry(0.09 * h, 0.09 * h, 0.42 * h);
        const receiver = new THREE.Mesh(box, body);
        receiver.position.set(0, 0, 0);
        gun.add(receiver);
        const barrelLen = def.id === 'sniper' ? 0.5 : def.id === 'heavy' ? 0.34 : 0.26;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * h, 0.014 * h, barrelLen * h, 8), dark);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.01 * h, -barrelLen * h * 0.5);
        gun.add(barrel);
        if (def.id === 'sniper') {
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * h, 0.022 * h, 0.16 * h, 10), dark);
            scope.rotation.x = Math.PI / 2;
            scope.position.set(0, 0.09 * h, -0.05 * h);
            gun.add(scope);
        }
        else if (def.id === 'heavy') {
            // LMG drum
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * h, 0.07 * h, 0.1 * h, 12), body);
            drum.position.set(0, -0.08 * h, -0.02 * h);
            gun.add(drum);
        }
        else if (def.id === 'medic') {
            // Compact SMG
            gun.scale.setScalar(0.7);
        }
        gun.position.set(0.26 * h, 0.92 * h, 0.28 * h);
        gun.rotation.x = 0.06;
        this.group.add(gun);
    }
    /** White hit-flash on all materials (decays over ~0.12s). */
    hitFlash() {
        this.flashT = 0.14;
    }
    /** Kill the soldier: play fall + sink, then hide. */
    setDead() {
        if (this.dead)
            return;
        this.dead = true;
        this.deathT = 0;
    }
    isDead() {
        return this.dead;
    }
    /** Should the group be hidden yet (after the death animation)? */
    isHidden() {
        return this.dead && this.deathT > 1.6;
    }
    update(deltaTime, pose) {
        // Hit flash decay
        if (this.flashT > 0) {
            this.flashT -= deltaTime;
            const k = Math.max(0, this.flashT / 0.14);
            for (const m of this.materials) {
                m.emissive.setRGB(1, 1, 1);
                m.emissiveIntensity = k * 1.2;
            }
        }
        else if (!this.dead) {
            for (const m of this.materials) {
                if (m === this.accentMat) {
                    m.emissiveIntensity = 0.9;
                }
                else {
                    m.emissiveIntensity = 0;
                }
            }
        }
        if (this.dead) {
            this.deathT += deltaTime;
            const t = this.deathT;
            // Dissolve shader over 0.9s from bottom (-1.0) to top (3.0)
            this.dissolveUniforms.uDissolve.value = THREE.MathUtils.lerp(-1.0, 3.0, Math.min(1, t / 0.9));
            // Fall backward, sink slightly, fade
            this.group.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2.1, Math.min(1, t * 1.8));
            this.group.position.y -= Math.min(0.15, t * 0.18);
            this.group.scale.setScalar(Math.max(0.001, this.baseScale * (1 - Math.max(0, (t - 0.9) * 1.2))));
            return;
        }
        // Walk cycle
        const moving = pose.moving && pose.speed > 0.3;
        if (moving) {
            this.walkPhase += deltaTime * (6 + pose.speed * 1.4);
            const swing = Math.sin(this.walkPhase) * 0.62;
            this.legL.rotation.x = swing;
            this.legR.rotation.x = -swing;
            this.armL.rotation.x = -swing * 0.7;
            this.armR.rotation.x = swing * 0.7;
            // Body bob
            this.bodyMesh.position.y = 0.92 + Math.abs(Math.sin(this.walkPhase)) * 0.03;
        }
        else {
            this.legL.rotation.x = 0;
            this.legR.rotation.x = 0;
            this.armL.rotation.x = 0.1;
            this.armR.rotation.x = -0.1;
        }
        // Accent pulse (medic/class glow)
        const pulse = 0.7 + Math.sin(performance.now() * 0.004) * 0.25;
        this.accentMat.emissiveIntensity = this.flashT > 0 ? 1.2 : pulse;
        this.group.scale.setScalar(this.baseScale);
    }
    dispose() {
        this.group.traverse((o) => {
            if (o instanceof THREE.Mesh)
                o.geometry.dispose();
        });
        for (const m of this.materials)
            m.dispose();
        this.group.removeFromParent();
    }
}
//# sourceMappingURL=EnemySoldierRig.js.map