/**
 * Renderer.ts
 *
 * Core renderer class that wraps Three.js and manages the rendering pipeline.
 * Supports WebGPU when available with WebGL fallback.
 * Implements a forward+ rendering pipeline with full post-processing stack.
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * Renderer capabilities detected at runtime
 */
export interface RendererCapabilities {
    supportsWebGPU: boolean;
    supportsWebGL2: boolean;
    maxTextureSize: number;
    maxTextureUnits: number;
    maxSamples: number;
    maxAnisotropy: number;
    shaderVersion: string;
    vendor: string;
    renderer: string;
}
/**
 * Renderer configuration
 */
export interface RendererConfig {
    container: HTMLElement;
    width: number;
    height: number;
    pixelRatio: number;
    antialiasing: boolean;
    alpha: boolean;
    toneMapping: THREE.ToneMapping;
    toneMappingExposure: number;
    outputColorSpace: THREE.ColorSpace;
    powerPreference: GPUPreference;
    useWebGPU: boolean;
    shadowMapSize: number;
    shadowMapType: THREE.ShadowMapType;
    samples: number;
}
/**
 * GPU preference for WebGPU
 */
export type GPUPreference = 'high-performance' | 'low-power' | 'default';
/**
 * Core Renderer class
 *
 * Manages the Three.js renderer, scene, camera, and provides
 * the foundation for all rendering subsystems.
 */
export declare class Renderer {
    private renderer;
    private config;
    private capabilities;
    private scene;
    private camera;
    private readonly clock;
    private resizeObserver;
    private initialized;
    constructor(config?: Partial<RendererConfig>);
    /**
     * Initialize the renderer
     */
    initialize(): Promise<void>;
    /**
     * Detect GPU capabilities
     */
    private detectCapabilities;
    /**
     * Setup resize observer for responsive rendering
     */
    private setupResizeObserver;
    /**
     * Setup default scene lighting and environment
     */
    private setupDefaultScene;
    /**
     * Resize the renderer
     */
    resize(width: number, height: number): void;
    /**
     * Render a single frame
     */
    render(): void;
    /**
     * Set the render target (for post-processing)
     */
    setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
    /**
     * Get the Three.js renderer instance
     */
    getNativeRenderer(): THREE.WebGLRenderer;
    /**
     * Get the scene
     */
    getScene(): THREE.Scene;
    /**
     * Get the camera
     */
    getCamera(): THREE.PerspectiveCamera;
    /**
     * Get the renderer config
     */
    getConfig(): Readonly<RendererConfig>;
    /**
     * Get renderer capabilities
     */
    getCapabilities(): RendererCapabilities;
    /**
     * Get the renderer DOM element
     */
    getDomElement(): HTMLCanvasElement;
    /**
     * Get the clock
     */
    getClock(): THREE.Clock;
    /**
     * Set the tone mapping exposure
     */
    setExposure(exposure: number): void;
    /**
     * Set the clear color
     */
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    /**
     * Check if the renderer is initialized
     */
    isInitialized(): boolean;
    /**
     * Dispose the renderer
     */
    dispose(): void;
}
//# sourceMappingURL=Renderer.d.ts.map