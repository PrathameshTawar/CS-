/**
 * CameraShake.ts
 *
 * Camera shake controller (Requirement 6.5). Applies decaying random
 * offsets to the camera rotation. Magnitude is inversely proportional
 * to weapon stability and amplified for headshot kills.
 *
 * @module Rendering
 */
import * as THREE from 'three';
export class CameraShake {
    camera;
    requests = [];
    tmpOffset = new THREE.Vector3();
    constructor(camera) {
        this.camera = camera;
    }
    /** Add a shake impulse. */
    addShake(magnitude, duration, frequency = 10) {
        this.requests.push({ magnitude, duration, frequency, elapsed: 0 });
        // Cap concurrent shakes
        if (this.requests.length > 8) {
            this.requests.shift();
        }
    }
    /** Total current shake intensity (0..1-ish). */
    getIntensity() {
        let total = 0;
        for (const r of this.requests) {
            const t = 1 - r.elapsed / r.duration;
            total += r.magnitude * t * t;
        }
        return Math.min(1, total);
    }
    /** Apply shake offset to the camera rotation (call after controller). */
    update(deltaTime) {
        const intensity = this.getIntensity();
        if (intensity > 0.001) {
            const time = performance.now() / 1000;
            let noiseX = 0;
            let noiseY = 0;
            let noiseZ = 0;
            for (const r of this.requests) {
                const t = 1 - r.elapsed / r.duration;
                const amp = r.magnitude * t * t * 0.004;
                noiseX += Math.sin(time * r.frequency * 2 * Math.PI * 1.7) * amp;
                noiseY += Math.sin(time * r.frequency * 2 * Math.PI * 2.3 + 1.3) * amp;
                noiseZ += Math.sin(time * r.frequency * 2 * Math.PI * 1.1 + 2.7) * amp * 0.5;
            }
            this.camera.rotation.x += noiseX;
            this.camera.rotation.y += noiseY;
            this.camera.rotation.z += noiseZ;
        }
        // Decay
        for (let i = this.requests.length - 1; i >= 0; i--) {
            this.requests[i].elapsed += deltaTime;
            if (this.requests[i].elapsed >= this.requests[i].duration) {
                this.requests.splice(i, 1);
            }
        }
        void this.tmpOffset;
    }
    clear() {
        this.requests.length = 0;
    }
}
//# sourceMappingURL=CameraShake.js.map