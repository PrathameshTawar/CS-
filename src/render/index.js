// render/index.js — the render system. Owns the WebGLRenderer, the HDR
// pipeline, the post chain (Karis bloom + AgX composite) and the point-light
// budget. Everything the world draws lands here.
//
// Public surface (see ARCHITECTURE.md):
//   r.renderer, r.registerPass(pass), r.addLight(light, opts),
//   r.requestEnvMap(), r.setEnvMap(tex), r.screenSize, r.depthTexture,
//   r.velocityTexture, r.anisotropy

import * as THREE from 'three';
import { AGX_GLSL } from './agx.glsl.js';
import { FullScreenTriangle, POST_VERT } from './FullScreenTriangle.js';
import { Bloom } from './bloom.js';

const COMPOSITE_FRAG = /* glsl */ `
${AGX_GLSL}
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float exposure;
uniform float bloomStrength;
varying vec2 vUv;

vec3 owLinearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * bloomStrength;
  c *= exposure;
  c = AgXToneMapping(c);
  gl_FragColor = vec4(owLinearToSRGB(c), 1.0);
}`;

const VIEW_FRAG = /* glsl */ `
${AGX_GLSL}
uniform sampler2D tDiffuse;
uniform float exposure;
varying vec2 vUv;

vec3 owLinearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb;
  c *= exposure;
  c = AgXToneMapping(c);
  gl_FragColor = vec4(owLinearToSRGB(c), t.a);
}`;

