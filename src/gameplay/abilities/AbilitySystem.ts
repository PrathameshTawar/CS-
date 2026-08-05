/**
 * AbilitySystem.ts
 *
 * Player abilities (Requirement 8.4): dash with motion-blur streak,
 * ghost trail, and wind particles. Manages cooldowns for the HUD.
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { GAME_EVENTS, AbilityEvent, SoundEvent } from '../core/GameTypes';
import { PlayerController } from '../player/PlayerController';

export interface AbilityDef {
  id: string;
  name: string;
  cooldown: number;
}

export interface GhostTrailSegment {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  life: number;
  maxLife: number;
}

const DEFAULT_ABILITIES: AbilityDef[] = [
  { id: 'dash', name: 'Dash', cooldown: 5 },
  { id: 'smoke', name: 'Smoke Grenade', cooldown: 20 },
  { id: 'flash', name: 'Flashbang', cooldown: 25 },
  { id: 'shock', name: 'Shock Grenade', cooldown: 30 },
];

export class AbilitySystem {
  private readonly bus: EventBus;
  private readonly player: PlayerController;
  private readonly abilities: Map<string, { def: AbilityDef; remaining: number }> = new Map();
  private readonly ghostTrail: GhostTrailSegment[] = [];
  private dashActive = false;
  private dashTimer = 0;

  constructor(bus: EventBus, player: PlayerController, abilities?: AbilityDef[]) {
    this.bus = bus;
    this.player = player;
    const list = abilities ?? DEFAULT_ABILITIES;
    for (const def of list) {
      this.abilities.set(def.id, { def, remaining: 0 });
    }
  }

  getAbilities(): AbilityDef[] {
    return Array.from(this.abilities.values()).map((a) => a.def);
  }

  getCooldown(id: string): number {
    return this.abilities.get(id)?.remaining ?? 0;
  }

  isReady(id: string): boolean {
    const a = this.abilities.get(id);
    return !!a && a.remaining <= 0;
  }

  /**
   * Trigger the dash ability if ready. Applies a forward velocity burst
   * and spawns a ghost trail.
   */
  triggerDash(forward: THREE.Vector3): boolean {
    if (!this.isReady('dash')) return false;
    const a = this.abilities.get('dash')!;
    a.remaining = a.def.cooldown;

    this.dashActive = true;
    this.dashTimer = 0;

    const vel = this.player.state.velocity;
    vel.x = forward.x * 18;
    vel.z = forward.z * 18;
    vel.y = 0;

    // Sound event for AI
    const pos = this.player.getPosition();
    const sound: SoundEvent = {
      type: 'dash',
      position: { x: pos.x, y: pos.y, z: pos.z },
      radius: 14,
      volume: 0.6,
    };
    this.bus.emit(GAME_EVENTS.SOUND, sound);

    this.emitCooldown('dash', a.def.cooldown);
    return true;
  }

  /** Consume a grenade ability (returns true if available). */
  consumeGrenade(id: 'smoke' | 'flash' | 'shock'): boolean {
    if (!this.isReady(id)) return false;
    const a = this.abilities.get(id)!;
    a.remaining = a.def.cooldown;
    this.emitCooldown(id, a.def.cooldown);
    return true;
  }

  private emitCooldown(id: string, maxCooldown: number): void {
    const event: AbilityEvent = {
      id,
      cooldown: maxCooldown,
      maxCooldown,
      ready: false,
    };
    this.bus.emit(GAME_EVENTS.ABILITY, event);
  }

  /**
   * Per-frame update: dash behavior, ghost trail decay, cooldown ticks.
   */
  update(deltaTime: number): void {
    // Cooldowns
    for (const [, a] of this.abilities) {
      if (a.remaining > 0) {
        a.remaining = Math.max(0, a.remaining - deltaTime);
        if (a.remaining === 0) {
          const event: AbilityEvent = {
            id: a.def.id,
            cooldown: 0,
            maxCooldown: a.def.cooldown,
            ready: true,
          };
          this.bus.emit(GAME_EVENTS.ABILITY, event);
        }
      }
    }

    // Dash active window
    if (this.dashActive) {
      this.dashTimer += deltaTime;
      // Spawn ghost trail segments
      const pos = this.player.getPosition();
      this.ghostTrail.push({
        position: pos.clone(),
        rotation: new THREE.Euler(
          this.player.state.pitch,
          this.player.state.yaw,
          0
        ),
        life: 0,
        maxLife: 0.4,
      });
      if (this.dashTimer > 0.22) {
        this.dashActive = false;
      }
    }

    // Decay ghost trail
    for (let i = this.ghostTrail.length - 1; i >= 0; i--) {
      this.ghostTrail[i].life += deltaTime;
      if (this.ghostTrail[i].life >= this.ghostTrail[i].maxLife) {
        this.ghostTrail.splice(i, 1);
      }
    }
  }

  getGhostTrail(): readonly GhostTrailSegment[] {
    return this.ghostTrail;
  }

  isDashing(): boolean {
    return this.dashActive;
  }
}
