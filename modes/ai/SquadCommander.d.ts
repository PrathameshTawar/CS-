/**
 * SquadCommander.ts
 *
 * Commander brain per squad (R33.1-R33.2). Issues tactical orders through
 * SquadManager's squad communication path (GAME_EVENTS.SQUAD):
 *  - flank      — flanker role + perpendicular cover target
 *  - retreat    — low-HP members fall back
 *  - ambush     — reposition to a covered point near the last known position
 *  - hold       — hold a defensive anchor and engage
 *  - search     — sweep the last known position
 *  - reinforce  — emit a 'reinforce' squad event; the game layer converts it
 *                 into a Director support-squad spawn after an 8s delay (R33.3)
 *
 * Order refresh ≤ 1s (R33.4). Each decision branch is gated by a difficulty
 * weight (SQUAD_COMMANDER_TUNING) — e.g. hard squads flank aggressively while
 * easy squads retreat at the first sign of trouble — resolved live from an
 * injectable getDifficulty() so Director difficulty escalations take effect
 * immediately. The commander remains fully deterministic under test via
 * injectable clock/RNG plus a per-instance tuning override.
 *
 * @module AI
 */
import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { SquadManager } from '../../ai/core/SquadManager';
import type { Difficulty } from '../GameMode';
/** Tactical orders a squad commander can issue (R33.1). */
export type SquadOrderType = 'flank' | 'retreat' | 'ambush' | 'hold' | 'search' | 'reinforce';
/** A single order decision, retained for tests/debug. */
export interface SquadOrder {
    type: SquadOrderType;
    squadId: number;
    issuedAt: number;
}
/**
 * Per-difficulty decision weights (0..1 probabilities, except cooldowns in
 * seconds). Higher = the order is more likely to fire when its condition holds.
 */
export interface SquadCommanderTuning {
    /** Chance a 2+ member combat squad flanks instead of holding. Higher = more aggressive. */
    flankChance: number;
    /** Chance wounded members fall back. Higher = more retreats. */
    retreatChance: number;
    /** Chance to reposition to an ambush point when sight is lost. */
    ambushChance: number;
    /** Chance a solo defender holds the line. */
    holdChance: number;
    /** Chance to sweep the last known position when alerted but unengaged. */
    searchChance: number;
    /** Chance a pressured squad calls reinforcements per refresh. */
    reinforceChance: number;
    /** Seconds between reinforcement calls. */
    reinforceCooldown: number;
}
/** Difficulty-scaled commander weights (defaults when getDifficulty is absent). */
export declare const SQUAD_COMMANDER_TUNING: Record<Difficulty, SquadCommanderTuning>;
export interface SquadCommanderOptions {
    /** Clock in seconds; injectable for tests. Defaults to performance.now()/1000. */
    now?: () => number;
    /** Random in [0,1); injectable for tests. Defaults to Math.random. */
    random?: () => number;
    /** Order refresh interval in seconds (R33.4: ≤ 1s). Default 0.8s. */
    refreshInterval?: number;
    /**
     * Reads the current session difficulty so weights track live Director
     * escalations. Defaults to 'normal'.
     */
    getDifficulty?: () => Difficulty;
    /**
     * Per-instance override merged over the difficulty preset (tests/custom
     * loadouts). Partial — only listed fields are overridden.
     */
    tuning?: Partial<SquadCommanderTuning>;
}
/**
 * R33.3: delay (seconds) between a squad's reinforce call and the Director's
 * support-squad spawn. Game.ts uses this to schedule the spawn.
 */
export declare const SQUAD_REINFORCE_DELAY = 8;
export declare class SquadCommander {
    private readonly bus;
    private readonly manager;
    private readonly now;
    private readonly random;
    private readonly refreshInterval;
    private readonly getDifficulty;
    private readonly tuningOverride;
    private tickTimer;
    private readonly lastOrderAt;
    private readonly lastReinforceAt;
    private readonly orderHistory;
    constructor(bus: EventBus, manager: SquadManager, options?: SquadCommanderOptions);
    /** Orders issued since construction (tests/debug). */
    getOrderHistory(): SquadOrder[];
    /** Resolve the active tuning: difficulty preset merged with the override. */
    currentTuning(): SquadCommanderTuning;
    /**
     * Advance the commander clock. Evaluates every squad at most once per
     * refreshInterval (R33.4) and issues a single priority order per squad.
     */
    update(deltaTime: number, playerPos: THREE.Vector3): void;
    private evaluateSquad;
    /** Weighted roll: true when random() < clamped chance. */
    private roll;
    /**
     * Issue a single order to a squad. Returns true if the order actually fired,
     * or false when the per-squad order throttle drops it (another order went out
     * within the refresh window).
     */
    private issue;
    dispose(): void;
}
//# sourceMappingURL=SquadCommander.d.ts.map