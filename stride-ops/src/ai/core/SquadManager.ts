/**
 * SquadManager.ts
 *
 * Squad AI (Requirement 11):
 *  - Groups 2–6 enemies with a designated leader
 *  - Leader broadcasts contact alerts within radio range (50m)
 *  - Role assignment: suppress + flank
 *  - Retreat directive when member HP < 30%
 *  - Last survivor becomes aggressive solo assault
 *
 * @module AI
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { EnemyController, AIState } from './EnemyController';
import { GAME_EVENTS, SquadEvent, SoundEvent } from '../../gameplay/core/GameTypes';

/** Event payload emitted when an enemy spots the player. */
interface EnemySeenEvent {
  enemyId: number;
  position: { x: number; y: number; z: number };
}

export interface SquadOptions {
  id: number;
  radioRange?: number;
  tacticUpdateInterval?: number;
}

export class Squad {
  readonly id: number;
  readonly radioRange: number;
  leader: EnemyController | null = null;
  members: EnemyController[] = [];
  private readonly bus: EventBus;
  private tacticTimer = 0;
  private readonly tacticUpdateInterval: number;

  constructor(bus: EventBus, options: SquadOptions) {
    this.bus = bus;
    this.id = options.id;
    this.radioRange = options.radioRange ?? 50;
    this.tacticUpdateInterval = options.tacticUpdateInterval ?? 1.0;
  }

  addMember(enemy: EnemyController): void {
    this.members.push(enemy);
    enemy.squadId = this.id;
    if (!this.leader) {
      this.leader = enemy;
      enemy.role = 'support';
    }
  }

  isAlive(enemy: EnemyController): boolean {
    return enemy.alive;
  }

  get aliveMembers(): EnemyController[] {
    return this.members.filter((m) => m.alive);
  }

  /**
   * Called when any member spots the player: broadcast to all members
   * within radio range.
   */
  broadcastContact(playerPosition: THREE.Vector3): void {
    const event: SquadEvent = {
      type: 'contact',
      squadId: this.id,
      message: 'Contact! Engaging hostiles.',
      position: { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z },
    };
    this.bus.emit(GAME_EVENTS.SQUAD, event);

    for (const member of this.members) {
      if (!member.alive) continue;
      // Radio range check
      const dist = member.position.distanceTo(this.leader?.position ?? playerPosition);
      if (dist <= this.radioRange) {
        member.onSquadContact(playerPosition);
      }
    }
  }

  /**
   * Periodically assign roles: one suppressor, one flanker.
   */
  update(deltaTime: number, playerPos: THREE.Vector3): void {
    this.tacticTimer += deltaTime;
    if (this.tacticTimer < this.tacticUpdateInterval) return;
    this.tacticTimer = 0;

    const alive = this.aliveMembers;
    if (alive.length === 0) return;

    // Last survivor: aggressive solo assault (Requirement 11.6)
    if (alive.length === 1) {
      const survivor = alive[0];
      survivor.role = 'flank';
      const event: SquadEvent = {
        type: 'solo',
        squadId: this.id,
        message: `${survivor.name} is going in alone!`,
      };
      this.bus.emit(GAME_EVENTS.SQUAD, event);
      return;
    }

    // Assign one flanker and one suppressor
    const inCombat = alive.filter((m) => m.state === AIState.Combat);
    if (inCombat.length >= 2) {
      // Scout prefers flank; Heavy prefers suppress
      const flanker = inCombat.find((m) => m.classDef.behavior === 'flanker') ?? inCombat[0];
      const suppressor = inCombat.find((m) => m.classDef.behavior === 'frontal') ?? inCombat[1];

      for (const member of alive) {
        member.role = 'support';
      }
      flanker.role = 'flank';
      suppressor.role = 'suppress';

      // Flanker moves to a flanking position perpendicular to the player
      const toPlayer = new THREE.Vector3().subVectors(playerPos, flanker.position).normalize();
      const flankPos = playerPos.clone().add(
        new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(8)
      );
      flanker.coverTarget = flankPos;

      const event: SquadEvent = {
        type: 'flank',
        squadId: this.id,
        message: `${flanker.name} flanking left! ${suppressor.name} covering.`,
        position: { x: flankPos.x, y: flankPos.y, z: flankPos.z },
      };
      this.bus.emit(GAME_EVENTS.SQUAD, event);
    }

    // Retreat directive for low-HP members (Requirement 11.4)
    for (const member of alive) {
      if (member.health < member.healthMax * 0.3 && member.state !== AIState.Retreat) {
        member.enterState(AIState.Retreat);
        const event: SquadEvent = {
          type: 'retreat',
          squadId: this.id,
          message: `${member.name} falling back!`,
        };
        this.bus.emit(GAME_EVENTS.SQUAD, event);
      }
    }
  }

