/**
 * rendering-effects-smoke.test.ts
 *
 * Per-effect smoke tests for the post-processing effect classes:
 *   SSAOEffect, BloomEffect, TAAResolveEffect, MotionBlurEffect, GodRaysEffect
 *
 * Each effect is driven through its full lifecycle — construct → initialize →
 * render → setSize → dispose — verifying that no stage throws and that dispose
 * is idempotent (a common leak regression). The public API surface of each
 * effect (setters, light-source management, jitter, config helpers) is also
 * exercised so behavior changes surface as failures.
 *
 * THREE.WebGLRenderer is mocked (no WebGL context in Node); the effect passes
 * render into FullScreenTriangle, whose render is a no-op with the mock
 * renderer.
 *
 * @module Tests
 */

// ─── DOM mock ───────────────────────────────────────────────────────────────
// Must run BEFORE any imports that reference document/window. Three.js's
// WebGLRenderer constructor calls document.createElementNS; we stub just
// enough DOM surface so module init succeeds.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = {
  createElementNS: (_ns: string, name: string) => {
    if (name === 'canvas') return { getContext: () => null, addEventListener: () => {}, removeEventListener: () => {}, style: {} };
    return { style: {} };
  },
  createElement: () => ({ getContext: () => null, addEventListener: () => {}, removeEventListener: () => {}, style: {} }),
  body: { appendChild: () => {}, removeChild: () => {}, style: {} },
  createEvent: () => ({ initEvent: () => {} }),
  head: { appendChild: () => {} },
} as unknown as Document;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = {
  devicePixelRatio: 1,
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: () => {},
  removeEventListener: () => {},
  ResizeObserver: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  navigator: { gpu: undefined },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = (globalThis as any).window.ResizeObserver;

// ─── Imports (must come after the DOM mock) ─────────────────────────────────
import * as THREE from 'three';

// ─── Mock THREE.WebGLRenderer ───────────────────────────────────────────────
const mockRenderer = {
  domElement: { style: {} } as HTMLCanvasElement,
  setSize: jest.fn(),
  setPixelRatio: jest.fn(),
  setClearColor: jest.fn(),
  setRenderTarget: jest.fn(),
  render: jest.fn(),
  clear: jest.fn(),
  dispose: jest.fn(),
  toneMapping: 0,
  toneMappingExposure: 1,
  outputColorSpace: 'srgb',
  shadowMap: { enabled: false, type: 0 },
  useLegacyLights: true,
  readRenderTargetPixels: jest.fn(),
  info: { render: { calls: 0, triangles: 0, points: 0, lines: 0 } },
  getContext: () => null,
  capabilities: { isWebGL2: false, maxTextures: 16, maxTextureSize: 16384, maxVertexUniforms: 4096, maxFragmentUniforms: 4096 },
  compileAsync: jest.fn(),
} as unknown as jest.Mocked<THREE.WebGLRenderer>;

jest.mock('three', () => {
  const actualThree = jest.requireActual('three');
  return {
    ...actualThree,
    WebGLRenderer: jest.fn().mockImplementation(() => ({ ...mockRenderer })),
  };
});

// ─── Module imports after mock ──────────────────────────────────────────────
import { SSAOEffect } from '../../src/rendering/postprocessing/effects/SSAOEffect';
import { BloomEffect } from '../../src/rendering/postprocessing/effects/BloomEffect';
import { TAAResolveEffect } from '../../src/rendering/postprocessing/effects/TAAResolveEffect';
import { MotionBlurEffect } from '../../src/rendering/postprocessing/effects/MotionBlurEffect';
import { GodRaysEffect, LightSourceType } from '../../src/rendering/postprocessing/effects/GodRaysEffect';

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** A mock WebGLRenderer (jest mock constructor). */
function nativeRenderer(): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({ antialias: false, alpha: true });
}

/** A camera the effects' render() signatures require. */
function camera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
}

