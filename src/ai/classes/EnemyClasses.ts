/**
 * EnemyClasses.ts
 *
 * Enemy class definitions (Requirement 12):
 *  - Scout: fast, low HP, flanks
 *  - Heavy: slow, high HP, frontal suppression
 *  - Sniper: long range, repositions after each shot
 *  - Engineer: deploys a stationary turret
 *  - Medic: heals squad members
 *
 * @module AI
 */

export type EnemyClassId = 'scout' | 'heavy' | 'sniper' | 'engineer' | 'medic';

export interface EnemyClassDef {
  id: EnemyClassId;
  name: string;
  /** Base movement speed (m/s). */
  speed: number;
  /** Movement speed multiplier vs base. */
  speedMultiplier: number;
  health: number;
  /** Hearing radius in meters (Requirement 9.5). */
  hearingRadius: number;
  /** Effective engagement range (m). */
  engagementRange: number;
  /** Damage per hit on the player. */
  damage: number;
  /** Shots per second. */
  fireRate: number;
  /** Hit chance at engagement range (0..1). */
  accuracy: number;
  /** Behavior archetype. */
  behavior: 'flanker' | 'frontal' | 'long_range' | 'engineer' | 'medic';
  /** Body color. */
  color: number;
  /** Scale of the enemy mesh. */
  scale: number;
  /** Per-class AI tuning. */
  ai: {
    /** Chance to take cover when shot at. */
    coverChance: number;
    /** Time to search last-known position before giving up (s). */
    searchDuration: number;
    /** Whether this class can deploy turrets. */
    deploysTurret: boolean;
    /** Whether this class heals squad members. */
    heals: boolean;
    /** Whether this class repositions after firing. */
    repositionsAfterShot: boolean;
  };
}

export const ENEMY_CLASSES: Record<EnemyClassId, EnemyClassDef> = {
  scout: {
    id: 'scout',
    name: 'Scout',
    speed: 4.5,
    speedMultiplier: 1.5,
    health: 60,
    hearingRadius: 15,
    engagementRange: 20,
    damage: 12,
    fireRate: 2.5,
    accuracy: 0.45,
    behavior: 'flanker',
    color: 0x66cc66,
    scale: 0.95,
    ai: {
      coverChance: 0.3,
      searchDuration: 15,
      deploysTurret: false,
      heals: false,
      repositionsAfterShot: true,
    },
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy',
    speed: 2.2,
    speedMultiplier: 0.6,
    health: 300,
    hearingRadius: 8,
    engagementRange: 25,
    damage: 22,
    fireRate: 1.2,
    accuracy: 0.3,
    behavior: 'frontal',
    color: 0xcc5555,
    scale: 1.3,
    ai: {
      coverChance: 0.1,
      searchDuration: 20,
      deploysTurret: false,
      heals: false,
      repositionsAfterShot: false,
    },
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    speed: 3.2,
    speedMultiplier: 0.9,
    health: 80,
    hearingRadius: 25,
    engagementRange: 60,
    damage: 55,
    fireRate: 0.4,
    accuracy: 0.8,
    behavior: 'long_range',
    color: 0x5555cc,
    scale: 1.0,
    ai: {
      coverChance: 0.5,
      searchDuration: 20,
      deploysTurret: false,
      heals: false,
      repositionsAfterShot: true,
    },
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    speed: 3.5,
    speedMultiplier: 1.0,
    health: 100,
    hearingRadius: 10,
    engagementRange: 22,
    damage: 14,
    fireRate: 2.0,
    accuracy: 0.4,
    behavior: 'engineer',
    color: 0xddaa44,
    scale: 1.0,
    ai: {
      coverChance: 0.35,
      searchDuration: 15,
      deploysTurret: true,
      heals: false,
      repositionsAfterShot: false,
    },
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    speed: 3.8,
    speedMultiplier: 1.1,
    health: 90,
    hearingRadius: 10,
    engagementRange: 18,
    damage: 10,
    fireRate: 1.8,
    accuracy: 0.35,
    behavior: 'medic',
    color: 0x44ccaa,
    scale: 1.0,
    ai: {
      coverChance: 0.3,
      searchDuration: 15,
      deploysTurret: false,
      heals: true,
      repositionsAfterShot: false,
    },
  },
};
