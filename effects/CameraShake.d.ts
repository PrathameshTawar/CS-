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
export declare class CameraShake {
    private readonly camera;
    private readonly requests;
    private readonly tmpOffset;
    constructor(camera: THREE.PerspectiveCamera);
    /** Add a shake impulse. */
    addShake(magnitude: number, duration: number, frequency?: number): void;
    /** Total current shake intensity (0..1-ish). */
    getIntensity(): number;
    /** Apply shake offset to the camera rotation (call after controller). */
    update(deltaTime: number): void;
    clear(): void;
}
//# sourceMappingURL=CameraShake.d.ts.map