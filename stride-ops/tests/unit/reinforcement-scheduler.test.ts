/**
 * reinforcement-scheduler.test.ts
 *
 * Unit tests for ReinforcementScheduler (R33.3): the 8s delay before a
 * 'reinforce' request becomes a spawn, the FIFO release order, the
 * MAX_LIVE_ENEMIES cap gate dropping denied requests, and cancellation.
 * Mirrors the Game.ts wiring: a SQUAD 'reinforce' event schedules a 3-enemy
 * support squad, and poll() feeds spawnDirectorEnemies.
 */

import { ReinforcementScheduler, REINFORCEMENT_TUNING } from '../../src/modes/ai/ReinforcementScheduler';
import { SQUAD_REINFORCE_DELAY } from '../../src/modes/ai/SquadCommander';
import type { EnemyClassId } from '../../src/ai/classes/EnemyClasses';

const SUPPORT_SQUAD: EnemyClassId[] = ['scout', 'heavy', 'medic'];

interface Harness {
  scheduler: ReinforcementScheduler;
  t: { now: number };
  fired: { count: number; classes: EnemyClassId[] }[];
}

function makeHarness(options: {
  delay?: number;
  canFire?: (req: { count: number; classes: EnemyClassId[] }) => boolean;
} = {}): Harness {
  const t = { now: 0 };
  const fired: { count: number; classes: EnemyClassId[] }[] = [];
  const scheduler = new ReinforcementScheduler({
    delay: options.delay,
    now: () => t.now,
    canFire: options.canFire ?? (() => true),
  });
  return { scheduler, t, fired };
}

/** Mimic the Game.ts path: poll due requests and record spawns. */
function poll(h: Harness): void {
  for (const req of h.scheduler.poll(h.t.now)) {
    h.fired.push(req);
  }
}

