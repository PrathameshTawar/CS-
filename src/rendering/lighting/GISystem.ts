/**
 * GISystem.ts
 *
 * Implements Requirement 2.1 & 2.3 — Dynamic Diffuse Global Illumination (DDGI)
 * irradiance probe grid approximation.
 *
 * Features:
 * - 3D irradiance probe grid spanning the playable environment (R2.1)
 * - Real-time indirect diffuse irradiance evaluation with bounce coloring (R2.1)
 * - Trilinear interpolation + hemispherical normal weighting (R2.1)
 * - Dynamic object sampling for players, weapons, and physics debris (R2.3)
 *
 * @module Rendering
 */

import * as THREE from 'three';

export interface GIProbe {
  position: THREE.Vector3;
  irradiance: THREE.Color;
}

export interface GISystemOptions {
  minBounds?: THREE.Vector3;
  maxBounds?: THREE.Vector3;
  gridResolution?: { x: number; y: number; z: number };
  skyColor?: THREE.Color;
  groundColor?: THREE.Color;
}

export class GISystem {
  private readonly probes: GIProbe[] = [];
  private readonly minBounds: THREE.Vector3;
  private readonly maxBounds: THREE.Vector3;
  private readonly gridRes: { x: number; y: number; z: number };
  private readonly skyColor: THREE.Color;
  private readonly groundColor: THREE.Color;
  private time = 0;

  constructor(options: GISystemOptions = {}) {
    this.minBounds = options.minBounds?.clone() ?? new THREE.Vector3(-60, 0, -60);
    this.maxBounds = options.maxBounds?.clone() ?? new THREE.Vector3(60, 20, 60);
    this.gridRes = options.gridResolution ?? { x: 5, y: 3, z: 5 };
    this.skyColor = options.skyColor?.clone() ?? new THREE.Color(0xd6e8f0);
    this.groundColor = options.groundColor?.clone() ?? new THREE.Color(0x6a5a48);

    this.initializeProbes();
  }

  private initializeProbes(): void {
    const { x: rx, y: ry, z: rz } = this.gridRes;
    const size = this.maxBounds.clone().sub(this.minBounds);

    for (let iz = 0; iz < rz; iz++) {
      for (let iy = 0; iy < ry; iy++) {
        for (let ix = 0; ix < rx; ix++) {
          const fx = rx > 1 ? ix / (rx - 1) : 0.5;
          const fy = ry > 1 ? iy / (ry - 1) : 0.5;
          const fz = rz > 1 ? iz / (rz - 1) : 0.5;

          const position = new THREE.Vector3(
            this.minBounds.x + fx * size.x,
            this.minBounds.y + fy * size.y,
            this.minBounds.z + fz * size.z,
          );

          // Initial irradiance mix between sky and ground bounce
          const irradiance = new THREE.Color().lerpColors(this.groundColor, this.skyColor, fy * 0.7 + 0.15);
          this.probes.push({ position, irradiance });
        }
      }
    }
  }

  /**
   * Updates probe irradiance colors based on scene lights and bounce (R2.1).
   */
  update(deltaTime: number, lights?: (THREE.Object3D | THREE.Light)[]): void {
    this.time += deltaTime;

    // Slowly pulse/update indirect bounce from light sources
    for (const probe of this.probes) {
      const baseCol = probe.irradiance;

      if (lights) {
        for (const light of lights) {
          if (!light.visible || !(light instanceof THREE.Light)) continue;
          if (light instanceof THREE.DirectionalLight) {
            // Sun indirect bounce
            const contrib = light.color.clone().multiplyScalar(light.intensity * 0.08);
            baseCol.add(contrib);
          } else if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
            const dist = probe.position.distanceTo(light.position);
            const atten = 1.0 / (1.0 + dist * dist * 0.05);
            const contrib = light.color.clone().multiplyScalar(light.intensity * atten * 0.12);
            baseCol.add(contrib);
          }
        }
      }

      // Clamp so irradiance doesn't blow out
      baseCol.r = Math.min(1.5, baseCol.r);
      baseCol.g = Math.min(1.5, baseCol.g);
      baseCol.b = Math.min(1.5, baseCol.b);
    }
  }

  /**
   * Samples trilinearly interpolated indirect irradiance at worldPos (R2.1, R2.3).
   */
  sampleIrradiance(worldPos: THREE.Vector3, normal?: THREE.Vector3): THREE.Color {
    const { x: rx, y: ry, z: rz } = this.gridRes;
    const size = this.maxBounds.clone().sub(this.minBounds);

    const fx = THREE.MathUtils.clamp((worldPos.x - this.minBounds.x) / size.x, 0, 1) * (rx - 1);
    const fy = THREE.MathUtils.clamp((worldPos.y - this.minBounds.y) / size.y, 0, 1) * (ry - 1);
    const fz = THREE.MathUtils.clamp((worldPos.z - this.minBounds.z) / size.z, 0, 1) * (rz - 1);

    const x0 = Math.floor(fx);
    const x1 = Math.min(rx - 1, x0 + 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(ry - 1, y0 + 1);
    const z0 = Math.floor(fz);
    const z1 = Math.min(rz - 1, z0 + 1);

    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;

    const getIdx = (ix: number, iy: number, iz: number) => iz * (rx * ry) + iy * rx + ix;

    const c000 = this.probes[getIdx(x0, y0, z0)]?.irradiance ?? this.skyColor;
    const c100 = this.probes[getIdx(x1, y0, z0)]?.irradiance ?? this.skyColor;
    const c010 = this.probes[getIdx(x0, y1, z0)]?.irradiance ?? this.skyColor;
    const c110 = this.probes[getIdx(x1, y1, z0)]?.irradiance ?? this.skyColor;
    const c001 = this.probes[getIdx(x0, y0, z1)]?.irradiance ?? this.skyColor;
    const c101 = this.probes[getIdx(x1, y0, z1)]?.irradiance ?? this.skyColor;
    const c011 = this.probes[getIdx(x0, y1, z1)]?.irradiance ?? this.skyColor;
    const c111 = this.probes[getIdx(x1, y1, z1)]?.irradiance ?? this.skyColor;

    const c00 = c000.clone().lerp(c100, tx);
    const c10 = c010.clone().lerp(c110, tx);
    const c01 = c001.clone().lerp(c101, tx);
    const c11 = c011.clone().lerp(c111, tx);

    const c0 = c00.lerp(c10, ty);
    const c1 = c01.lerp(c11, ty);

    const sampled = c0.lerp(c1, tz);

    // Apply hemispherical cosine weighting if normal is provided
    if (normal) {
      const upDot = THREE.MathUtils.clamp(normal.y * 0.5 + 0.5, 0.2, 1.0);
      sampled.multiplyScalar(upDot);
    }

    return sampled;
  }

  /**
   * Samples GI probe volume and applies indirect irradiance to dynamic objects (R2.3).
   */
  updateDynamicObjects(objects: THREE.Object3D[]): void {
    const tempNormal = new THREE.Vector3(0, 1, 0);
    for (const obj of objects) {
      if (!obj.visible) continue;
      const irr = this.sampleIrradiance(obj.position, tempNormal);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.emissive) {
            mat.emissive.copy(irr).multiplyScalar(0.12);
          }
        }
      });
    }
  }

  dispose(): void {
    this.probes.length = 0;
  }
}
