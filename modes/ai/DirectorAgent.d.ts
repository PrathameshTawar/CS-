/**
 * DirectorAgent.ts
 *
 * The AI Director (Requirement 28, design §4.3.4) — the heart of AI mode.
 * It watches the player through existing EventBus events, aggregates a
 * normalized TelemetryFrame exactly once per second (R28.2), evaluates an
 * interpretable rule table, and emits typed AdaptationCommands (R28.3).
 *
 * Rules are local and deterministic-ish (probability-weighted) so decisions
 * cost ≤ 1 frame with zero network round-trips. Commands are emitted on the
 * bus as DIRECTOR_COMMAND_EVENT; the demo runtime executes them.
 *
 * @module Modes
 */
import { EventBus } from '../../engine/events/EventBus';
import type { AdaptationCommand, Difficulty, TelemetryFrame } from '../GameMode';
/** Bus event carrying a single AdaptationCommand for the runtime to execute. */
export declare const DIRECTOR_COMMAND_EVENT = "ai.director.command";
/** Bus event carrying the latest aggregated TelemetryFrame (debug/HUD). */
export declare const DIRECTOR_TELEMETRY_EVENT = "ai.director.telemetry";
/** Extra context passed to rules alongside the telemetry frame. */
export interface DirectorRuleContext {
    difficulty: Difficulty;
    difficultyCeiling: Difficulty;
    /** Enemies the Director has commanded to spawn this session (R28.7 cap). */
    spawnedEnemies: number;
    maxSpawnedEnemies: number;
}
/**
 * One interpretable rule row: condition → (probability → command), with a
 * cooldown that prevents spam. Kept as data so rules are easy to tune and test.
 */
export interface DirectorRule {
    readonly id: string;
    /** Minimum seconds between firings (rate limiting, R28.3). */
    readonly cooldown: number;
    /** Chance (0..1) to fire when the condition is true. */
    readonly probability: number;
    readonly condition: (frame: TelemetryFrame, ctx: DirectorRuleContext) => boolean;
    readonly make: (frame: TelemetryFrame, ctx: DirectorRuleContext) => AdaptationCommand;
}
export interface DirectorOptions {
    /** Read the current session difficulty (kill-streak rule). */
    getDifficulty: () => Difficulty;
    /** Clock in ms; injectable for tests. Defaults to performance.now(). */
    now?: () => number;
    /** Random in [0,1); injectable for tests. Defaults to Math.random. */
    random?: () => number;
    /** Max enemies the Director may command this session (R28.7). */
    maxSpawnedEnemies?: number;
    /** Difficulty ceiling for the current biome (R28.7). */
    difficultyCeiling?: Difficulty;
}
/**
 * Baseline rules (R28.4-28.6) plus one spawn rule so spawn_enemies has a
 * trigger. All respect cooldowns and per-biome caps (R28.7).
 */
export declare const DEFAULT_DIRECTOR_RULES: readonly DirectorRule[];
/**
 * Watches gameplay events, aggregates telemetry at 1 Hz, and emits
 * AdaptationCommands through the rule table.
 */
export declare class DirectorAgent {
    private readonly bus;
    private readonly options;
    private readonly rules;
    /** rule id → last fired timestamp (ms). */
    private readonly firedAt;
    private readonly disposers;
    private health;
    private maxHealth;
    private armor;
    private kills;
    private killStreak;
    private deaths;
    private shotsFired;
    private shotsHit;
    private lastFireAt;
    private lastFootstepAt;
    private missionTarget;
    private missionBaseline;
    private idleSeconds;
    private lowHealthSeconds;
    private spawnedEnemies;
    private accumulator;
    private lastFrame;
    constructor(bus: EventBus, options: DirectorOptions);
    /** Current accumulated telemetry (last aggregated frame, or defaults). */
    getTelemetry(): TelemetryFrame;
    /** Reset per-session state (new world / new round). */
    reset(): void;
    /**
     * Per-frame update; aggregates and evaluates once per second (R28.2).
     */
    update(deltaTime: number): void;
    /**
     * One 1-second heartbeat: advance idle/low-health timers, build the frame,
     * evaluate rules, and emit any commands. Public for unit tests.
     */
    tick(): void;
    /**
     * Pure rule evaluation: returns commands that fired this tick, honoring
     * cooldowns and probabilities. Note: the R28.7 spawn cap counter is
     * incremented by tick() when a spawn command is emitted — not here — so
     * direct evaluate() calls cannot mutate session state. Public for tests.
     */
    evaluate(frame: TelemetryFrame): AdaptationCommand[];
    dispose(): void;
    private subscribe;
    private buildFrame;
}
//# sourceMappingURL=DirectorAgent.d.ts.map