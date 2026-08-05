/**
 * SkyDome.ts
 *
 * Procedural sky dome rendered with a single shader: gradient sky, sun disc
 * with glow, drifting procedural clouds, and a star field at night. The dome
 * follows the camera so the horizon always sits at the fog line. Weather and
 * time-of-day are driven by the WorldMutator through setAtmosphere().
 *
 * Fully procedural — no textures or external assets.
 *
 * @module Rendering
 */
import * as THREE from 'three';
export interface SkyAtmosphere {
    /** Zenith sky color (RGB hex). */
    zenith: number;
    /** Horizon sky color (RGB hex). */
    horizon: number;
    /** Sun disc + glow color. */
    sunColor: number;
    /** Sun direction (normalized, world space). */
    sunDirection?: THREE.Vector3;
    /** 0..1 — how much cloud cover. */
    cloudCover: number;
    /** Sun brightness multiplier. */
    sunIntensity: number;
    /** 0..1 — star visibility (night). */
    starIntensity: number;
}
/**
 * A skydome that keeps itself centered on the camera.
 */
export declare class SkyDome {
    private readonly mesh;
    private readonly material;
    private readonly sunDir;
    private time;
    constructor(scene: THREE.Scene);
    /**
     * Apply weather / time-of-day. Called by the WorldMutator on every mutation.
     */
    setAtmosphere(atmo: SkyAtmosphere): void;
    /** Keep the dome centered on the camera (x/z) so the horizon never moves. */
    update(deltaTime: number, camera: THREE.PerspectiveCamera): void;
    dispose(): void;
}
//# sourceMappingURL=SkyDome.d.ts.map