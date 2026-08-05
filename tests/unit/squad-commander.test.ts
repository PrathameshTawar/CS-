/**
 * squad-commander.test.ts
 *
 * Unit tests for SquadCommander (R33.1-R33.4): order issuance for each
 * tactical order (flank/retreat/ambush/hold/search/reinforce), the ≤1s
 * order refresh, the reinforce cooldown, and the 8s reinforcement delay.
 */

import * as THREE from 'three';
import { EventBus } from '../../src/engine/events/EventBus';
import { PhysicsWorld } from '../../src/physics/core/PhysicsWorld';
import { NavGrid } from '../../src/gameplay/maps/NavGrid';
import { EnemyController, AIState } from '../../src/ai/core/EnemyController';
import { SquadManager } from '../../src/ai/core/SquadManager';
import { ENEMY_CLASSES, EnemyClassDef } from '../../src/ai/classes/EnemyClasses';
import {
  SquadCommander,
  SQUAD_REINFORCE_DELAY,
  SQUAD_COMMANDER_TUNING,
} from '../../src/modes/ai/SquadCommander';
import type { SquadCommanderTuning, SquadOrderType } from '../../src/modes/ai/SquadCommander';
import { GAME_EVENTS, SquadEvent } from '../../src/gameplay/core/GameTypes';
import type { Difficulty } from '../../src/modes/GameMode';

function makeNavGrid(): NavGrid {
  const grid = new NavGrid({ width: 30, depth: 30, cellSize: 1.5 });
  for (let x = 0; x < 30; x++) {
    for (let z = 0; z < 30; z++) {
      grid.setCell(x, z, true, 0.1);
    }
  }
  return grid;
}

function makeEnemy(
  bus: EventBus,
  physics: PhysicsWorld,
  grid: NavGrid,
  id: number,
  x: number,
  z: number,
  classDef: EnemyClassDef = ENEMY_CLASSES.scout
): EnemyController {
  return new EnemyController(bus, physics, {
    id,
    name: `Enemy ${id}`,
    classDef,
    navGrid: grid,
    spawn: { x, y: 0, z },
  });
}

interface Harness {
  bus: EventBus;
  manager: SquadManager;
  commander: SquadCommander;
  events: SquadEvent[];
  t: { now: number };
  difficulty: { value: Difficulty };
}

function makeHarness(
  options: {
    refreshInterval?: number;
    difficulty?: Difficulty;
    tuning?: Partial<SquadCommanderTuning>;
    random?: () => number;
  } = {}
): Harness {
  const bus = new EventBus();
  const manager = new SquadManager(bus, 50);
  const t = { now: 0 };
  const difficulty = { value: options.difficulty ?? ('normal' as Difficulty) };
  const events: SquadEvent[] = [];
  bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => events.push(e));

  const commander = new SquadCommander(bus, manager, {
    now: () => t.now,
    // Always below reinforceChance for deterministic tests unless overridden.
    random: options.random ?? (() => 0.1),
    refreshInterval: options.refreshInterval ?? 1.0,
    getDifficulty: () => difficulty.value,
    tuning: options.tuning,
  });
  return { bus, manager, commander, events, t, difficulty };
}

function putInCombat(enemies: EnemyController[], playerPos: THREE.Vector3): void {
  for (const e of enemies) {
    e.onSquadContact(playerPos);
  }
}

