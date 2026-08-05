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
export var ToneMappingOperator;
(function (ToneMappingOperator) {
    ToneMappingOperator["ACES"] = "aces";
    ToneMappingOperator["Reinhard"] = "reinhard";
    ToneMappingOperator["Uncharted2"] = "uncharted2";
    ToneMappingOperator["Filmic"] = "filmic";
    ToneMappingOperator["Linear"] = "linear";
    ToneMappingOperator["Custom"] = "custom";
})(ToneMappingOperator || (ToneMappingOperator = {}));
/**
 * Default HDR configuration
 */
const DEFAULT_HDR_CONFIG = {
    enabled: true,
    exposure: 1.0,
    minExposure: 0.5,
    maxExposure: 2.0,
    exposureAdaptationSpeed: 0.2,
    toneMapping: ToneMappingOperator.ACES,
    whitePoint: 11.2,
    gamma: 2.2,
    bloomThreshold: 0.8,
    useAutoExposure: false,
    luminanceHistogramBins: 64,
    meteringMode: 'center',
};
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
export class HDRPipeline {
    config;
    currentExposure;
    hdrRenderTarget;
    luminanceRenderTarget;
    toneMapMaterial;
    luminanceMaterial;
    renderer = null;
    initialized = false;
    constructor(config) {
        this.config = { ...DEFAULT_HDR_CONFIG, ...config };
        this.currentExposure = this.config.exposure;
        // HDR render target (FP16 for performance) with depth texture for
        // post-processing effects that sample scene depth (e.g. volumetric fog).
        this.hdrRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: true,
            depthTexture: new THREE.DepthTexture(1, 1),
            stencilBuffer: false,
        });
        // Luminance compute target (1x1 pixel)
        this.luminanceRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RedFormat,
            type: THREE.FloatType,
        });
    }
    /**
     * Initialize HDR pipeline resources
     */
    initialize(renderer, width, height) {
        this.renderer = renderer;
        this.hdrRenderTarget.setSize(width, height);
        // Tone mapping shader material
        this.toneMapMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                exposure: { value: this.currentExposure },
                whitePoint: { value: this.config.whitePoint },
                gamma: { value: this.config.gamma },
                toneMapping: { value: this.getToneMappingCode() },
            },
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float exposure;
        uniform float whitePoint;
        uniform float gamma;
        uniform int toneMapping;
        varying vec2 vUv;

        // ACES filmic tone mapping
        vec3 acesToneMap(vec3 color) {
          float a = 2.51;
          float b = 0.03;
          float c = 2.43;
          float d = 0.59;
          float e = 0.14;
          return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
        }

        // Reinhard tone mapping
        vec3 reinhardToneMap(vec3 color) {
          return color / (color + vec3(1.0));
        }

        // Uncharted 2 tone mapping
        vec3 uncharted2ToneMap(vec3 color) {
          float A = 0.15;
          float B = 0.50;
          float C = 0.10;
          float D = 0.20;
          float E = 0.02;
          float F = 0.30;
          return ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
        }

        void main() {
          vec3 hdrColor = texture2D(tDiffuse, vUv).rgb;
          
          // Apply exposure
          vec3 color = hdrColor * exposure;
          
          // Tone mapping
          vec3 mapped;
          if (toneMapping == 0) { // ACES
            mapped = acesToneMap(color);
          } else if (toneMapping == 1) { // Reinhard
            mapped = reinhardToneMap(color);
          } else if (toneMapping == 2) { // Uncharted2
            mapped = uncharted2ToneMap(color);
            float whiteScale = 1.0 / uncharted2ToneMap(vec3(whitePoint)).x;
            mapped *= whiteScale;
          } else { // Linear / default
            mapped = clamp(color, 0.0, 1.0);
          }
          
          // Gamma correction
          mapped = pow(mapped, vec3(1.0 / gamma));
          
          gl_FragColor = vec4(mapped, 1.0);
        }
      `,
        });
        // Luminance computation material
        this.luminanceMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
            },
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          // Compute log average luminance
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          float logLum = log2(max(luminance, 0.0001));
          gl_FragColor = vec4(logLum, 0.0, 0.0, 1.0);
        }
      `,
        });
        this.initialized = true;
    }
    /**
     * Get the tone mapping operator code as integer for shader
     */
    getToneMappingCode() {
        switch (this.config.toneMapping) {
            case ToneMappingOperator.ACES: return 0;
            case ToneMappingOperator.Reinhard: return 1;
            case ToneMappingOperator.Uncharted2: return 2;
            default: return 3;
        }
    }
    /**
     * Begin HDR rendering - sets render target to HDR buffer
     */
    beginFrame() {
        if (!this.initialized || !this.renderer)
            return;
        this.renderer.setRenderTarget(this.hdrRenderTarget);
        this.renderer.clear(true, true, true);
    }
    /**
     * End HDR rendering - applies tone mapping and outputs
     */
    endFrame(outputTarget) {
        if (!this.initialized || !this.renderer)
            return;
        // Update auto-exposure
        if (this.config.useAutoExposure) {
            this.computeAutoExposure();
        }
        // Apply tone mapping
        this.toneMapMaterial.uniforms.tDiffuse.value = this.hdrRenderTarget.texture;
        this.toneMapMaterial.uniforms.exposure.value = this.currentExposure;
        if (outputTarget) {
            this.renderer.setRenderTarget(outputTarget);
        }
        else {
            this.renderer.setRenderTarget(null);
        }
        // Full-screen quad render would go here
    }
    /**
     * Compute auto-exposure using luminance analysis
     */
    computeAutoExposure() {
        if (!this.renderer)
            return;
        // Compute luminance (simplified - real impl would use downsampling)
        this.luminanceMaterial.uniforms.tDiffuse.value = this.hdrRenderTarget.texture;
        this.renderer.setRenderTarget(this.luminanceRenderTarget);
        // Full-screen quad render
        // Read back luminance (in production, use GPU queries)
        const pixels = new Float32Array(1);
        this.renderer.readRenderTargetPixels(this.luminanceRenderTarget, 0, 0, 1, 1, pixels);
        const logLuminance = pixels[0];
        const luminance = Math.pow(2, logLuminance);
        // Smoothly adapt exposure
        const targetExposure = luminance > 0.001
            ? THREE.MathUtils.clamp(1.0 / luminance, this.config.minExposure, this.config.maxExposure)
            : this.currentExposure;
        this.currentExposure = THREE.MathUtils.lerp(this.currentExposure, targetExposure, this.config.exposureAdaptationSpeed);
    }
    /**
     * Get the HDR render target
     */
    getHDRTarget() {
        return this.hdrRenderTarget;
    }
    /**
     * Get current exposure value
     */
    getExposure() {
        return this.currentExposure;
    }
    /**
     * Manually set exposure
     */
    setExposure(exposure) {
        this.currentExposure = THREE.MathUtils.clamp(exposure, this.config.minExposure, this.config.maxExposure);
    }
    /**
     * Enable/disable auto-exposure
     */
    setAutoExposure(enabled) {
        this.config.useAutoExposure = enabled;
    }
    /**
     * Set tone mapping operator
     */
    setToneMapping(operator) {
        this.config.toneMapping = operator;
        if (this.toneMapMaterial) {
            this.toneMapMaterial.uniforms.toneMapping.value = this.getToneMappingCode();
        }
    }
    /**
     * Resize HDR buffers
     */
    setSize(width, height) {
        this.hdrRenderTarget.setSize(width, height);
    }
    /**
     * Dispose HDR resources
     */
    dispose() {
        this.hdrRenderTarget.dispose();
        this.luminanceRenderTarget.dispose();
        if (this.toneMapMaterial)
            this.toneMapMaterial.dispose();
        if (this.luminanceMaterial)
            this.luminanceMaterial.dispose();
        this.initialized = false;
    }
}
//# sourceMappingURL=HDRPipeline.js.map