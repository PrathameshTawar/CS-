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
import {
  GAME_EVENTS,
  HealthStateEvent,
  KillEvent,
  HitMarkerEvent,
  ObjectiveEvent,
  SoundEvent,
  WeaponFireEvent,
} from '../../gameplay/core/GameTypes';
import type { EnemyClassId } from '../../ai/classes/EnemyClasses';
import type { AdaptationCommand, Difficulty, TelemetryFrame } from '../GameMode';

/** Bus event carrying a single AdaptationCommand for the runtime to execute. */
export const DIRECTOR_COMMAND_EVENT = 'ai.director.command';
/** Bus event carrying the latest aggregated TelemetryFrame (debug/HUD). */
export const DIRECTOR_TELEMETRY_EVENT = 'ai.director.telemetry';

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

const DEFAULT_MAX_SPAWNED = 8;
const IDLE_FLUSH_SECONDS = 45;
const LOW_HEALTH_RATIO = 0.25;
const LOW_HEALTH_SECONDS = 8;
const KILL_STREAK_RAMP = 8;
const KILL_STREAK_SPAWN = 5;

/**
 * Baseline rules (R28.4-28.6) plus one spawn rule so spawn_enemies has a
 * trigger. All respect cooldowns and per-biome caps (R28.7).
 */
export const DEFAULT_DIRECTOR_RULES: readonly DirectorRule[] = [
  {
    id: 'low-health-medkit',
    cooldown: 30,
    probability: 0.85,
    condition: (f) =>
      f.health > 0 && f.maxHealth > 0 && f.health / f.maxHealth < LOW_HEALTH_RATIO && f.lowHealthSeconds >= LOW_HEALTH_SECONDS,
    make: () => ({ kind: 'grant_content', content: 'medkit' }),
  },
  {
    id: 'kill-streak-ramp',
    cooldown: 20,
    probability: 1,
    condition: (f, ctx) =>
      f.killStreak >= KILL_STREAK_RAMP && ctx.difficulty !== 'hard' && ctx.difficultyCeiling === 'hard',
    make: () => ({ kind: 'adjust_difficulty', difficulty: 'hard', ramp: 'ease' }),
  },
  {
    id: 'idle-flush',
    cooldown: 60,
    probability: 1,
    condition: (f) => f.secondsIdle >= IDLE_FLUSH_SECONDS,
    make: () => ({ kind: 'event_trigger', event: 'explosion' }),
  },
  {
    id: 'domination-spawns',
    cooldown: 25,
    probability: 0.7,
    condition: (f, ctx) => f.killStreak >= KILL_STREAK_SPAWN && ctx.spawnedEnemies < ctx.maxSpawnedEnemies,
    make: () => ({ kind: 'spawn_enemies', count: 2, classes: ['scout', 'heavy'] as EnemyClassId[], urgency: 0.6 }),
  },
];

/**
 * Watches gameplay events, aggregates telemetry at 1 Hz, and emits
 * AdaptationCommands through the rule table.
 */
export class DirectorAgent {
  private readonly bus: EventBus;
  private readonly options: {
    getDifficulty: () => Difficulty;
    now: () => number;
    random: () => number;
    maxSpawnedEnemies: number;
    difficultyCeiling: Difficulty;
  };
  private readonly rules: readonly DirectorRule[];
  /** rule id → last fired timestamp (ms). */
  private readonly firedAt = new Map<string, number>();
  private readonly disposers: (() => void)[] = [];

  // --- Event accumulators ---
  private health = 100;
  private maxHealth = 100;
  private armor = 0;
  private kills = 0;
  private killStreak = 0;
  private deaths = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private lastFireAt = -Infinity;
  private lastFootstepAt = -Infinity;
  private missionTarget = 0;
  private missionBaseline = 0;
  private idleSeconds = 0;
  private lowHealthSeconds = 0;
  private spawnedEnemies = 0;
  private accumulator = 0;
  private lastFrame: TelemetryFrame | null = null;

  constructor(bus: EventBus, options: DirectorOptions) {
    this.bus = bus;
    this.options = {
      getDifficulty: options.getDifficulty,
      now: options.now ?? (() => performance.now()),
      random: options.random ?? (() => Math.random()),
      maxSpawnedEnemies: options.maxSpawnedEnemies ?? DEFAULT_MAX_SPAWNED,
      difficultyCeiling: options.difficultyCeiling ?? 'hard',
    };
    this.rules = DEFAULT_DIRECTOR_RULES;
    this.subscribe();
  }

  /** Current accumulated telemetry (last aggregated frame, or defaults). */
  getTelemetry(): TelemetryFrame {
    return this.lastFrame ?? this.buildFrame();
  }

