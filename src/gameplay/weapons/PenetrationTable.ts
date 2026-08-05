/**
 * PenetrationTable.ts
 *
 * Material-specific bullet penetration properties (Requirement 14).
 *
 * @module Gameplay
 */

import { SurfaceMaterial } from '../core/GameTypes';

export interface PenetrationEntry {
  /** Can bullets pass through at all? */
  penetrable: boolean;
  /** Kinetic-energy resistance threshold (bullet penetrationPower vs this). */
  resistance: number;
  /** Damage attenuation per penetration (multiplier on remaining damage). */
  damageAttenuation: number;
  /** Max number of surfaces a bullet can pass through. */
  maxDepth: number;
  /** Decal/sound surface descriptor. */
  kind: 'soft' | 'hard' | 'brittle' | 'fragile';
}

export const PENETRATION_TABLE: Record<SurfaceMaterial, PenetrationEntry> = {
  [SurfaceMaterial.Wood]: { penetrable: true, resistance: 20, damageAttenuation: 0.7, maxDepth: 3, kind: 'soft' },
  [SurfaceMaterial.Glass]: { penetrable: true, resistance: 8, damageAttenuation: 0.85, maxDepth: 1, kind: 'fragile' },
  [SurfaceMaterial.Dirt]: { penetrable: true, resistance: 12, damageAttenuation: 0.75, maxDepth: 2, kind: 'soft' },
  [SurfaceMaterial.Grass]: { penetrable: true, resistance: 5, damageAttenuation: 0.9, maxDepth: 1, kind: 'soft' },
  [SurfaceMaterial.Concrete]: { penetrable: false, resistance: 90, damageAttenuation: 0, maxDepth: 0, kind: 'hard' },
  [SurfaceMaterial.Metal]: { penetrable: false, resistance: 70, damageAttenuation: 0, maxDepth: 0, kind: 'hard' },
  [SurfaceMaterial.Water]: { penetrable: true, resistance: 2, damageAttenuation: 0.5, maxDepth: 1, kind: 'soft' },
};

/**
 * Evaluate whether a projectile with the given penetration power
 * passes through a surface of the given material.
 */
export function canPenetrate(material: SurfaceMaterial, penetrationPower: number): boolean {
  const entry = PENETRATION_TABLE[material];
  if (!entry.penetrable) return false;
  return penetrationPower >= entry.resistance;
}

/**
 * Apply the damage attenuation of a penetrated material.
 */
export function attenuateDamage(material: SurfaceMaterial, damage: number): number {
  return damage * PENETRATION_TABLE[material].damageAttenuation;
}

export function getPenetrationEntry(material: SurfaceMaterial): PenetrationEntry {
  return PENETRATION_TABLE[material];
}
