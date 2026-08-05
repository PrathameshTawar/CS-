/**
 * DestructionSystem.ts
 *
 * Implements Requirement 4 — environment destruction.
 *
 * Responsibilities
 * ────────────────
 * 1. Receives IMPACT events from the EventBus.
 * 2. Looks up the hit block in PhysicsWorld and applies damage via
 *    PhysicsWorld.applyDamage() (which uses the DESTRUCTION_PROFILES table).
 * 3. Handles PhysicsWorld.onBlockDamaged callbacks:
 *      crack     → swap block mesh material to cracked variant (tint + normal overlay)
 *      fracture  → crack + spawn debris particle burst
 *      collapse  → remove mesh from scene + spawn heavy debris + scorch decal
 * 4. Limits live debris to MAX_DEBRIS_BLOCKS to maintain performance (R4.5).
 * 5. Manages bullet-hole decal lifetime (R4.6) — decals older than
 *    DECAL_LIFETIME_MS are removed each frame.
 *
 * Wire-up (in Game.ts / demo):
 *   const destruction = new DestructionSystem(bus, physics, scene, particles, decals);
 *   // Each frame:
 *   destruction.update(deltaTime);
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { PhysicsWorld, DESTRUCTION_PROFILES } from '../../physics/core/PhysicsWorld';
import { ParticleSystem } from '../../rendering/particles/ParticleSystem';
import { ImpactDecalSystem } from '../../rendering/effects/ImpactDecalSystem';
import { GAME_EVENTS, ImpactEvent, ExplosionEvent } from './GameTypes';
import { BlockInstance } from '../maps/MapGenerator';

// ─── Config ────────────────────────────────────────────────────────────────

/** Requirement 4.5: max simultaneous debris meshes in the scene. */
const MAX_DEBRIS_BLOCKS = 64;

/** Requirement 4.6: bullet hole decal lifetime in milliseconds (default 30s). */
const DECAL_LIFETIME_MS = 30_000;

/** Crack tint — slight desaturation + reddish dust overlay. */
const CRACK_TINT = new THREE.Color(0.85, 0.80, 0.75);

/** Fracture tint — darker, more broken. */
const FRACTURE_TINT = new THREE.Color(0.65, 0.60, 0.55);

// ─── Types ─────────────────────────────────────────────────────────────────

interface DebrisMaterialProfile {
  color: THREE.Color;
  roughness: number;
  metalness: number;
  transparent?: boolean;
  opacity?: number;
  drag: number;
  bounce: number;
  countMin: number;
  countMax: number;
  speedMult: number;
  shape: 'chunk' | 'splinter' | 'shard';
}

const DEBRIS_PROFILES: Record<string, DebrisMaterialProfile> = {
  wood: {
    color: new THREE.Color(0x8b5a2b),
    roughness: 0.88,
    metalness: 0.05,
    drag: 0.88,
    bounce: 0.25,
    countMin: 12,
    countMax: 20,
    speedMult: 1.2,
    shape: 'splinter',
  },
  concrete: {
    color: new THREE.Color(0x7f8c8d),
    roughness: 0.95,
    metalness: 0.05,
    drag: 0.94,
    bounce: 0.15,
    countMin: 10,
    countMax: 18,
    speedMult: 1.0,
    shape: 'chunk',
  },
  stone: {
    color: new THREE.Color(0x6c7a7d),
    roughness: 0.95,
    metalness: 0.05,
    drag: 0.94,
    bounce: 0.15,
    countMin: 10,
    countMax: 18,
    speedMult: 1.0,
    shape: 'chunk',
  },
  glass: {
    color: new THREE.Color(0xddeeff),
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: 0.65,
    drag: 0.96,
    bounce: 0.35,
    countMin: 14,
    countMax: 24,
    speedMult: 2.2,
    shape: 'shard',
  },
};

interface DebrisMesh {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
  settled: boolean;
  drag: number;
  bounce: number;
}

interface TrackedDecal {
  /** The decal mesh or group added to the scene. */
  object: THREE.Object3D;
  spawnTime: number;
}

// ─── DestructionSystem ─────────────────────────────────────────────────────

