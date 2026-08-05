/**
 * WeaponSystem.ts
 *
 * Per-weapon gunplay (Requirement 13): recoil patterns, spread/bloom,
 * ADS sway, reload and inspect timers, attachment stat application,
 * and bullet firing with penetration evaluation.
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import {
  WeaponDefinition,
  WEAPON_CATALOG,
} from './WeaponCatalog';
import { AttachmentLoadout } from './Attachments';
import { canPenetrate, attenuateDamage } from './PenetrationTable';
import { SurfaceMaterial, GAME_EVENTS, SoundEvent, WeaponFireEvent } from '../core/GameTypes';
import { PhysicsWorld, RayHit } from '../../physics/core/PhysicsWorld';
import { SeededRandom } from '../core/Random';

export interface WeaponState {
  weaponId: string;
  magazine: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  inspecting: boolean;
  inspectProgress: number;
  bloom: number;
  lastShotTime: number;
  burstIndex: number;
}

export interface ShotResult {
  hit: RayHit | null;
  damage: number;
  penetrated: boolean;
  surface: SurfaceMaterial | null;
}

export interface WeaponSystemConfig {
  /** Entity id of the shooter (player or enemy). */
  sourceId: number;
  /** Suppressed? (modifies sound emission) */
  suppressed: boolean;
}

/**
 * Handles firing, recoil, spread, reload and inspect for a single weapon.
 */
export class WeaponSystem {
  private readonly bus: EventBus;
  private readonly physics: PhysicsWorld;
  private readonly rng = new SeededRandom(Date.now() & 0xffffffff);
  private definition: WeaponDefinition;
  private readonly loadout = new AttachmentLoadout();
  private readonly state: WeaponState;
  private readonly config: WeaponSystemConfig;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(
    bus: EventBus,
    physics: PhysicsWorld,
    camera: THREE.PerspectiveCamera,
    weaponId: string,
    config: WeaponSystemConfig
  ) {
    this.bus = bus;
    this.physics = physics;
    this.camera = camera;
    this.config = config;
    this.definition = { ...WEAPON_CATALOG[weaponId] };

    const magSize = this.getMagazineSize();
    this.state = {
      weaponId,
      magazine: magSize,
      reserve: this.definition.reserveAmmo,
      reloading: false,
      reloadProgress: 0,
      inspecting: false,
      inspectProgress: 0,
      bloom: 0,
      lastShotTime: 0,
      burstIndex: 0,
    };
  }

  getState(): WeaponState {
    return this.state;
  }

  getDefinition(): WeaponDefinition {
    return this.definition;
  }

  getLoadout(): AttachmentLoadout {
    return this.loadout;
  }

  private getMods() {
    return this.loadout.getModifiers();
  }

  getMagazineSize(): number {
    const mods = this.getMods();
    return Math.round(this.definition.magazineSize * (1 + mods.magazineBonus));
  }

  getZoom(): number {
    return this.definition.adsZoom * this.getMods().zoom;
  }

  isSuppressed(): boolean {
    return this.config.suppressed;
  }

  /**
   * Set suppressed status (e.g. suppressor equipped).
   */
  setSuppressed(suppressed: boolean): void {
    this.config.suppressed = suppressed;
  }

