/**
 * PostProcessingPipeline.ts
 *
 * Modular post-processing pipeline with support for:
 * - Bloom
 * - Motion blur
 * - TAA (Temporal Anti-Aliasing)
 * - SSAO (Screen Space Ambient Occlusion)
 * - Color grading
 * - Custom effects
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { FullScreenTriangle } from '../core/FullScreenTriangle';
/**
 * Default post-processing configuration
 */
const DEFAULT_POST_CONFIG = {
    width: 1920,
    height: 1080,
    pixelRatio: 1,
    bloomEnabled: true,
    motionBlurEnabled: true,
    taaEnabled: true,
    ssaoEnabled: true,
    bloomIntensity: 1.5,
    bloomRadius: 0.4,
    bloomThreshold: 0.85,
    motionBlurIntensity: 0.5,
    motionBlurSamples: 8,
    ssaoRadius: 0.5,
    ssaoBias: 0.025,
    ssaoIntensity: 1.0,
};
/**
 * The main post-processing pipeline
 *
 * Manages a chain of post-processing effects that are applied
 * sequentially after the main scene render pass.
 */
export class PostProcessingPipeline {
    effects = [];
    config;
    renderTargets;
    activeTarget = 0;
    renderer = null;
    initialized = false;
    /** Cached passthrough blit material — reused by blit()/blitToScreen(). */
    blitMaterial = null;
    constructor(config) {
        this.config = { ...DEFAULT_POST_CONFIG, ...config };
        // Create double-buffered render targets
        this.renderTargets = [
            this.createRenderTarget(this.config.width, this.config.height),
            this.createRenderTarget(this.config.width, this.config.height),
        ];
    }
    /**
     * Create a render target with HDR support
     */
    createRenderTarget(width, height) {
        return new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType, // HDR support
            depthBuffer: true,
            stencilBuffer: false,
            samples: 0, // MSAA is done before post-processing
        });
    }
    /**
     * Initialize the pipeline with a renderer reference
     */
    initialize(renderer) {
        this.renderer = renderer;
        this.blitMaterial = new THREE.RawShaderMaterial({
            uniforms: { tDiffuse: { value: null } },
            vertexShader: /* glsl */ `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
            fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
      `,
            depthTest: false,
            depthWrite: false,
        });
        this.initialized = true;
    }
    /**
     * Add an effect to the pipeline
     */
    addEffect(effect, index) {
        if (index !== undefined) {
            this.effects.splice(index, 0, effect);
        }
        else {
            this.effects.push(effect);
        }
        effect.setSize(this.config.width, this.config.height);
        // If the pipeline is already initialized, initialize the effect immediately
        if (this.initialized && this.renderer) {
            effect.initialize(this.renderer, this.config.width, this.config.height);
        }
    }
    /**
     * Remove an effect from the pipeline
     */
    removeEffect(effectName) {
        const index = this.effects.findIndex((e) => e.name === effectName);
        if (index !== -1) {
            this.effects[index].dispose();
            this.effects.splice(index, 1);
        }
    }
    /**
     * Get an effect by name
     */
    getEffect(name) {
        return this.effects.find((e) => e.name === name);
    }
    /**
     * Execute the full post-processing pipeline.
     *
     * @param input  - The input render target (scene HDR output)
     * @param output - The final output target (screen or next step)
     * @param camera - The active camera — passed to every effect so
     *                 projection-dependent passes (SSAO, MotionBlur, GodRays)
     *                 always have the current frame's matrices.
     */
    render(input, output, camera) {
        if (!this.initialized || !this.renderer)
            return;
        const cam = camera ?? null;
        const enabledEffects = this.effects.filter((e) => e.enabled);
        if (enabledEffects.length === 0) {
            if (output) {
                this.blit(input, output);
            }
            else {
                this.blitToScreen(input);
            }
            return;
        }
        let currentInput = input;
        for (let i = 0; i < enabledEffects.length; i++) {
            const effect = enabledEffects[i];
            const isLast = i === enabledEffects.length - 1;
            if (isLast && !output) {
                effect.render(currentInput, null, cam);
            }
            else if (isLast && output) {
                effect.render(currentInput, output, cam);
            }
            else {
                const nextTarget = this.renderTargets[this.activeTarget ^ 1];
                effect.render(currentInput, nextTarget, cam);
                currentInput = nextTarget;
                this.activeTarget ^= 1;
            }
        }
    }
    /**
     * Blit one render target to another (full-screen triangle pass).
     */
    blit(source, dest) {
        if (!this.renderer || !this.blitMaterial)
            return;
        this.blitMaterial.uniforms.tDiffuse.value = source.texture;
        FullScreenTriangle.getInstance().render(this.renderer, this.blitMaterial, dest);
    }
    /**
     * Blit a render target directly to the screen
     */
    blitToScreen(source) {
        if (!this.renderer || !this.blitMaterial)
            return;
        this.blitMaterial.uniforms.tDiffuse.value = source.texture;
        FullScreenTriangle.getInstance().render(this.renderer, this.blitMaterial, null);
    }
    /**
     * Resize all render targets and effects
     */
    setSize(width, height) {
        this.config.width = width;
        this.config.height = height;
        for (const rt of this.renderTargets) {
            rt.setSize(width, height);
        }
        for (const effect of this.effects) {
            effect.setSize(width, height);
        }
    }
    /**
     * Get the current config
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update pipeline configuration at runtime
     */
    updateConfig(partial) {
        Object.assign(this.config, partial);
    }
    /**
     * Dispose all effects and render targets
     */
    dispose() {
        for (const effect of this.effects) {
            effect.dispose();
        }
        for (const rt of this.renderTargets) {
            rt.dispose();
        }
        this.blitMaterial?.dispose();
        this.blitMaterial = null;
        this.effects.length = 0;
        this.initialized = false;
    }
}
//# sourceMappingURL=PostProcessingPipeline.js.map