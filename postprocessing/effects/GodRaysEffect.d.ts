/**
 * GodRaysEffect.ts
 *
 * Volumetric light scattering ("god rays") implemented as a screen-space
 * post-processing pass using the radial blur technique from:
 *   Lengyel, GPU Gems 3 Ch.13 — "Volumetric Light Scattering as a Post-Process"
 *
 * Algorithm per frame
 * ───────────────────
 *  1. Occlusion pass   — scene rendered as a silhouette: sky = white, geometry = black.
 *                        Output → half-res occlusionTarget.
 *  2. Radial blur pass — for each registered light source, march NUM_SAMPLES steps
 *                        radially outward from the projected light screen-position,
 *                        exponentially attenuating each sample. Supports up to
 *                        MAX_LIGHTS sources in a single pass (uniform array).
 *                        Each source carries a type flag; the type filter bitmask
 *                        lets callers suppress specific categories at runtime without
 *                        touching the source list.
 *  3. Composite pass   — additive blend the scatter buffer on top of scene color.
 *
 * Count & type filter
 * ───────────────────
 *  addLightSource()    — register a source with LightSourceType (Sun | Spot | Point | Custom).
 *  removeLightSource() — deregister by id.
 *  setTypeFilter()     — bitmask of LightSourceType flags; only matching sources are uploaded
 *                        to the GPU each frame. Default = ALL (0xFFFF).
 *  setMaxLights()      — hard cap on how many sources are uploaded per frame (default 4).
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
/**
 * Light source types for the count + type filter.
 * Stored as a bit flag so callers can OR them together.
 * NOTE: plain enum (not const enum) for safe cross-module usage.
 */
export declare enum LightSourceType {
    Sun = 1,// 1
    Spot = 2,// 2
    Point = 4,// 4
    Custom = 8,// 8
    All = 65535
}
/**
 * A single registered volumetric light source.
 */
export interface LightSource {
    /** Unique identifier for this source. */
    id: string;
    /** What kind of light — used by the type filter bitmask. */
    type: LightSourceType;
    /** World-space position of the light (or a distant direction for sun). */
    position: THREE.Vector3;
    /** Per-source colour tint (HDR values allowed). */
    color: THREE.Color;
    /** Master weight multiplier [0, 1]. Fade in/out at runtime. */
    weight: number;
    /** How many samples to march outward (overrides global if > 0). */
    sampleCount?: number;
    /** Enabled flag — cheaper than removing and re-adding. */
    enabled: boolean;
}
/**
 * GodRaysEffect runtime configuration.
 */
export interface GodRaysConfig {
    /** Default exposure / density of the scattering. */
    exposure: number;
    /** Decay factor per sample step [0, 1]. Higher = shorter rays. */
    decay: number;
    /** Density of the sampling grid along each ray. */
    density: number;
    /** Global weight multiplier. */
    weight: number;
    /** Resolution divisor for the occlusion + scatter buffer (2 = half-res). */
    downscale: number;
    /** Bitmask of LightSourceType flags that are uploaded to GPU. Default = All. */
    typeFilter: number;
    /** Hard cap on sources sent to the GPU per frame. Max = MAX_LIGHTS (4). */
    maxLights: number;
}
export declare class GodRaysEffect implements IPostEffect {
    readonly name = "GodRays";
    enabled: boolean;
    private config;
    private readonly sources;
    private renderer;
    private depthTexture;
    private occlusionTarget;
    private scatterTarget;
    private occlusionMat;
    private scatterMat;
    private compositeMat;
    private _width;
    private _height;
    private _passthroughMat;
    private readonly _screenPos;
    private readonly _projMatrix;
    constructor(config?: Partial<GodRaysConfig>);
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): void;
    setSize(width: number, height: number): void;
    setDepthTexture(texture: THREE.Texture): void;
    dispose(): void;
    /**
     * Register a volumetric light source.
     * Returns the id for later removal.
     */
    addLightSource(source: LightSource): string;
    /**
     * Convenience helper — add a sun-type source from a THREE.DirectionalLight.
     */
    addDirectionalSun(id: string, light: THREE.DirectionalLight, weight?: number): string;
    /**
     * Remove a registered source by id.
     */
    removeLightSource(id: string): void;
    /**
     * Update a source's world-space position each frame (e.g. moving sun).
     */
    setLightPosition(id: string, position: THREE.Vector3): void;
    /**
     * Fade a source in or out without removing it.
     */
    setLightWeight(id: string, weight: number): void;
    /**
     * Bitmask of LightSourceType flags. Only sources whose type matches any
     * set bit are uploaded to the GPU this frame.
     * e.g. setTypeFilter(LightSourceType.Sun | LightSourceType.Spot)
     */
    setTypeFilter(mask: number): void;
    /**
     * Hard cap on how many sources are sent to the GPU per frame.
     * Clamped to [1, MAX_LIGHTS].
     */
    setMaxLights(n: number): void;
    /** Get a registered source by id (for runtime tweaking). */
    getLightSource(id: string): LightSource | undefined;
    /** Total registered sources (ignores enabled/filter state). */
    get lightCount(): number;
    setExposure(v: number): void;
    setDecay(v: number): void;
    setDensity(v: number): void;
    setWeight(v: number): void;
    setIntensity(v: number): void;
    /** Build the two half-resolution render targets. */
    private _buildTargets;
    /** Build the three shader materials. */
    private _buildMaterials;
    /**
     * Apply count + type filter and return the active source list,
     * sorted by weight descending, capped to maxLights.
     */
    private _getActiveSources;
    /**
     * Project world-space light positions to screen space and upload to uniforms.
     * Writes directly into the pre-allocated Float32Arrays — zero GC per call.
     */
    private _uploadLightUniforms;
    /** Sync scalar uniforms to the scatter material after a config change. */
    private _syncUniforms;
    /** Pass-through blit when there are no active sources — zero allocations. */
    private _blit;
}
//# sourceMappingURL=GodRaysEffect.d.ts.map