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
 * Default renderer configuration
 */
const DEFAULT_RENDERER_CONFIG = {
    container: document.body,
    width: 1920,
    height: 1080,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    antialiasing: true,
    alpha: false,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.95,
    outputColorSpace: THREE.SRGBColorSpace,
    powerPreference: 'high-performance',
    useWebGPU: false,
    shadowMapSize: 2048,
    shadowMapType: THREE.PCFSoftShadowMap,
    samples: 4,
};
/**
 * Core Renderer class
 *
 * Manages the Three.js renderer, scene, camera, and provides
 * the foundation for all rendering subsystems.
 */
export class Renderer {
    renderer;
    config;
    capabilities;
    scene;
    camera;
    clock;
    resizeObserver = null;
    initialized = false;
    constructor(config) {
        this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.config.width / this.config.height, 0.1, 1000);
        this.clock = new THREE.Clock();
    }
    /**
     * Initialize the renderer
     */
    async initialize() {
        if (this.initialized)
            return;
        // Detect capabilities
        this.capabilities = await this.detectCapabilities();
        // Create the renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.config.antialiasing,
            alpha: this.config.alpha,
            powerPreference: this.config.powerPreference,
            stencil: false,
            depth: true,
        });
        this.renderer.setSize(this.config.width, this.config.height);
        this.renderer.setPixelRatio(this.config.pixelRatio);
        this.renderer.toneMapping = this.config.toneMapping;
        this.renderer.toneMappingExposure = this.config.toneMappingExposure;
        this.renderer.outputColorSpace = this.config.outputColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = this.config.shadowMapType;
        // First-person viewmodels and camera-attached effects (muzzle flash)
        // only render if the camera is part of the scene graph — THREE does not
        // traverse camera children otherwise. This was silently hiding the whole
        // weapon viewmodel (and its reticle) since the demo's inception.
        this.scene.add(this.camera);
        // Use legacy light units: the demo's light intensities (sun ~2-4, hemi
        // ~1-2) are tuned for THREE's pre-r155 semantics. With r155+'s physical
        // default (useLegacyLights=false) those values render ~3x dimmer and
        // crush shadowed surfaces to black.
        // NOTE: useLegacyLights is deprecated (console warning) and removed in a
        // future THREE. Migration path when upgrading: keep this false and scale
        // the demo's light intensities ~3-4x (sun ~12, hemi ~8) to match.
        this.renderer.useLegacyLights = true;
        // Shadow map bias is set per-material in the rendering pipeline
        // Attach to container
        this.config.container.appendChild(this.renderer.domElement);
        // Setup resize handling
        this.setupResizeObserver();
        // Setup default scene
        this.setupDefaultScene();
        this.initialized = true;
        console.log('[Renderer] Initialized successfully');
        console.log(`[Renderer] Vendor: ${this.capabilities.vendor}`);
        console.log(`[Renderer] GPU: ${this.capabilities.renderer}`);
        console.log(`[Renderer] Max Texture Size: ${this.capabilities.maxTextureSize}`);
    }
    /**
     * Detect GPU capabilities
     */
    async detectCapabilities() {
        // Check WebGPU availability
        let supportsWebGPU = false;
        if (navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                supportsWebGPU = !!adapter;
            }
            catch {
                supportsWebGPU = false;
            }
        }
        // For WebGL capabilities, we check after renderer creation
        // but we'll return a placeholder for now
        return {
            supportsWebGPU,
            supportsWebGL2: true,
            maxTextureSize: 16384,
            maxTextureUnits: 16,
            maxSamples: 4,
            maxAnisotropy: 16,
            shaderVersion: '300 es',
            vendor: 'unknown',
            renderer: 'unknown',
        };
    }
    /**
     * Setup resize observer for responsive rendering
     */
    setupResizeObserver() {
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                this.resize(width, height);
            }
        });
        this.resizeObserver.observe(this.config.container);
    }
    /**
     * Setup default scene lighting and environment
     */
    setupDefaultScene() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(ambientLight);
        // Hemisphere light for sky/ground color
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a3a3a, 0.6);
        this.scene.add(hemiLight);
        // Default fog
        this.scene.fog = new THREE.FogExp2(0x000000, 0.005);
    }
    /**
     * Resize the renderer
     */
    resize(width, height) {
        this.config.width = width;
        this.config.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    /**
     * Render a single frame
     */
    render() {
        if (!this.initialized)
            return;
        this.renderer.render(this.scene, this.camera);
    }
    /**
     * Set the render target (for post-processing)
     */
    setRenderTarget(target) {
        this.renderer.setRenderTarget(target);
    }
    /**
     * Get the Three.js renderer instance
     */
    getNativeRenderer() {
        return this.renderer;
    }
    /**
     * Get the scene
     */
    getScene() {
        return this.scene;
    }
    /**
     * Get the camera
     */
    getCamera() {
        return this.camera;
    }
    /**
     * Get the renderer config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get renderer capabilities
     */
    getCapabilities() {
        return { ...this.capabilities };
    }
    /**
     * Get the renderer DOM element
     */
    getDomElement() {
        return this.renderer.domElement;
    }
    /**
     * Get the clock
     */
    getClock() {
        return this.clock;
    }
    /**
     * Set the tone mapping exposure
     */
    setExposure(exposure) {
        this.config.toneMappingExposure = exposure;
        this.renderer.toneMappingExposure = exposure;
    }
    /**
     * Set the clear color
     */
    setClearColor(color, alpha) {
        this.renderer.setClearColor(color, alpha);
    }
    /**
     * Check if the renderer is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Dispose the renderer
     */
    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        // Remove the camera (and its first-person viewmodel children) from the scene
        // so the traverse below does not dispose the shared viewmodel materials.
        this.scene.remove(this.camera);
        this.renderer.dispose();
        // Dispose scene objects
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach((mat) => mat.dispose());
                }
                else {
                    object.material.dispose();
                }
            }
        });
        this.initialized = false;
        console.log('[Renderer] Disposed successfully');
    }
}
//# sourceMappingURL=Renderer.js.map