/**
 * penetration.test.ts
 *
 * Unit tests for the bullet penetration table (Requirement 14).
 */

import {
  canPenetrate,
  attenuateDamage,
  PENETRATION_TABLE,
} from '../../src/gameplay/weapons/PenetrationTable';
import { SurfaceMaterial } from '../../src/gameplay/core/GameTypes';

describe('PenetrationTable', () => {
  it('allows penetration through wood, glass, dirt, grass', () => {
    expect(canPenetrate(SurfaceMaterial.Wood, 45)).toBe(true);
    expect(canPenetrate(SurfaceMaterial.Glass, 45)).toBe(true);
    expect(canPenetrate(SurfaceMaterial.Dirt, 45)).toBe(true);
    expect(canPenetrate(SurfaceMaterial.Grass, 45)).toBe(true);
  });

  it('blocks penetration through concrete and metal', () => {
    expect(canPenetrate(SurfaceMaterial.Concrete, 95)).toBe(false);
    expect(canPenetrate(SurfaceMaterial.Metal, 95)).toBe(false);
  });

  it('blocks weak bullets from wood', () => {
    // A bullet with penetration power below wood's resistance stops.
    expect(canPenetrate(SurfaceMaterial.Wood, 10)).toBe(false);
    expect(canPenetrate(SurfaceMaterial.Wood, 20)).toBe(true);
  });

  it('attenuates damage per material', () => {
    const wood = attenuateDamage(SurfaceMaterial.Wood, 100);
    expect(wood).toBeCloseTo(70, 5); // 0.7 attenuation
    const glass = attenuateDamage(SurfaceMaterial.Glass, 100);
    expect(glass).toBeCloseTo(85, 5); // 0.85 attenuation
  });

  it('defines all required materials', () => {
    for (const m of Object.values(SurfaceMaterial)) {
      expect(PENETRATION_TABLE[m]).toBeDefined();
    }
  });
});
