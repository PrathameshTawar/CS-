/**
 * TracerSystem.ts
 *
 * Renders glowing bullet tracers (Requirement 6.2). Tracers are short-lived
 * line segments with a gradient glow effect, rendered additively.
 *
 * @module Rendering
 */
import * as THREE from 'three';
const MAX_TRACERS = 64;
export class TracerSystem {
    tracers = [];
    group;
    material;
    geometry;
    line;
    positions = new Float32Array(MAX_TRACERS * 2 * 3);
    colors = new Float32Array(MAX_TRACERS * 2 * 3);
    tempColor = new THREE.Color();
    constructor(scene) {
        this.group = new THREE.Group();
        this.material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            linewidth: 2,
        });
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setDrawRange(0, 0);
        this.line = new THREE.Line(this.geometry, this.material);
        this.line.frustumCulled = false;
        this.group.add(this.line);
        scene.add(this.group);
    }
    /**
     * Spawn a tracer from start toward end.
     */
    spawnTracer(start, end, color, life = 0.06) {
        if (this.tracers.length >= MAX_TRACERS) {
            this.tracers.shift();
        }
        this.tracers.push({
            start: new THREE.Vector3(start.x, start.y, start.z),
            end: new THREE.Vector3(end.x, end.y, end.z),
            color: new THREE.Color(color),
            life: 0,
            maxLife: life,
        });
    }
    update(deltaTime) {
        // Fade out expired tracers
        for (let i = this.tracers.length - 1; i >= 0; i--) {
            const t = this.tracers[i];
            t.life += deltaTime;
            if (t.life >= t.maxLife) {
                this.tracers.splice(i, 1);
            }
        }
        const count = this.tracers.length;
        for (let i = 0; i < count; i++) {
            const t = this.tracers[i];
            const alpha = 1 - t.life / t.maxLife;
            // Fade tail: the "end" vertex fades faster for a directional streak
            this.positions[i * 6 + 0] = t.start.x;
            this.positions[i * 6 + 1] = t.start.y;
            this.positions[i * 6 + 2] = t.start.z;
            this.positions[i * 6 + 3] = t.end.x;
            this.positions[i * 6 + 4] = t.end.y;
            this.positions[i * 6 + 5] = t.end.z;
            this.tempColor.copy(t.color).multiplyScalar(alpha);
            this.colors[i * 6 + 0] = this.tempColor.r;
            this.colors[i * 6 + 1] = this.tempColor.g;
            this.colors[i * 6 + 2] = this.tempColor.b;
            this.tempColor.copy(t.color).multiplyScalar(alpha * 0.15);
            this.colors[i * 6 + 3] = this.tempColor.r;
            this.colors[i * 6 + 4] = this.tempColor.g;
            this.colors[i * 6 + 5] = this.tempColor.b;
        }
        this.geometry.setDrawRange(0, count * 2);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
    clear() {
        this.tracers.length = 0;
        this.geometry.setDrawRange(0, 0);
    }
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.group.removeFromParent();
    }
}
//# sourceMappingURL=TracerSystem.js.map