describe('ReinforcementScheduler', () => {
  it('holds a request for the 8s delay before releasing it (R33.3)', () => {
    const h = makeHarness();
    h.scheduler.schedule(3, SUPPORT_SQUAD);

    // Not yet due at t=7.
    h.t.now = 7;
    poll(h);
    expect(h.fired.length).toBe(0);
    expect(h.scheduler.length).toBe(1);

    // Due exactly at the 8s mark.
    h.t.now = 8;
    poll(h);
    expect(h.fired.length).toBe(1);
    expect(h.fired[0]).toEqual({ count: 3, classes: SUPPORT_SQUAD });
    expect(h.scheduler.length).toBe(0);
  });

  it('defaults the delay to the SQUAD_REINFORCE_DELAY constant (8s)', () => {
    const h = makeHarness();
    h.scheduler.schedule(1, ['scout']);
    h.t.now = SQUAD_REINFORCE_DELAY - 0.001;
    poll(h);
    expect(h.fired.length).toBe(0);
    h.t.now = SQUAD_REINFORCE_DELAY;
    poll(h);
    expect(h.fired.length).toBe(1);
  });

  it('releases multiple matured requests in FIFO order', () => {
    const h = makeHarness();
    h.scheduler.schedule(3, SUPPORT_SQUAD);
    h.t.now = 2;
    h.scheduler.schedule(2, ['scout', 'sniper']);
    h.t.now = 5;
    h.scheduler.schedule(4, ['heavy']);

    // fireAt: request 1 = 0+8 = 8, request 2 = 2+8 = 10, request 3 = 5+8 = 13.
    h.t.now = 8; // only request 1 matured
    poll(h);
    expect(h.fired.length).toBe(1);
    expect(h.fired[0]).toEqual({ count: 3, classes: SUPPORT_SQUAD });
    expect(h.scheduler.length).toBe(2);

    h.t.now = 10; // requests 1 and 2 matured → FIFO order preserved
    poll(h);
    expect(h.fired.length).toBe(2);
    expect(h.fired[1]).toEqual({ count: 2, classes: ['scout', 'sniper'] });
    expect(h.scheduler.length).toBe(1);

    h.t.now = 13; // all three matured
    poll(h);
    expect(h.fired.length).toBe(3);
    expect(h.fired[2]).toEqual({ count: 4, classes: ['heavy'] });
    expect(h.scheduler.length).toBe(0);
  });

  it('drops due requests that fail the cap gate (MAX_LIVE_ENEMIES respected)', () => {
    let alive = 20;
    const MAX_LIVE_ENEMIES = 20;
    const h = makeHarness({
      canFire: () => alive < MAX_LIVE_ENEMIES,
    });
    h.scheduler.schedule(3, SUPPORT_SQUAD);

    // Scene at cap when the request matures → dropped, no spawn.
    h.t.now = 8;
    poll(h);
    expect(h.fired.length).toBe(0);
    expect(h.scheduler.length).toBe(0); // consumed, not retried

    // A later request while under cap → spawns normally.
    h.t.now = 8;
    alive = 15;
    h.scheduler.schedule(3, SUPPORT_SQUAD);
    h.t.now = 16;
    poll(h);
    expect(h.fired.length).toBe(1);
    expect(h.fired[0]).toEqual({ count: 3, classes: SUPPORT_SQUAD });
  });

  it('evaluates the cap gate only for matured requests', () => {
    let gateCalls = 0;
    const h = makeHarness({
      canFire: () => {
        gateCalls++;
        return true;
      },
    });
    h.scheduler.schedule(3, SUPPORT_SQUAD);

    // t=4: not matured → gate not consulted yet.
    h.t.now = 4;
    poll(h);
    expect(gateCalls).toBe(0);

    // t=8: matured → gate consulted exactly once.
    h.t.now = 8;
    poll(h);
    expect(gateCalls).toBe(1);
  });

  it('clear() cancels all pending reinforcement requests', () => {
    const h = makeHarness();
    h.scheduler.schedule(3, SUPPORT_SQUAD);
    h.t.now = 4;
    h.scheduler.schedule(2, ['scout']);

    h.scheduler.clear();
    expect(h.scheduler.length).toBe(0);

    h.t.now = 8;
    poll(h);
    expect(h.fired.length).toBe(0);
  });

  it('supports a custom delay and clock (test seam)', () => {
    const h = makeHarness({ delay: 0.5 });
    h.scheduler.schedule(1, ['scout']);

    h.t.now = 0.49;
    poll(h);
    expect(h.fired.length).toBe(0);

    h.t.now = 0.5;
    poll(h);
    expect(h.fired.length).toBe(1);
  });

  it('defines per-difficulty reinforcement loadouts (R33.3)', () => {
    // Every difficulty has a valid, non-empty mix of known classes.
    const allClasses = new Set<EnemyClassId>(['scout', 'heavy', 'sniper', 'engineer', 'medic']);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const mix = REINFORCEMENT_TUNING[difficulty].classes;
      expect(mix.length).toBeGreaterThan(0);
      for (const c of mix) expect(allClasses.has(c)).toBe(true);
    }

    // Normal keeps the classic balanced trio.
    expect(REINFORCEMENT_TUNING.normal.classes).toEqual(['scout', 'heavy', 'medic']);

    // Difficulty scaling: easy is a light pair, hard is a heavy four.
    expect(REINFORCEMENT_TUNING.easy.classes.length).toBeLessThan(
      REINFORCEMENT_TUNING.normal.classes.length
    );
    expect(REINFORCEMENT_TUNING.hard.classes.length).toBeGreaterThan(
      REINFORCEMENT_TUNING.normal.classes.length
    );
    const hardHeavies = REINFORCEMENT_TUNING.hard.classes.filter((c) => c === 'heavy').length;
    const easyHeavies = REINFORCEMENT_TUNING.easy.classes.filter((c) => c === 'heavy').length;
    expect(hardHeavies).toBeGreaterThan(easyHeavies);
  });

  it('schedules the data-driven loadout with count = classes.length', () => {
    const h = makeHarness();
    const mix = REINFORCEMENT_TUNING.hard;
    h.scheduler.schedule(mix.classes.length, mix.classes);

    h.t.now = 8;
    poll(h);
    expect(h.fired.length).toBe(1);
    expect(h.fired[0]).toEqual({ count: 4, classes: ['heavy', 'heavy', 'sniper', 'medic'] });
  });
});
