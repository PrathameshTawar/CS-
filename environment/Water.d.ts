/**
 * Water.ts
 *
 * Implements Requirement 1.1 — AAA Procedural Water System.
 *
 * Features:
 * - Sum-of-Sines / Gerstner wave displacement in vertex & normal evaluation (R1.1)
 * - Planar reflections via mirrored render target & Schlick Fresnel (R1.1)
 * - Depth-based color absorption (shallow turquoise → deep oceanic navy) (R1.1)
 * - Submerged caustic pattern projection onto underwater surfaces (R1.1)
 *
 * @module Rendering
 */
import * as THREE from 'three';
export interface WaterOptions {
    width?: number;
    depth?: number;
    waterHeight?: number;
    shallowColor?: THREE.Color;
    deepColor?: THREE.Color;
}
export declare class Water extends THREE.Mesh {
    private readonly waterMaterial;
    private readonly reflectionTarget;
    private readonly mirrorCamera;
    private waterHeight;
    constructor(scene: THREE.Scene, options?: WaterOptions);
    /**
     * Evaluates Gerstner wave height at world position (x, z) for physics / buoyancy.
     */
    getWaterHeightAt(x: number, z: number): number;
    update(deltaTime: number, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera): void;
    dispose(): void;
}
//# sourceMappingURL=Water.d.ts.map