/**
 * SSAOEffect.ts
 *
 * Screen Space Ambient Occlusion using a depth-derived normal + hemisphere
 * sampling approach. Normals are reconstructed from the depth buffer, so no
 * G-buffer normal pass is required. The occlusion result is blurred with a
 * separable blur and then composited onto the scene as `scene * AO`.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
/**
 * SSAO configuration
 */
export interface SSAOConfig {
    radius: number;
    bias: number;
    intensity: number;
    power: number;
    samples: number;
    blurPasses: number;
    downscale: number;
}
/**
 * SSAO (Screen Space Ambient Occlusion) effect
 *
 * Approximates ambient occlusion in screen space by sampling the depth buffer
 * around each pixel and computing the occlusion factor, then multiplies the
 * scene colour by the blurred occlusion.
 */
export declare class SSAOEffect implements IPostEffect {
    readonly name = "SSAO";
    enabled: boolean;
    private config;
    private readonly samples;
    private ssaoMaterial;
    private blurMaterial;
    private compositeMaterial;
    private readonly ssaoRenderTarget;
    private readonly blurRenderTarget;
    private renderer;
    private noiseTexture;
    private depthTexture;
    constructor(config?: Partial<SSAOConfig>);
    /**
     * Generate a random noise texture for sample rotation
     */
    private generateNoiseTexture;
    /**
     * Provide the scene depth texture directly (the post chain's intermediate
     * targets don't carry a depth attachment — the HDR target's depth does).
     */
    setDepthTexture(texture: THREE.Texture): void;
    /**
     * Initialize SSAO resources
     */
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    /**
     * Set the projection matrix for reconstruction (near/far are extracted
     * from the matrix so depth can be linearized in the shader).
     */
    setProjectionMatrices(projection: THREE.Matrix4): void;
    /**
     * Render the SSAO effect
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
//# sourceMappingURL=SSAOEffect.d.ts.map