export class RenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.config = ctx.config;
    this.q = ctx.config.q;

    this.renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: false, // TAA/post chain handles AA
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // applied in the composite
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(1);

    this.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), this.q.anisotropic ?? 8);

    this.screenSize = { width: 1, height: 1 };
    this.velocityTexture = null; // TAA comes later
    this.depthTexture = null;
    this.frameStats = { calls: 0, tris: 0 }; // accumulated across the frame's render() passes

    this._passes = [];
    this._lights = [];
    this._envMap = null;
    this._camPos = new THREE.Vector3();
    this._pingRTs = [null, null];
    this._viewRT = null;

    this._fst = new FullScreenTriangle();
    this._compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        exposure: { value: this.config.exposure },
        bloomStrength: { value: this.config.bloomStrength },
      },
      vertexShader: POST_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this._viewMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, exposure: { value: this.config.exposure } },
      vertexShader: POST_VERT,
      fragmentShader: VIEW_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending,
    });

    this._buildTargets(innerWidth, innerHeight);
    // Compile the post chain once, before the first visible frame.
    this._warmUp();
  }

  _buildTargets(w, h) {
    const q = this.q;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDPR);
    const sw = Math.max(2, Math.floor(w * dpr * q.resolutionScale));
    const sh = Math.max(2, Math.floor(h * dpr * q.resolutionScale));
    if (this.screenSize.width === sw && this.screenSize.height === sh && this.hdrRT) return;

    this._disposeTargets();
    this.screenSize.width = sw;
    this.screenSize.height = sh;

    this.hdrRT = new THREE.WebGLRenderTarget(sw, sh, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.depthTexture = new THREE.DepthTexture(sw, sh, THREE.UnsignedIntType);
    this.depthTexture.format = THREE.DepthFormat;
    this.hdrRT.depthTexture = this.depthTexture;

    this._pingRTs = [
      new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false }),
      new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false }),
    ];
    this._viewRT = new THREE.WebGLRenderTarget(sw, sh, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this._bloom = new Bloom(this.renderer, sw, sh, 4, 0.65);
    this.renderer.setSize(sw, sh, false);
  }

  _disposeTargets() {
    if (this.hdrRT) {
      this.hdrRT.dispose();
      if (this._pingRTs) {
        this._pingRTs[0].dispose();
        this._pingRTs[1].dispose();
      }
      this._viewRT.dispose();
      this.depthTexture.dispose();
      if (this._bloom) this._bloom.dispose();
      this.hdrRT = null;
    }
  }

  // ---- public integration points ----

  registerPass(pass) {
    this._passes.push(pass);
    return () => {
      const i = this._passes.indexOf(pass);
      if (i >= 0) this._passes.splice(i, 1);
    };
  }

  // Registers a punctual light under distance culling. The fade drives
  // intensity to zero but keeps `visible` true — the number of *visible*
  // point lights is a shader permutation key, so it must stay constant.
  addLight(light, opts = {}) {
    const range = opts.range ?? 20;
    light.visible = true;
    this._lights.push({
      light,
      range,
      baseIntensity: opts.intensity ?? light.intensity,
      fadeStart: opts.fadeStart ?? range * 0.65,
    });
    return light;
  }

  requestEnvMap() {
    return this._envMap;
  }

  setEnvMap(tex) {
    this._envMap = tex;
    this.ctx.scene.environment = tex;
  }

  // ---- per-frame ----

  update(dt, ctx) {
    this._collect();
    this._fadeLights();
    this._render();
  }

  _collect() {
    const scene = this.ctx.scene;
    scene.traverse((o) => {
      if (o.isMesh) {
        if (o.userData.owNoShadow) o.castShadow = false;
        if (o.userData.owNoPrepass) {
          /* no depth/normal prepass yet */
        }
      }
    });
  }

  _fadeLights() {
    this.ctx.camera.getWorldPosition(this._camPos);
    for (const L of this._lights) {
      const dist = L.light.position.distanceTo(this._camPos);
      const end = L.range;
      const start = L.fadeStart;
      let t = 1 - (dist - start) / (end - start);
      t = THREE.MathUtils.clamp(t, 0, 1);
      const f = t * t * (3 - 2 * t); // smoothstep
      L.light.intensity = L.baseIntensity * f;
      L.light.visible = true; // permutation-key safety
    }
  }

  _render() {
    const r = this.renderer;
    const ctx = this.ctx;
    const sw = this.screenSize.width;
    const sh = this.screenSize.height;

    // 1) world -> HDR target (linear, no tonemapping)
    r.setRenderTarget(this.hdrRT);
    r.setViewport(0, 0, sw, sh);
    r.clear(true, true, true);
    r.render(ctx.scene, ctx.camera);
    // three resets renderer.info at the start of every render() call, so
    // accumulate real scene stats here before the post chain wipes them.
    this.frameStats.calls = r.info.render.calls;
    this.frameStats.tris = r.info.render.triangles;

    // 2) bloom
    this._bloom.render(this.hdrRT.texture);

    // 3) custom registered passes (ping-pong between two RTs)
    let inTex = this.hdrRT.texture;
    let outRT = this._pingRTs[0];
    for (const pass of this._passes) {
      pass.render(inTex, outRT, ctx);
      inTex = outRT.texture;
      outRT = outRT === this._pingRTs[0] ? this._pingRTs[1] : this._pingRTs[0];
    }

    // 4) composite -> canvas
    this._compositeMat.uniforms.tDiffuse.value = inTex;
    this._compositeMat.uniforms.tBloom.value = this._bloom.texture;
    this._compositeMat.uniforms.exposure.value = this.config.exposure;
    this._fst.setMaterial(this._compositeMat);
    r.setRenderTarget(null);
    r.setViewport(0, 0, sw, sh);
    r.render(this._fst.scene, this._fst.camera);

    // 5) viewScene on top (first-person weapon; never clips through walls).
    // The view target is cleared to alpha 0 and the composite quad blends, so
    // empty pixels let the world show through behind the weapon.
    if (ctx.viewScene.children.length > 0) {
      const vc = ctx.viewCamera;
      vc.fov = this.config.fov; // weapon keeps a fixed FOV (does not ADS-zoom)
      vc.aspect = sw / sh;
      vc.updateProjectionMatrix();
      vc.quaternion.copy(ctx.camera.quaternion);
      vc.position.set(0, 0, 0);
      r.setRenderTarget(this._viewRT);
      r.setViewport(0, 0, sw, sh);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      r.render(ctx.viewScene, vc);
      this.frameStats.calls += r.info.render.calls;
      this.frameStats.tris += r.info.render.triangles;
      r.setClearColor(0x000000, 1);
      this._viewMat.uniforms.tDiffuse.value = this._viewRT.texture;
      this._viewMat.uniforms.exposure.value = this.config.exposure;
      this._fst.setMaterial(this._viewMat);
      r.setRenderTarget(null);
      r.render(this._fst.scene, this._fst.camera);
    }
  }

  // Compile the first-person view pipeline (viewScene render + VIEW_FRAG
  // composite) before the first visible frame, mirroring step 5 of _render().
  // Called by prewarm once the weapon viewmodel exists.
  warmView(ctx) {
    if (!ctx.viewScene.children.length) return;
    const r = this.renderer;
    const sw = this.screenSize.width;
    const sh = this.screenSize.height;
    const vc = ctx.viewCamera;
    vc.fov = this.config.fov;
    vc.aspect = sw / sh;
    vc.updateProjectionMatrix();
    vc.quaternion.copy(ctx.camera.quaternion);
    vc.position.set(0, 0, 0);
    r.setRenderTarget(this._viewRT);
    r.setViewport(0, 0, sw, sh);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(ctx.viewScene, vc);
    r.setClearColor(0x000000, 1);
    this._viewMat.uniforms.tDiffuse.value = this._viewRT.texture;
    this._viewMat.uniforms.exposure.value = this.config.exposure;
    this._fst.setMaterial(this._viewMat);
    // Composite into a ping target (not the visible canvas) — compiles the
    // exact same shader programs and is safe under headless software WebGL.
    r.setRenderTarget(this._pingRTs[0]);
    r.render(this._fst.scene, this._fst.camera);
    r.setRenderTarget(null);
    this._fst.setMaterial(this._compositeMat);
  }

  // Compile the post chain once at boot so the first visible frame is smooth.
  _warmUp() {
    const r = this.renderer;
    const sw = this.screenSize.width;
    const sh = this.screenSize.height;
    r.setRenderTarget(this.hdrRT);
    r.setViewport(0, 0, sw, sh);
    r.clear(true, true, true);
    r.render(this.ctx.scene, this.ctx.camera);
    this._bloom.render(this.hdrRT.texture);
    this._compositeMat.uniforms.tDiffuse.value = this.hdrRT.texture;
    this._compositeMat.uniforms.tBloom.value = this._bloom.texture;
    this._fst.setMaterial(this._compositeMat);
    r.setRenderTarget(null);
    r.setViewport(0, 0, sw, sh);
    r.render(this._fst.scene, this._fst.camera);
  }

  resize(w, h, ctx) {
    this._buildTargets(w, h);
  }

  dispose() {
    this._disposeTargets();
    this._compositeMat.dispose();
    this._viewMat.dispose();
    this._fst.dispose();
    this.renderer.dispose();
  }
}
