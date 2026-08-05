/**
 * WebGPUAdapter.ts
 *
 * WebGPU backend adapter for the renderer.
 * Provides a fallback/alternative to WebGL when WebGPU is available.
 * Handles device initialization, shader compilation, and pipeline setup.
 *
 * @module Rendering
 */
/// <reference types="@webgpu/types" />
/**
 * WebGPU device information
 */
export interface WebGPUDeviceInfo {
    adapterName: string;
    deviceName: string;
    maxTextureDimension2D: number;
    maxTextureArrayLayers: number;
    maxBindGroups: number;
    maxDynamicUniformBuffersPerPipelineLayout: number;
    maxSampledTexturesPerShaderStage: number;
    maxSamplersPerShaderStage: number;
    maxStorageBuffersPerShaderStage: number;
    maxStorageTexturesPerShaderStage: number;
    maxUniformBuffersPerShaderStage: number;
    maxUniformBufferBindingSize: number;
    timestampQuerySupport: boolean;
}
/**
 * WebGPU adapter initialization options
 */
export interface WebGPUAdapterOptions {
    powerPreference?: GPUPowerPreference;
    forceFallbackAdapter?: boolean;
    requiredFeatures?: string[];
    requiredLimits?: Record<string, number>;
}
/**
 * WebGPU Adapter
 *
 * Manages the WebGPU device lifecycle and provides
 * a simplified interface for rendering operations.
 */
export declare class WebGPUAdapter {
    private adapter;
    private device;
    private context;
    private options;
    private initialized;
    private deviceInfo;
    constructor(options?: Partial<WebGPUAdapterOptions>);
    /**
     * Initialize WebGPU adapter and device
     */
    initialize(canvas: HTMLCanvasElement): Promise<boolean>;
    /**
     * Query device information and capabilities
     */
    private queryDeviceInfo;
    /**
     * Configure the swap chain for rendering
     */
    configureSwapChain(_width: number, _height: number): void;
    /**
     * Create a shader module from WGSL code
     */
    createShaderModule(code: string): GPUShaderModule;
    /**
     * Create a render pipeline
     */
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    /**
     * Get the current frame's texture view
     */
    getCurrentTextureView(): GPUTextureView | null;
    /**
     * Submit a command buffer
     */
    submitCommandBuffer(commandBuffer: GPUCommandBuffer): void;
    /**
     * Create a command encoder
     */
    createCommandEncoder(): GPUCommandEncoder;
    /**
     * Get the GPU device
     */
    getDevice(): GPUDevice | null;
    /**
     * Get device information
     */
    getDeviceInfo(): WebGPUDeviceInfo | null;
    /**
     * Check if WebGPU is initialized
     */
    isInitialized(): boolean;
    /**
     * Resize the swap chain
     */
    resize(width: number, height: number): void;
    /**
     * Dispose WebGPU resources
     */
    dispose(): void;
}
//# sourceMappingURL=WebGPUAdapter.d.ts.map