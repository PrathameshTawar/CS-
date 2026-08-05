/**
 * WebGPUAdapter.ts
 *
 * WebGPU backend adapter for the renderer.
 * Provides a fallback/alternative to WebGL when WebGPU is available.
 * Handles device initialization, shader compilation, and pipeline setup.
 *
 * @module Rendering
 */
/**
 * Default WebGPU adapter options
 */
const DEFAULT_WEBGPU_OPTIONS = {
    powerPreference: 'high-performance',
    forceFallbackAdapter: false,
};
/**
 * WebGPU Adapter
 *
 * Manages the WebGPU device lifecycle and provides
 * a simplified interface for rendering operations.
 */
export class WebGPUAdapter {
    adapter = null;
    device = null;
    context = null;
    options;
    initialized = false;
    deviceInfo = null;
    constructor(options) {
        this.options = { ...DEFAULT_WEBGPU_OPTIONS, ...options };
    }
    /**
     * Initialize WebGPU adapter and device
     */
    async initialize(canvas) {
        if (!navigator.gpu) {
            console.warn('[WebGPU] WebGPU is not available on this browser.');
            return false;
        }
        try {
            // Request adapter
            this.adapter = await navigator.gpu.requestAdapter({
                powerPreference: this.options.powerPreference,
                forceFallbackAdapter: this.options.forceFallbackAdapter,
            });
            if (!this.adapter) {
                console.warn('[WebGPU] No WebGPU adapter found.');
                return false;
            }
            // Request device
            this.device = await this.adapter.requestDevice({
                requiredFeatures: this.options.requiredFeatures,
                requiredLimits: this.options.requiredLimits,
            });
            if (!this.device) {
                console.warn('[WebGPU] Failed to create WebGPU device.');
                return false;
            }
            // Get device info
            this.deviceInfo = this.queryDeviceInfo();
            // Configure canvas context
            this.context = canvas.getContext('webgpu');
            if (!this.context) {
                console.warn('[WebGPU] Failed to get WebGPU canvas context.');
                return false;
            }
            // Handle device lost
            this.device.lost.then((info) => {
                console.warn(`[WebGPU] Device lost: ${info.message}`);
                this.initialized = false;
            });
            this.initialized = true;
            console.log('[WebGPU] Initialized successfully');
            console.log(`[WebGPU] Adapter: ${this.deviceInfo.adapterName}`);
            return true;
        }
        catch (error) {
            console.error('[WebGPU] Initialization failed:', error);
            return false;
        }
    }
    /**
     * Query device information and capabilities
     */
    queryDeviceInfo() {
        if (!this.adapter || !this.device) {
            throw new Error('WebGPU not initialized.');
        }
        const adapterInfo = this.adapter.info;
        const limits = this.device.limits;
        return {
            adapterName: adapterInfo?.vendor ?? 'unknown',
            deviceName: adapterInfo?.architecture ?? 'unknown',
            maxTextureDimension2D: limits.maxTextureDimension2D,
            maxTextureArrayLayers: limits.maxTextureArrayLayers,
            maxBindGroups: limits.maxBindGroups,
            maxDynamicUniformBuffersPerPipelineLayout: limits.maxDynamicUniformBuffersPerPipelineLayout,
            maxSampledTexturesPerShaderStage: limits.maxSampledTexturesPerShaderStage,
            maxSamplersPerShaderStage: limits.maxSamplersPerShaderStage,
            maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
            maxStorageTexturesPerShaderStage: limits.maxStorageTexturesPerShaderStage,
            maxUniformBuffersPerShaderStage: limits.maxUniformBuffersPerShaderStage,
            maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize,
            timestampQuerySupport: !!this.device.features.has('timestamp-query'),
        };
    }
    /**
     * Configure the swap chain for rendering
     */
    configureSwapChain(_width, _height) {
        if (!this.context || !this.device)
            return;
        this.context.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: 'premultiplied',
        });
    }
    /**
     * Create a shader module from WGSL code
     */
    createShaderModule(code) {
        if (!this.device) {
            throw new Error('WebGPU device not initialized.');
        }
        return this.device.createShaderModule({ code });
    }
    /**
     * Create a render pipeline
     */
    createRenderPipeline(descriptor) {
        if (!this.device) {
            throw new Error('WebGPU device not initialized.');
        }
        return this.device.createRenderPipeline(descriptor);
    }
    /**
     * Get the current frame's texture view
     */
    getCurrentTextureView() {
        if (!this.context)
            return null;
        return this.context.getCurrentTexture().createView();
    }
    /**
     * Submit a command buffer
     */
    submitCommandBuffer(commandBuffer) {
        if (!this.device)
            return;
        this.device.queue.submit([commandBuffer]);
    }
    /**
     * Create a command encoder
     */
    createCommandEncoder() {
        if (!this.device) {
            throw new Error('WebGPU device not initialized.');
        }
        return this.device.createCommandEncoder();
    }
    /**
     * Get the GPU device
     */
    getDevice() {
        return this.device;
    }
    /**
     * Get device information
     */
    getDeviceInfo() {
        return this.deviceInfo;
    }
    /**
     * Check if WebGPU is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Resize the swap chain
     */
    resize(width, height) {
        this.configureSwapChain(width, height);
    }
    /**
     * Dispose WebGPU resources
     */
    dispose() {
        if (this.device) {
            this.device.destroy();
        }
        this.adapter = null;
        this.device = null;
        this.context = null;
        this.initialized = false;
    }
}
//# sourceMappingURL=WebGPUAdapter.js.map