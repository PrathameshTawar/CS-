/**
 * ReinforcementScheduler.ts
 *
 * Schedules Director support-squad spawns requested by squad commanders
 * (R33.3). A 'reinforce' order records a request; the scheduler holds it for
 * SQUAD_REINFORCE_DELAY (8s) before poll() releases it to the spawn layer.
 *
 * Extracted from Game.ts so the 8s delay and the scene-cap gate are unit
 * testable without booting a full demo world (same pattern as DirectorAgent /
 * SquadCommander / MemorySystem).
 *
 * @module AI
 */
import type { EnemyClassId } from '../../ai/classes/EnemyClasses';
import type { Difficulty } from '../GameMode';
/** A pending reinforcement spawn request. */
export interface ReinforcementRequest {
    count: number;
    classes: EnemyClassId[];
}
/** One difficulty's reinforcement squad loadout: the class mix called in. */
export interface ReinforcementLoadout {
    classes: EnemyClassId[];
}
/**
 * Per-difficulty reinforcement squad composition (R33.3). Data-driven so the
 * mix a commander calls in scales with difficulty — easy calls a light pair,
 * hard calls a heavy four with a sniper. Game.ts resolves this at schedule
 * time via the live difficulty, so Director escalations change the mix on the
 * next reinforce call (same pattern as SQUAD_COMMANDER_TUNING).
 */
export declare const REINFORCEMENT_TUNING: Record<Difficulty, ReinforcementLoadout>;
export interface ReinforcementSchedulerOptions {
    /** Delay in seconds before a scheduled request becomes due. Default 8 (R33.3). */
    delay?: number;
    /** Clock in seconds; injectable for tests. Defaults to performance.now()/1000. */
    now?: () => number;
    /**
     * Optional gate checked at poll time (e.g. "alive enemies < MAX_LIVE_ENEMIES").
     * Requests that fail the gate are dropped — respecting the scene cap.
     */
    canFire?: (request: ReinforcementRequest) => boolean;
}
export declare class ReinforcementScheduler {
    private readonly delay;
    private readonly now;
    private readonly canFire;
    private readonly pending;
    constructor(options?: ReinforcementSchedulerOptions);
    /** Number of requests waiting for the delay window to elapse. */
    get length(): number;
    /** Record a reinforcement request. It becomes due after `delay` seconds. */
    schedule(count: number, classes: EnemyClassId[]): void;
    /**
     * Release all requests whose delay window has elapsed. Requests failing the
     * cap gate (canFire) are dropped rather than spawned. The pending list is
     * drained of everything that has matured.
     */
    poll(now?: number): ReinforcementRequest[];
    /** Cancel all pending reinforcement requests. */
    clear(): void;
}
//# sourceMappingURL=ReinforcementScheduler.d.ts.map