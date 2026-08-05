/**
 * RenderPipeline.ts
 *
 * The master rendering orchestrator.
 * Owns every rendering subsystem and sequences them correctly each frame.
 *
 * Frame order:
 *   1.  TAA jitter       — jitter projection matrix for sub-pixel AA
 *   2.  CSM update       — fit shadow cascade frusta to current camera view
 *   3.  CSM render       — write depth maps from light's POV
 *   4.  HDR begin        — bind float16 render target
 *   5.  Scene render     — forward pass with PBR materials + CSM shadows
 *   6.  Post-processing  — SSAO → MotionBlur → Bloom → TAA resolve
 *   7.  HDR end          — tone-map HDR → LDR
 *   8.  Present          — blit LDR to screen
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { Renderer } from './Renderer';
import { HDRPipeline } from '../hdr/HDRPipeline';
import { LightingSystem } from '../lighting/LightingSystem';
import { CascadedShadowMap } from '../shadows/CascadedShadowMap';
import { PostProcessingPipeline } from '../postprocessing/PostProcessingPipeline';
import { GodRaysEffect } from '../postprocessing/effects/GodRaysEffect';
/**
 * Render pipeline configuration
 */
export interface RenderPipelineConfig {
    width: number;
    height: number;
    enableHDR: boolean;
    enableCSM: boolean;
    enableSSAO: boolean;
    enableBloom: boolean;
    enableMotionBlur: boolean;
    enableTAA: boolean;
    enableGodRays: boolean;
}
/**
 * RenderPipeline — wires all rendering subsystems together.
 */
export declare class RenderPipeline {
    private readonly config;
    private readonly renderer;
    private readonly tri;
    private readonly hdr;
    private readonly lighting;
    private readonly csm;
    private readonly post;
    private readonly taa;
    private readonly bloom;
    private readonly motionBlur;
    private readonly ssao;
    private readonly godRays;
    private readonly ldrTarget;
    private _blitMat;
    private _previousViewProjection;
    private readonly _currentViewProjection;
    private initialized;
    constructor(renderer: Renderer, config?: Partial<RenderPipelineConfig>);
    /**
     * Initialize all subsystems — must be called after Renderer.initialize()
     */
    initialize(): void;
    /**
     * Execute a full frame render.
     * Called once per frame from RenderModule.
     */
    renderFrame(shadowCasters?: THREE.Object3D[]): void;
    /**
     * Blit a render target to the screen — zero allocations, cached material.
     */
    private blitToScreen;
    /**
     * Resize all targets when the viewport changes.
     */
    setSize(width: number, height: number): void;
    /**
     * Accessors for subsystems (used by other modules to add lights, etc.)
     */
    getLightingSystem(): LightingSystem;
    getCSM(): CascadedShadowMap;
    getHDRPipeline(): HDRPipeline;
    getPostPipeline(): PostProcessingPipeline;
    /** Access the god rays effect for runtime source management. */
    getGodRays(): GodRaysEffect;
    /**
     * Dispose all subsystems.
     */
    dispose(): void;
}
//# sourceMappingURL=RenderPipeline.d.ts.map