describe('SquadCommander', () => {
  it('issues a flank order when two or more members are in combat', () => {
    const h = makeHarness();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const scout = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
    const heavy = makeEnemy(h.bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
    h.manager.createSquad([scout, heavy]);

    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([scout, heavy], playerPos);
    // Simulate a direct sight line so the ambush branch doesn't preempt flank.
    scout.getPerceptionMemory().seesPlayer = true;

    h.commander.update(1.0, playerPos);

    const flankOrders = h.commander.getOrderHistory().filter((o) => o.type === 'flank');
    expect(flankOrders.length).toBeGreaterThan(0);
    expect(h.events.some((e) => e.type === 'flank')).toBe(true);
    expect(scout.role).toBe('flank');
    expect(scout.coverTarget).not.toBeNull();
  });

  it('orders retreat for low-HP members in combat', () => {
    const h = makeHarness();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout); // 60 max HP
    const b = makeEnemy(h.bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
    h.manager.createSquad([a, b]);

    a.health = 5; // < 30% of 60
    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([a, b], playerPos);

    h.commander.update(1.0, playerPos);

    const orders = h.commander.getOrderHistory();
    expect(orders.some((o) => o.type === 'retreat')).toBe(true);
    expect(a.state).toBe(AIState.Retreat);
    expect(h.events.some((e) => e.type === 'retreat')).toBe(true);
  });

  it('orders an ambush when combat is active but the player is out of sight', () => {
    const h = makeHarness();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5);
    const b = makeEnemy(h.bus, physics, grid, 2, 8, 5);
    h.manager.createSquad([a, b]);

    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([a, b], playerPos);
    // lastKnownPosition was set by onSquadContact, but nobody currently sees
    // the player → ambush branch.
    expect(a.getPerceptionMemory().seesPlayer).toBe(false);

    h.commander.update(1.0, playerPos);

    const orders = h.commander.getOrderHistory();
    expect(orders.some((o) => o.type === 'ambush')).toBe(true);
    expect(h.events.some((e) => e.type === 'ambush')).toBe(true);
    expect(a.coverTarget).not.toBeNull();
    expect(a.state).toBe(AIState.Combat);
  });

  it('orders hold when a single member is fighting without a last known position', () => {
    const h = makeHarness();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5);
    h.manager.createSquad([a]);

    const playerPos = new THREE.Vector3(15, 1.5, 5);
    a.enterState(AIState.Combat);
    a.getPerceptionMemory().seesPlayer = true;

    h.commander.update(1.0, playerPos);

    const orders = h.commander.getOrderHistory();
    expect(orders.some((o) => o.type === 'hold')).toBe(true);
    expect(h.events.some((e) => e.type === 'hold')).toBe(true);
  });

  it('orders a search of the last known position when alerted but not engaged', () => {
    const h = makeHarness();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5);
    h.manager.createSquad([a]);

    const lastKnown = new THREE.Vector3(15, 1.5, 5);
    a.getPerceptionMemory().lastKnownPosition = lastKnown.clone();
    // Not in combat — the player was seen earlier but is gone.

    h.commander.update(1.0, new THREE.Vector3(2, 1.5, 2));

    const orders = h.commander.getOrderHistory();
    expect(orders.some((o) => o.type === 'search')).toBe(true);
    expect(a.state).toBe(AIState.Search);
    expect(h.events.some((e) => e.type === 'search')).toBe(true);
  });

  it('calls reinforcements when the squad is pressured, and honors the cooldown', () => {
    const h = makeHarness({ tuning: { reinforceCooldown: 15, reinforceChance: 0.6 } });
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5);
    const b = makeEnemy(h.bus, physics, grid, 2, 8, 5);
    const c = makeEnemy(h.bus, physics, grid, 3, 10, 5);
    const squad = h.manager.createSquad([a, b, c]);

    // Squad of 3, two killed → 1 survivor ≤ 50% strength.
    b.applyDamage(9999, -1);
    c.applyDamage(9999, -1);

    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([a], playerPos);

    h.commander.update(1.0, playerPos);
    const reinforceEvents = h.events.filter((e) => e.type === 'reinforce');
    expect(reinforceEvents.length).toBe(1);
    expect(reinforceEvents[0].squadId).toBe(squad.id);
    expect(h.commander.getOrderHistory().some((o) => o.type === 'reinforce')).toBe(true);

    // Advance 5s — inside the 15s cooldown → no second call.
    h.t.now = 5;
    h.commander.update(1.0, playerPos);
    expect(h.events.filter((e) => e.type === 'reinforce').length).toBe(1);

    // Advance past the cooldown → the squad may call again.
    h.t.now = 20;
    h.commander.update(1.0, playerPos);
    expect(h.events.filter((e) => e.type === 'reinforce').length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes orders at most once per second (R33.4)', () => {
    const h = makeHarness({ refreshInterval: 1.0 });
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const a = makeEnemy(h.bus, physics, grid, 1, 5, 5);
    h.manager.createSquad([a]);

    const playerPos = new THREE.Vector3(15, 1.5, 5);
    a.enterState(AIState.Combat);
    a.getPerceptionMemory().seesPlayer = true;

    // Two partial updates under 1s → still no order.
    h.commander.update(0.4, playerPos);
    h.commander.update(0.4, playerPos);
    expect(h.commander.getOrderHistory().length).toBe(0);

    // Crossing the 1s threshold → order issued.
    h.commander.update(0.4, playerPos);
    expect(h.commander.getOrderHistory().length).toBeGreaterThan(0);
  });

  it('exposes the 8s reinforcement delay constant (R33.3)', () => {
    expect(SQUAD_REINFORCE_DELAY).toBe(8);
  });

  it('scales flank aggression with difficulty (hard flanks, easy holds)', () => {
    // Two engaged members with a seesPlayer sight line — the flank branch is
    // the only combat order available (no wounded, not pressured, no ambush).
    function runForDifficulty(difficulty: Difficulty): 'flank' | 'hold' | 'none' {
      // Mid-range roll (0.5): above easy's flankChance (0.4), below hard's (1.0).
      const h = makeHarness({ difficulty, random: () => 0.5 });
      const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
      const grid = makeNavGrid();
      const scout = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
      const heavy = makeEnemy(h.bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
      h.manager.createSquad([scout, heavy]);
      const playerPos = new THREE.Vector3(15, 1.5, 5);
      putInCombat([scout, heavy], playerPos);
      scout.getPerceptionMemory().seesPlayer = true;
      h.commander.update(1.0, playerPos);
      const types = h.commander.getOrderHistory().map((o) => o.type);
      if (types.includes('flank')) return 'flank';
      if (types.includes('hold')) return 'hold';
      return 'none';
    }

    // Hard: flankChance 1.0 → always flanks. Easy: flankChance 0.4 and the
    // roll falls through to holdChance 0.9 → holds instead.
    expect(runForDifficulty('hard')).toBe('flank');
    expect(runForDifficulty('easy')).toBe('hold');
    // The weights themselves reflect the intent.
    expect(SQUAD_COMMANDER_TUNING.hard.flankChance).toBeGreaterThan(
      SQUAD_COMMANDER_TUNING.easy.flankChance
    );
  });

  it('scales retreat behavior with difficulty (easy retreats, hard fights on)', () => {
    // One wounded member in combat. Easy's retreatChance (1.0) always fires;
    // hard's roll of 0.6 misses the retreat gate (0.5) and falls through to an
    // ambush order instead — i.e. it keeps fighting rather than falling back.
    function ordersFor(difficulty: Difficulty): SquadOrderType[] {
      // Mid-range roll (0.6): below easy's retreatChance (1.0), above hard's (0.5).
      const h = makeHarness({ difficulty, random: () => 0.6 });
      const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
      const grid = makeNavGrid();
      const a = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
      h.manager.createSquad([a]);
      a.health = 5; // < 30% of 60
      const playerPos = new THREE.Vector3(15, 1.5, 5);
      putInCombat([a], playerPos);
      h.commander.update(1.0, playerPos);
      return h.commander.getOrderHistory().map((o) => o.type);
    }

    expect(ordersFor('easy')).toContain('retreat');
    const hardOrders = ordersFor('hard');
    expect(hardOrders).not.toContain('retreat');
    expect(hardOrders.length).toBeGreaterThan(0); // fights on (ambush), not idle
    expect(SQUAD_COMMANDER_TUNING.easy.retreatChance).toBeGreaterThan(
      SQUAD_COMMANDER_TUNING.hard.retreatChance
    );
  });

  it('tracks live difficulty changes (Director escalation takes effect immediately)', () => {
    // Mid-range roll (0.5) so easy holds while hard flanks.
    const h = makeHarness({ difficulty: 'easy', random: () => 0.5 });
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const scout = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
    const heavy = makeEnemy(h.bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
    h.manager.createSquad([scout, heavy]);
    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([scout, heavy], playerPos);
    scout.getPerceptionMemory().seesPlayer = true;

    // Easy → squad holds rather than flanks.
    h.commander.update(1.0, playerPos);
    expect(h.commander.getOrderHistory().some((o) => o.type === 'flank')).toBe(false);
    expect(h.commander.getOrderHistory().some((o) => o.type === 'hold')).toBe(true);

    // Director escalates to hard mid-session → next refresh the squad flanks.
    h.difficulty.value = 'hard';
    h.t.now = 5;
    h.commander.update(1.0, playerPos);
    expect(h.commander.getOrderHistory().some((o) => o.type === 'flank')).toBe(true);
  });

  it('lets an instance tuning override beat the difficulty preset', () => {
    const h = makeHarness({
      difficulty: 'hard',
      random: () => 0.5,
      tuning: { flankChance: 0 }, // suppress flanks entirely despite hard
    });
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const scout = makeEnemy(h.bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
    const heavy = makeEnemy(h.bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
    h.manager.createSquad([scout, heavy]);
    const playerPos = new THREE.Vector3(15, 1.5, 5);
    putInCombat([scout, heavy], playerPos);
    scout.getPerceptionMemory().seesPlayer = true;

    h.commander.update(1.0, playerPos);
    const types = h.commander.getOrderHistory().map((o) => o.type);
    expect(types.includes('flank')).toBe(false);
    expect(types.includes('hold')).toBe(true);
  });
});
