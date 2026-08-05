/**
 * GodRaysEffect.ts
 *
 * Volumetric light scattering ("god rays") implemented as a screen-space
 * post-processing pass using the radial blur technique from:
 *   Lengyel, GPU Gems 3 Ch.13 — "Volumetric Light Scattering as a Post-Process"
 *
 * Algorithm per frame
 * ───────────────────
 *  1. Occlusion pass   — scene rendered as a silhouette: sky = white, geometry = black.
 *                        Output → half-res occlusionTarget.
 *  2. Radial blur pass — for each registered light source, march NUM_SAMPLES steps
 *                        radially outward from the projected light screen-position,
 *                        exponentially attenuating each sample. Supports up to
 *                        MAX_LIGHTS sources in a single pass (uniform array).
 *                        Each source carries a type flag; the type filter bitmask
 *                        lets callers suppress specific categories at runtime without
 *                        touching the source list.
 *  3. Composite pass   — additive blend the scatter buffer on top of scene color.
 *
 * Count & type filter
 * ───────────────────
 *  addLightSource()    — register a source with LightSourceType (Sun | Spot | Point | Custom).
 *  removeLightSource() — deregister by id.
 *  setTypeFilter()     — bitmask of LightSourceType flags; only matching sources are uploaded
 *                        to the GPU each frame. Default = ALL (0xFFFF).
 *  setMaxLights()      — hard cap on how many sources are uploaded per frame (default 4).
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { FullScreenTriangle } from '../../core/FullScreenTriangle';
// ─── Constants ────────────────────────────────────────────────────────────────
/** Maximum simultaneous god-ray sources the GPU shader supports. */
const MAX_LIGHTS = 4;
/** Radial blur sample count — matches the #define in the fragment shader. */
const NUM_SAMPLES = 100;
// ─── Public types ─────────────────────────────────────────────────────────────
/**
 * Light source types for the count + type filter.
 * Stored as a bit flag so callers can OR them together.
 * NOTE: plain enum (not const enum) for safe cross-module usage.
 */
export var LightSourceType;
(function (LightSourceType) {
    LightSourceType[LightSourceType["Sun"] = 1] = "Sun";
    LightSourceType[LightSourceType["Spot"] = 2] = "Spot";
    LightSourceType[LightSourceType["Point"] = 4] = "Point";
    LightSourceType[LightSourceType["Custom"] = 8] = "Custom";
    LightSourceType[LightSourceType["All"] = 65535] = "All";
})(LightSourceType || (LightSourceType = {}));
const DEFAULT_CONFIG = {
    // Moody volumetric scattering: punchier exposure, slightly longer rays and
    // a bit more density so shafts read clearly against the fog.
    exposure: 0.42,
    decay: 0.96,
    density: 0.9,
    weight: 6.5,
    downscale: 2,
    typeFilter: LightSourceType.All,
    maxLights: MAX_LIGHTS,
};
// ─── Shader sources ───────────────────────────────────────────────────────────
/**
 * Shared vertex shader — plain pass-through used by all three passes.
 * Works with the FullScreenTriangle geometry (no projectionMatrix math needed).
 */
const VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  varying   vec2 vUv;
  void main() {
    vUv         = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
/**
 * Pass 1 — Occlusion silhouette.
 * Where depth >= 1.0 (sky) output white; everywhere else output black.
 * This produces the "holes" through which the light can scatter.
 */
const OCCLUSION_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;       // scene depth buffer [0,1]
  uniform sampler2D tScene;       // full scene colour (for bright-spot extraction)
  uniform float     threshold;    // luminance cutoff to count as "sky"
  varying vec2      vUv;

  void main() {
    float depth     = texture2D(tDepth, vUv).r;
    vec3  sceneCol  = texture2D(tScene, vUv).rgb;
    float luminance = dot(sceneCol, vec3(0.2126, 0.7152, 0.0722));

    // Sky = very far depth OR very bright (e.g. sun disc)
    float skyMask = step(0.9999, depth) + step(threshold, luminance);
    skyMask       = clamp(skyMask, 0.0, 1.0);

    gl_FragColor = vec4(vec3(skyMask), 1.0);
  }
`;
/**
 * Pass 2 — Radial blur / volumetric scatter.
 * Marches NUM_SAMPLES steps from each pixel toward the projected light position,
 * accumulating occluded light with exponential decay.
 * Supports up to MAX_LIGHTS sources in a single pass.
 */
const SCATTER_FRAG = /* glsl */ `
  precision highp float;

  #define NUM_SAMPLES ${NUM_SAMPLES}
  #define MAX_LIGHTS  ${MAX_LIGHTS}

  uniform sampler2D tOcclusion;            // output of pass 1
  uniform int       lightCount;            // actual source count this frame
  uniform vec2      lightScreenPos[MAX_LIGHTS]; // NDC screen positions [0,1]
  uniform vec3      lightColor[MAX_LIGHTS];     // HDR colour tint
  uniform float     lightWeight[MAX_LIGHTS];    // per-source weight

  uniform float exposure;
  uniform float decay;
  uniform float density;
  uniform float weight;

  varying vec2 vUv;

  void main() {
    vec3 scatter = vec3(0.0);

    for (int l = 0; l < MAX_LIGHTS; l++) {
      if (l >= lightCount) break;

      vec2  texCoord  = vUv;
      vec2  deltaUV   = (texCoord - lightScreenPos[l]) * (1.0 / float(NUM_SAMPLES)) * density;
      float illum     = 1.0;

      for (int i = 0; i < NUM_SAMPLES; i++) {
        texCoord   -= deltaUV;
        float samp  = texture2D(tOcclusion, clamp(texCoord, 0.0, 1.0)).r;
        samp       *= illum * weight;
        scatter    += samp * lightColor[l] * lightWeight[l];
        illum      *= decay;
      }
    }

    gl_FragColor = vec4(scatter * exposure, 1.0);
  }
`;
/**
 * Pass 3 — Additive composite.
 * Blends the scatter buffer on top of the original HDR scene colour.
 */
const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;    // original scene HDR
  uniform sampler2D tScatter;  // output of pass 2
  uniform float     intensity; // master blend strength
  varying vec2 vUv;

  void main() {
    vec4 scene   = texture2D(tScene,   vUv);
    vec3 scatter = texture2D(tScatter, vUv).rgb;
    // Additive blend — preserves HDR headroom
    gl_FragColor = vec4(scene.rgb + scatter * intensity, scene.a);
  }
`;
// ─── Effect class ─────────────────────────────────────────────────────────────
export class GodRaysEffect {
    name = 'GodRays';
    enabled = true;
    config;
    // Registered light sources
    sources = new Map();
    // GPU resources
    renderer = null;
    depthTexture = null;
    occlusionTarget;
    scatterTarget;
    occlusionMat;
    scatterMat;
    compositeMat;
    // Viewport dimensions — stored for setSize, used by _buildTargets
    _width = 1920;
    _height = 1080;
    // Cached pass-through blit material (used when no sources are active)
    _passthroughMat;
    // Scratch objects reused every frame — avoids GC pressure
    _screenPos = new THREE.Vector3();
    _projMatrix = new THREE.Matrix4();
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ─── IPostEffect ────────────────────────────────────────────────────────────
    initialize(renderer, width, height) {
        this.renderer = renderer;
        this._width = width;
        this._height = height;
        this._buildTargets(width, height);
        this._buildMaterials();
    }
    render(input, output, camera) {
        if (!this.renderer)
            return;
        const activeSources = this._getActiveSources();
        if (activeSources.length === 0) {
            // Nothing to scatter — pass through unchanged
            this._blit(input, output);
            return;
        }
        const tri = FullScreenTriangle.getInstance();
        // ── Pass 1: occlusion silhouette ──────────────────────────────────────────
        this.occlusionMat.uniforms.tScene.value = input.texture;
        this.occlusionMat.uniforms.tDepth.value =
            this.depthTexture ?? input.depthTexture ?? input.texture;
        tri.render(this.renderer, this.occlusionMat, this.occlusionTarget);
        // ── Pass 2: radial scatter ────────────────────────────────────────────────
        this._uploadLightUniforms(activeSources, camera);
        this.scatterMat.uniforms.tOcclusion.value = this.occlusionTarget.texture;
        tri.render(this.renderer, this.scatterMat, this.scatterTarget);
        // ── Pass 3: composite ─────────────────────────────────────────────────────
        this.compositeMat.uniforms.tScene.value = input.texture;
        this.compositeMat.uniforms.tScatter.value = this.scatterTarget.texture;
        tri.render(this.renderer, this.compositeMat, output);
    }
    setSize(width, height) {
        this._width = width;
        this._height = height;
        if (this.occlusionTarget) {
            const dw = Math.max(1, Math.floor(this._width / this.config.downscale));
            const dh = Math.max(1, Math.floor(this._height / this.config.downscale));
            this.occlusionTarget.setSize(dw, dh);
            this.scatterTarget.setSize(dw, dh);
        }
    }
    setDepthTexture(texture) {
        this.depthTexture = texture;
    }
    dispose() {
        this.occlusionTarget?.dispose();
        this.scatterTarget?.dispose();
        this.occlusionMat?.dispose();
        this.scatterMat?.dispose();
        this.compositeMat?.dispose();
        this._passthroughMat?.dispose();
        this.sources.clear();
    }
    // ─── Light source API ────────────────────────────────────────────────────────
    /**
     * Register a volumetric light source.
     * Returns the id for later removal.
     */
    addLightSource(source) {
        this.sources.set(source.id, source);
        return source.id;
    }
    /**
     * Convenience helper — add a sun-type source from a THREE.DirectionalLight.
     */
    addDirectionalSun(id, light, weight = 1.0) {
        return this.addLightSource({
            id,
            type: LightSourceType.Sun,
            position: light.position.clone(),
            color: light.color.clone(),
            weight,
            enabled: true,
        });
    }
    /**
     * Remove a registered source by id.
     */
    removeLightSource(id) {
        this.sources.delete(id);
    }
    /**
     * Update a source's world-space position each frame (e.g. moving sun).
     */
    setLightPosition(id, position) {
        const src = this.sources.get(id);
        if (src)
            src.position.copy(position);
    }
    /**
     * Fade a source in or out without removing it.
     */
    setLightWeight(id, weight) {
        const src = this.sources.get(id);
        if (src)
            src.weight = THREE.MathUtils.clamp(weight, 0, 1);
    }
    /**
     * Bitmask of LightSourceType flags. Only sources whose type matches any
     * set bit are uploaded to the GPU this frame.
     * e.g. setTypeFilter(LightSourceType.Sun | LightSourceType.Spot)
     */
    setTypeFilter(mask) {
        this.config.typeFilter = mask;
    }
    /**
     * Hard cap on how many sources are sent to the GPU per frame.
     * Clamped to [1, MAX_LIGHTS].
     */
    setMaxLights(n) {
        this.config.maxLights = THREE.MathUtils.clamp(n, 1, MAX_LIGHTS);
    }
    /** Get a registered source by id (for runtime tweaking). */
    getLightSource(id) {
        return this.sources.get(id);
    }
    /** Total registered sources (ignores enabled/filter state). */
    get lightCount() {
        return this.sources.size;
    }
    // ─── Config helpers ──────────────────────────────────────────────────────────
    setExposure(v) { this.config.exposure = v; this._syncUniforms(); }
    setDecay(v) { this.config.decay = v; this._syncUniforms(); }
    setDensity(v) { this.config.density = v; this._syncUniforms(); }
    setWeight(v) { this.config.weight = v; this._syncUniforms(); }
    setIntensity(v) {
        if (this.compositeMat) {
            this.compositeMat.uniforms.intensity.value = v;
        }
    }
    // ─── Private helpers ─────────────────────────────────────────────────────────
    /** Build the two half-resolution render targets. */
    _buildTargets(width, height) {
        const dw = Math.max(1, Math.floor(width / this.config.downscale));
        const dh = Math.max(1, Math.floor(height / this.config.downscale));
        const rtParams = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: false,
            stencilBuffer: false,
        };
        this.occlusionTarget = new THREE.WebGLRenderTarget(dw, dh, rtParams);
        this.scatterTarget = new THREE.WebGLRenderTarget(dw, dh, rtParams);
    }
    /** Build the three shader materials. */
    _buildMaterials() {
        // ── Pass 1: occlusion ────────────────────────────────────────────────────
        this.occlusionMat = new THREE.RawShaderMaterial({
            uniforms: {
                tScene: { value: null },
                tDepth: { value: null },
                threshold: { value: 0.9 }, // luminance above which a pixel counts as sky
            },
            vertexShader: VERT,
            fragmentShader: OCCLUSION_FRAG,
            depthTest: false,
            depthWrite: false,
        });
        // ── Pass 2: scatter ──────────────────────────────────────────────────────
        // Pre-allocate flat typed arrays for GPU array uniforms.
        // THREE.RawShaderMaterial requires flat Float32Arrays for vec2[]/vec3[] arrays.
        const posFlat = new Float32Array(MAX_LIGHTS * 2); // vec2[MAX_LIGHTS]
        const colFlat = new Float32Array(MAX_LIGHTS * 3); // vec3[MAX_LIGHTS]
        const wgtFlat = new Float32Array(MAX_LIGHTS); // float[MAX_LIGHTS]
        this.scatterMat = new THREE.RawShaderMaterial({
            uniforms: {
                tOcclusion: { value: null },
                lightCount: { value: 0 },
                lightScreenPos: { value: posFlat },
                lightColor: { value: colFlat },
                lightWeight: { value: wgtFlat },
                exposure: { value: this.config.exposure },
                decay: { value: this.config.decay },
                density: { value: this.config.density },
                weight: { value: this.config.weight },
            },
            vertexShader: VERT,
            fragmentShader: SCATTER_FRAG,
            depthTest: false,
            depthWrite: false,
        });
        // ── Pass 3: composite ────────────────────────────────────────────────────
        this.compositeMat = new THREE.RawShaderMaterial({
            uniforms: {
                tScene: { value: null },
                tScatter: { value: null },
                intensity: { value: 1.0 },
            },
            vertexShader: VERT,
            fragmentShader: COMPOSITE_FRAG,
            depthTest: false,
            depthWrite: false,
        });
        // ── Pass-through blit (no active sources) ────────────────────────────────
        this._passthroughMat = new THREE.RawShaderMaterial({
            uniforms: { tDiffuse: { value: null } },
            vertexShader: VERT,
            fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
      `,
            depthTest: false, depthWrite: false,
        });
    }
    /**
     * Apply count + type filter and return the active source list,
     * sorted by weight descending, capped to maxLights.
     */
    _getActiveSources() {
        const mask = this.config.typeFilter;
        const cap = this.config.maxLights;
        return Array.from(this.sources.values())
            .filter(s => s.enabled && (s.type & mask) !== 0 && s.weight > 0)
            .sort((a, b) => b.weight - a.weight) // highest weight rendered first
            .slice(0, cap);
    }
    /**
     * Project world-space light positions to screen space and upload to uniforms.
     * Writes directly into the pre-allocated Float32Arrays — zero GC per call.
     */
    _uploadLightUniforms(sources, camera) {
        const u = this.scatterMat.uniforms;
        const posFlat = u.lightScreenPos.value;
        const colFlat = u.lightColor.value;
        const wgtFlat = u.lightWeight.value;
        this._projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        for (let i = 0; i < MAX_LIGHTS; i++) {
            const src = sources[i];
            if (!src) {
                // Zero out any slot beyond the active count
                posFlat[i * 2] = 0.5;
                posFlat[i * 2 + 1] = 0.5;
                colFlat[i * 3] = 0;
                colFlat[i * 3 + 1] = 0;
                colFlat[i * 3 + 2] = 0;
                wgtFlat[i] = 0;
                continue;
            }
            // World → clip space with proper w-divide
            this._screenPos.copy(src.position).applyMatrix4(this._projMatrix);
            // _screenPos.x/y are in NDC after applyMatrix4 only if w=1.
            // For directional lights the position is effectively at infinity;
            // callers should pass a large-magnitude direction scaled into scene units.
            // Convert NDC [-1,1] → UV [0,1]
            posFlat[i * 2] = (this._screenPos.x + 1.0) * 0.5;
            posFlat[i * 2 + 1] = (this._screenPos.y + 1.0) * 0.5;
            colFlat[i * 3] = src.color.r;
            colFlat[i * 3 + 1] = src.color.g;
            colFlat[i * 3 + 2] = src.color.b;
            wgtFlat[i] = src.weight;
        }
        u.lightCount.value = sources.length;
        u.exposure.value = this.config.exposure;
        u.decay.value = this.config.decay;
        u.density.value = this.config.density;
        u.weight.value = this.config.weight;
        // Mark the array uniforms as needing re-upload
        u.lightScreenPos.value = posFlat;
        u.lightColor.value = colFlat;
        u.lightWeight.value = wgtFlat;
    }
    /** Sync scalar uniforms to the scatter material after a config change. */
    _syncUniforms() {
        if (!this.scatterMat)
            return;
        this.scatterMat.uniforms.exposure.value = this.config.exposure;
        this.scatterMat.uniforms.decay.value = this.config.decay;
        this.scatterMat.uniforms.density.value = this.config.density;
        this.scatterMat.uniforms.weight.value = this.config.weight;
    }
    /** Pass-through blit when there are no active sources — zero allocations. */
    _blit(src, dst) {
        if (!this.renderer)
            return;
        this._passthroughMat.uniforms.tDiffuse.value = src.texture;
        FullScreenTriangle.getInstance().render(this.renderer, this._passthroughMat, dst);
    }
}
//# sourceMappingURL=GodRaysEffect.js.map