export class DestructionSystem {
  private readonly physics: PhysicsWorld;
  private readonly scene: THREE.Scene;
  private readonly particles: ParticleSystem;
  private readonly decals: ImpactDecalSystem;

  /** Map from BlockInstance → scene mesh so we can update/remove it. */
  private readonly blockMeshes: Map<BlockInstance, THREE.Mesh>;

  /** Active physics-simulated debris meshes. */
  private readonly debrisMeshes: DebrisMesh[] = [];

  /** Tracked bullet-hole decals for lifetime management. */
  private readonly trackedDecals: TrackedDecal[] = [];
  private _lastImpactDir = new THREE.Vector3(0, 1, 0);

  private readonly disposers: (() => void)[] = [];

  /** Shared cracked geometry overlay material (reused, not per-block). */
  private readonly crackedMaterial: THREE.MeshStandardMaterial;
  private readonly fracturedMaterial: THREE.MeshStandardMaterial;

  /** Random in [0,1); injectable for determinism. Defaults to Math.random. */
  private readonly random: () => number;

  /**
   * @param blockMeshes  - Map from BlockInstance → THREE.Mesh (owned by Game/buildMap).
   *                       DestructionSystem does NOT own these meshes; it only
   *                       mutates their material and removes them from the scene.
   * @param random       - Random function; injectable for tests. Defaults to Math.random.
   */
  constructor(
    bus: EventBus,
    physics: PhysicsWorld,
    scene: THREE.Scene,
    particles: ParticleSystem,
    decals: ImpactDecalSystem,
    blockMeshes: Map<BlockInstance, THREE.Mesh>,
    random?: () => number,
  ) {
    this.random = random ?? Math.random;
    this.physics = physics;
    this.scene = scene;
    this.particles = particles;
    this.decals = decals;
    this.blockMeshes = blockMeshes;

    // Shared damage materials
    this.crackedMaterial = new THREE.MeshStandardMaterial({
      color: CRACK_TINT,
      roughness: 0.9,
      metalness: 0.0,
    });
    this.fracturedMaterial = new THREE.MeshStandardMaterial({
      color: FRACTURE_TINT,
      roughness: 1.0,
      metalness: 0.0,
    });

    // Register PhysicsWorld callback
    this.physics.onBlockDamaged = (block, state) => {
      this._onBlockState(block, state);
    };

    // Subscribe to IMPACT events
    this.disposers.push(
      bus.on<ImpactEvent>(GAME_EVENTS.IMPACT, (e) => {
        this._handleImpact(e);
      }),
      bus.on<ExplosionEvent>(GAME_EVENTS.EXPLOSION, (e) => {
        this.applyExplosion(
          new THREE.Vector3(e.position.x, e.position.y, e.position.z),
          e.radius,
          e.maxDamage ?? 250
        );
      }),
    );
  }

