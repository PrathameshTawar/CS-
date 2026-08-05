/**
 * PickupSystem.ts
 *
 * Simple medkit / ammo pickups (Task T1.6). The AI Director's
 * grant_content(medkit|ammo) and event_trigger(airdrop) commands spawn
 * these into the scene; the player collects them on proximity. The demo
 * applies the effect (heal / reserve ammo) on GAME_EVENTS.PICKUP.
 *
 * @module Gameplay
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import { GAME_EVENTS, PickupEvent } from '../core/GameTypes';

export type PickupKind = 'medkit' | 'ammo';

export interface PickupSpawn {
  kind: PickupKind;
  position: { x: number; y: number; z: number };
}

interface ActivePickup {
  id: number;
  kind: PickupKind;
  group: THREE.Group;
  baseY: number;
}

const PICKUP_RADIUS_SQ = 1.6; // horizontal pickup radius, squared
const VERTICAL_TOLERANCE = 2.0;

export class PickupSystem {
  private readonly scene: THREE.Scene;
  private readonly bus: EventBus;
  private readonly pickups: ActivePickup[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene, bus: EventBus) {
    this.scene = scene;
    this.bus = bus;
  }

  get count(): number {
    return this.pickups.length;
  }

  /** Spawn a pickup at a world position. */
  spawn(kind: PickupKind, position: { x: number; y: number; z: number }): void {
    const group = this.buildMesh(kind);
    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);
    this.pickups.push({ id: this.nextId++, kind, group, baseY: position.y });
  }

  /** Per-frame update: bob/spin + proximity collection against the player. */
  update(deltaTime: number, playerPos: THREE.Vector3): void {
    const now = performance.now();
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      // Gentle bob + spin so pickups read as interactive.
      p.group.rotation.y += deltaTime * 2;
      p.group.position.y = p.baseY + Math.sin(now * 0.004 + p.id) * 0.12;

      const dx = p.group.position.x - playerPos.x;
      const dz = p.group.position.z - playerPos.z;
      const dy = p.group.position.y - playerPos.y;
      if (dx * dx + dz * dz < PICKUP_RADIUS_SQ && Math.abs(dy) < VERTICAL_TOLERANCE) {
        this.disposeGroup(p.group);
        this.pickups.splice(i, 1);
        this.bus.emit<PickupEvent>(GAME_EVENTS.PICKUP, {
          kind: p.kind,
          position: { x: p.group.position.x, y: p.group.position.y, z: p.group.position.z },
        });
      }
    }
  }

  /** Remove all pickups (world teardown). */
  dispose(): void {
    for (const p of this.pickups) this.disposeGroup(p.group);
    this.pickups.length = 0;
  }

  /** Remove the group from the scene and release its GPU resources. */
  private disposeGroup(group: THREE.Group): void {
    this.scene.remove(group);
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    });
  }

  private buildMesh(kind: PickupKind): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.35, 0.5),
      new THREE.MeshStandardMaterial({
        color: kind === 'medkit' ? 0xf5f5f4 : 0xc8a24a,
        emissive: kind === 'medkit' ? 0x2f6f2f : 0x6b4d1f,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      })
    );
    group.add(body);

    if (kind === 'medkit') {
      // Red medical cross on the front face
      const red = new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0xdc2626,
        emissiveIntensity: 0.6,
      });
      const barH = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.1), red);
      barH.position.set(0, 0, 0.26);
      group.add(barH);
      const barV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.1), red);
      barV.position.set(0, 0, 0.26);
      group.add(barV);
    } else {
      // Ammo: olive crate with a dark band
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.08, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x2d2a1e, roughness: 0.7 })
      );
      band.position.set(0, 0.16, 0);
      group.add(band);
    }
    return group;
  }
}
