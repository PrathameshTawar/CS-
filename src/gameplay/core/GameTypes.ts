/**
 * GameTypes.ts
 *
 * Shared gameplay constants and event payload types used across
 * gameplay, AI, audio, UI, and networking modules.
 *
 * @module Gameplay
 */

/** Central event bus topic names. */
export const GAME_EVENTS = {
  /** Player fired a weapon. Payload: WeaponFireEvent */
  WEAPON_FIRED: 'gameplay.weapon.fired',
  /** A bullet impacted a surface. Payload: ImpactEvent */
  IMPACT: 'gameplay.impact',
  /** Player or enemy was damaged. Payload: DamageEvent */
  DAMAGE: 'gameplay.damage',
  /** An enemy was killed. Payload: KillEvent */
  KILL: 'gameplay.kill',
  /** A sound event that AI can hear. Payload: SoundEvent */
  SOUND: 'gameplay.sound',
  /** Player health/armor changed. Payload: HealthStateEvent */
  HEALTH: 'gameplay.health',
  /** Ammo changed. Payload: AmmoEvent */
  AMMO: 'gameplay.ammo',
  /** Hit marker request. Payload: HitMarkerEvent */
  HIT_MARKER: 'gameplay.hitmarker',
  /** Kill feed entry. Payload: KillFeedEvent */
  KILL_FEED: 'gameplay.killfeed',
  /** Camera shake request. Payload: ShakeEvent */
  CAMERA_SHAKE: 'gameplay.camera.shake',
  /** Ability cooldown changed. Payload: AbilityEvent */
  ABILITY: 'gameplay.ability',
  /** Mission/objective update. Payload: ObjectiveEvent */
  OBJECTIVE: 'gameplay.objective',
  /** Grenade detonated. Payload: GrenadeEvent */
  GRENADE: 'gameplay.grenade',
  /** Squad state changed (contact, flank, retreat...). Payload: SquadEvent */
  SQUAD: 'gameplay.squad',
  /** A pickup (medkit/ammo) was collected. Payload: PickupEvent */
  PICKUP: 'gameplay.pickup',
  /** An explosion detonated. Payload: ExplosionEvent */
  EXPLOSION: 'gameplay.explosion',
} as const;

/** Surface materials that affect audio, particles, and penetration. */
export enum SurfaceMaterial {
  Concrete = 'concrete',
  Wood = 'wood',
  Glass = 'glass',
  Metal = 'metal',
  Dirt = 'dirt',
  Grass = 'grass',
  Water = 'water',
}

/** A sound event that AI enemies can perceive. */
export interface SoundEvent {
  type: 'footstep' | 'gunshot' | 'explosion' | 'impact' | 'grenade' | 'dash' | 'reload';
  position: { x: number; y: number; z: number };
  /** Audible radius in meters (0 = silent to AI). */
  radius: number;
  volume: number; // 0..1
  surface?: SurfaceMaterial;
  sourceId?: number; // entity id that made the sound
}

export interface DamageEvent {
  target: 'player' | 'enemy';
  targetId: number;
  source: 'player' | 'enemy' | 'environment';
  sourceId: number;
  amount: number;
  critical: boolean;
  headshot: boolean;
  /** World position where the damage was applied (for damage numbers). */
  worldPosition?: { x: number; y: number; z: number };
  /** World position of the damage source (for directional damage indicators). */
  sourcePosition?: { x: number; y: number; z: number };
}

export interface KillEvent {
  killerId: number;
  killerName: string;
  victimId: number;
  victimName: string;
  headshot: boolean;
  /** World position of the victim (for kill effects). */
  worldPosition: { x: number; y: number; z: number };
}

export interface WeaponFireEvent {
  weaponId: string;
  sourceId: number;
  position: { x: number; y: number; z: number };
  /** Aim direction (unit vector). */
  direction: { x: number; y: number; z: number };
  suppressed: boolean;
}

export interface ImpactEvent {
  position: { x: number; y: number; z: number };
  /** Surface normal. */
  normal: { x: number; y: number; z: number };
  surface: SurfaceMaterial;
  force: number;
  /** Whether the impact came from a penetrating bullet. */
  penetrated: boolean;
  /**
   * The BlockInstance that was hit, if any.
   * Typed as unknown here to avoid a circular dep between GameTypes and
   * MapGenerator; callers that need the block cast to BlockInstance.
   */
  block?: unknown;
}

export interface HealthStateEvent {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
}

export interface AmmoEvent {
  weaponId: string;
  magazine: number;
  magazineSize: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number; // 0..1
}

export interface HitMarkerEvent {
  kind: 'hit' | 'high' | 'critical';
}

export interface KillFeedEvent {
  killerName: string;
  victimName: string;
  headshot: boolean;
}

export interface ShakeEvent {
  magnitude: number;
  duration: number;
  frequency: number;
}

export interface AbilityEvent {
  id: string;
  cooldown: number; // seconds remaining
  maxCooldown: number;
  ready: boolean;
}

export interface ObjectiveEvent {
  text: string;
  progress?: { current: number; target: number };
}

export interface GrenadeEvent {
  type: 'smoke' | 'flash' | 'shock';
  position: { x: number; y: number; z: number };
}

export interface SquadEvent {
  type:
    | 'contact'
    | 'flank'
    | 'suppress'
    | 'retreat'
    | 'solo'
    | 'deployed'
    // R33.1-R33.2: commander orders issued through the squad channel.
    | 'ambush'
    | 'hold'
    | 'search'
    | 'reinforce';
  squadId: number;
  message: string;
  position?: { x: number; y: number; z: number };
}

export interface PickupEvent {
  kind: 'medkit' | 'ammo';
  position: { x: number; y: number; z: number };
}

export interface ExplosionEvent {
  position: { x: number; y: number; z: number };
  radius: number;
  maxDamage?: number;
}
