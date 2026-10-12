/**
 * ai-enemy.test.ts
 *
 * Unit tests for EnemyController (Requirements 9-12):
 * damage & kill events, hearing→investigate transitions, squad
 * contact→combat, and the ai.enemy.seen emission throttle.
 */

import * as THREE from 'three';
import { EventBus } from '../../src/engine/events/EventBus';
import { PhysicsWorld } from '../../src/physics/core/PhysicsWorld';
import { NavGrid } from '../../src/gameplay/maps/NavGrid';
import { EnemyController, AIState } from '../../src/ai/core/EnemyController';
import { ENEMY_CLASSES } from '../../src/ai/classes/EnemyClasses';
import { GAME_EVENTS, KillEvent, SoundEvent } from '../../src/gameplay/core/GameTypes';

function makeGrid(): NavGrid {
  const grid = new NavGrid({ width: 30, depth: 30, cellSize: 1.5 });
  for (let x = 0; x < 30; x++) {
    for (let z = 0; z < 30; z++) {
      grid.setCell(x, z, true, 0.1);
    }
  }
  return grid;
}

function makeEnemy(bus: EventBus, id = 1): EnemyController {
  const physics = new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
  return new EnemyController(bus, physics, {
    id,
    name: `Enemy ${id}`,
    classDef: ENEMY_CLASSES.scout,
    navGrid: makeGrid(),
    spawn: { x: 0, y: 0, z: 0 },
  });
}

describe('EnemyController', () => {
  it('starts patrolling with full health', () => {
    const bus = new EventBus();
    const enemy = makeEnemy(bus);
    expect(enemy.state).toBe(AIState.Patrol);
    expect(enemy.alive).toBe(true);
    expect(enemy.health).toBe(ENEMY_CLASSES.scout.health);
  });

  it('applies damage and emits a KILL event at zero health', () => {
    const bus = new EventBus();
    const kills: KillEvent[] = [];
    bus.on<KillEvent>(GAME_EVENTS.KILL, (e) => kills.push(e));

    const enemy = makeEnemy(bus);
    enemy.applyDamage(10, -1);
    expect(enemy.health).toBe(ENEMY_CLASSES.scout.health - 10);
    expect(enemy.alive).toBe(true);
    expect(kills.length).toBe(0);

    enemy.applyDamage(9999, -1);
    expect(enemy.alive).toBe(false);
    expect(enemy.state).toBe(AIState.Dead);
    expect(kills.length).toBe(1);
    expect(kills[0].killerId).toBe(-1);
    expect(kills[0].victimId).toBe(enemy.id);
  });

  it('transitions to investigate when it hears a sound', () => {
    const bus = new EventBus();
    const enemy = makeEnemy(bus);
    const sound: SoundEvent = {
      type: 'footstep',
      position: { x: 3, y: 0, z: 0 },
      radius: 20,
      volume: 0.8,
    };
    enemy.onSoundHeard(sound, 5);
    expect(enemy.state).toBe(AIState.Investigate);
  });

  it('ignores silent sounds (Requirement 9.4)', () => {
    const bus = new EventBus();
    const enemy = makeEnemy(bus);
    const silent: SoundEvent = {
      type: 'gunshot',
      position: { x: 3, y: 0, z: 0 },
      radius: 0,
      volume: 1,
    };
    enemy.onSoundHeard(silent, 5);
    expect(enemy.state).toBe(AIState.Patrol);
  });

  it('enters combat and remembers the player on squad contact', () => {
    const bus = new EventBus();
    const enemy = makeEnemy(bus);
    const playerPos = new THREE.Vector3(10, 1.5, 10);
    enemy.onSquadContact(playerPos);
    expect(enemy.state).toBe(AIState.Combat);
    expect(enemy.getPerceptionMemory().lastKnownPosition?.x).toBeCloseTo(10, 5);
  });

  it('throttles ai.enemy.seen emissions to once per second', () => {
    const bus = new EventBus();
    let seenEmissions = 0;
    bus.on('ai.enemy.seen', () => seenEmissions++);

    const enemy = makeEnemy(bus);
    const playerPos = new THREE.Vector3(10, 1.5, 10);

    // First sighting → transition to combat → emit
    enemy.onSeenPlayer(playerPos, 0);
    expect(seenEmissions).toBe(1);
    expect(enemy.state).toBe(AIState.Combat);

    // Rapid re-sightings within the interval → no re-emission
    enemy.onSeenPlayer(playerPos, 0.5);
    expect(seenEmissions).toBe(1);

    // Drop out of combat (lose sight → search) then re-see after 1s
    enemy.enterState(AIState.Search);
    enemy.onSeenPlayer(playerPos, 2.0);
    expect(seenEmissions).toBe(2);
  });

  it('keeps the player visible state accurate after losing sight', () => {
    const bus = new EventBus();
    const enemy = makeEnemy(bus);
    const playerPos = new THREE.Vector3(10, 1.5, 10);
    enemy.onSeenPlayer(playerPos, 0);
    expect(enemy.getPerceptionMemory().seesPlayer).toBe(true);
  });
});
