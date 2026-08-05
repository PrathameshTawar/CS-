/**
 * GISystem.ts
 *
 * Implements Requirement 2.1 & 2.3 — Dynamic Diffuse Global Illumination (DDGI)
 * irradiance probe grid approximation.
 *
 * Features:
 * - 3D irradiance probe grid spanning the playable environment (R2.1)
 * - Real-time indirect diffuse irradiance evaluation with bounce coloring (R2.1)
 * - Trilinear interpolation + hemispherical normal weighting (R2.1)
 * - Dynamic object sampling for players, weapons, and physics debris (R2.3)
 *
 * @module Rendering
 */
import * as THREE from 'three';
export interface GIProbe {
    position: THREE.Vector3;
    irradiance: THREE.Color;
}
export interface GISystemOptions {
    minBounds?: THREE.Vector3;
    maxBounds?: THREE.Vector3;
    gridResolution?: {
        x: number;
        y: number;
        z: number;
    };
    skyColor?: THREE.Color;
    groundColor?: THREE.Color;
}
export declare class GISystem {
    private readonly probes;
    private readonly minBounds;
    private readonly maxBounds;
    private readonly gridRes;
    private readonly skyColor;
    private readonly groundColor;
    private time;
    constructor(options?: GISystemOptions);
    private initializeProbes;
    /**
     * Updates probe irradiance colors based on scene lights and bounce (R2.1).
     */
    update(deltaTime: number, lights?: (THREE.Object3D | THREE.Light)[]): void;
    /**
     * Samples trilinearly interpolated indirect irradiance at worldPos (R2.1, R2.3).
     */
    sampleIrradiance(worldPos: THREE.Vector3, normal?: THREE.Vector3): THREE.Color;
    /**
     * Samples GI probe volume and applies indirect irradiance to dynamic objects (R2.3).
     */
    updateDynamicObjects(objects: THREE.Object3D[]): void;
    dispose(): void;
}
//# sourceMappingURL=GISystem.d.ts.map