  /**
   * Fractures all destructible surfaces within an explosion's blast radius (R4.4).
   * Debris velocity scales by inverse distance from the epicenter.
   */
  applyExplosion(epicenter: THREE.Vector3, radius: number, maxDamage = 250): void {
    for (const block of this.blockMeshes.keys()) {
      const dx = block.x - epicenter.x;
      const dy = block.y - epicenter.y;
      const dz = block.z - epicenter.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= radius) {
        const factor = 1 - dist / radius; // inverse distance scaling
        const dmg = Math.round(maxDamage * factor);
        if (dmg > 0) {
          const dir = new THREE.Vector3(dx, dy, dz).normalize();
          this._lastImpactDir = dir.multiplyScalar(factor * 18);
          this.physics.applyDamage(block, dmg);
        }
      }
    }
  }

  // ─── Per-frame update ──────────────────────────────────────────────────

  update(deltaTime: number): void {
    this._stepDebris(deltaTime);
    this._pruneDecals();
  }

  // ─── Decal tracking ────────────────────────────────────────────────────

  /**
   * Register a decal object for lifetime management.
   * Call this whenever the ImpactDecalSystem spawns a decal so the
   * DestructionSystem can remove old ones (R4.6).
   */
  trackDecal(object: THREE.Object3D): void {
    this.trackedDecals.push({ object, spawnTime: Date.now() });
  }

  setDecalLifetime(_ms: number): void {
    // Future: make configurable at runtime
  }

  // ─── Dispose ───────────────────────────────────────────────────────────

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;

    for (const dm of this.debrisMeshes) {
      this.scene.remove(dm.mesh);
      dm.mesh.geometry.dispose();
      (dm.mesh.material as THREE.Material).dispose();
    }
    this.debrisMeshes.length = 0;

    this.crackedMaterial.dispose();
    this.fracturedMaterial.dispose();

    this.physics.onBlockDamaged = undefined;
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private _handleImpact(e: ImpactEvent): void {
    if (!e.penetrated && e.block) {
      const block = e.block as unknown as BlockInstance;
      const profile = DESTRUCTION_PROFILES[block.material] ?? DESTRUCTION_PROFILES.concrete;

      if (e.normal) {
        this._lastImpactDir.set(-e.normal.x, -e.normal.y, -e.normal.z).normalize().multiplyScalar(10);
      } else {
        this._lastImpactDir.set(0, 1, 0);
      }

      const baseDamage = 30;
      const damage = Math.round(baseDamage * (profile.penetrable ? 1.0 : 0.5));

      this.physics.applyDamage(block, damage);
    }
  }

  private _onBlockState(block: BlockInstance, state: 'crack' | 'fracture' | 'collapse'): void {
    const mesh = this.blockMeshes.get(block);

    if (state === 'crack') {
      if (mesh) {
        // Tint the mesh material toward the cracked look
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(CRACK_TINT);
        mat.roughness = Math.min(1, mat.roughness + 0.15);
        mesh.material = mat;
      }
    }

    if (state === 'fracture') {
      if (mesh) {
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiply(FRACTURE_TINT);
        mat.roughness = 1.0;
        mesh.material = mat;
      }
      // Spawn small debris burst
      this.particles.emitDebris(
        block.x, block.y + block.hy, block.z,
        0, 1, 0,
        block.material,
        8,
      );
    }

    if (state === 'collapse') {
      // Remove mesh from scene
      if (mesh) {
        this.scene.remove(mesh);
        this.blockMeshes.delete(block);
        // Dispose geometry but keep the shared material (cloned above)
        mesh.geometry.dispose();
        if (!Array.isArray(mesh.material)) {
          (mesh.material as THREE.Material).dispose();
        }
      }

      // Heavy debris burst (Requirement 4.2)
      this.particles.emitDebris(
        block.x, block.y, block.z,
        (this.random() - 0.5) * 2,
        1,
        (this.random() - 0.5) * 2,
        block.material,
        20,
      );

      // Scorch decal at collapse origin
      this.decals.spawnScorch(
        new THREE.Vector3(block.x, block.y - block.hy + 0.02, block.z),
        block.hx * 1.5,
      );

      // Spawn a few rigid-body debris meshes for chunky visual (R4.2)
      this._spawnDebrisMeshes(block);
    }
  }

  /**
   * Spawn 8-24 procedural debris fragments from a collapsed block (R4.1, R4.2, R4.3).
   */
  private _spawnDebrisMeshes(block: BlockInstance): void {
    const prof = DEBRIS_PROFILES[block.material] ?? DEBRIS_PROFILES.concrete;
    const count = Math.min(
      THREE.MathUtils.randInt(prof.countMin, prof.countMax),
      MAX_DEBRIS_BLOCKS - this.debrisMeshes.length,
    );

    if (count <= 0) {
      const settledIdx = this.debrisMeshes.findIndex(d => d.settled);
      if (settledIdx !== -1) {
        const old = this.debrisMeshes.splice(settledIdx, 1)[0];
        this.scene.remove(old.mesh);
        old.mesh.geometry.dispose();
        (old.mesh.material as THREE.Material).dispose();
      }
    }

    const mat = new THREE.MeshStandardMaterial({
      color: prof.color.clone().multiplyScalar(0.9),
      roughness: prof.roughness,
      metalness: prof.metalness,
      transparent: prof.transparent ?? false,
      opacity: prof.opacity ?? 1.0,
    });

    if (prof.shape === 'chunk') {
      this.particles.emitSmoke(block.x, block.y + block.hy, block.z);
    }

    for (let i = 0; i < count; i++) {
      const sx = block.hx * (0.15 + this.random() * 0.35);
      const sy = block.hy * (0.15 + this.random() * 0.35);
      const sz = block.hz * (0.15 + this.random() * 0.35);

      let geo: THREE.BufferGeometry;
      if (prof.shape === 'splinter') {
        geo = new THREE.BoxGeometry(sx * 0.5, sy * 2.8, sz * 0.5);
      } else if (prof.shape === 'shard') {
        geo = new THREE.TetrahedronGeometry(Math.max(sx, sy, sz) * 1.3);
      } else {
        geo = new THREE.BoxGeometry(sx * 1.8, sy * 1.8, sz * 1.8);
      }

      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.castShadow = true;
      mesh.position.set(
        block.x + (this.random() - 0.5) * block.hx * 1.5,
        block.y + block.hy + (this.random() - 0.5) * block.hy,
        block.z + (this.random() - 0.5) * block.hz * 1.5,
      );
      mesh.rotation.set(this.random() * Math.PI, this.random() * Math.PI, this.random() * Math.PI);
      this.scene.add(mesh);

      const baseVel = this._lastImpactDir.clone().multiplyScalar(prof.speedMult);

      this.debrisMeshes.push({
        mesh,
        velocity: new THREE.Vector3(
          baseVel.x + (this.random() - 0.5) * 9 * prof.speedMult,
          4 + this.random() * 6 * prof.speedMult,
          baseVel.z + (this.random() - 0.5) * 9 * prof.speedMult,
        ),
        angularVelocity: new THREE.Vector3(
          (this.random() - 0.5) * 12,
          (this.random() - 0.5) * 12,
          (this.random() - 0.5) * 12,
        ),
        life: 0,
        maxLife: 6 + this.random() * 4,
        settled: false,
        drag: prof.drag,
        bounce: prof.bounce,
      });
    }

    mat.dispose();
  }

  /** Integrate debris meshes: gravity + profile drag + ground settle (R4.2, R4.3). */
  private _stepDebris(dt: number): void {
    for (let i = this.debrisMeshes.length - 1; i >= 0; i--) {
      const d = this.debrisMeshes[i];
      d.life += dt;

      if (d.life >= d.maxLife) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debrisMeshes.splice(i, 1);
        continue;
      }

      if (!d.settled) {
        // Gravity + Profile Drag
        d.velocity.y -= 9.8 * dt;
        d.velocity.multiplyScalar(Math.pow(d.drag, dt * 60));
        d.mesh.position.addScaledVector(d.velocity, dt);

        // Ground settle with profile bounce
        if (d.mesh.position.y <= 0.1) {
          d.mesh.position.y = 0.1;
          d.velocity.y = Math.abs(d.velocity.y) * -d.bounce;
          d.velocity.x *= 0.6;
          d.velocity.z *= 0.6;
          d.angularVelocity.multiplyScalar(0.5);

          if (Math.abs(d.velocity.y) < 0.2 && d.velocity.length() < 0.5) {
            d.settled = true;
            d.velocity.set(0, 0, 0);
          }
        }

        // Angular rotation
        d.mesh.rotation.x += d.angularVelocity.x * dt;
        d.mesh.rotation.y += d.angularVelocity.y * dt;
        d.mesh.rotation.z += d.angularVelocity.z * dt;
        d.angularVelocity.multiplyScalar(Math.pow(0.9, dt * 60));
      }
    }
  }

  /** Remove decals older than DECAL_LIFETIME_MS (Requirement 4.6). */
  private _pruneDecals(): void {
    const now = Date.now();
    for (let i = this.trackedDecals.length - 1; i >= 0; i--) {
      const td = this.trackedDecals[i];
      if (now - td.spawnTime >= DECAL_LIFETIME_MS) {
        this.scene.remove(td.object);
        this.trackedDecals.splice(i, 1);
      }
    }
  }
}
