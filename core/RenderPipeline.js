/**
 * RenderPipeline.ts
 *
 * The master rendering orchestrator.
 * Owns every rendering subsystem and sequences them correctly each frame.
 *
 * Frame order:
 *   1.  TAA jitter       — jitter projection matrix for sub-pixel AA
 *   2.  CSM update       — fit shadow cascade frusta to current camera view
 *   3.  CSM render       — write depth maps from light's POV
 *   4.  HDR begin        — bind float16 render target
 *   5.  Scene render     — forward pass with PBR materials + CSM shadows
 *   6.  Post-processing  — SSAO → MotionBlur → Bloom → TAA resolve
 *   7.  HDR end          — tone-map HDR → LDR
 *   8.  Present          — blit LDR to screen
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { FullScreenTriangle } from './FullScreenTriangle';
import { HDRPipeline } from '../hdr/HDRPipeline';
import { LightingSystem } from '../lighting/LightingSystem';
import { CascadedShadowMap } from '../shadows/CascadedShadowMap';
import { PostProcessingPipeline } from '../postprocessing/PostProcessingPipeline';
import { TAAResolveEffect } from '../postprocessing/effects/TAAResolveEffect';
import { BloomEffect } from '../postprocessing/effects/BloomEffect';
import { MotionBlurEffect } from '../postprocessing/effects/MotionBlurEffect';
import { SSAOEffect } from '../postprocessing/effects/SSAOEffect';
import { GodRaysEffect } from '../postprocessing/effects/GodRaysEffect';
const DEFAULT_PIPELINE_CONFIG = {
    width: 1920,
    height: 1080,
    enableHDR: true,
    enableCSM: true,
    enableSSAO: true,
    enableBloom: true,
    enableMotionBlur: true,
    enableTAA: true,
    enableGodRays: true,
};
/**
 * RenderPipeline — wires all rendering subsystems together.
 */
