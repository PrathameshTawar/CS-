/**
 * EnemyController.ts
 *
 * Behavior-tree-lite enemy controller implementing Requirements 9, 10, 11:
 *  - PATROL: follow patrol routes via A* navigation
 *  - INVESTIGATE: move to last heard sound position
 *  - SEARCH: sweep last-known position
 *  - COMBAT: engage the player (shoot, strafe, cover)
 *  - RETREAT: fall back when low HP
 *  - Classes: Scout flanks, Heavy suppresses, Sniper repositions,
 *    Engineer deploys turrets, Medic heals squad members
 *
 * @module AI
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { PhysicsWorld } from '../../physics/core/PhysicsWorld';
import { PerceptionSystem } from '../perception/PerceptionSystem';
import { AINavigator } from '../navigation/AINavigator';
import { EnemyClassDef } from '../classes/EnemyClasses';
import { NavGrid } from '../../gameplay/maps/NavGrid';
import { GAME_EVENTS, SoundEvent, DamageEvent, KillEvent } from '../../gameplay/core/GameTypes';

export enum AIState {
  Idle = 'idle',
  Patrol = 'patrol',
  Investigate = 'investigate',
  Search = 'search',
  Combat = 'combat',
  Retreat = 'retreat',
  Dead = 'dead',
}

export interface EnemySnapshot {
  id: number;
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  state: AIState;
  classId: string;
}

export interface EnemyControllerConfig {
  /** Unique entity id. */
  id: number;
  name: string;
  classDef: EnemyClassDef;
  navGrid: NavGrid;
  spawn: { x: number; y: number; z: number };
  patrolRoute?: { x: number; z: number }[];
  /** Random in [0,1); injectable for tests. Defaults to Math.random. */
  random?: () => number;
}

export class EnemyController {
  readonly id: number;
  readonly name: string;
  classDef: EnemyClassDef;
  readonly position: THREE.Vector3;
  healthMax: number;
  health: number;
  state: AIState = AIState.Idle;
  yaw = 0;
  alive = true;

  /** World mesh holder (assigned by demo scene layer). */
  meshGroup: THREE.Group | null = null;

  /** Cover target set by the controller or squad manager. */
  coverTarget: THREE.Vector3 | null = null;

  private readonly bus: EventBus;
  private readonly physics: PhysicsWorld;
  private readonly perception: PerceptionSystem;
  private readonly navigator: AINavigator;
  private readonly patrolRoute: { x: number; z: number }[];
  private patrolIndex = 0;
  private readonly eyeOffset = 1.5;

  // Combat state
  private fireCooldown = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private repositionTimer = 0;

  // Turret deployment (engineer)
  turretDeployed = false;
  private deployTimer = 0;

  // Medic
  private healCooldown = 0;

  // Retreat
  private retreatTimer = 0;

  /** Random in [0,1); injectable for tests. */
  private readonly random: () => number;

  // Squad role (assigned by SquadManager)
  role: 'suppress' | 'flank' | 'support' | 'none' = 'none';
  squadId: number | null = null;

  // Throttle for squad contact broadcasts (avoid per-frame spam)
  private lastContactEmitTime = -Infinity;
  private readonly contactEmitInterval = 1.0;

  private readonly stateTimers: Record<AIState, number> = {
    [AIState.Idle]: 0,
    [AIState.Patrol]: 0,
    [AIState.Investigate]: 0,
    [AIState.Search]: 0,
    [AIState.Combat]: 0,
    [AIState.Retreat]: 0,
    [AIState.Dead]: 0,
  };

  constructor(bus: EventBus, physics: PhysicsWorld, config: EnemyControllerConfig) {
    this.bus = bus;
    this.physics = physics;
    this.id = config.id;
    this.name = config.name;
    this.classDef = config.classDef;
    this.position = new THREE.Vector3(config.spawn.x, config.spawn.y, config.spawn.z);
    this.healthMax = config.classDef.health;
    this.health = this.healthMax;
    this.patrolRoute = config.patrolRoute ?? [];
    this.perception = new PerceptionSystem(
      physics,
      config.classDef.hearingRadius,
      config.classDef.engagementRange + 15,
      130
    );
    this.random = config.random ?? Math.random;
    this.navigator = new AINavigator(config.navGrid);
    this.enterState(AIState.Patrol);
  }