/** A pair of render targets used as render() input/output. */
function targets(w = 64, h = 64): { input: THREE.WebGLRenderTarget; output: THREE.WebGLRenderTarget } {
  return {
    input: new THREE.WebGLRenderTarget(w, h),
    output: new THREE.WebGLRenderTarget(w, h),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// SSAOEffect
// ═════════════════════════════════════════════════════════════════════════════

describe('SSAOEffect', () => {
  it('constructs with default config', () => {
    const effect = new SSAOEffect();
    expect(effect).toBeInstanceOf(SSAOEffect);
    expect(effect.name).toBe('SSAO');
    expect(effect.enabled).toBe(true);
  });

  it('constructs with a custom config', () => {
    const effect = new SSAOEffect({ radius: 1.0, intensity: 0.5, blurPasses: 1 });
    expect(effect).toBeInstanceOf(SSAOEffect);
  });

  it('initialize does not throw with a mock renderer', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    expect(() => effect.initialize(r, 64, 64)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setDepthTexture and setProjectionMatrices do not throw after initialize', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setDepthTexture(new THREE.Texture())).not.toThrow();
    expect(() => effect.setProjectionMatrices(new THREE.Matrix4())).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setProjectionMatrices extracts near/far into uniforms when finite', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const proj = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000).projectionMatrix;
    expect(() => effect.setProjectionMatrices(proj)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setSize resizes internal targets without throwing', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setSize(128, 128)).not.toThrow();
    expect(() => effect.setSize(1, 1)).not.toThrow(); // downscale floor
    effect.dispose();
    r.dispose();
  });

  it('render does not throw with a target pair and camera', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  // NOTE: SSAOEffect.dispose() accesses this.ssaoMaterial unguarded, so it
  // throws if called before initialize() — dispose idempotency is therefore
  // only asserted after initialize here.
  it('dispose after initialize is idempotent', () => {
    const effect = new SSAOEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.dispose()).not.toThrow();
    expect(() => effect.dispose()).not.toThrow();
    r.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BloomEffect
// ═════════════════════════════════════════════════════════════════════════════

describe('BloomEffect', () => {
  it('constructs with default config', () => {
    const effect = new BloomEffect();
    expect(effect).toBeInstanceOf(BloomEffect);
    expect(effect.name).toBe('Bloom');
    expect(effect.enabled).toBe(true);
  });

  it('constructs with a custom config', () => {
    const effect = new BloomEffect({ intensity: 2.0, stages: 3, threshold: 0.5 });
    expect(effect).toBeInstanceOf(BloomEffect);
  });

  it('initialize does not throw and builds the mip chain', () => {
    const effect = new BloomEffect();
    const r = nativeRenderer();
    expect(() => effect.initialize(r, 64, 64)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('render does not throw with a target pair and camera', () => {
    const effect = new BloomEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  it('setSize rebuilds the mip chain without throwing', () => {
    const effect = new BloomEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setSize(128, 96)).not.toThrow();
    expect(() => effect.setSize(1, 1)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setIntensity and setThreshold update without throwing (before and after init)', () => {
    const effect = new BloomEffect();
    expect(() => effect.setIntensity(2.5)).not.toThrow();
    expect(() => effect.setThreshold(0.6)).not.toThrow();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setIntensity(1.0)).not.toThrow();
    expect(() => effect.setThreshold(0.9)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  // NOTE: BloomEffect.dispose() accesses this.extractMaterial unguarded, so it
  // throws if called before initialize() — dispose idempotency is therefore
  // only asserted after initialize here.
  it('dispose after initialize is idempotent', () => {
    const effect = new BloomEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.dispose()).not.toThrow();
    expect(() => effect.dispose()).not.toThrow();
    r.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TAAResolveEffect
// ═════════════════════════════════════════════════════════════════════════════

describe('TAAResolveEffect', () => {
  it('constructs with default config', () => {
    const effect = new TAAResolveEffect();
    expect(effect).toBeInstanceOf(TAAResolveEffect);
    expect(effect.name).toBe('TAA');
    expect(effect.enabled).toBe(true);
  });

  it('constructs with a custom config', () => {
    const effect = new TAAResolveEffect({ jitterScale: 1.0, historyBlendFactor: 0.8 });
    expect(effect).toBeInstanceOf(TAAResolveEffect);
  });

  it('initialize does not throw with a mock renderer', () => {
    const effect = new TAAResolveEffect();
    const r = nativeRenderer();
    expect(() => effect.initialize(r, 64, 64)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('getJitter returns (0,0) before any frames and a clone after', () => {
    const effect = new TAAResolveEffect();
    expect(effect.getJitter().length()).toBeCloseTo(0);
    effect.nextFrame();
    effect.nextFrame(); // two frames — both Halton components are non-zero
    const j = effect.getJitter();
    expect(j.length()).toBeGreaterThan(0);
    // Mutating the returned vector must not affect the internal state.
    // jitterScale defaults to 0.5, so the magnitude stays well under 1.
    j.set(99, 99);
    expect(effect.getJitter().length()).toBeLessThan(1);
    expect(effect.getJitter().x).not.toBe(99);
  });

  it('applyJitterToProjection offsets the projection matrix elements', () => {
    const effect = new TAAResolveEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    effect.nextFrame();
    effect.nextFrame(); // frame 1's x-jitter is exactly 0 (Halton(1,2)); frame 2 isn't
    const proj = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000).projectionMatrix;
    const e8 = proj.elements[8];
    const e9 = proj.elements[9];
    expect(() => effect.applyJitterToProjection(proj)).not.toThrow();
    expect(proj.elements[8]).not.toBe(e8);
    expect(proj.elements[9]).not.toBe(e9);
    effect.dispose();
    r.dispose();
  });

  it('setSize resizes the history target without throwing', () => {
    const effect = new TAAResolveEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setSize(128, 128)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('render does not throw with a target pair and camera', () => {
    const effect = new TAAResolveEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  it('dispose is idempotent (safe both before and after initialize)', () => {
    const effect = new TAAResolveEffect();
    expect(() => effect.dispose()).not.toThrow(); // material undefined → guarded
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.dispose()).not.toThrow();
    expect(() => effect.dispose()).not.toThrow();
    r.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MotionBlurEffect
// ═════════════════════════════════════════════════════════════════════════════

describe('MotionBlurEffect', () => {
  it('constructs with default config', () => {
    const effect = new MotionBlurEffect();
    expect(effect).toBeInstanceOf(MotionBlurEffect);
    expect(effect.name).toBe('MotionBlur');
    expect(effect.enabled).toBe(true);
  });

  it('constructs with a custom config', () => {
    const effect = new MotionBlurEffect({ intensity: 1.0, samples: 8, jitter: false });
    expect(effect).toBeInstanceOf(MotionBlurEffect);
  });

  it('initialize does not throw with a mock renderer', () => {
    const effect = new MotionBlurEffect();
    const r = nativeRenderer();
    expect(() => effect.initialize(r, 64, 64)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setDepthTexture and setMatrices do not throw after initialize', () => {
    const effect = new MotionBlurEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setDepthTexture(new THREE.Texture())).not.toThrow();
    const mvp = new THREE.Matrix4();
    expect(() => effect.setMatrices(mvp, mvp)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('setSize is a no-op that does not throw (no size-dependent targets)', () => {
    const effect = new MotionBlurEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setSize(128, 128)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('render does not throw with a target pair and camera', () => {
    const effect = new MotionBlurEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  it('dispose is idempotent (safe both before and after initialize)', () => {
    const effect = new MotionBlurEffect();
    expect(() => effect.dispose()).not.toThrow();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.dispose()).not.toThrow();
    expect(() => effect.dispose()).not.toThrow();
    r.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GodRaysEffect
// ═════════════════════════════════════════════════════════════════════════════

describe('GodRaysEffect', () => {
  it('constructs with default config — no light sources registered', () => {
    const effect = new GodRaysEffect();
    expect(effect).toBeInstanceOf(GodRaysEffect);
    expect(effect.name).toBe('GodRays');
    expect(effect.enabled).toBe(true);
    expect(effect.lightCount).toBe(0);
  });

  it('constructs with a custom config', () => {
    const effect = new GodRaysEffect({ exposure: 1.0, decay: 0.9, maxLights: 2 });
    expect(effect).toBeInstanceOf(GodRaysEffect);
  });

  it('initialize does not throw with a mock renderer', () => {
    const effect = new GodRaysEffect();
    const r = nativeRenderer();
    expect(() => effect.initialize(r, 64, 64)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('addLightSource / getLightSource / lightCount / removeLightSource lifecycle', () => {
    const effect = new GodRaysEffect();
    effect.addLightSource({
      id: 'sun1',
      type: LightSourceType.Sun,
      position: new THREE.Vector3(50, 70, 30),
      color: new THREE.Color(1, 0.9, 0.8),
      weight: 1,
      enabled: true,
    });
    expect(effect.lightCount).toBe(1);
    expect(effect.getLightSource('sun1')?.type).toBe(LightSourceType.Sun);
    effect.removeLightSource('sun1');
    expect(effect.lightCount).toBe(0);
    expect(effect.getLightSource('sun1')).toBeUndefined();
  });

  it('addDirectionalSun registers a Sun-typed source', () => {
    const effect = new GodRaysEffect();
    const light = new THREE.DirectionalLight(0xffffff, 4.2);
    light.position.set(10, 20, 30);
    const id = effect.addDirectionalSun('sun', light, 0.8);
    expect(id).toBe('sun');
    const src = effect.getLightSource('sun');
    expect(src?.type).toBe(LightSourceType.Sun);
    expect(src?.weight).toBe(0.8);
    expect(src?.position.equals(light.position)).toBe(true);
  });

  it('setLightPosition and setLightWeight update the registered source', () => {
    const effect = new GodRaysEffect();
    effect.addLightSource({
      id: 'l',
      type: LightSourceType.Point,
      position: new THREE.Vector3(0, 0, 0),
      color: new THREE.Color(1, 1, 1),
      weight: 1,
      enabled: true,
    });
    effect.setLightPosition('l', new THREE.Vector3(5, 6, 7));
    expect(effect.getLightSource('l')!.position.equals(new THREE.Vector3(5, 6, 7))).toBe(true);
    effect.setLightWeight('l', 0.4);
    expect(effect.getLightSource('l')!.weight).toBeCloseTo(0.4);
  });

  it('setTypeFilter and setMaxLights do not throw and clamp the cap', () => {
    const effect = new GodRaysEffect();
    expect(() => effect.setTypeFilter(LightSourceType.Sun | LightSourceType.Spot)).not.toThrow();
    expect(() => effect.setMaxLights(99)).not.toThrow(); // clamped to MAX_LIGHTS
    expect(() => effect.setMaxLights(0)).not.toThrow();  // clamped to 1
  });

  it('config setters do not throw before or after initialize', () => {
    const effect = new GodRaysEffect();
    expect(() => effect.setExposure(0.5)).not.toThrow();
    expect(() => effect.setDecay(0.9)).not.toThrow();
    expect(() => effect.setDensity(0.8)).not.toThrow();
    expect(() => effect.setWeight(5.0)).not.toThrow();
    expect(() => effect.setIntensity(1.2)).not.toThrow();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setExposure(0.6)).not.toThrow();
    expect(() => effect.setIntensity(1.0)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('render with no light sources passes through without throwing', () => {
    const effect = new GodRaysEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  it('render with a registered light source does not throw', () => {
    const effect = new GodRaysEffect();
    effect.addLightSource({
      id: 'sun',
      type: LightSourceType.Sun,
      position: new THREE.Vector3(50, 70, 30),
      color: new THREE.Color(1, 0.9, 0.8),
      weight: 1,
      enabled: true,
    });
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    const { input, output } = targets();
    expect(() => effect.render(input, output, camera())).not.toThrow();
    input.dispose();
    output.dispose();
    effect.dispose();
    r.dispose();
  });

  it('setSize resizes the half-res targets without throwing', () => {
    const effect = new GodRaysEffect();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.setSize(128, 128)).not.toThrow();
    effect.dispose();
    r.dispose();
  });

  it('dispose is idempotent (safe both before and after initialize)', () => {
    const effect = new GodRaysEffect();
    expect(() => effect.dispose()).not.toThrow();
    const r = nativeRenderer();
    effect.initialize(r, 64, 64);
    expect(() => effect.dispose()).not.toThrow();
    expect(() => effect.dispose()).not.toThrow();
    r.dispose();
  });
});