export class RenderPipeline {
    config;
    renderer;
    tri;
    // Subsystems
    hdr;
    lighting;
    csm;
    post;
    // Effects
    taa;
    bloom;
    motionBlur;
    ssao;
    godRays;
    // LDR output target for post-processing chain
    ldrTarget;
    // Cached blit material — allocated once in initialize(), reused every present pass
    _blitMat;
    // Previous view-projection for velocity
    _previousViewProjection = new THREE.Matrix4();
    // Scratch VP matrix — reused every frame to avoid GC pressure
    _currentViewProjection = new THREE.Matrix4();
    initialized = false;
    constructor(renderer, config) {
        this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
        this.renderer = renderer;
        this.tri = FullScreenTriangle.getInstance();
        const { width, height } = this.config;
        const _native = renderer.getNativeRenderer();
        void _native; // kept for future direct GPU state inspection
        const scene = renderer.getScene();
        // Subsystems
        this.hdr = new HDRPipeline();
        this.lighting = new LightingSystem(scene);
        this.csm = new CascadedShadowMap();
        this.post = new PostProcessingPipeline({ width, height, pixelRatio: 1 });
        // Effects (order matters — they will be added to the post pipeline)
        this.ssao = new SSAOEffect();
        this.motionBlur = new MotionBlurEffect();
        this.godRays = new GodRaysEffect();
        this.bloom = new BloomEffect();
        this.taa = new TAAResolveEffect();
        this.ldrTarget = new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: false,
        });
    }
    /**
     * Initialize all subsystems — must be called after Renderer.initialize()
     */
    initialize() {
        if (this.initialized)
            return;
        const native = this.renderer.getNativeRenderer();
        const { width, height } = this.config;
        // Init subsystems
        if (this.config.enableHDR) {
            this.hdr.initialize(native, width, height);
        }
        if (this.config.enableCSM) {
            this.csm.initialize(native);
        }
        // Init post-processing
        this.post.initialize(native);
        // Depth-based effects (SSAO, MotionBlur) sample the HDR target's real
        // depth texture — intermediate post targets don't carry depth attachments.
        const hdrDepth = this.hdr.getHDRTarget().depthTexture;
        // Add effects in render order:
        //   SSAO → GodRays → MotionBlur → Bloom → TAA
        // GodRays runs before bloom so scattered light gets bloomed naturally.
        if (this.config.enableSSAO) {
            this.ssao.initialize(native, width, height);
            this.ssao.setDepthTexture(hdrDepth);
            this.post.addEffect(this.ssao);
        }
        if (this.config.enableGodRays) {
            this.godRays.initialize(native, width, height);
            this.godRays.setDepthTexture(hdrDepth);
            this.post.addEffect(this.godRays);
        }
        if (this.config.enableMotionBlur) {
            this.motionBlur.initialize(native, width, height);
            this.motionBlur.setDepthTexture(hdrDepth);
            this.post.addEffect(this.motionBlur);
        }
        if (this.config.enableBloom) {
            this.bloom.initialize(native, width, height);
            this.post.addEffect(this.bloom);
        }
        if (this.config.enableTAA) {
            this.taa.initialize(native, width, height);
            this.post.addEffect(this.taa);
        }
        // Build the cached present-pass blit material.
        // THREE only applies tone mapping + sRGB encoding when rendering to the
        // default framebuffer, so the HDR target holds RAW linear values. This
        // present pass is where HDR -> LDR actually happens: exposure, ACES
        // filmic tone mapping, a cinematic color grade (contrast / saturation /
        // warm-cool split / shadow lift), and gamma encoding.
        //
        // NOTE: the grade runs AFTER tone mapping (in display space), where the
        // 0.5 pivot is perceptually meaningful — grading linear HDR values with
        // a 0.5 pivot is wrong (that's why CinematicFX's linear-space contrast
        // was neutralized).
        this._blitMat = new THREE.RawShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                uExposure: { value: this.renderer.getConfig().toneMappingExposure },
                // Cinematic grade controls (display space, after ACES).
                // 1.0 = neutral for contrast/saturation; 0 = neutral for shadows/warm.
                uContrast: { value: 1.28 },
                uSaturation: { value: 1.22 },
                uShadows: { value: 0.26 }, // deepen near-blacks (filmic S-curve)
                uWarm: { value: 0.15 }, // warm shadows / cool highlights split
            },
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
        uniform float uExposure;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uShadows;
        uniform float uWarm;
        varying vec2 vUv;

        // ACES filmic tone mapping (Narkowicz fit)
        vec3 acesToneMap(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;

          // Film-to-display: ACES on the true HDR signal (the post chain no
          // longer clamps, so highlights > 1.0 roll off properly here).
          color = acesToneMap(color);

          // S-curve contrast around the perceptual midpoint
          color = (color - 0.5) * uContrast + 0.5;

          // Saturation boost in display space
          float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(luma), color, uSaturation);

          // Warm shadows / cool highlights split (CoD-style daylight grade)
          color.r += uWarm * (1.0 - luma) * 0.30;
          color.b += uWarm * luma * 0.22;

          // Shadow deepen: filmic S-curve toe — darkens near-blacks for
          // contrast while keeping a small toe so they don't crush to zero.
          color *= 1.0 - uShadows * (1.0 - smoothstep(0.0, 0.45, luma));

          // Gamma encode for display
          color = pow(max(color, 0.0), vec3(1.0 / 2.2));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
            depthTest: false,
            depthWrite: false,
        });
        this.initialized = true;
        console.log('[RenderPipeline] Initialized.');
    }
    /**
     * Execute a full frame render.
     * Called once per frame from RenderModule.
     */
    renderFrame(shadowCasters = []) {
        if (!this.initialized)
            return;
        const native = this.renderer.getNativeRenderer();
        const camera = this.renderer.getCamera();
        const scene = this.renderer.getScene();
        // 1. TAA jitter — must happen BEFORE projection is used to render
        if (this.config.enableTAA) {
            this.taa.nextFrame();
            this.taa.applyJitterToProjection(camera.projectionMatrix);
        }
        // 2. CSM update — fit frusta to current jittered camera
        if (this.config.enableCSM) {
            this.csm.update(camera, new THREE.Vector3(-1, -2, -1).normalize());
        }
        // 3. CSM shadow pass — render depth maps
        if (this.config.enableCSM && shadowCasters.length > 0) {
            this.csm.renderShadows(scene, shadowCasters);
        }
        // 4. Main scene pass — render into HDR target
        if (this.config.enableHDR) {
            this.hdr.beginFrame();
            native.render(scene, camera);
            // Post-processing runs against the HDR target, then tone-maps to LDR.
            // Sync SSAO projection + motion blur reprojection matrices FIRST so
            // they match the frame just rendered (previously they were one frame
            // stale because the SSAO update ran after post.render).
            if (this.config.enableSSAO) {
                this.ssao.setProjectionMatrices(camera.projectionMatrix);
            }
            if (this.config.enableMotionBlur) {
                this._currentViewProjection
                    .copy(camera.projectionMatrix)
                    .multiply(camera.matrixWorldInverse);
                this.motionBlur.setMatrices(this._currentViewProjection, this._previousViewProjection);
            }
            this.post.render(this.hdr.getHDRTarget(), this.ldrTarget, camera);
            this.hdr.endFrame(this.ldrTarget);
        }
        else {
            // Render directly
            native.setRenderTarget(null);
            native.render(scene, camera);
        }
        // 5. Present — blit LDR to screen
        if (this.config.enableHDR) {
            this.blitToScreen(this.ldrTarget);
        }
        // Store current VP for next frame velocity
        this._previousViewProjection
            .copy(camera.projectionMatrix)
            .multiply(camera.matrixWorldInverse);
    }
    /**
     * Blit a render target to the screen — zero allocations, cached material.
     */
    blitToScreen(source) {
        const native = this.renderer.getNativeRenderer();
        this._blitMat.uniforms.tDiffuse.value = source.texture;
        this._blitMat.uniforms.uExposure.value = this.renderer.getConfig().toneMappingExposure;
        this.tri.render(native, this._blitMat, null);
    }
    /**
     * Resize all targets when the viewport changes.
     */
    setSize(width, height) {
        this.config.width = width;
        this.config.height = height;
        this.hdr.setSize(width, height);
        this.post.setSize(width, height); // propagates to all effects via setSize
        this.ldrTarget.setSize(width, height);
    }
    /**
     * Accessors for subsystems (used by other modules to add lights, etc.)
     */
    getLightingSystem() {
        return this.lighting;
    }
    getCSM() {
        return this.csm;
    }
    getHDRPipeline() {
        return this.hdr;
    }
    getPostPipeline() {
        return this.post;
    }
    /** Access the god rays effect for runtime source management. */
    getGodRays() {
        return this.godRays;
    }
    /**
     * Dispose all subsystems.
     */
    dispose() {
        this.hdr.dispose();
        this.csm.dispose();
        this.post.dispose();
        this.ldrTarget.dispose();
        this._blitMat?.dispose();
        this.initialized = false;
    }
}
//# sourceMappingURL=RenderPipeline.js.map