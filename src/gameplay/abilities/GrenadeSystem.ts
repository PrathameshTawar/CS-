/**
 * GrenadeSystem.ts
 *
 * Tactical grenades (Requirement 8): smoke, flashbang, and shock grenades.
 * Each detonation emits particles, screen effects, and AI-relevant sound
 * events (smoke blocks AI line-of-sight).
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { GAME_EVENTS, GrenadeEvent, SoundEvent } from '../core/GameTypes';

export type GrenadeType = 'smoke' | 'flash' | 'shock';

export interface GrenadeProjectile {
  type: GrenadeType;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  fuse: number;
  alive: boolean;
}

/** A detonated smoke cloud that persists and blocks AI line-of-sight. */
export interface SmokeCloud {
  position: THREE.Vector3;
  age: number;
  duration: number;
}

export interface GrenadeConfig {
  throwSpeed: number;
  gravity: number;
  smokeFuse: number;
  flashFuse: number;
  shockFuse: number;
  smokeRadius: number;
  smokeDuration: number;
}

const DEFAULT_GRENADE_CONFIG: GrenadeConfig = {
  throwSpeed: 16,
  gravity: 18,
  smokeFuse: 1.6,
  flashFuse: 1.4,
  shockFuse: 1.2,
  smokeRadius: 7,
  smokeDuration: 15,
};

/**
 * Owns in-flight grenade projectiles and their detonation behavior.
 * The actual visual effects are handled by the demo/feedback systems
 * listening to GRENADE events.
 */
export class GrenadeSystem {
  private readonly bus: EventBus;
  private readonly config: GrenadeConfig;
  private readonly projectiles: GrenadeProjectile[] = [];
  private readonly smokeClouds: SmokeCloud[] = [];

  constructor(bus: EventBus, config?: Partial<GrenadeConfig>) {
    this.bus = bus;
    this.config = { ...DEFAULT_GRENADE_CONFIG, ...config };
  }

  getProjectiles(): readonly GrenadeProjectile[] {
    return this.projectiles;
  }

  getSmokeClouds(): readonly SmokeCloud[] {
    return this.smokeClouds;
  }

  /** Throw a grenade from the given origin toward the aim direction. */
  throwGrenade(
    type: GrenadeType,
    origin: THREE.Vector3,
    aim: THREE.Vector3,
    sourceId: number
  ): void {
    const fuse = this.getFuse(type);
    const velocity = aim
      .clone()
      .multiplyScalar(this.config.throwSpeed)
      .add(new THREE.Vector3(0, 3.2, 0)); // slight arc

    this.projectiles.push({
      type,
      position: origin.clone(),
      velocity,
      fuse,
      alive: true,
    });

    // Throwing is audible to nearby enemies
    const sound: SoundEvent = {
      type: 'grenade',
      position: { x: origin.x, y: origin.y, z: origin.z },
      radius: 8,
      volume: 0.4,
      sourceId,
    };
    this.bus.emit(GAME_EVENTS.SOUND, sound);
  }

  private getFuse(type: GrenadeType): number {
    switch (type) {
      case 'smoke': return this.config.smokeFuse;
      case 'flash': return this.config.flashFuse;
      case 'shock': return this.config.shockFuse;
    }
  }

  /**
   * Update in-flight projectiles with simple ballistic physics
   * (bounces are ignored for demo simplicity — impacts at ground level).
   */
  update(deltaTime: number): void {
    for (const g of this.projectiles) {
      if (!g.alive) continue;
      g.fuse -= deltaTime;
      g.velocity.y -= this.config.gravity * deltaTime;
      g.position.addScaledVector(g.velocity, deltaTime);

      // Ground clamp
      if (g.position.y < 0.1) {
        g.position.y = 0.1;
        g.velocity.y *= -0.3; // small bounce
        g.velocity.x *= 0.6;
        g.velocity.z *= 0.6;
      }

      if (g.fuse <= 0) {
        this.detonate(g);
      }
    }

    // Cleanup projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (!this.projectiles[i].alive) {
        this.projectiles.splice(i, 1);
      }
    }

    // Age and prune smoke clouds so they stop blocking LOS after their
    // duration (Requirement 8.1)
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      this.smokeClouds[i].age += deltaTime;
      if (this.smokeClouds[i].age >= this.smokeClouds[i].duration) {
        this.smokeClouds.splice(i, 1);
      }
    }
  }

  private detonate(g: GrenadeProjectile): void {
    g.alive = false;

    const event: GrenadeEvent = {
      type: g.type,
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
    };
    this.bus.emit(GAME_EVENTS.GRENADE, event);

    // Smoke persists as a blocking volume (Requirement 8.1)
    if (g.type === 'smoke') {
      this.smokeClouds.push({
        position: g.position.clone(),
        age: 0,
        duration: this.config.smokeDuration,
      });
    }

    // Explosion sound event for AI hearing
    const radius = g.type === 'smoke' ? this.config.smokeRadius : 30;
    const sound: SoundEvent = {
      type: 'explosion',
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      radius,
      volume: 1,
    };
    this.bus.emit(GAME_EVENTS.SOUND, sound);
  }

  /**
   * Whether the given position is inside an active smoke cloud
   * (used to block AI line-of-sight, Requirement 8.1).
   */
  isInSmoke(x: number, y: number, z: number): boolean {
    for (const cloud of this.smokeClouds) {
      const dist = Math.hypot(cloud.position.x - x, cloud.position.y - y, cloud.position.z - z);
      // Smoke expands over its lifetime
      const radius = this.config.smokeRadius * (0.4 + 0.6 * Math.min(1, cloud.age / 2));
      if (dist < radius) return true;
    }
    return false;
  }
}
