/**
 * VolumetricLightEffect.ts
 *
 * Volumetric fog & light shafts (Requirement 1).
 * Screen-space ray-marched god rays from a directional light (sun),
 * combined with an exponential fog density pass. Rays are rendered by
 * marching toward the light screen position, sampling an occlusion
 * approximation, and accumulating scattered light.
 *
 * This is a lightweight approximation suitable for 60 FPS on WebGL.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../postprocessing/PostProcessingPipeline';
export interface VolumetricLightConfig {
    /** Number of ray-march steps. */
    steps: number;
    /** Light scattering density. */
    density: number;
    /** Fog color. */
    fogColor: number;
    /** Fog density (exponential). */
    fogDensity: number;
    /** Global intensity of the light shafts. */
    intensity: number;
    /** Decay per step. */
    decay: number;
    /** Weight of the light source itself. */
    weight: number;
    /** Exposure boost for the effect. */
    exposure: number;
}
/**
 * Post-processing effect that adds volumetric light shafts and
 * screen-space fog.
 */
export declare class VolumetricLightEffect implements IPostEffect {
    readonly name = "VolumetricLight";
    enabled: boolean;
    private config;
    private material;
    private renderer;
    private depthTexture;
    private lightScreenPos;
    constructor(config?: Partial<VolumetricLightConfig>);
    /**
     * Set the screen-space position of the light source (e.g. sun).
     * Computed by the demo by projecting the sun direction.
     */
    setLightScreenPosition(x: number, y: number): void;
    getFogDensity(): number;
    setFogDensity(density: number): void;
    getFogColor(): THREE.Color;
    setFogColor(color: number): void;
    /** Ray-march scattering density (0..1). Exposed for WorldMutator (R30.4). */
    setDensity(density: number): void;
    /** Global god-ray intensity. Exposed for WorldMutator (R30.4/R30.5). */
    setIntensity(intensity: number): void;
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, _camera: THREE.PerspectiveCamera): void;
    setDepthTexture(texture: THREE.Texture): void;
    setSize(width: number, height: number): void;
    dispose(): void;
}
//# sourceMappingURL=VolumetricLightEffect.d.ts.map