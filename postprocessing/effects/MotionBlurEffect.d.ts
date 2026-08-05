/**
 * MotionBlurEffect.ts
 *
 * High-quality camera-space motion blur using depth reprojection.
 * Each pixel's world position is reconstructed from the depth buffer,
 * reprojected through the PREVIOUS frame's view-projection matrix, and the
 * resulting UV delta becomes the blur direction. Supports only camera/object
 * parallax motion (the scene itself must be static between frames), which is
 * the dominant motion source in an FPS camera — the CoD-style look.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
/**
 * Motion blur configuration
 */
export interface MotionBlurConfig {
    intensity: number;
    samples: number;
    maxVelocity: number;
    jitter: boolean;
}
/**
 * Motion blur post-processing effect
 *
 * Uses depth reprojection (previous frame UV - current frame UV) to compute
 * per-pixel velocity, then applies a directional blur along that velocity.
 */
export declare class MotionBlurEffect implements IPostEffect {
    readonly name = "MotionBlur";
    enabled: boolean;
    private config;
    private material;
    private renderer;
    private depthTexture;
    private readonly invViewProjection;
    private previousViewProjection;
    constructor(config?: Partial<MotionBlurConfig>);
    /**
     * Provide the scene depth texture directly (the post chain's intermediate
     * targets don't carry a depth attachment — the HDR target's depth does).
     */
    setDepthTexture(texture: THREE.Texture): void;
    /**
     * Initialize motion blur resources
     */
    initialize(renderer: THREE.WebGLRenderer, _width: number, _height: number): void;
    /**
     * Set the current view-projection matrix and its inverse, plus the previous
     * frame's view-projection for reprojection.
     */
    setMatrices(viewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4): void;
    /**
     * Render the motion blur effect
     */
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, _camera: THREE.PerspectiveCamera): void;
    /**
     * Resize
     */
    setSize(_width: number, _height: number): void;
    /**
     * Dispose
     */
    dispose(): void;
}
//# sourceMappingURL=MotionBlurEffect.d.ts.map