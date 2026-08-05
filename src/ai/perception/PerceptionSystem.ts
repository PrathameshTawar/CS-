/**
 * PerceptionSystem.ts
 *
 * AI perception (Requirements 9, 10):
 *  - Hearing: sound events within per-class radius trigger investigation
 *  - Sight: FOV check + line-of-sight raycast against world blocks
 *  - Last Known Position (LKP) tracking with search sweeps
 *
 * @module AI
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../../physics/core/PhysicsWorld';
import { SoundEvent } from '../../gameplay/core/GameTypes';

export interface PerceptionMemory {
  /** Last known player position. */
  lastKnownPosition: THREE.Vector3 | null;
  /** Position of the most recent heard sound. */
  lastSoundPosition: THREE.Vector3 | null;
  lastSoundTime: number;
  lastSoundType: SoundEvent['type'] | null;
  /** Whether the player was seen recently. */
  seesPlayer: boolean;
  lastSeenTime: number;
  /** Search state. */
  searching: boolean;
  searchCenter: THREE.Vector3 | null;
  searchStartTime: number;
}

export interface SightCheckResult {
  visible: boolean;
  distance: number;
}

/**
 * Optional LOS occlusion check (e.g. smoke grenades block sight, Req 8.1).
 */
export type OcclusionChecker = (x: number, y: number, z: number) => boolean;

export class PerceptionSystem {
  private readonly physics: PhysicsWorld;
  private readonly memory: PerceptionMemory;
  private readonly hearingRadius: number;
  private readonly sightRange: number;
  private readonly fovDegrees: number;
  private occlusionChecker: OcclusionChecker | null = null;

  constructor(
    physics: PhysicsWorld,
    hearingRadius: number,
    sightRange: number,
    fovDegrees = 120
  ) {
    this.physics = physics;
    this.hearingRadius = hearingRadius;
    this.sightRange = sightRange;
    this.fovDegrees = fovDegrees;
    this.memory = {
      lastKnownPosition: null,
      lastSoundPosition: null,
      lastSoundTime: -Infinity,
      lastSoundType: null,
      seesPlayer: false,
      lastSeenTime: -Infinity,
      searching: false,
      searchCenter: null,
      searchStartTime: 0,
    };
  }

  getMemory(): PerceptionMemory {
    return this.memory;
  }

  /**
   * Set an occlusion checker (e.g. smoke) that can block line of sight.
   */
  setOcclusionChecker(checker: OcclusionChecker | null): void {
    this.occlusionChecker = checker;
  }

  /**
   * Register a sound event if within hearing radius and audible
   * (Requirement 9.4: silent/zero-radius sounds are never heard).
   * Returns true if the sound was heard.
   */
  hear(sound: SoundEvent, listenerPos: THREE.Vector3, time: number): boolean {
    if (sound.radius <= 0 || sound.volume <= 0) return false;

    const dx = sound.position.x - listenerPos.x;
    const dy = sound.position.y - listenerPos.y;
    const dz = sound.position.z - listenerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Effective hearing range shrinks with sound volume
    const effectiveRadius = this.hearingRadius * Math.min(1, sound.volume + 0.2);
    if (dist > Math.min(effectiveRadius, sound.radius)) return false;

    this.memory.lastSoundPosition = new THREE.Vector3(sound.position.x, sound.position.y, sound.position.z);
    this.memory.lastSoundTime = time;
    this.memory.lastSoundType = sound.type;
    return true;
  }

  /**
   * Check whether the target position is visible from the observer's eye
   * position with a clear line of sight and within FOV.
   */
  canSee(
    eyePos: THREE.Vector3,
    facingDir: THREE.Vector3,
    targetPos: THREE.Vector3,
    time: number
  ): SightCheckResult {
    const toTarget = new THREE.Vector3().subVectors(targetPos, eyePos);
    const dist = toTarget.length();
    if (dist > this.sightRange) {
      this.memory.seesPlayer = false;
      return { visible: false, distance: dist };
    }

    // FOV check
    const dir = toTarget.clone().normalize();
    const dot = dir.dot(facingDir);
    const fovCos = Math.cos(THREE.MathUtils.degToRad(this.fovDegrees / 2));
    if (dot < fovCos) {
      this.memory.seesPlayer = false;
      return { visible: false, distance: dist };
    }

    // Smoke / volumetric occlusion check (Requirement 8.1)
    if (this.occlusionChecker) {
      const steps = 5;
      let occluded = false;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (
          this.occlusionChecker(
            eyePos.x + dir.x * dist * t,
            eyePos.y + dir.y * dist * t,
            eyePos.z + dir.z * dist * t
          )
        ) {
          occluded = true;
          break;
        }
      }
      if (occluded) {
        this.memory.seesPlayer = false;
        return { visible: false, distance: dist };
      }
    }

    // Line-of-sight raycast (aim at torso height)
    const hit = this.physics.raycast(
      { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      { x: dir.x, y: dir.y, z: dir.z },
      dist - 0.1
    );

    const visible = hit === null;
    this.memory.seesPlayer = visible;
    if (visible) {
      this.memory.lastSeenTime = time;
      this.memory.lastKnownPosition = targetPos.clone();
    }
    return { visible, distance: dist };
  }

  /** Start a search around a position. */
  startSearch(center: THREE.Vector3, time: number): void {
    this.memory.searching = true;
    this.memory.searchCenter = center.clone();
    this.memory.searchStartTime = time;
  }

  /** Update search state, returning the current search point or null when done. */
  updateSearch(time: number, searchDuration: number): THREE.Vector3 | null {
    if (!this.memory.searching || !this.memory.searchCenter) return null;
    if (time - this.memory.searchStartTime > searchDuration) {
      this.memory.searching = false;
      this.memory.searchCenter = null;
      return null;
    }
    // Sweep in a small circle around the search center
    const elapsed = time - this.memory.searchStartTime;
    const radius = 2 + elapsed * 0.5;
    const angle = elapsed * 1.2;
    return new THREE.Vector3(
      this.memory.searchCenter.x + Math.cos(angle) * radius,
      this.memory.searchCenter.y,
      this.memory.searchCenter.z + Math.sin(angle) * radius
    );
  }

  clearSight(): void {
    this.memory.seesPlayer = false;
  }

  reset(): void {
    this.memory.lastKnownPosition = null;
    this.memory.lastSoundPosition = null;
    this.memory.lastSoundTime = -Infinity;
    this.memory.lastSoundType = null;
    this.memory.seesPlayer = false;
    this.memory.lastSeenTime = -Infinity;
    this.memory.searching = false;
    this.memory.searchCenter = null;
    this.memory.searchStartTime = 0;
  }
}
