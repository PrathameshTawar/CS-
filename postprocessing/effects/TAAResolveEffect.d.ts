/**
 * TAAResolveEffect.ts
 *
 * Temporal Anti-Aliasing (TAA) resolve effect.
 * Uses sub-pixel jittering across frames and resolves
 * using a history buffer with neighborhood clamping.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
/**
 * TAA configuration
 */
export interface TAAConfig {
    jitterScale: number;
    historyBlendFactor: number;
    sharpness: number;
    useVelocity: boolean;
}
/**
 * TAA (Temporal Anti-Aliasing) effect
 *
 * Accumulates samples over multiple frames using
 * sub-pixel jitter and a history buffer with
 * neighborhood clamping to reduce ghosting.
 */
export declare class TAAResolveEffect implements IPostEffect {
    readonly name = "TAA";
    enabled: boolean;
    private config;
    private readonly historyTarget;
    private material;
    private renderer;
    private width;
    private height;
    private frameIndex;
    private currentJitter;
    constructor(config?: Partial<TAAConfig>);
    /**
     * Initialize TAA resources
     */
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    /**
     * Get the current sub-pixel jitter offset
     */
    getJitter(): THREE.Vector2;
    /**
     * Advance to the next frame (updates jitter)
     */
    nextFrame(): void;
    /**
     * Apply jitter to a projection matrix
     */
    applyJitterToProjection(projection: THREE.Matrix4): void;
    /**
     * Render the TAA resolve
     */
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, _camera: THREE.PerspectiveCamera): void;
    /**
     * Resize
     */
    setSize(width: number, height: number): void;
    /**
     * Dispose
     */
    dispose(): void;
}
//# sourceMappingURL=TAAResolveEffect.d.ts.map