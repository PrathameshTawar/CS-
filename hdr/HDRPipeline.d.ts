/**
 * HDRPipeline.ts
 *
 * High Dynamic Range rendering pipeline.
 * Manages HDR framebuffers, tone mapping, exposure adaptation,
 * and eye adaptation (auto-exposure).
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * Tone mapping operators
 */
export declare enum ToneMappingOperator {
    ACES = "aces",
    Reinhard = "reinhard",
    Uncharted2 = "uncharted2",
    Filmic = "filmic",
    Linear = "linear",
    Custom = "custom"
}
/**
 * HDR pipeline configuration
 */
export interface HDRPipelineConfig {
    enabled: boolean;
    exposure: number;
    minExposure: number;
    maxExposure: number;
    exposureAdaptationSpeed: number;
    toneMapping: ToneMappingOperator;
    whitePoint: number;
    gamma: number;
    bloomThreshold: number;
    useAutoExposure: boolean;
    luminanceHistogramBins: number;
    meteringMode: 'center' | 'average' | 'spot';
}
/**
 * HDR Pipeline
 *
 * Manages the HDR rendering workflow:
 * 1. Scene renders to HDR framebuffer (Float16/32)
 * 2. Luminance computation for auto-exposure
 * 3. Tone mapping from HDR to LDR
 * 4. Gamma correction
 * 5. Output to display or post-processing
 */
export declare class HDRPipeline {
    private config;
    private currentExposure;
    private readonly hdrRenderTarget;
    private readonly luminanceRenderTarget;
    private toneMapMaterial;
    private luminanceMaterial;
    private renderer;
    private initialized;
    constructor(config?: Partial<HDRPipelineConfig>);
    /**
     * Initialize HDR pipeline resources
     */
    initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void;
    /**
     * Get the tone mapping operator code as integer for shader
     */
    private getToneMappingCode;
    /**
     * Begin HDR rendering - sets render target to HDR buffer
     */
    beginFrame(): void;
    /**
     * End HDR rendering - applies tone mapping and outputs
     */
    endFrame(outputTarget: THREE.WebGLRenderTarget | null): void;
    /**
     * Compute auto-exposure using luminance analysis
     */
    private computeAutoExposure;
    /**
     * Get the HDR render target
     */
    getHDRTarget(): THREE.WebGLRenderTarget;
    /**
     * Get current exposure value
     */
    getExposure(): number;
    /**
     * Manually set exposure
     */
    setExposure(exposure: number): void;
    /**
     * Enable/disable auto-exposure
     */
    setAutoExposure(enabled: boolean): void;
    /**
     * Set tone mapping operator
     */
    setToneMapping(operator: ToneMappingOperator): void;
    /**
     * Resize HDR buffers
     */
    setSize(width: number, height: number): void;
    /**
     * Dispose HDR resources
     */
    dispose(): void;
}
//# sourceMappingURL=HDRPipeline.d.ts.map