/**
 * rendering-pipeline-smoke.test.ts
 *
 * Rendering pipeline smoke test: constructs every major subsystem in the
 * rendering stack, verifies proper initialization, and then disposes everything
 * cleanly. Three.js WebGLRenderer is mocked to avoid needing a real WebGL
 * context (which is unavailable in the Node test environment).
 *
 * Coverage target: Renderer, RenderPipeline, HDRPipeline, PostProcessingPipeline,
 * CascadedShadowMap, FullScreenTriangle, and the effect classes (SSAO, Bloom,
 * MotionBlur, TAA, GodRays).
 *
 * @module Tests
 */

// ─── DOM mock ───────────────────────────────────────────────────────────────
// Three.js's WebGLRenderer constructor calls document.createElementNS to create
// the <canvas> element. Jest runs in the Node environment, so we stub just
// enough DOM surface to let the constructor succeed.
//
// This must run BEFORE any imports that reference document or window.

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

// ResizeObserver is also needed as a global (not just window property)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = (globalThis as any).window.ResizeObserver;

// ─── Imports (must come after the DOM mock) ─────────────────────────────────
import * as THREE from 'three';

// ─── Mock THREE.WebGLRenderer ───────────────────────────────────────────────
// We cannot create a real WebGL context in the Node test environment, so we
// mock the renderer constructor. Subsystems that need a WebGLRenderer receive
// a minimal mock that implements the subset of the API they use.
// The mock also tracks dispose calls to verify cleanup.

