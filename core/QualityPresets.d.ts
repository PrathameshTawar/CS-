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
export type QualityTier = 'low' | 'medium' | 'high';
export interface QualitySettings {
    shadowMapSize: number;
    particleMultiplier: number;
    ssaoEnabled: boolean;
    ssaoRadius: number;
    bloomEnabled: boolean;
    motionBlurEnabled: boolean;
    taaEnabled: boolean;
    godRaysEnabled: boolean;
    fogDensityMultiplier: number;
    pixelRatioMax: number;
}
export declare const QUALITY_PRESETS: Record<QualityTier, QualitySettings>;
export declare class QualityManager {
    private tier;
    private adaptive;
    /** Rolling frame time samples for adaptive quality (R23.3). */
    private readonly frameSamples;
    private consecutiveOverBudget;
    private readonly FRAME_BUDGET_MS;
    private readonly CONSECUTIVE_THRESHOLD;
    private readonly SAMPLE_WINDOW;
    /** Optional Three.js renderer reference for pixel ratio updates. */
    private nativeRenderer;
    /** Optional pipeline reference for enabling/disabling effects. */
    private pipeline;
    /** Fires whenever the tier changes — callers can update their UIs. */
    onTierChanged?: (tier: QualityTier, settings: QualitySettings) => void;
    constructor(initial?: QualityTier, adaptive?: boolean);
    /**
     * Wire up the renderer and pipeline so the preset manager can push
     * settings automatically. Call after both are initialized.
     */
    attach(renderer: THREE.WebGLRenderer, pipeline: RenderPipeline): void;
    getTier(): QualityTier;
    getSettings(): QualitySettings;
    setTier(tier: QualityTier): void;
    setAdaptive(enabled: boolean): void;
    isAdaptive(): boolean;
    /**
     * Call once per rendered frame with the measured frame time in ms.
     * Automatically downgrades the tier when the frame budget is exceeded
     * for CONSECUTIVE_THRESHOLD frames in a row (R23.3).
     */
    updateFrameTime(frameMs: number): void;
    /** Estimated current FPS from recent frame samples. */
    getEstimatedFPS(): number;
    private _downgrade;
    /**
     * Push the preset settings into the live renderer and pipeline.
     * Safe to call before attach() — the writes are deferred to attach().
     */
    private apply;
}
//# sourceMappingURL=QualityPresets.d.ts.map