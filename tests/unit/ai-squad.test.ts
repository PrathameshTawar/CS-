/**
 * ai-squad.test.ts
 *
 * Unit tests for SquadManager/Squad (Requirements 11, 12):
 * contact broadcast within radio range, role assignment (flank +
 * suppress), last-survivor solo assault, and medic healing.
 */

import * as THREE from 'three';
import { EventBus } from '../../src/engine/events/EventBus';
import { PhysicsWorld } from '../../src/physics/core/PhysicsWorld';
import { NavGrid } from '../../src/gameplay/maps/NavGrid';
import { EnemyController, AIState } from '../../src/ai/core/EnemyController';
import { SquadManager } from '../../src/ai/core/SquadManager';
import { ENEMY_CLASSES, EnemyClassDef } from '../../src/ai/classes/EnemyClasses';
import { GAME_EVENTS, SquadEvent } from '../../src/gameplay/core/GameTypes';

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

describe('SquadManager', () => {
  it('broadcasts contact to squad members within radio range', () => {
    const bus = new EventBus();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const squadEvents: SquadEvent[] = [];
    bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => squadEvents.push(e));

    const manager = new SquadManager(bus, 50);
    const a = makeEnemy(bus, physics, grid, 1, 5, 5);
    const b = makeEnemy(bus, physics, grid, 2, 8, 5);
    manager.createSquad([a, b]);

    // Enemy a sees the player → squad radio alert
    a.onSeenPlayer(new THREE.Vector3(10, 1.5, 5), 0);

    expect(squadEvents.some((e) => e.type === 'contact')).toBe(true);
    expect(b.state).toBe(AIState.Combat);
    expect(b.getPerceptionMemory().lastKnownPosition?.x).toBeCloseTo(10, 5);
  });

  it('does NOT alert members beyond radio range', () => {
    const bus = new EventBus();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const squadEvents: SquadEvent[] = [];
    bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => squadEvents.push(e));

    const manager = new SquadManager(bus, 20); // tight radio range
    const a = makeEnemy(bus, physics, grid, 1, 5, 5);
    const far = makeEnemy(bus, physics, grid, 2, 80, 80);
    manager.createSquad([a, far]);

    a.onSeenPlayer(new THREE.Vector3(10, 1.5, 5), 0);

    expect(squadEvents.some((e) => e.type === 'contact')).toBe(true);
    expect(far.state).toBe(AIState.Patrol); // stayed on patrol
  });

  it('assigns flank and suppress roles to combat members', () => {
    const bus = new EventBus();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();

    const manager = new SquadManager(bus, 50);
    const scout = makeEnemy(bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.scout);
    const heavy = makeEnemy(bus, physics, grid, 2, 8, 5, ENEMY_CLASSES.heavy);
    const squad = manager.createSquad([scout, heavy]);

    // Both into combat
    const playerPos = new THREE.Vector3(15, 1.5, 5);
    scout.onSquadContact(playerPos);
    heavy.onSquadContact(playerPos);

    squad.update(1.0, playerPos);

    const roles = squad.members.map((m) => m.role).sort();
    expect(roles).toContain('flank');
    expect(roles).toContain('suppress');
  });

  it('makes the last survivor go solo aggressive (Requirement 11.6)', () => {
    const bus = new EventBus();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();
    const squadEvents: SquadEvent[] = [];
    bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => squadEvents.push(e));

    const manager = new SquadManager(bus, 50);
    const a = makeEnemy(bus, physics, grid, 1, 5, 5);
    const b = makeEnemy(bus, physics, grid, 2, 8, 5);
    const squad = manager.createSquad([a, b]);

    b.applyDamage(9999, -1); // kill b

    squad.update(1.0, new THREE.Vector3(15, 1.5, 5));

    expect(a.alive).toBe(true);
    expect(a.role).toBe('flank');
    expect(squadEvents.some((e) => e.type === 'solo')).toBe(true);
  });

  it('medics heal wounded squad members up to 80% (Requirement 12.5)', () => {
    const bus = new EventBus();
    const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
    const grid = makeNavGrid();

    const manager = new SquadManager(bus, 50);
    const medic = makeEnemy(bus, physics, grid, 1, 5, 5, ENEMY_CLASSES.medic);
    const wounded = makeEnemy(bus, physics, grid, 2, 6, 5, ENEMY_CLASSES.scout);
    const squad = manager.createSquad([medic, wounded]);

    wounded.health = 20; // well below 80% of max (60)
    squad.medicHeal(medic, 1.0);

    expect(wounded.health).toBeGreaterThan(20);
    expect(wounded.health).toBeLessThanOrEqual(ENEMY_CLASSES.scout.health * 0.8 + 0.01);
  });
});