  /**
   * Attempt to fire. Returns a ShotResult describing the trajectory outcome.
   * Only fires if off cooldown, has ammo, and not reloading/inspecting.
   */
  fire(
    origin: THREE.Vector3,
    aimDir: THREE.Vector3,
    ads: boolean,
    now: number,
    deltaTime: number
  ): ShotResult | null {
    const def = this.definition;
    const cooldown = 60 / def.fireRate;
    if (now - this.state.lastShotTime < cooldown) return null;
    if (this.state.reloading || this.state.inspecting) return null;
    if (this.state.magazine <= 0) {
      this.startReload();
      return null;
    }

    this.state.lastShotTime = now;
    this.state.magazine--;
    this.state.bloom = Math.min(this.definition.bloomMax, this.state.bloom + this.definition.bloomPerShot);

    const mods = this.getMods();
    const spread = this.getCurrentSpread(ads) * mods.spreadMultiplier;

    // Pellet loop (shotguns fire multiple pellets)
    let bestDamage = 0;
    let bestHit: RayHit | null = null;
    let bestPenetrated = false;
    let bestSurface: SurfaceMaterial | null = null;

    const pellets = def.pellets;
    for (let i = 0; i < pellets; i++) {
      const dir = this.spreadDirection(aimDir, spread);
      const result = this.traceBullet(origin, dir, now);
      if (result.damage > bestDamage) {
        bestDamage = result.damage;
        bestHit = result.hit;
        bestPenetrated = result.penetrated;
        bestSurface = result.surface;
      }
    }

    // Emit weapon fired event (for feedback + AI hearing)
    const soundRadius = def.soundRadius * mods.soundRadiusMultiplier;
    const fireEvent: WeaponFireEvent = {
      weaponId: def.id,
      sourceId: this.config.sourceId,
      position: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: aimDir.x, y: aimDir.y, z: aimDir.z },
      suppressed: this.config.suppressed,
    };
    this.bus.emit(GAME_EVENTS.WEAPON_FIRED, fireEvent);

    if (soundRadius > 0) {
      const sound: SoundEvent = {
        type: 'gunshot',
        position: { x: origin.x, y: origin.y, z: origin.z },
        radius: soundRadius,
        volume: this.config.suppressed ? 0.3 : 1,
        sourceId: this.config.sourceId,
      };
      this.bus.emit(GAME_EVENTS.SOUND, sound);
    }

    // Apply recoil to camera
    this.applyRecoil(ads, deltaTime, mods.recoilMultiplier);

    // Reserve reload when magazine empty
    if (this.state.magazine === 0 && this.state.reserve > 0) {
      this.startReload();
    }

