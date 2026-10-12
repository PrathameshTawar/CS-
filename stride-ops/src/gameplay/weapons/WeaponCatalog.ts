/**
 * WeaponCatalog.ts
 *
 * Weapon definitions with per-weapon recoil patterns, spread/bloom,
 * ADS behavior, reload/inspect durations, and supported attachment slots.
 *
 * @module Gameplay
 */

import { SurfaceMaterial } from '../core/GameTypes';

export enum WeaponCategory {
  Rifle = 'rifle',
  SMG = 'smg',
  Shotgun = 'shotgun',
  Sniper = 'sniper',
  Pistol = 'pistol',
}

export interface RecoilCurve {
  /** Vertical kick samples (degrees) applied per shot in a burst. */
  vertical: number[];
  /** Horizontal kick samples (degrees, +/-) applied per shot. */
  horizontal: number[];
}

export interface AttachmentSlots {
  optic: boolean;
  muzzle: boolean;
  underbarrel: boolean;
  magazine: boolean;
  stock: boolean;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  category: WeaponCategory;
  /** Damage per bullet at point blank. */
  baseDamage: number;
  /** Damage falloff: [minRange, maxRange, minMultiplier]. */
  falloff: [number, number, number];
  /** Rounds per minute. */
  fireRate: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadTime: number;
  inspectTime: number;
  recoil: RecoilCurve;
  /** Base spread in radians (hip fire). */
  baseSpread: number;
  /** Spread increase per shot in rapid succession. */
  bloomPerShot: number;
  bloomMax: number;
  bloomCooldown: number; // seconds to reset bloom
  /** ADS stats. */
  adsZoom: number;
  adsSpreadMultiplier: number;
  adsFov: number;
  /** Weapon sway (ADS). */
  swayAmount: number;
  swayFrequency: number;
  /** Bullet behavior. */
  bulletSpeed: number; // for tracers
  penetrationPower: number;
  /** Sound radius in meters (0 = silent). */
  soundRadius: number;
  /** Tracer color. */
  tracerColor: number;
  /** Muzzle flash size. */
  flashSize: number;
  /** Automatic or semi-auto. */
  automatic: boolean;
  /** Pellet count (shotguns). */
  pellets: number;
  /** Stability — higher = less camera shake on fire. */
  stability: number;
  attachments: AttachmentSlots;
  /** Material-specific damage multipliers (e.g. weak vs glass). */
  materialMultipliers?: Partial<Record<SurfaceMaterial, number>>;
}