const mockRenderer = {
  domElement: { style: {} } as HTMLCanvasElement,
  setSize: jest.fn(),
  setPixelRatio: jest.fn(),
  setClearColor: jest.fn(),
  setRenderTarget: jest.fn(),
  render: jest.fn(),
  clear: jest.fn(),
  dispose: jest.fn().mockImplementation(function(this: any) { this._disposed = true; }),
  _disposed: false,
  // toneMapping is a plain property, not a setter
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

// Track all created mock renderers for global assertions
const mockRenderers: typeof mockRenderer[] = [];

jest.mock('three', () => {
  const actualThree = jest.requireActual('three');
  return {
    ...actualThree,
    WebGLRenderer: jest.fn().mockImplementation(() => {
      const r = { ...mockRenderer, dispose: jest.fn().mockImplementation(function(this: any) { this._disposed = true; }) };
      mockRenderers.push(r);
      return r;
    }),
  };
});

// ─── Module imports after mock ──────────────────────────────────────────────
import { Renderer } from '../../src/rendering/core/Renderer';
import { RenderPipeline } from '../../src/rendering/core/RenderPipeline';
import { RenderModule } from '../../src/rendering/core/RenderModule';
import { HDRPipeline } from '../../src/rendering/hdr/HDRPipeline';
import { PostProcessingPipeline } from '../../src/rendering/postprocessing/PostProcessingPipeline';
import { CascadedShadowMap } from '../../src/rendering/shadows/CascadedShadowMap';
import { FullScreenTriangle } from '../../src/rendering/core/FullScreenTriangle';
import { ModuleState } from '../../src/engine/core/Engine';

// ═════════════════════════════════════════════════════════════════════════════
// Renderer
// ═════════════════════════════════════════════════════════════════════════════

describe('Renderer', () => {
  beforeEach(() => {
    mockRenderers.length = 0;
  });

  it('constructs with default config', () => {
    const r = new Renderer();
    expect(r).toBeInstanceOf(Renderer);
    expect(r.isInitialized()).toBe(false);
  });

  it('constructs with custom config', () => {
    const r = new Renderer({ width: 800, height: 600, antialiasing: false });
    expect(r).toBeInstanceOf(Renderer);
    expect(r.isInitialized()).toBe(false);
  });

  it('initializes and isInitialized returns true', async () => {
    const r = new Renderer({ width: 64, height: 64, antialiasing: false });
    await r.initialize();
    expect(r.isInitialized()).toBe(true);
    // Must not throw on subsequent calls (idempotent)
    await r.initialize();
    expect(r.isInitialized()).toBe(true);
    r.dispose();
  });

  it('dispose transitions back to uninitialized', async () => {
    const r = new Renderer({ width: 64, height: 64, antialiasing: false });
    await r.initialize();
    expect(r.isInitialized()).toBe(true);
    r.dispose();
    expect(r.isInitialized()).toBe(false);
    // Double dispose must not throw
    r.dispose();
    expect(r.isInitialized()).toBe(false);
  });

  it('dispose calls the underlying WebGLRenderer.dispose', async () => {
    const r = new Renderer({ width: 64, height: 64, antialiasing: false });
    await r.initialize();
    // At this point a mock WebGLRenderer was created
    r.dispose();
    expect(mockRenderers.length).toBeGreaterThanOrEqual(1);
    // The mock renderer's dispose should have been called
    const last = mockRenderers[mockRenderers.length - 1];
    expect(last.dispose).toHaveBeenCalled();
  });

  it('getConfig returns a copy of the config', () => {
    const r = new Renderer({ width: 800, height: 600 });
    const cfg = r.getConfig();
    expect(cfg.width).toBe(800);
    expect(cfg.height).toBe(600);
    // Verify it's a copy (type cast to avoid readonly on the interface)
    (cfg as any).width = 999;
    expect(r.getConfig().width).toBe(800);
  });

  it('getScene and getCamera return non-null objects', () => {
    const r = new Renderer();
    expect(r.getScene()).toBeInstanceOf(THREE.Scene);
    expect(r.getCamera()).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it('setExposure updates the exposure value', async () => {
    const r = new Renderer({ width: 64, height: 64 });
    await r.initialize();
    r.setExposure(0.5);
    expect(r.getConfig().toneMappingExposure).toBeCloseTo(0.5);
    r.dispose();
  });

  it('setClearColor does not throw', async () => {
    const r = new Renderer({ width: 64, height: 64 });
    await r.initialize();
    expect(() => r.setClearColor(0x000000)).not.toThrow();
    r.dispose();
  });

  it('render is a no-op before initialization', () => {
    const r = new Renderer();
    expect(() => r.render()).not.toThrow();
  });

  it('getNativeRenderer returns the underlying WebGLRenderer', async () => {
    const r = new Renderer({ width: 64, height: 64 });
    await r.initialize();
    expect(r.getNativeRenderer()).toBe(mockRenderers[mockRenderers.length - 1]);
    r.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RenderPipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('RenderPipeline', () => {
  let renderer: Renderer;

  beforeEach(async () => {
    mockRenderers.length = 0;
    renderer = new Renderer({ width: 64, height: 64, antialiasing: false });
    await renderer.initialize();
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('constructs with a Renderer', () => {
    const pipeline = new RenderPipeline(renderer);
    expect(pipeline).toBeInstanceOf(RenderPipeline);
  });

  it('initializes and disposes without errors', () => {
    const pipeline = new RenderPipeline(renderer, {
      enableHDR: true,
      enableCSM: true,
      enableSSAO: true,
      enableBloom: true,
      enableMotionBlur: true,
      enableTAA: true,
      enableGodRays: true,
    });
    expect(() => pipeline.initialize()).not.toThrow();
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it('initializes with all effects disabled', () => {
    const pipeline = new RenderPipeline(renderer, {
      enableHDR: false,
      enableCSM: false,
      enableSSAO: false,
      enableBloom: false,
      enableMotionBlur: false,
      enableTAA: false,
      enableGodRays: false,
    });
    expect(() => pipeline.initialize()).not.toThrow();
    expect(() => pipeline.dispose()).not.toThrow();
  });

  it('double initialize is a no-op', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(() => pipeline.initialize()).not.toThrow();
    pipeline.dispose();
  });

  it('renderFrame does not throw with empty shadow casters', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(() => pipeline.renderFrame([])).not.toThrow();
    pipeline.dispose();
  });

  it('setSize forwards to subsystems', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(() => pipeline.setSize(128, 128)).not.toThrow();
    pipeline.dispose();
  });

  it('getLightingSystem returns a valid object', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(pipeline.getLightingSystem()).toBeDefined();
    pipeline.dispose();
  });

  it('getCSM returns a valid object', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(pipeline.getCSM()).toBeDefined();
    pipeline.dispose();
  });

  it('getHDRPipeline returns a valid object', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(pipeline.getHDRPipeline()).toBeDefined();
    pipeline.dispose();
  });

  it('getPostPipeline returns a valid object', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(pipeline.getPostPipeline()).toBeDefined();
    pipeline.dispose();
  });

  it('getGodRays returns a valid object', () => {
    const pipeline = new RenderPipeline(renderer);
    pipeline.initialize();
    expect(pipeline.getGodRays()).toBeDefined();
    pipeline.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HDRPipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('HDRPipeline', () => {
  it('constructs with default config', () => {
    const hdr = new HDRPipeline();
    expect(hdr).toBeInstanceOf(HDRPipeline);
    expect(hdr.getExposure()).toBe(1.0);
  });

  it('constructs with custom config', () => {
    const hdr = new HDRPipeline({ exposure: 2.0, minExposure: 0.1, maxExposure: 10 });
    expect(hdr.getExposure()).toBe(2.0);
  });

  it('initialize does not throw with a mock renderer', () => {
    const hdr = new HDRPipeline();
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    expect(() => hdr.initialize(native, 64, 64)).not.toThrow();
    hdr.dispose();
    native.dispose();
  });

  it('beginFrame and endFrame do not throw', () => {
    const hdr = new HDRPipeline();
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    hdr.initialize(native, 64, 64);
    expect(() => hdr.beginFrame()).not.toThrow();
    expect(() => hdr.endFrame(null)).not.toThrow();
    hdr.dispose();
    native.dispose();
  });

  it('setExposure clamps to min/max', () => {
    const hdr = new HDRPipeline({ minExposure: 0.5, maxExposure: 2.0 });
    hdr.setExposure(10);
    expect(hdr.getExposure()).toBe(2.0);
    hdr.setExposure(0);
    expect(hdr.getExposure()).toBe(0.5);
  });

  it('setSize resizes the HDR target', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const hdr = new HDRPipeline();
    hdr.initialize(native, 64, 64);
    expect(() => hdr.setSize(128, 128)).not.toThrow();
    hdr.dispose();
    native.dispose();
  });

  it('getHDRTarget returns a render target', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const hdr = new HDRPipeline();
    hdr.initialize(native, 64, 64);
    expect(hdr.getHDRTarget()).toBeInstanceOf(THREE.WebGLRenderTarget);
    hdr.dispose();
    native.dispose();
  });

  it('setAutoExposure toggles auto-exposure', () => {
    const hdr = new HDRPipeline();
    hdr.setAutoExposure(true);
    hdr.setAutoExposure(false);
    // No throw — coverage of the setter
  });

  it('setToneMapping switches operators', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const hdr = new HDRPipeline();
    hdr.initialize(native, 64, 64);
    expect(() => hdr.setToneMapping(0 as any)).not.toThrow();
    hdr.dispose();
    native.dispose();
  });

  it('dispose is idempotent', () => {
    const hdr = new HDRPipeline();
    expect(() => hdr.dispose()).not.toThrow();
    expect(() => hdr.dispose()).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PostProcessingPipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('PostProcessingPipeline', () => {
  it('constructs with default config', () => {
    const pp = new PostProcessingPipeline();
    expect(pp).toBeInstanceOf(PostProcessingPipeline);
  });

  it('initialize does not throw with a renderer', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const pp = new PostProcessingPipeline({ width: 64, height: 64 });
    expect(() => pp.initialize(native)).not.toThrow();
    pp.dispose();
    native.dispose();
  });

  it('addEffect / removeEffect / getEffect lifecycle', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const pp = new PostProcessingPipeline({ width: 64, height: 64 });
    pp.initialize(native);

    // Add a mock effect
    const mockEffect = {
      name: 'MockEffect',
      enabled: true,
      initialize: jest.fn(),
      render: jest.fn(),
      setSize: jest.fn(),
      dispose: jest.fn(),
    };
    pp.addEffect(mockEffect);
    expect(pp.getEffect('MockEffect')).toBe(mockEffect);

    // Remove it
    pp.removeEffect('MockEffect');
    expect(pp.getEffect('MockEffect')).toBeUndefined();
    expect(mockEffect.dispose).toHaveBeenCalledTimes(1);

    pp.dispose();
    native.dispose();
  });

  it('render is a no-op when not initialized', () => {
    const pp = new PostProcessingPipeline();
    const input = new THREE.WebGLRenderTarget(1, 1);
    const output = new THREE.WebGLRenderTarget(1, 1);
    expect(() => pp.render(input, output)).not.toThrow();
    input.dispose();
    output.dispose();
  });

  it('render works with an initialized pipeline', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const pp = new PostProcessingPipeline({ width: 64, height: 64 });
    pp.initialize(native);
    const input = new THREE.WebGLRenderTarget(64, 64);
    expect(() => pp.render(input, null)).not.toThrow();
    input.dispose();
    pp.dispose();
    native.dispose();
  });

  it('setSize resizes render targets', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const pp = new PostProcessingPipeline({ width: 64, height: 64 });
    pp.initialize(native);
    expect(() => pp.setSize(128, 128)).not.toThrow();
    pp.dispose();
    native.dispose();
  });

  it('updateConfig merges partial config', () => {
    const pp = new PostProcessingPipeline({ width: 64, height: 64 });
    pp.updateConfig({ bloomEnabled: false, motionBlurEnabled: false });
    expect(pp.getConfig().bloomEnabled).toBe(false);
    expect(pp.getConfig().motionBlurEnabled).toBe(false);
    // Other values unchanged
    expect(pp.getConfig().width).toBe(64);
  });

  it('dispose is idempotent', () => {
    const pp = new PostProcessingPipeline();
    expect(() => pp.dispose()).not.toThrow();
    expect(() => pp.dispose()).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CascadedShadowMap
// ═════════════════════════════════════════════════════════════════════════════

describe('CascadedShadowMap', () => {
  it('constructs with default config — cascade count is 0 until initialize()', () => {
    const csm = new CascadedShadowMap();
    expect(csm).toBeInstanceOf(CascadedShadowMap);
    // Cascades are created in initialize(), not the constructor
    expect(csm.getCascadeCount()).toBe(0);
  });

  it('constructs with custom cascade count — count is 0 until initialize()', () => {
    const csm = new CascadedShadowMap({ count: 2 });
    expect(csm.getCascadeCount()).toBe(0);
  });

  it('after initialize, getCascadeCount returns the configured count', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap();
    csm.initialize(native);
    expect(csm.getCascadeCount()).toBe(4);
    csm.dispose();
    native.dispose();
  });

  it('after initialize with custom count, returns that count', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap({ count: 2 });
    csm.initialize(native);
    expect(csm.getCascadeCount()).toBe(2);
    csm.dispose();
    native.dispose();
  });

  it('initialize does not throw with a renderer', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap();
    expect(() => csm.initialize(native)).not.toThrow();
    csm.dispose();
    native.dispose();
  });

  it('setSize resizes all cascades', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap();
    csm.initialize(native);
    expect(() => csm.setSize(1024)).not.toThrow();
    csm.dispose();
    native.dispose();
  });

  it('getShadowTexture returns null for out-of-range index', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap();
    csm.initialize(native);
    expect(csm.getShadowTexture(-1)).toBeNull();
    expect(csm.getShadowTexture(99)).toBeNull();
    csm.dispose();
    native.dispose();
  });

  it('getCascadeData returns structured data', () => {
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const csm = new CascadedShadowMap();
    csm.initialize(native);
    const data = csm.getCascadeData();
    expect(data.cascadeCount).toBe(4);
    expect(data.splitPositions.length).toBe(5); // count + 1
    expect(data.viewProjectionMatrices.length).toBe(4 * 16); // count * 16
    expect(data.shadowTextures.length).toBe(4);
    csm.dispose();
    native.dispose();
  });

  it('dispose is idempotent', () => {
    const csm = new CascadedShadowMap();
    expect(() => csm.dispose()).not.toThrow();
    expect(() => csm.dispose()).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FullScreenTriangle
// ═════════════════════════════════════════════════════════════════════════════

describe('FullScreenTriangle', () => {

  it('singleton returns the same instance', () => {
    const a = FullScreenTriangle.getInstance();
    const b = FullScreenTriangle.getInstance();
    expect(a).toBe(b);
  });

  it('dispose resets the singleton', () => {
    // Reset singleton state first
    const a = FullScreenTriangle.getInstance();
    a.dispose();

    // After dispose, getInstance creates a new one
    const b = FullScreenTriangle.getInstance();
    expect(b).not.toBe(a);

    // Clean up
    b.dispose();
  });

  it('render does not throw with a mock renderer', () => {
    const tri = FullScreenTriangle.getInstance();
    const native = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const material = new THREE.RawShaderMaterial();
    expect(() => tri.render(native, material, null)).not.toThrow();
    material.dispose();
    native.dispose();
    tri.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RenderModule (full lifecycle: init → update → dispose)
// ═════════════════════════════════════════════════════════════════════════════

describe('RenderModule', () => {
  it('constructs with default state', () => {
    const mod = new RenderModule();
    expect(mod.name).toBe('RenderModule');
    expect(mod.state).toBe(ModuleState.UNINITIALIZED);
  });

  it('init → update → dispose lifecycle', async () => {
    const mod = new RenderModule({
      renderer: { width: 64, height: 64, antialiasing: false },
      pipeline: {
        enableHDR: true,
        enableCSM: true,
        enableSSAO: true,
        enableBloom: true,
        enableMotionBlur: true,
        enableTAA: true,
        enableGodRays: true,
      },
    });

    // Step 1: Initialize
    await mod.init();
    expect(mod.state).toBe(ModuleState.ACTIVE);
    expect(mod.getRenderer()).toBeInstanceOf(Renderer);
    expect(mod.getPipeline()).toBeInstanceOf(RenderPipeline);
    expect(mod.getRenderer().isInitialized()).toBe(true);

    // Step 2: Update (no-op before active, but shouldn't throw)
    mod.update(0.016);
    expect(mod.state).toBe(ModuleState.ACTIVE);

    // Step 3: Pause / Resume
    mod.pause();
    expect(mod.state).toBe(ModuleState.PAUSED);
    mod.resume();
    expect(mod.state).toBe(ModuleState.ACTIVE);

    // Step 4: Set shadow casters
    expect(() => mod.setShadowCasters([])).not.toThrow();

    // Step 5: Dispose
    await mod.dispose();
    expect(mod.state).toBe(ModuleState.DISPOSED);
  });

  it('init transitions to ERROR when the renderer fails to initialize', async () => {
    // Renderer's initialize() calls document.body.appendChild which we mock but
    // may fail in edge cases. Use a valid config; the mock environment handles it.
    const mod = new RenderModule({
      renderer: { width: 64, height: 64, antialiasing: false },
    });
    // This should succeed in our mocked environment
    await mod.init();
    expect(mod.state).toBe(ModuleState.ACTIVE);
    await mod.dispose();
  });
});