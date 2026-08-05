/**
 * ClassicMode.ts
 *
 * Mode 1 — CLASSIC (Requirements 26-27, design §3).
 * Fixed, deterministic, offline: a curated {biome, seed} rotation, the stock
 * weapon catalog, fixed difficulty presets, and a fixed elimination objective.
 * Never constructs or calls any LLM provider (R26.2).
 *
 * Every call to nextWorldConfig() advances the rotation; the demo advances
 * the world after a round clear by requesting the next config (T0.6).
 *
 * @module Modes
 */
import { Biome } from '../../gameplay/maps/MapGenerator';
import type { AdaptationCommand, Difficulty, GameMode, MissionContentPayload, SessionContext, TelemetryFrame, WorldConfig } from '../GameMode';
export interface ClassicRotationEntry {
    biome: Biome;
    seed: number;
}
/**
 * Curated map rotation (design §3.2, T0.2): all six biomes, two seeds each.
 * MapGenerator determinism (R18.3) guarantees every entry is reproducible.
 */
export declare const CLASSIC_ROTATION: ClassicRotationEntry[];
/**
 * Fixed-content mode (R27). Deterministic by construction: same rotation
 * index + same seed always yield the same world.
 */
export declare class ClassicMode implements GameMode {
    readonly id: "classic";
    readonly label = "CLASSIC";
    difficulty: Difficulty;
    private index;
    constructor(difficulty?: Difficulty);
    /** Index of the next rotation entry to be returned. */
    get rotationIndex(): number;
    get rotationLength(): number;
    /** Restart the rotation from the first entry (new session). */
    reset(): void;
    nextWorldConfig(context: SessionContext): Promise<WorldConfig>;
    nextMission(_config: WorldConfig): Promise<MissionContentPayload | null>;
    update(_deltaTime: number, _telemetry: TelemetryFrame): AdaptationCommand[];
    dispose(): void;
}
//# sourceMappingURL=ClassicMode.d.ts.map