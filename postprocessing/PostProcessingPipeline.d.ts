/**
 * PostProcessingPipeline.ts
 *
 * Modular post-processing pipeline with support for:
 * - Bloom
 * - Motion blur
 * - TAA (Temporal Anti-Aliasing)
 * - SSAO (Screen Space Ambient Occlusion)
 * - Color grading
 * - Custom effects
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * Post-processing effect base class
 */
export interface IPostEffect {
    readonly name: string;
    enabled: boolean;
    /** Called once after the pipeline has a renderer. */
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): void;
    setSize(width: number, height: number): void;
    dispose(): void;
}
/**
 * Post-processing pipeline configuration
 */
export interface PostPipelineConfig {
    width: number;
    height: number;
    pixelRatio: number;
    bloomEnabled: boolean;
    motionBlurEnabled: boolean;
    taaEnabled: boolean;
    ssaoEnabled: boolean;
    bloomIntensity: number;
    bloomRadius: number;
    bloomThreshold: number;
    motionBlurIntensity: number;
    motionBlurSamples: number;
    ssaoRadius: number;
    ssaoBias: number;
    ssaoIntensity: number;
}
/**
 * The main post-processing pipeline
 *
 * Manages a chain of post-processing effects that are applied
 * sequentially after the main scene render pass.
 */
export declare class PostProcessingPipeline {
    private readonly effects;
    private readonly config;
    private readonly renderTargets;
    private activeTarget;
    private renderer;
    private initialized;
    /** Cached passthrough blit material — reused by blit()/blitToScreen(). */
    private blitMaterial;
    constructor(config?: Partial<PostPipelineConfig>);
    /**
     * Create a render target with HDR support
     */
    private createRenderTarget;
    /**
     * Initialize the pipeline with a renderer reference
     */
    initialize(renderer: THREE.WebGLRenderer): void;
    /**
     * Add an effect to the pipeline
     */
    addEffect(effect: IPostEffect, index?: number): void;
    /**
     * Remove an effect from the pipeline
     */
    removeEffect(effectName: string): void;
    /**
     * Get an effect by name
     */
    getEffect<T extends IPostEffect>(name: string): T | undefined;
    /**
     * Execute the full post-processing pipeline.
     *
     * @param input  - The input render target (scene HDR output)
     * @param output - The final output target (screen or next step)
     * @param camera - The active camera — passed to every effect so
     *                 projection-dependent passes (SSAO, MotionBlur, GodRays)
     *                 always have the current frame's matrices.
     */
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null, camera?: THREE.PerspectiveCamera): void;
    /**
     * Blit one render target to another (full-screen triangle pass).
     */
    private blit;
    /**
     * Blit a render target directly to the screen
     */
    private blitToScreen;
    /**
     * Resize all render targets and effects
     */
    setSize(width: number, height: number): void;
    /**
     * Get the current config
     */
    getConfig(): Readonly<PostPipelineConfig>;
    /**
     * Update pipeline configuration at runtime
     */
    updateConfig(partial: Partial<PostPipelineConfig>): void;
    /**
     * Dispose all effects and render targets
     */
    dispose(): void;
}
//# sourceMappingURL=PostProcessingPipeline.d.ts.map