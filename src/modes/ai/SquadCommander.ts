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
import { Squad, SquadManager } from '../../ai/core/SquadManager';
import { AIState } from '../../ai/core/EnemyController';
import { GAME_EVENTS, SquadEvent } from '../../gameplay/core/GameTypes';
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
export const SQUAD_COMMANDER_TUNING: Record<Difficulty, SquadCommanderTuning> = {
  // Easy: passive — plenty of retreats, few flanks, rarely calls backup.
  easy: {
    flankChance: 0.4,
    retreatChance: 1.0,
    ambushChance: 0.5,
    holdChance: 0.9,
    searchChance: 0.8,
    reinforceChance: 0.4,
    reinforceCooldown: 25,
  },
  normal: {
    flankChance: 0.7,
    retreatChance: 0.8,
    ambushChance: 0.7,
    holdChance: 0.9,
    searchChance: 0.9,
    reinforceChance: 0.6,
    reinforceCooldown: 15,
  },
  // Hard: aggressive — always flanks, fights on when wounded, calls backup fast.
  hard: {
    flankChance: 1.0,
    retreatChance: 0.5,
    ambushChance: 0.9,
    holdChance: 0.7,
    searchChance: 0.7,
    reinforceChance: 0.9,
    reinforceCooldown: 10,
  },
};

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

/** Member HP ratio below which a squad commander orders a fallback. */
const RETREAT_HP_RATIO = 0.3;

/**
 * R33.3: delay (seconds) between a squad's reinforce call and the Director's
 * support-squad spawn. Game.ts uses this to schedule the spawn.
 */
export const SQUAD_REINFORCE_DELAY = 8;

const ORDER_MESSAGES: Record<SquadOrderType, string> = {
  flank: 'Flanking!',
  retreat: 'Falling back!',
  ambush: 'Ambush — hold until they close!',
  hold: 'Hold the line!',
  search: 'Sweeping the area!',
  reinforce: 'Calling for reinforcements!',
};

export class SquadCommander {
  private readonly bus: EventBus;
  private readonly manager: SquadManager;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly refreshInterval: number;
  private readonly getDifficulty: () => Difficulty;
  private readonly tuningOverride: Partial<SquadCommanderTuning>;

  private tickTimer = 0;
  private readonly lastOrderAt = new Map<number, number>();
  private readonly lastReinforceAt = new Map<number, number>();
  private readonly orderHistory: SquadOrder[] = [];

  constructor(bus: EventBus, manager: SquadManager, options: SquadCommanderOptions = {}) {
    this.bus = bus;
    this.manager = manager;
    this.now = options.now ?? (() => performance.now() / 1000);
    this.random = options.random ?? Math.random;
    this.refreshInterval = options.refreshInterval ?? 0.8;
    this.getDifficulty = options.getDifficulty ?? (() => 'normal');
    this.tuningOverride = options.tuning ?? {};
  }

  /** Orders issued since construction (tests/debug). */
  getOrderHistory(): SquadOrder[] {
    return this.orderHistory;
  }

  /** Resolve the active tuning: difficulty preset merged with the override. */
  currentTuning(): SquadCommanderTuning {
    return { ...SQUAD_COMMANDER_TUNING[this.getDifficulty()], ...this.tuningOverride };
  }

  /**
   * Advance the commander clock. Evaluates every squad at most once per
   * refreshInterval (R33.4) and issues a single priority order per squad.
   */
  update(deltaTime: number, playerPos: THREE.Vector3): void {
    this.tickTimer += deltaTime;
    if (this.tickTimer < this.refreshInterval) return;
    this.tickTimer = 0;

    for (const squad of this.manager.getSquads()) {
      this.evaluateSquad(squad, playerPos);
    }
  }