    return { hit: bestHit, damage: bestDamage, penetrated: bestPenetrated, surface: bestSurface };
  }

  /**
   * Trace a single bullet with penetration evaluation.
   */
  private traceBullet(origin: THREE.Vector3, dir: THREE.Vector3, now: number): {
    hit: RayHit | null;
    damage: number;
    penetrated: boolean;
    surface: SurfaceMaterial | null;
  } {
    const def = this.definition;
    let damage = def.baseDamage;
    let remainingDepth = 4;
    const currentOrigin = origin.clone();
    const currentDir = dir.clone();
    let lastHit: RayHit | null = null;
    let penetrated = false;
    let hitSurface: SurfaceMaterial | null = null;

    for (let pass = 0; pass < 4; pass++) {
      const hit = this.physics.raycast(
        { x: currentOrigin.x, y: currentOrigin.y, z: currentOrigin.z },
        { x: currentDir.x, y: currentDir.y, z: currentDir.z },
        200
      );
      if (!hit) break;
      lastHit = hit;
      hitSurface = hit.surface;

      // Damage falloff by distance
      const [minRange, maxRange, minMult] = def.falloff;
      const t = THREE.MathUtils.clamp((hit.distance - minRange) / Math.max(1, maxRange - minRange), 0, 1);
      const falloffMult = THREE.MathUtils.lerp(1, minMult, t);
      const matMult = def.materialMultipliers?.[hit.surface] ?? 1;

      // Penetration check
      if (canPenetrate(hit.surface, def.penetrationPower)) {
        penetrated = true;
        damage = attenuateDamage(hit.surface, damage) * falloffMult * matMult;
        remainingDepth--;
        if (remainingDepth <= 0) break;

        // Continue through: nudge origin past the surface along the normal
        currentOrigin.set(
          hit.point.x + hit.normal.x * 0.05,
          hit.point.y + hit.normal.y * 0.05,
          hit.point.z + hit.normal.z * 0.05
        );
        continue;
      }

      // Stopped: apply falloff only
      damage = damage * falloffMult * matMult;
      break;
    }

    void now;
    return { hit: lastHit, damage, penetrated, surface: hitSurface };
  }

  /**
   * Current spread including bloom decay.
   */
  private getCurrentSpread(ads: boolean): number {
    const def = this.definition;
    const base = ads ? def.baseSpread * def.adsSpreadMultiplier : def.baseSpread;
    return base + this.state.bloom;
  }

  private spreadDirection(aim: THREE.Vector3, spread: number): THREE.Vector3 {
    const angle = this.rng.angle();
    const radius = Math.sqrt(this.rng.next()) * spread;
    // Build an orthonormal basis around aim
    const up = Math.abs(aim.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(aim, up).normalize();
    const upDir = new THREE.Vector3().crossVectors(right, aim).normalize();

    const dir = aim
      .clone()
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(upDir, Math.sin(angle) * radius)
      .normalize();
    return dir;
  }

  private applyRecoil(ads: boolean, deltaTime: number, recoilMultiplier: number): void {
    const def = this.definition;
    const idx = this.state.burstIndex % def.recoil.vertical.length;
    this.state.burstIndex++;

    const kick = (ads ? 0.55 : 1) * recoilMultiplier;
    const vKick = (def.recoil.vertical[idx] ?? 1) * kick;
    const hKick = (def.recoil.horizontal[idx] ?? 0) * kick;

    // Apply to camera rotation with decay for smooth recovery
    this.camera.rotation.x -= THREE.MathUtils.degToRad(vKick);
    this.camera.rotation.y += THREE.MathUtils.degToRad(hKick);

    // Clamp pitch
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01
    );

    void deltaTime;
  }

  /**
   * Per-frame update for bloom decay, reload progress, inspect progress,
   * and ADS sway.
   */
  update(deltaTime: number, moving: boolean): void {
    const def = this.definition;
    const now = performance.now() / 1000;

    // Bloom decay
    if (now - this.state.lastShotTime > def.bloomCooldown) {
      this.state.bloom = Math.max(0, this.state.bloom - deltaTime * 0.05);
    }

    // Reload
    if (this.state.reloading) {
      const reloadTime = def.reloadTime * this.getMods().reloadMultiplier;
      this.state.reloadProgress = Math.min(1, this.state.reloadProgress + deltaTime / reloadTime);
      if (this.state.reloadProgress >= 1) {
        this.state.reloading = false;
        this.state.reloadProgress = 0;
        const add = Math.min(this.getMagazineSize() - this.state.magazine, this.state.reserve);
        this.state.magazine += add;
        this.state.reserve -= add;
      }
    }

    // Inspect
    if (this.state.inspecting) {
      this.state.inspectProgress = Math.min(1, this.state.inspectProgress + deltaTime / def.inspectTime);
      if (this.state.inspectProgress >= 1) {
        this.state.inspecting = false;
        this.state.inspectProgress = 0;
      }
    }

    // ADS sway (applied by the combat system via camera transform)
    void moving;
  }

  startReload(): void {
    if (this.state.reloading || this.state.inspecting) return;
    if (this.state.magazine >= this.getMagazineSize()) return;
    if (this.state.reserve <= 0) return;
    this.state.reloading = true;
    this.state.reloadProgress = 0;
  }

  startInspect(): void {
    if (this.state.inspecting || this.state.reloading) return;
    this.state.inspecting = true;
    this.state.inspectProgress = 0;
  }

  cancelInterrupt(): void {
    this.state.reloading = false;
    this.state.reloadProgress = 0;
    this.state.inspecting = false;
    this.state.inspectProgress = 0;
  }

  /** Switch to a different weapon (preserves loadout modifiers by re-reading catalog). */
  switchTo(weaponId: string): void {
    this.definition = { ...WEAPON_CATALOG[weaponId] };
    this.state.weaponId = weaponId;
    this.state.magazine = this.getMagazineSize();
    this.state.reserve = this.definition.reserveAmmo;
    this.state.reloading = false;
    this.state.inspecting = false;
    this.state.reloadProgress = 0;
    this.state.inspectProgress = 0;
    this.state.bloom = 0;
    this.state.burstIndex = 0;
  }

  getTotalAmmo(): number {
    return this.state.magazine + this.state.reserve;
  }
}