  /**
   * T2.6: Live rebalancing of living enemy stats (health, speed, accuracy)
   * without mutating the base ENEMY_CLASSES definitions (R31.2-R31.3).
   */
  rebalance(
    bal: { healthMultiplier: number; speedMultiplier: number; accuracyMultiplier: number },
    baseDef: EnemyClassDef,
    tuning: { health: number; speed: number; accuracy: number }
  ): void {
    if (!this.alive) return;
    const oldMax = this.healthMax;
    const newMax = Math.max(1, Math.round(baseDef.health * tuning.health * bal.healthMultiplier));
    if (oldMax > 0 && newMax !== oldMax) {
      const ratio = this.health / oldMax;
      this.healthMax = newMax;
      this.health = Math.min(newMax, Math.round(ratio * newMax));
    }
    this.classDef = {
      ...baseDef,
      health: newMax,
      speed: baseDef.speed * tuning.speed * bal.speedMultiplier,
      accuracy: Math.min(0.95, baseDef.accuracy * tuning.accuracy * bal.accuracyMultiplier),
    };
  }

  getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.eyeOffset, this.position.z);
  }

  getFacing(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  getPerceptionMemory() {
    return this.perception.getMemory();
  }

  /**
   * Wire an occlusion checker (e.g. smoke) into this enemy's sight.
   */
  setOcclusionChecker(checker: ((x: number, y: number, z: number) => boolean) | null): void {
    this.perception.setOcclusionChecker(checker);
  }

  enterState(state: AIState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTimers[state] = 0;
  }

  applyDamage(amount: number, sourceId: number, headshot: boolean = false): void {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.enterState(AIState.Dead);
      const killEvent: KillEvent = {
        killerId: sourceId,
        killerName: 'Player',
        victimId: this.id,
        victimName: this.name,
        headshot: headshot,
        worldPosition: { x: this.position.x, y: this.position.y, z: this.position.z },
      };
      this.bus.emit(GAME_EVENTS.KILL, killEvent);
      const sound: SoundEvent = {
        type: 'impact',
        position: { x: this.position.x, y: this.position.y, z: this.position.z },
        radius: 6,
        volume: 0.4,
        sourceId: this.id,
      };
      this.bus.emit(GAME_EVENTS.SOUND, sound);
    }
  }

  /**
   * Called when a sound event is within hearing range.
   */
  onSoundHeard(sound: SoundEvent, time: number): void {
    if (!this.alive || this.state === AIState.Dead || this.state === AIState.Combat) return;
    if (this.perception.hear(sound, this.position, time)) {
      this.enterState(AIState.Investigate);
    }
  }

  /**
   * Called when the squad broadcasts a contact alert.
   */
  onSquadContact(playerPosition: THREE.Vector3): void {
    if (!this.alive || this.state === AIState.Dead) return;
    this.perception.getMemory().lastKnownPosition = playerPosition.clone();
    this.enterState(AIState.Combat);
  }

  /**
   * Called when this enemy directly sees the player. Emits an event so the
   * squad manager can broadcast the radio contact to the whole squad.
   */
  onSeenPlayer(playerPosition: THREE.Vector3, time?: number): void {
    if (!this.alive) return;
    this.perception.getMemory().lastKnownPosition = playerPosition.clone();
    this.perception.getMemory().seesPlayer = true;
    const now = time ?? performance.now() / 1000;
    if (this.state !== AIState.Combat) {
      this.enterState(AIState.Combat);
      // Only broadcast on the transition into combat, throttled
      if (now - this.lastContactEmitTime > this.contactEmitInterval) {
        this.lastContactEmitTime = now;
        this.bus.emit('ai.enemy.seen', {
          enemyId: this.id,
          position: { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z },
        });
      }
    }
  }

  /**
   * Handle being shot at: chance to take cover.
   */
  onShotAt(shotFrom: THREE.Vector3): void {
    if (!this.alive) return;
    if (this.random() < this.classDef.ai.coverChance && this.state === AIState.Combat) {
      // Move perpendicular to the threat
      const dir = new THREE.Vector3().subVectors(this.position, shotFrom).normalize();
      this.coverTarget = this.position.clone().add(
        new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(3)
      );
    }
  }

  /**
   * Called when the squad commander orders a tactical fallback. Keeps the
   * enemy retreating for the given duration (R33.1 'retreat').
   */
  orderRetreat(duration = 2.5): void {
    if (!this.alive || this.state === AIState.Dead) return;
    this.retreatTimer = duration;
    this.enterState(AIState.Retreat);
  }

  /**
   * Called when the squad commander orders a sweep of a location. Pins the
   * last-known position and begins the search behavior (R33.1 'search').
   */
  orderSearch(center: THREE.Vector3, time: number): void {
    if (!this.alive || this.state === AIState.Dead) return;
    this.perception.getMemory().lastKnownPosition = center.clone();
    this.perception.startSearch(center, time);
    this.enterState(AIState.Search);
  }

  /**
   * Main update: pick next action based on state, then move/fire.
   */
  update(deltaTime: number, playerPos: THREE.Vector3, playerVisible: boolean, time: number): void {
    if (!this.alive) return;
    this.stateTimers[this.state] += deltaTime;
    this.fireCooldown = Math.max(0, this.fireCooldown - deltaTime);
    this.healCooldown = Math.max(0, this.healCooldown - deltaTime);
    this.repositionTimer = Math.max(0, this.repositionTimer - deltaTime);

    // Perception: direct sight check
    const sight = this.perception.canSee(this.getEyePosition(), this.getFacing(), playerPos, time);
    if (sight.visible) {
      this.onSeenPlayer(playerPos, time);
    } else if (this.state === AIState.Combat) {
      // Lost sight: start searching the last known position
      const mem = this.perception.getMemory();
      if (mem.lastKnownPosition) {
        this.enterState(AIState.Search);
        this.perception.startSearch(mem.lastKnownPosition, time);
      }
    }

    switch (this.state) {
      case AIState.Patrol:
        this.updatePatrol(deltaTime, playerPos);
        break;
      case AIState.Investigate:
        this.updateInvestigate(deltaTime, playerPos);
        break;
      case AIState.Search:
        this.updateSearch(deltaTime, playerPos, time);
        break;
      case AIState.Combat:
        this.updateCombat(deltaTime, playerPos, time);
        break;
      case AIState.Retreat:
        this.updateRetreat(deltaTime, playerPos);
        break;
      case AIState.Idle:
        if (this.stateTimers[AIState.Idle] > 1.5) this.enterState(AIState.Patrol);
        break;
      case AIState.Dead:
        break;
    }

    // Low HP retreat (Requirement 11.4)
    if (
      this.state === AIState.Combat &&
      this.health < this.healthMax * 0.3 &&
      this.stateTimers[AIState.Combat] > 3
    ) {
      this.enterState(AIState.Retreat);
      this.retreatTimer = 2.5;
    }

    void playerVisible;
  }

  private updatePatrol(deltaTime: number, _playerPos: THREE.Vector3): void {
    if (this.patrolRoute.length === 0) {
      this.enterState(AIState.Idle);
      return;
    }
    const target = this.patrolRoute[this.patrolIndex % this.patrolRoute.length];
    const t = new THREE.Vector3(target.x, this.position.y, target.z);

    // Use A* navigation to the patrol waypoint
    if (!this.navigator.hasPath) {
      this.navigator.setTarget(this.position, t);
    }
    this.navigator.update(this.position, t, deltaTime);
    const steer = this.navigator.steer(this.position);
    if (steer) {
      this.moveAlong(steer, this.classDef.speed * 0.5);
    }
    if (this.position.distanceTo(t) < 1.5) {
      this.patrolIndex++;
      this.navigator.clear();
    }
  }

  private updateInvestigate(_deltaTime: number, _playerPos: THREE.Vector3): void {
    const mem = this.perception.getMemory();
    const target = mem.lastSoundPosition;
    if (!target) {
      this.enterState(AIState.Patrol);
      return;
    }
    this.moveDirect(target, this.classDef.speed * 0.8);
    if (this.position.distanceTo(target) < 1.5) {
      // Arrived at sound origin: search around it (Requirement 9.3)
      this.perception.startSearch(target, performance.now() / 1000);
      this.enterState(AIState.Search);
    }
  }

  private updateSearch(_deltaTime: number, _playerPos: THREE.Vector3, time: number): void {
    const point = this.perception.updateSearch(time, this.classDef.ai.searchDuration);
    if (!point) {
      this.enterState(AIState.Patrol);
      return;
    }
    this.moveDirect(point, this.classDef.speed * 0.7);
  }

  private updateCombat(deltaTime: number, playerPos: THREE.Vector3, time: number): void {
    const def = this.classDef;
    const dist = this.position.distanceTo(playerPos);

    // Engineer: deploy turret at combat start (Requirement 12.4)
    if (def.ai.deploysTurret && !this.turretDeployed) {
      this.deployTimer += deltaTime;
      if (this.deployTimer >= 3) {
        this.turretDeployed = true;
        this.bus.emit(GAME_EVENTS.SQUAD, {
          type: 'deployed',
          squadId: this.squadId ?? -1,
          message: `${this.name} deployed a turret`,
          position: { x: this.position.x, y: this.position.y, z: this.position.z },
        });
      }
    }

    // Medic: heal nearby wounded squad members (Requirement 12.5)
    if (def.ai.heals && this.healCooldown <= 0) {
      this.healCooldown = 1;
      this.bus.emit('ai.medic.heal', { medicId: this.id, position: this.position.clone() });
    }

    // Sniper: reposition after shot (Requirement 12.3)
    if (def.ai.repositionsAfterShot && this.repositionTimer <= 0) {
      this.repositionTimer = 3;
      const dir = new THREE.Vector3().subVectors(this.position, playerPos).normalize();
      const offset = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(4);
      this.coverTarget = this.position.clone().add(offset);
    }

    // Honor cover target if set (moved toward it, then cleared)
    if (this.coverTarget) {
      this.moveDirect(this.coverTarget, def.speed * 0.9);
      if (this.position.distanceTo(this.coverTarget) < 1.5) {
        this.coverTarget = null;
      }
      this.lookAt(playerPos);
      this.maybeFire(playerPos, dist);
      return;
    }

    // Strafe while engaging
    this.strafeTimer += deltaTime;
    if (this.strafeTimer > 1.2) {
      this.strafeTimer = 0;
      this.strafeDir *= -1;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.position);

    // Engage range logic
    if (dist > def.engagementRange) {
      // Close distance (or flank for scouts)
      const approach = toPlayer.clone().normalize();
      this.moveDirect(this.position.clone().add(approach), def.speed);
    } else if (dist < 4 && def.behavior !== 'frontal') {
      // Back away slightly
      const back = toPlayer.clone().normalize();
      this.moveDirect(this.position.clone().add(back), def.speed * 0.7);
    } else {
      // In range: strafe
      const right = toPlayer.clone().normalize();
      const strafe = new THREE.Vector3(-right.z, 0, right.x).multiplyScalar(this.strafeDir);
      this.moveDirect(this.position.clone().add(strafe.multiplyScalar(1.5)), def.speed * 0.6);
    }

    // Face the player and fire
    this.lookAt(playerPos);
    this.maybeFire(playerPos, dist);
    void time;
  }

  private maybeFire(playerPos: THREE.Vector3, dist: number): void {
    if (this.fireCooldown <= 0 && dist < this.classDef.engagementRange * 1.5) {
      const visible = this.perception.getMemory().seesPlayer;
      if (visible) {
        this.fireAtPlayer(playerPos);
      }
    }
  }

  private updateRetreat(deltaTime: number, _playerPos: THREE.Vector3): void {
    this.retreatTimer -= deltaTime;
    // Move away from player to a fallback position (squad handles exact position)
    const away = this.retreatDirection();
    this.moveDirect(this.position.clone().add(away.multiplyScalar(8)), this.classDef.speed * 1.1);
    if (this.retreatTimer <= 0) {
      this.enterState(AIState.Combat);
    }
    void deltaTime;
  }

  private retreatDirection(): THREE.Vector3 {
    return new THREE.Vector3(this.random() - 0.5, 0, this.random() - 0.5).normalize();
  }

  /** Direct steering movement (grounded, block push-out). */
  private moveDirect(target: THREE.Vector3, speed: number): void {
    const dir = new THREE.Vector3().subVectors(target, this.position);
    dir.y = 0;
    const len = dir.length();
    if (len < 0.05) return;
    const step = Math.min(speed * 0.05, len);
    dir.normalize().multiplyScalar(step);
    this.position.add(dir);

    // Keep grounded
    const groundY = this.physics.groundHeightAt(this.position.x, this.position.z);
    this.position.y = groundY + 0.01;

    // Collision: avoid overlapping cover blocks via simple push-out
    this.pushOutOfBlocks();

    this.yaw = Math.atan2(-dir.x, -dir.z);
  }

  /** Move along a unit direction (used by navigation steering). */
  private moveAlong(dir: THREE.Vector3, speed: number): void {
    this.moveDirect(this.position.clone().add(dir.multiplyScalar(2)), speed);
  }

  private pushOutOfBlocks(): void {
    const blocks = this.physics.getBlocks();
    const radius = 0.5;
    for (const block of blocks) {
      const minX = block.x - block.hx;
      const maxX = block.x + block.hx;
      const minZ = block.z - block.hz;
      const maxZ = block.z + block.hz;
      if (
        this.position.x > minX - radius && this.position.x < maxX + radius &&
        this.position.z > minZ - radius && this.position.z < maxZ + radius &&
        this.position.y > block.y - block.hy && this.position.y < block.y + block.hy
      ) {
        const dx = this.position.x - block.x;
        const dz = this.position.z - block.z;
        if (Math.abs(dx) > Math.abs(dz)) {
          this.position.x = dx > 0 ? maxX + radius : minX - radius;
        } else {
          this.position.z = dz > 0 ? maxZ + radius : minZ - radius;
        }
      }
    }
  }

  private lookAt(target: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(target, this.position);
    this.yaw = Math.atan2(-dir.x, -dir.z);
  }

  private fireAtPlayer(playerPos: THREE.Vector3): void {
    const def = this.classDef;
    this.fireCooldown = 1 / def.fireRate;

    // Accuracy roll
    const roll = this.random();
    if (roll < def.accuracy) {
      const dmgEvent: DamageEvent = {
        target: 'player',
        targetId: -1,
        source: 'enemy',
        sourceId: this.id,
        amount: def.damage,
        critical: false,
        headshot: roll > def.accuracy * 0.9,
        worldPosition: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
        sourcePosition: { x: this.position.x, y: this.position.y, z: this.position.z },
      };
      this.bus.emit(GAME_EVENTS.DAMAGE, dmgEvent);
    }

    // Gunshot sound
    const sound: SoundEvent = {
      type: 'gunshot',
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      radius: def.id === 'sniper' ? 70 : 35,
      volume: 1,
      sourceId: this.id,
    };
    this.bus.emit(GAME_EVENTS.SOUND, sound);
  }

  getSnapshot(): EnemySnapshot {
    return {
      id: this.id,
      position: this.position.clone(),
      health: this.health,
      maxHealth: this.healthMax,
      state: this.state,
      classId: this.classDef.id,
    };
  }
}