  private evaluateSquad(squad: Squad, playerPos: THREE.Vector3): void {
    const alive = squad.aliveMembers;
    if (alive.length === 0) return;
    const now = this.now();
    const t = this.currentTuning();

    const inCombat = alive.some((m) => m.state === AIState.Combat);
    const anySeesPlayer = alive.some((m) => m.getPerceptionMemory().seesPlayer);
    const lastKnown =
      alive.map((m) => m.getPerceptionMemory().lastKnownPosition).find((p) => p !== null) ?? null;
    const lowHp = alive.filter((m) => m.health < m.healthMax * RETREAT_HP_RATIO);

    // Priority 1: wounded members fall back (R33.1 'retreat'). Hard squads
    // fight on through the wound; easy squads retreat almost always.
    if (inCombat && lowHp.length > 0 && this.roll(t.retreatChance)) {
      this.issue(squad, 'retreat', playerPos, now, () => {
        for (const m of lowHp) m.orderRetreat(2.5);
      });
      return;
    }

    // Priority 2: outnumbered/under fire → call reinforcements (R33.3).
    const lastReinforce = this.lastReinforceAt.get(squad.id) ?? -Infinity;
    const pressured = inCombat && alive.length <= squad.members.length * 0.5;
    if (
      pressured &&
      now - lastReinforce >= t.reinforceCooldown &&
      this.roll(t.reinforceChance)
    ) {
      const issued = this.issue(squad, 'reinforce', playerPos, now, () => {
        // The game layer listens for the 'reinforce' squad event and schedules
        // a Director support-squad spawn after the R33.3 8s delay.
      });
      // Only start the cooldown if the order actually fired (the per-squad
      // order throttle in issue() may drop it if another order just went out).
      if (issued) this.lastReinforceAt.set(squad.id, now);
      return;
    }

    // Priority 3: combat without line of sight → ambush the last known spot.
    if (inCombat && !anySeesPlayer && lastKnown && this.roll(t.ambushChance)) {
      this.issue(squad, 'ambush', lastKnown, now, () => {
        for (const m of alive) {
          m.getPerceptionMemory().lastKnownPosition = lastKnown.clone();
          const to = new THREE.Vector3().subVectors(m.position, lastKnown).normalize();
          m.coverTarget = lastKnown.clone().add(new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(3));
          m.enterState(AIState.Combat);
        }
      });
      return;
    }

    // Priority 4: flank when two or more are engaged (R33.1 'flank'). This is
    // the aggression dial — hard squads always flank, easy squads rarely do.
    if (inCombat && alive.length >= 2 && this.roll(t.flankChance)) {
      this.issue(squad, 'flank', playerPos, now, () => {
        const flanker = alive.find((m) => m.classDef.behavior === 'flanker') ?? alive[0];
        flanker.role = 'flank';
        const toPlayer = new THREE.Vector3().subVectors(playerPos, flanker.position).normalize();
        flanker.coverTarget = playerPos
          .clone()
          .add(new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(8));
      });
      return;
    }

    // Priority 5: hold a defensive anchor when alone in combat (R33.1 'hold').
    if (inCombat && this.roll(t.holdChance)) {
      this.issue(squad, 'hold', playerPos, now, () => {
        for (const m of alive) {
          const toPlayer = new THREE.Vector3().subVectors(playerPos, m.position).normalize();
          m.coverTarget = m.position.clone().add(toPlayer.multiplyScalar(2));
          m.enterState(AIState.Combat);
        }
      });
      return;
    }

    // Priority 6: sweep the last known position when alerted but not engaged.
    if (lastKnown && this.roll(t.searchChance)) {
      this.issue(squad, 'search', lastKnown, now, () => {
        for (const m of alive) m.orderSearch(lastKnown, now);
      });
    }
  }

  /** Weighted roll: true when random() < clamped chance. */
  private roll(chance: number): boolean {
    return this.random() < Math.min(1, Math.max(0, chance));
  }

  /**
   * Issue a single order to a squad. Returns true if the order actually fired,
   * or false when the per-squad order throttle drops it (another order went out
   * within the refresh window).
   */
  private issue(
    squad: Squad,
    type: SquadOrderType,
    target: THREE.Vector3,
    now: number,
    apply: () => void
  ): boolean {
    // Per-squad order throttle: one order per squad per refresh window.
    const last = this.lastOrderAt.get(squad.id) ?? -Infinity;
    if (now - last < this.refreshInterval) return false;
    this.lastOrderAt.set(squad.id, now);

    apply();
    this.orderHistory.push({ type, squadId: squad.id, issuedAt: now });

    const event: SquadEvent = {
      type,
      squadId: squad.id,
      message: ORDER_MESSAGES[type],
      position: { x: target.x, y: target.y, z: target.z },
    };
    this.bus.emit(GAME_EVENTS.SQUAD, event);
    return true;
  }

  dispose(): void {
    this.orderHistory.length = 0;
    this.lastOrderAt.clear();
    this.lastReinforceAt.clear();
    this.tickTimer = 0;
  }
}
