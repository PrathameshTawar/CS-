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
export declare class AbilityFXSystem {
    private readonly scene;
    private readonly smokeClouds;
    private readonly electricArcs;
    private readonly ghosts;
    private flashbangIntensity;
    constructor(scene: THREE.Scene);
    /**
     * Spawns a volumetric smoke cloud (R8.1).
     */
    spawnSmokeCloud(pos: {
        x: number;
        y: number;
        z: number;
    }, duration?: number, radius?: number): void;
    /**
     * Triggers Flashbang screen bloom overexposure (R8.2).
     */
    triggerFlashbang(intensity?: number): void;
    getFlashbangIntensity(): number;
    /**
     * Spawns Shock Grenade Electric Arcs (R8.3).
     */
    spawnElectricArcs(pos: {
        x: number;
        y: number;
        z: number;
    }, radius?: number, duration?: number): void;
    /**
     * Spawns a Dash Motion Blur / Ghost Trail afterimage (R8.4).
     */
    spawnGhostTrail(sourceObject: THREE.Object3D, duration?: number): void;
    update(deltaTime: number): void;
    dispose(): void;
}
//# sourceMappingURL=AbilityFXSystem.d.ts.map