export const WEAPON_CATALOG: Record<string, WeaponDefinition> = {
  assault_rifle: {
    id: 'assault_rifle',
    name: 'M4 Assault Rifle',
    category: WeaponCategory.Rifle,
    baseDamage: 28,
    falloff: [18, 60, 0.55],
    fireRate: 750,
    magazineSize: 30,
    reserveAmmo: 120,
    reloadTime: 2.1,
    inspectTime: 1.4,
    recoil: {
      vertical: [1.2, 1.5, 1.9, 2.1, 2.4, 2.6],
      horizontal: [0.3, -0.4, 0.5, -0.3, 0.4, 0.2],
    },
    baseSpread: 0.02,
    bloomPerShot: 0.004,
    bloomMax: 0.06,
    bloomCooldown: 0.35,
    adsZoom: 1.5,
    adsSpreadMultiplier: 0.35,
    adsFov: 55,
    swayAmount: 0.0012,
    swayFrequency: 0.9,
    bulletSpeed: 900,
    penetrationPower: 45,
    soundRadius: 40,
    tracerColor: 0xffd27a,
    flashSize: 1.0,
    automatic: true,
    pellets: 1,
    stability: 0.7,
    attachments: { optic: true, muzzle: true, underbarrel: true, magazine: true, stock: true },
  },
  smg: {
    id: 'smg',
    name: 'MP5 SMG',
    category: WeaponCategory.SMG,
    baseDamage: 20,
    falloff: [12, 40, 0.6],
    fireRate: 950,
    magazineSize: 30,
    reserveAmmo: 150,
    reloadTime: 1.8,
    inspectTime: 1.2,
    recoil: {
      vertical: [0.8, 1.0, 1.2, 1.3],
      horizontal: [0.2, -0.3, 0.2, -0.2],
    },
    baseSpread: 0.028,
    bloomPerShot: 0.006,
    bloomMax: 0.07,
    bloomCooldown: 0.3,
    adsZoom: 1.3,
    adsSpreadMultiplier: 0.4,
    adsFov: 62,
    swayAmount: 0.0014,
    swayFrequency: 1.1,
    bulletSpeed: 750,
    penetrationPower: 28,
    soundRadius: 32,
    tracerColor: 0xffc864,
    flashSize: 0.8,
    automatic: true,
    pellets: 1,
    stability: 0.8,
    attachments: { optic: true, muzzle: true, underbarrel: true, magazine: true, stock: false },
  },
  shotgun: {
    id: 'shotgun',
    name: 'Pump Shotgun',
    category: WeaponCategory.Shotgun,
    baseDamage: 12,
    falloff: [6, 20, 0.35],
    fireRate: 75,
    magazineSize: 6,
    reserveAmmo: 36,
    reloadTime: 2.6,
    inspectTime: 1.5,
    recoil: {
      vertical: [4.5],
      horizontal: [0.8],
    },
    baseSpread: 0.09,
    bloomPerShot: 0.02,
    bloomMax: 0.12,
    bloomCooldown: 0.5,
    adsZoom: 1.2,
    adsSpreadMultiplier: 0.55,
    adsFov: 66,
    swayAmount: 0.0016,
    swayFrequency: 0.8,
    bulletSpeed: 600,
    penetrationPower: 20,
    soundRadius: 50,
    tracerColor: 0xffaa44,
    flashSize: 1.6,
    automatic: false,
    pellets: 8,
    stability: 0.5,
    attachments: { optic: false, muzzle: true, underbarrel: false, magazine: false, stock: true },
  },
  sniper: {
    id: 'sniper',
    name: 'AWP Sniper',
    category: WeaponCategory.Sniper,
    baseDamage: 120,
    falloff: [40, 200, 0.85],
    fireRate: 40,
    magazineSize: 5,
    reserveAmmo: 20,
    reloadTime: 3.2,
    inspectTime: 1.8,
    recoil: {
      vertical: [6.0],
      horizontal: [1.0],
    },
    baseSpread: 0.001,
    bloomPerShot: 0.001,
    bloomMax: 0.01,
    bloomCooldown: 0.6,
    adsZoom: 5.0,
    adsSpreadMultiplier: 0.2,
    adsFov: 20,
    swayAmount: 0.0022,
    swayFrequency: 0.5,
    bulletSpeed: 1500,
    penetrationPower: 95,
    soundRadius: 80,
    tracerColor: 0x8ad4ff,
    flashSize: 1.8,
    automatic: false,
    pellets: 1,
    stability: 0.4,
    attachments: { optic: true, muzzle: true, underbarrel: false, magazine: false, stock: true },
  },
  pistol: {
    id: 'pistol',
    name: 'M9 Pistol',
    category: WeaponCategory.Pistol,
    baseDamage: 34,
    falloff: [10, 35, 0.6],
    fireRate: 300,
    magazineSize: 12,
    reserveAmmo: 60,
    reloadTime: 1.4,
    inspectTime: 1.0,
    recoil: {
      vertical: [1.8, 2.0],
      horizontal: [0.3, -0.3],
    },
    baseSpread: 0.014,
    bloomPerShot: 0.01,
    bloomMax: 0.05,
    bloomCooldown: 0.4,
    adsZoom: 1.25,
    adsSpreadMultiplier: 0.4,
    adsFov: 62,
    swayAmount: 0.001,
    swayFrequency: 1.0,
    bulletSpeed: 550,
    penetrationPower: 30,
    soundRadius: 28,
    tracerColor: 0xffe08a,
    flashSize: 0.6,
    automatic: false,
    pellets: 1,
    stability: 0.85,
    attachments: { optic: false, muzzle: true, underbarrel: false, magazine: false, stock: false },
  },
  skuller: {
    id: 'skuller',
    name: 'Skuller Headhunter 💀',
    category: WeaponCategory.Pistol,
    baseDamage: 85, // One-tap headshot guaranteed (85 * 4 = 340 headshot dmg)
    falloff: [25, 120, 0.75],
    fireRate: 150,
    magazineSize: 7,
    reserveAmmo: 35,
    reloadTime: 2.0,
    inspectTime: 1.5,
    recoil: {
      vertical: [4.0, 4.5],
      horizontal: [0.5, -0.5],
    },
    baseSpread: 0.002, // laser accurate for headshots
    bloomPerShot: 0.02,
    bloomMax: 0.08,
    bloomCooldown: 0.35,
    adsZoom: 1.4,
    adsSpreadMultiplier: 0.2,
    adsFov: 58,
    swayAmount: 0.0008,
    swayFrequency: 0.8,
    bulletSpeed: 1100,
    penetrationPower: 65,
    soundRadius: 60,
    tracerColor: 0xff2244,
    flashSize: 1.4,
    automatic: false,
    pellets: 1,
    stability: 0.75,
    attachments: { optic: true, muzzle: true, underbarrel: false, magazine: false, stock: false },
  },
};
