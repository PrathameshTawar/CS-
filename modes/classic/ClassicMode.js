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
/**
 * Curated map rotation (design §3.2, T0.2): all six biomes, two seeds each.
 * MapGenerator determinism (R18.3) guarantees every entry is reproducible.
 */
export const CLASSIC_ROTATION = [
    { biome: Biome.City, seed: 1337 },
    { biome: Biome.City, seed: 31415 },
    { biome: Biome.Forest, seed: 4242 },
    { biome: Biome.Forest, seed: 271828 },
    { biome: Biome.Snow, seed: 9001 },
    { biome: Biome.Snow, seed: 112358 },
    { biome: Biome.Desert, seed: 7777 },
    { biome: Biome.Desert, seed: 61803 },
    { biome: Biome.Dungeon, seed: 5150 },
    { biome: Biome.Dungeon, seed: 161803 },
    { biome: Biome.Factory, seed: 2024 },
    { biome: Biome.Factory, seed: 8675309 },
];
const FIXED_OBJECTIVE = {
    objectiveType: 'elimination',
    title: 'Clean Sweep',
    briefing: 'Eliminate all hostiles.',
    successCondition: 'All hostiles neutralized.',
    failureCondition: 'Player is eliminated.',
    targetCount: 1,
};
/**
 * Fixed-content mode (R27). Deterministic by construction: same rotation
 * index + same seed always yield the same world.
 */
export class ClassicMode {
    id = 'classic';
    label = 'CLASSIC';
    difficulty;
    index = 0;
    constructor(difficulty = 'normal') {
        this.difficulty = difficulty;
    }
    /** Index of the next rotation entry to be returned. */
    get rotationIndex() {
        return this.index;
    }
    get rotationLength() {
        return CLASSIC_ROTATION.length;
    }
    /** Restart the rotation from the first entry (new session). */
    reset() {
        this.index = 0;
    }
    async nextWorldConfig(context) {
        const entry = CLASSIC_ROTATION[this.index % CLASSIC_ROTATION.length];
        this.index = (this.index + 1) % CLASSIC_ROTATION.length;
        this.difficulty = context.difficulty;
        return {
            seed: entry.seed,
            biome: entry.biome,
            density: 0.55,
            weather: 'clear',
            timeOfDay: 'day',
            mood: 'fixed',
            buildings: 0,
            roads: 0,
            enemyCamps: 0,
            difficulty: this.difficulty,
            // Map-generator hints used by AI mode only; Classic is fully deterministic.
            coverZones: 0,
            elevatedPositions: 0,
        };
    }
    async nextMission(_config) {
        return FIXED_OBJECTIVE;
    }
    update(_deltaTime, _telemetry) {
        return []; // no Director in Classic mode
    }
    dispose() {
        // nothing to release
    }
}
//# sourceMappingURL=ClassicMode.js.map