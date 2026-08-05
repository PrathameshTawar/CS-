/**
 * QualityPresets.ts
 *
 * Configurable quality preset system (Requirement 23.2-23.3).
 *
 * Three presets — Low / Medium / High — that adjust:
 *   - Shadow map resolution
 *   - Particle count cap multiplier
 *   - SSAO enabled + radius
 *   - Bloom enabled
 *   - Motion blur enabled
 *   - TAA enabled
 *   - God rays enabled
 *   - Volumetric fog density multiplier
 *   - Pixel ratio cap
 *
 * Adaptive quality (R23.3): if the measured frame time exceeds 20 ms for
 * 5 consecutive frames, the tier drops one step automatically.
 * The drop can be re-enabled manually by calling `setAdaptive(true)`.
 *
 * @module Rendering
 */

import * as THREE from 'three';
import { RenderPipeline } from './RenderPipeline';

// ─── Types ─────────────────────────────────────────────────────────────────

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  shadowMapSize:       number;    // CSM/directional shadow map resolution
  particleMultiplier:  number;    // 0..1 scale on max particles
  ssaoEnabled:         boolean;
  ssaoRadius:          number;
  bloomEnabled:        boolean;
  motionBlurEnabled:   boolean;
  taaEnabled:          boolean;
  godRaysEnabled:      boolean;
  fogDensityMultiplier: number;   // applied on top of biome base density
  pixelRatioMax:       number;    // device pixel ratio cap
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  low: {
    shadowMapSize:        512,
    particleMultiplier:   0.3,
    ssaoEnabled:          false,
    ssaoRadius:           0.3,
    bloomEnabled:         false,
    motionBlurEnabled:    false,
    taaEnabled:           true,   // TAA stays on — it's free AA, not expensive
    godRaysEnabled:       false,
    fogDensityMultiplier: 0.5,
    pixelRatioMax:        1.0,
  },
  medium: {
    shadowMapSize:        1024,
    particleMultiplier:   0.6,
    ssaoEnabled:          true,
    ssaoRadius:           0.45,
    bloomEnabled:         true,
    motionBlurEnabled:    false,
    taaEnabled:           true,
    godRaysEnabled:       true,
    fogDensityMultiplier: 0.8,
    pixelRatioMax:        1.5,
  },
  high: {
    shadowMapSize:        2048,
    particleMultiplier:   1.0,
    ssaoEnabled:          true,
    ssaoRadius:           0.55,
    bloomEnabled:         true,
    motionBlurEnabled:    true,
    taaEnabled:           true,
    godRaysEnabled:       true,
    fogDensityMultiplier: 1.0,
    pixelRatioMax:        2.0,
  },
};

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high'];

// ─── QualityManager ─────────────────────────────────────────────────────────

export class QualityManager {
  private tier: QualityTier;
  private adaptive: boolean;

  /** Rolling frame time samples for adaptive quality (R23.3). */
  private readonly frameSamples: number[] = [];
  private consecutiveOverBudget = 0;
  private readonly FRAME_BUDGET_MS = 20;   // >20 ms = <50 FPS
  private readonly CONSECUTIVE_THRESHOLD = 5;
  private readonly SAMPLE_WINDOW = 10;

  /** Optional Three.js renderer reference for pixel ratio updates. */
  private nativeRenderer: THREE.WebGLRenderer | null = null;
  /** Optional pipeline reference for enabling/disabling effects. */
  private pipeline: RenderPipeline | null = null;

  /** Fires whenever the tier changes — callers can update their UIs. */
  onTierChanged?: (tier: QualityTier, settings: QualitySettings) => void;

  constructor(initial: QualityTier = 'high', adaptive = false) {
    this.tier = initial;
    this.adaptive = adaptive;
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  /**
   * Wire up the renderer and pipeline so the preset manager can push
   * settings automatically. Call after both are initialized.
   */
  attach(renderer: THREE.WebGLRenderer, pipeline: RenderPipeline): void {
    this.nativeRenderer = renderer;
    this.pipeline = pipeline;
    this.apply(this.tier);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  getTier(): QualityTier { return this.tier; }
  getSettings(): QualitySettings { return { ...QUALITY_PRESETS[this.tier] }; }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.apply(tier);
    this.onTierChanged?.(tier, this.getSettings());
  }

  setAdaptive(enabled: boolean): void {
    this.adaptive = enabled;
    this.consecutiveOverBudget = 0;
  }

  isAdaptive(): boolean { return this.adaptive; }

  /**
   * Call once per rendered frame with the measured frame time in ms.
   * Automatically downgrades the tier when the frame budget is exceeded
   * for CONSECUTIVE_THRESHOLD frames in a row (R23.3).
   */
  updateFrameTime(frameMs: number): void {
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > this.SAMPLE_WINDOW) {
      this.frameSamples.shift();
    }

    if (!this.adaptive) return;

    if (frameMs > this.FRAME_BUDGET_MS) {
      this.consecutiveOverBudget++;
      if (this.consecutiveOverBudget >= this.CONSECUTIVE_THRESHOLD) {
        this.consecutiveOverBudget = 0;
        this._downgrade();
      }
    } else {
      this.consecutiveOverBudget = 0;
    }
  }

  /** Estimated current FPS from recent frame samples. */
  getEstimatedFPS(): number {
    if (this.frameSamples.length === 0) return 0;
    const avg = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private _downgrade(): void {
    const idx = TIER_ORDER.indexOf(this.tier);
    if (idx > 0) {
      this.setTier(TIER_ORDER[idx - 1]);
    }
  }

  /**
   * Push the preset settings into the live renderer and pipeline.
   * Safe to call before attach() — the writes are deferred to attach().
   */
  private apply(tier: QualityTier): void {
    const s = QUALITY_PRESETS[tier];

    if (this.nativeRenderer) {
      // Pixel ratio cap
      const deviceRatio = window?.devicePixelRatio ?? 1;
      this.nativeRenderer.setPixelRatio(Math.min(deviceRatio, s.pixelRatioMax));
    }

    if (this.pipeline) {
      const post = this.pipeline.getPostPipeline();
      const ssao = post.getEffect('SSAO');
      const bloom = post.getEffect('Bloom');
      const mb = post.getEffect('MotionBlur');
      const taa = post.getEffect('TAA');
      const gr = post.getEffect('GodRays');

      if (ssao) ssao.enabled = s.ssaoEnabled;
      if (bloom) bloom.enabled = s.bloomEnabled;
      if (mb) mb.enabled = s.motionBlurEnabled;
      if (taa) taa.enabled = s.taaEnabled;
      if (gr) gr.enabled = s.godRaysEnabled;

      // Shadow map resolution on the CSM
      const csm = this.pipeline.getCSM();
      if (csm) csm.setSize(s.shadowMapSize);
    }
  }
}