  /** Reset per-session state (new world / new round). */
  reset(): void {
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.kills = 0;
    this.killStreak = 0;
    this.deaths = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastFireAt = -Infinity;
    this.lastFootstepAt = -Infinity;
    this.missionTarget = 0;
    this.missionBaseline = 0;
    this.idleSeconds = 0;
    this.lowHealthSeconds = 0;
    this.spawnedEnemies = 0;
    this.accumulator = 0;
    this.firedAt.clear();
    this.lastFrame = null;
  }

  /**
   * Per-frame update; aggregates and evaluates once per second (R28.2).
   */
  update(deltaTime: number): void {
    this.accumulator += deltaTime;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this.tick();
    }
  }

  /**
   * One 1-second heartbeat: advance idle/low-health timers, build the frame,
   * evaluate rules, and emit any commands. Public for unit tests.
   */
  tick(): void {
    const now = this.options.now();
    const moving = now - this.lastFootstepAt < 1500;
    const firing = now - this.lastFireAt < 1200;
    if (!moving && !firing) this.idleSeconds += 1;
    else this.idleSeconds = 0;

    const ratio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    if (this.health > 0 && ratio < LOW_HEALTH_RATIO) this.lowHealthSeconds += 1;
    else this.lowHealthSeconds = 0;

    const frame = this.buildFrame(now, moving, firing);
    const commands = this.evaluate(frame);

    for (const cmd of commands) {
      if (cmd.kind === 'spawn_enemies') this.spawnedEnemies += cmd.count;
      this.bus.emit(DIRECTOR_COMMAND_EVENT, cmd);
    }
    this.lastFrame = frame;
    this.bus.emit(DIRECTOR_TELEMETRY_EVENT, frame);
  }

  /**
   * Pure rule evaluation: returns commands that fired this tick, honoring
   * cooldowns and probabilities. Note: the R28.7 spawn cap counter is
   * incremented by tick() when a spawn command is emitted — not here — so
   * direct evaluate() calls cannot mutate session state. Public for tests.
   */
  evaluate(frame: TelemetryFrame): AdaptationCommand[] {
    const now = this.options.now();
    const ctx: DirectorRuleContext = {
      difficulty: this.options.getDifficulty(),
      difficultyCeiling: this.options.difficultyCeiling,
      spawnedEnemies: this.spawnedEnemies,
      maxSpawnedEnemies: this.options.maxSpawnedEnemies,
    };
    const commands: AdaptationCommand[] = [];
    for (const rule of this.rules) {
      const last = this.firedAt.get(rule.id) ?? -Infinity;
      if (now - last < rule.cooldown * 1000) continue;
      if (!rule.condition(frame, ctx)) continue;
      if (this.options.random() >= rule.probability) continue;
      this.firedAt.set(rule.id, now);
      commands.push(rule.make(frame, ctx));
    }
    return commands;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  private subscribe(): void {
    this.disposers.push(
      this.bus.on<KillEvent>(GAME_EVENTS.KILL, (e) => {
        if (e.killerId === -1) {
          this.kills++;
          this.killStreak++;
        }
      }),
      this.bus.on<HealthStateEvent>(GAME_EVENTS.HEALTH, (e) => {
        this.health = e.health;
        this.maxHealth = e.maxHealth;
        this.armor = e.armor;
        if (e.health <= 0) {
          this.deaths++;
          this.killStreak = 0;
        }
      }),
      this.bus.on<WeaponFireEvent>(GAME_EVENTS.WEAPON_FIRED, (e) => {
        if (e.sourceId === -1) {
          this.shotsFired++;
          this.lastFireAt = this.options.now();
        }
      }),
      this.bus.on<HitMarkerEvent>(GAME_EVENTS.HIT_MARKER, () => {
        this.shotsHit++;
      }),
      this.bus.on<SoundEvent>(GAME_EVENTS.SOUND, (e) => {
        if (e.type === 'footstep' && e.sourceId === -1) this.lastFootstepAt = this.options.now();
      }),
      this.bus.on<ObjectiveEvent>(GAME_EVENTS.OBJECTIVE, (e) => {
        if (e.progress) {
          this.missionTarget = e.progress.target;
          this.missionBaseline = this.kills;
        }
      })
    );
  }

  private buildFrame(now: number = this.options.now(), moving = false, firing = false): TelemetryFrame {
    return {
      timestamp: now,
      health: this.health,
      maxHealth: this.maxHealth,
      armor: this.armor,
      kills: this.kills,
      killStreak: this.killStreak,
      deaths: this.deaths,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      missionProgress: Math.max(0, this.kills - this.missionBaseline),
      missionTarget: this.missionTarget,
      moving,
      firing,
      secondsIdle: this.idleSeconds,
      lowHealthSeconds: this.lowHealthSeconds,
    };
  }
}
