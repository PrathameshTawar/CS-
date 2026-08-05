/**
 * MuzzleFlash.ts
 *
 * Muzzle flash: a brief point light plus an additive billboard sprite
 * attached to the camera. Spawned on every weapon fire for immediate
 * visual feedback (Requirement 6.1).
 *
 * @module Rendering
 */
import * as THREE from 'three';
export declare class MuzzleFlash {
    private readonly light;
    private readonly sprite;
    private readonly spriteMat;
    private readonly group;
    private timer;
    private duration;
    constructor(camera: THREE.PerspectiveCamera);
    /**
     * Reposition the whole flash to a camera-local offset (viewmodel muzzle).
     */
    setOffset(x: number, y: number, z: number): void;
    trigger(sizeScale: number, intensity: number): void;
    update(deltaTime: number): void;
    dispose(): void;
}
//# sourceMappingURL=MuzzleFlash.d.ts.map