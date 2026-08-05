/**
 * BloomEffect.ts
 *
 * High-quality bloom effect with:
 * - Gaussian blur (separable)
 * - Adaptive threshold
 * - Multiple bloom stages
 * - HDR-compatible
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
/**
 * Bloom configuration
 */
export interface BloomConfig {
    intensity: number;
    radius: number;
    threshold: number;
    smoothness: number;
    stages: number;
    downscale: number;
}
/**
 * Bloom post-processing effect
 *
 * Implements an iterative bloom with separable Gaussian blur.
 * Extracts bright areas, applies blur at multiple scales,
 * and composites back onto the original image.
 */
export declare class BloomEffect implements IPostEffect {
    readonly name = "Bloom";
    enabled: boolean;
    private config;
    private readonly mipChain;
    private renderer;
    private width;
    private height;
    private blurMaterial;
    private compositeMaterial;
    private extractMaterial;
    constructor(config?: Partial<BloomConfig>);
    /**
     * Initialize bloom effect resources
     */
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    /**
     * Build the bloom mip chain
     */
    private buildMipChain;
    /**
     * Render the bloom effect
     */
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, _camera: THREE.PerspectiveCamera): void;
    /**
     * Full-screen quad vertex shader
     */
    private getFullScreenQuadVertex;
    /**
     * Resize bloom targets
     */
    setSize(width: number, height: number): void;
    /**
     * Update bloom parameters
     */
    setIntensity(intensity: number): void;
    /**
     * Update bloom threshold
     */
    setThreshold(threshold: number): void;
    /**
     * Dispose bloom resources
     */
    dispose(): void;
}
//# sourceMappingURL=BloomEffect.d.ts.map