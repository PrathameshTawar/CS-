/**
 * director-rules.test.ts
 *
 * Unit tests for the AI Director (Requirement 28, tasks T1.1-T1.4):
 *  - telemetry aggregation from bus events (kills, streak, health, shots)
 *  - each baseline rule fires (low-health, kill-streak, idle, spawn)
 *  - cooldowns rate-limit commands (no spam)
 *  - per-session spawn cap is respected (R28.7)
 */

import { EventBus } from '../../src/engine/events/EventBus';
import { DirectorAgent, DIRECTOR_COMMAND_EVENT, DEFAULT_DIRECTOR_RULES } from '../../src/modes/ai/DirectorAgent';
import { GAME_EVENTS } from '../../src/gameplay/core/GameTypes';
import type { AdaptationCommand, Difficulty, TelemetryFrame } from '../../src/modes/GameMode';

/** Build a telemetry frame with sane defaults for pure rule-condition tests. */
function frame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    timestamp: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    kills: 0,
    killStreak: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    missionProgress: 0,
    missionTarget: 0,
    moving: false,
    firing: false,
    secondsIdle: 0,
    lowHealthSeconds: 0,
    ...overrides,
  };
}

/** Shared mutable clock (ms) — injectable via the director's now() option. */
let nowMs = 0;

interface Harness {
  bus: EventBus;
  director: DirectorAgent;
  commands: AdaptationCommand[];
}

/** Create a director wired to a bus with a controllable clock + RNG. */
function createDirector(opts: {
  difficulty?: Difficulty;
  difficultyCeiling?: Difficulty;
  maxSpawnedEnemies?: number;
}): Harness {
  const bus = new EventBus();
  const commands: AdaptationCommand[] = [];
  bus.on(DIRECTOR_COMMAND_EVENT, (cmd: AdaptationCommand) => commands.push(cmd));
  const director = new DirectorAgent(bus, {
    getDifficulty: () => opts.difficulty ?? 'normal',
    difficultyCeiling: opts.difficultyCeiling ?? 'hard',
    maxSpawnedEnemies: opts.maxSpawnedEnemies ?? 8,
    now: () => nowMs,
    random: () => 0, // always fire when a condition is true
  });
  return { bus, director, commands };
}

/** Advance the shared clock and run one 1-second director heartbeat. */
function heartbeats(director: DirectorAgent, count: number): void {
  for (let i = 0; i < count; i++) {
    nowMs += 1000;
    director.update(1);
  }
}

function emitKills(bus: EventBus, count: number): void {
  for (let i = 0; i < count; i++) {
    bus.emit(GAME_EVENTS.KILL, {
      killerId: -1,
      killerName: 'You',
      victimId: 100 + i,
      victimName: 'Enemy',
      headshot: false,
      worldPosition: { x: 0, y: 0, z: 0 },
    });
  }
}