  /**
   * Medics heal wounded members (Requirement 12.5): restoring 20 HP/s
   * up to 80% of max health within 10m.
   */
  medicHeal(medic: EnemyController, deltaTime: number): void {
    if (!medic.classDef.ai.heals || !medic.alive) return;
    for (const member of this.members) {
      if (!member.alive || member === medic) continue;
      if (member.health >= member.healthMax * 0.8) continue;
      const dist = medic.position.distanceTo(member.position);
      if (dist > 10) continue;
      member.health = Math.min(member.healthMax * 0.8, member.health + 20 * deltaTime);
    }
  }
}

export class SquadManager {
  private readonly bus: EventBus;
  private readonly squads: Squad[] = [];
  private nextSquadId = 1;
  private readonly radioRange: number;
  private readonly disposeListener: () => void;

  constructor(bus: EventBus, radioRange = 50) {
    this.bus = bus;
    this.radioRange = radioRange;

    // When any member spots the player, the whole squad is alerted
    // via radio contact (Requirement 11.2).
    this.disposeListener = bus.on<EnemySeenEvent>('ai.enemy.seen', (e) => {
      const squad = this.getSquadByMember(e.enemyId);
      if (squad) {
        squad.broadcastContact(new THREE.Vector3(e.position.x, e.position.y, e.position.z));
      }
    });
  }

  private getSquadByMember(enemyId: number): Squad | null {
    return this.squads.find((s) => s.members.some((m) => m.id === enemyId)) ?? null;
  }

  /** Create a squad and add the given enemies. */
  createSquad(enemies: EnemyController[]): Squad {
    const squad = new Squad(this.bus, { id: this.nextSquadId++, radioRange: this.radioRange });
    for (const enemy of enemies) {
      squad.addMember(enemy);
    }
    this.squads.push(squad);
    return squad;
  }

  getSquads(): Squad[] {
    return this.squads;
  }

  /** Find the squad containing the given enemy. */
  getSquadOf(enemy: EnemyController): Squad | null {
    return this.squads.find((s) => s.members.includes(enemy)) ?? null;
  }

  /**
   * Route sound events to all squads (enemies hear sounds).
   */
  onSound(sound: SoundEvent, time: number): void {
    for (const squad of this.squads) {
      for (const member of squad.members) {
        member.onSoundHeard(sound, time);
      }
    }
  }

  /**
   * Update all squads: role assignment and medic healing.
   */
  update(deltaTime: number, playerPos: THREE.Vector3): void {
    for (const squad of this.squads) {
      squad.update(deltaTime, playerPos);

      // Medic healing pass
      for (const member of squad.members) {
        if (member.alive && member.classDef.ai.heals) {
          squad.medicHeal(member, deltaTime);
        }
      }

      // Clean up empty squads
      if (squad.aliveMembers.length === 0) {
        this.squads.splice(this.squads.indexOf(squad), 1);
      }
    }
  }

  getEnemyCount(): number {
    return this.squads.reduce((acc, s) => acc + s.aliveMembers.length, 0);
  }

  clear(): void {
    this.squads.length = 0;
    this.nextSquadId = 1;
  }

  dispose(): void {
    this.disposeListener();
    this.clear();
  }
}