describe('DirectorAgent', () => {
  beforeEach(() => {
    nowMs = 0;
  });

  describe('telemetry aggregation', () => {
    it('aggregates kills, streak, health and shots from bus events', () => {
      const { bus, director } = createDirector({});
      emitKills(bus, 3);
      bus.emit(GAME_EVENTS.HEALTH, { health: 80, maxHealth: 100, armor: 20, maxArmor: 50 });
      bus.emit(GAME_EVENTS.WEAPON_FIRED, {
        weaponId: 'ar', sourceId: -1,
        position: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 }, suppressed: false,
      });
      bus.emit(GAME_EVENTS.HIT_MARKER, { kind: 'hit' });

      heartbeats(director, 1);

      const t = director.getTelemetry();
      expect(t.kills).toBe(3);
      expect(t.killStreak).toBe(3);
      expect(t.health).toBe(80);
      expect(t.shotsFired).toBe(1);
      expect(t.shotsHit).toBe(1);
    });

    it('resets the kill streak when the player dies', () => {
      const { bus, director } = createDirector({});
      emitKills(bus, 3);
      bus.emit(GAME_EVENTS.HEALTH, { health: 0, maxHealth: 100, armor: 0, maxArmor: 50 });
      heartbeats(director, 1);
      expect(director.getTelemetry().killStreak).toBe(0);
      expect(director.getTelemetry().deaths).toBe(1);
    });
  });

  describe('baseline rules (R28.4-28.6)', () => {
    it('fires low-health-medkit after 8s below 25% health', () => {
      const { bus, director, commands } = createDirector({});
      bus.emit(GAME_EVENTS.HEALTH, { health: 20, maxHealth: 100, armor: 0, maxArmor: 50 });
      heartbeats(director, 8); // lowHealthSeconds reaches 8 on the last beat
      expect(commands.some((c) => c.kind === 'grant_content' && c.content === 'medkit')).toBe(true);
    });

    it('does not fire low-health-medkit when health is above 25%', () => {
      const { director } = createDirector({});
      expect(director.evaluate(frame({ health: 50, maxHealth: 100, lowHealthSeconds: 8 }))).toEqual([]);
    });

    it('does not fire low-health-medkit before 8 seconds of low health', () => {
      const { director } = createDirector({});
      expect(director.evaluate(frame({ health: 20, maxHealth: 100, lowHealthSeconds: 5 }))).toEqual([]);
    });

    it('fires kill-streak-ramp at an 8-streak when below hard difficulty', () => {
      const { bus, director, commands } = createDirector({ difficulty: 'normal' });
      emitKills(bus, 8);
      heartbeats(director, 1);
      expect(commands).toContainEqual({ kind: 'adjust_difficulty', difficulty: 'hard', ramp: 'ease' });
    });

    it('does not ramp when difficulty is already hard', () => {
      // maxSpawnedEnemies: 0 isolates the ramp rule (disables domination-spawns).
      const { director } = createDirector({ difficulty: 'hard', maxSpawnedEnemies: 0 });
      expect(director.evaluate(frame({ killStreak: 8 }))).toEqual([]);
    });

    it('does not ramp above the biome difficulty ceiling (R28.7)', () => {
      const { director } = createDirector({ difficulty: 'normal', difficultyCeiling: 'normal', maxSpawnedEnemies: 0 });
      expect(director.evaluate(frame({ killStreak: 8 }))).toEqual([]);
    });

    it('fires idle-flush after 45 seconds of no movement and no firing', () => {
      const { director, commands } = createDirector({});
      heartbeats(director, 45);
      expect(commands).toContainEqual({ kind: 'event_trigger', event: 'explosion' });
    });

    it('does not flush an active player', () => {
      const { director } = createDirector({});
      expect(director.evaluate(frame({ secondsIdle: 44, moving: true }))).toEqual([]);
    });
  });

  describe('rate limiting and caps (R28.3, R28.7)', () => {
    it('respects cooldowns — a rule does not re-fire within its window', () => {
      // idle-flush (cooldown 60s) is the only rule that fires for this frame.
      const { director } = createDirector({});
      const f = frame({ secondsIdle: 45 });
      expect(director.evaluate(f).length).toBe(1); // fires at nowMs = 0

      nowMs += 10_000; // still within the 60s cooldown
      expect(director.evaluate(f).length).toBe(0);

      nowMs += 60_000; // 70s total — past cooldown
      expect(director.evaluate(f).length).toBe(1);
    });

    it('respects the per-session spawn cap (R28.7)', () => {
      const { bus, director, commands } = createDirector({ maxSpawnedEnemies: 2, difficulty: 'hard' });
      emitKills(bus, 5); // killStreak 5 → domination-spawns fires (spawned 2)
      heartbeats(director, 1);
      expect(commands.filter((c) => c.kind === 'spawn_enemies').length).toBe(1);

      nowMs += 30_000; // past the 25s cooldown
      emitKills(bus, 2); // streak now 7 — but cap (2) reached
      heartbeats(director, 1);
      expect(commands.filter((c) => c.kind === 'spawn_enemies').length).toBe(1);
    });
  });

  describe('rule table shape', () => {
    it('defines the four baseline rules with positive cooldowns', () => {
      expect(DEFAULT_DIRECTOR_RULES.map((r) => r.id)).toEqual([
        'low-health-medkit',
        'kill-streak-ramp',
        'idle-flush',
        'domination-spawns',
      ]);
      for (const rule of DEFAULT_DIRECTOR_RULES) {
        expect(rule.cooldown).toBeGreaterThan(0);
        expect(rule.probability).toBeGreaterThan(0);
        expect(rule.probability).toBeLessThanOrEqual(1);
      }
    });
  });
});
