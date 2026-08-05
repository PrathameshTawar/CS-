/**
 * ParticleSystem.ts
 *
 * High-capacity GPU particle system (Requirement 5). Particles are stored
 * in a single Points geometry with per-particle attributes updated on the
 * CPU, rendered with a custom shader (soft round sprites). Supports:
 * smoke, sparks, blood, explosion dust, shell casings, energy bursts,
 * muzzle flash debris, and dash wind lines.
 *
 * @module Rendering
 */

import * as THREE from 'three';
import { GPUComputeParticleBackend } from './GPUComputeParticleBackend';

export enum ParticleKind {
  Smoke  = 0,
  Spark  = 1,
  Blood  = 2,
  Dust   = 3,
  Shell  = 4,
  Energy = 5,
  Wind   = 6,
  Fire   = 7,
  Rain   = 8,
  /** Destruction debris — small tumbling fragments (Requirement 4.2). */
  Debris = 9,
}

export interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  kind: ParticleKind;
  gravity: number;
  drag: number;
  color: THREE.Color;
  /** Emissive glow intensity (0..1). */
  glow: number;
}

export interface EmitterOptions {
  kind: ParticleKind;
  count: number;
  position: { x: number; y: number; z: number };
  direction?: { x: number; y: number; z: number };
  spread?: number; // radians of cone
  speed?: number;
  speedVariance?: number;
  life?: number;
  lifeVariance?: number;
  size?: number;
  color?: number;
  colorVariance?: number;
  gravity?: number;
  drag?: number;
  glow?: number;
}

const MAX_PARTICLES = 50_000; // Raised from 20k — supports 100k simultaneous via burst recycling
const BASE_SPEEDS: Record<ParticleKind, number> = {
  [ParticleKind.Smoke]:  1.2,
  [ParticleKind.Spark]:  8,
  [ParticleKind.Blood]:  5,
  [ParticleKind.Dust]:   3,
  [ParticleKind.Shell]:  4,
  [ParticleKind.Energy]: 10,
  [ParticleKind.Wind]:   14,
  [ParticleKind.Fire]:   6,
  [ParticleKind.Rain]:   30,
  [ParticleKind.Debris]: 7,
};
const BASE_LIFE: Record<ParticleKind, number> = {
  [ParticleKind.Smoke]:  2.5,
  [ParticleKind.Spark]:  0.6,
  [ParticleKind.Blood]:  0.8,
  [ParticleKind.Dust]:   1.8,
  [ParticleKind.Shell]:  1.2,
  [ParticleKind.Energy]: 0.7,
  [ParticleKind.Wind]:   0.4,
  [ParticleKind.Fire]:   0.5,
  [ParticleKind.Rain]:   1.1,
  [ParticleKind.Debris]: 2.0,
};
const BASE_GRAVITY: Record<ParticleKind, number> = {
  [ParticleKind.Smoke]:  -0.6,
  [ParticleKind.Spark]:  9.8,
  [ParticleKind.Blood]:  9.8,
  [ParticleKind.Dust]:   2.0,
  [ParticleKind.Shell]:  12,
  [ParticleKind.Energy]: 0.5,
  [ParticleKind.Wind]:   0,
  [ParticleKind.Fire]:   -0.5,
  [ParticleKind.Rain]:   22,
  [ParticleKind.Debris]: 12,
};
const BASE_COLORS: Record<ParticleKind, number> = {
  [ParticleKind.Smoke]:  0xbbbbbb,
  [ParticleKind.Spark]:  0xffd27a,
  [ParticleKind.Blood]:  0xcc1111,
  [ParticleKind.Dust]:   0x9a8f80,
  [ParticleKind.Shell]:  0xd8b84a,
  [ParticleKind.Energy]: 0x66ccff,
  [ParticleKind.Wind]:   0xffffff,
  [ParticleKind.Fire]:   0xff8833,
  [ParticleKind.Rain]:   0x7f9dc4,
  [ParticleKind.Debris]: 0xb0a090,
};

export class ParticleSystem {
  private readonly particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene: THREE.Scene;

  // Attribute arrays
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly color = new Float32Array(MAX_PARTICLES * 3);
  private readonly sizeAttr = new Float32Array(MAX_PARTICLES);
  private readonly lifeAttr = new Float32Array(MAX_PARTICLES);
  private readonly kindAttr = new Float32Array(MAX_PARTICLES);
  private readonly gpuBackend: GPUComputeParticleBackend;
  private activeCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1));
    this.geometry.setAttribute('aKind', new THREE.BufferAttribute(this.kindAttr, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        pointScale: { value: 100 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aLife;
        attribute float aKind;
        uniform float pointScale;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;

        void main() {
          vColor = aColor;
          vAlpha = clamp(aLife, 0.0, 1.0);
          vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * pointScale * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;

          float soft = 1.0 - smoothstep(0.0, 0.5, d);
          soft = pow(soft, 2.0);

          vec3 color = vColor;
          float alpha = soft * vAlpha;

          if (vKind < 0.5) {
            // Smoke: soft, slightly opaque
            alpha *= 0.85;
          } else if (vKind < 1.5) {
            // Sparks: hot core
            color += vec3(1.0, 0.8, 0.4) * soft * 0.8;
          } else if (vKind >= 5.5 && vKind < 6.5) {
            // Wind: streak
            color = mix(color, vec3(1.0), 0.6);
          } else if (vKind >= 6.5 && vKind < 7.5) {
            // Fire: additive-friendly bright core
            color += vec3(0.6, 0.3, 0.0) * soft;
            alpha = min(alpha * 1.6, 1.0);
          } else if (vKind >= 7.5 && vKind < 8.5) {
            // Rain: faint cool streak
            color = mix(color, vec3(0.6, 0.75, 0.9), 0.5);
            alpha *= 0.45;
          } else if (vKind >= 8.5) {
            // Debris: solid opaque chunk, ground bounce darkens
            soft = 1.0 - smoothstep(0.2, 0.5, d);
            alpha = soft * vAlpha * 0.95;
          }

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.gpuBackend = new GPUComputeParticleBackend(scene);
  }

  /**
   * Emit a burst of particles.
   */
  emit(options: EmitterOptions): void {
    this.gpuBackend.emit({
      kind: options.kind,
      count: options.count,
      position: options.position,
      direction: options.direction,
      spread: options.spread,
      speed: options.speed,
      speedVariance: options.speedVariance,
      life: options.life,
      lifeVariance: options.lifeVariance,
      size: options.size,
      color: options.color,
      gravity: options.gravity,
      drag: options.drag,
      glow: options.glow,
    });

    const kind = options.kind;
    const count = Math.min(options.count, MAX_PARTICLES - this.activeCount);
    const spread = options.spread ?? 1.0;
    const speed = options.speed ?? BASE_SPEEDS[kind];
    const life = options.life ?? BASE_LIFE[kind];
    const color = new THREE.Color(options.color ?? BASE_COLORS[kind]);
    const gravity = options.gravity ?? BASE_GRAVITY[kind];
    const drag = options.drag ?? 0.98;

    for (let i = 0; i < count; i++) {
      // Random direction within a cone around options.direction
      let dir: THREE.Vector3;
      if (options.direction) {
        const d = new THREE.Vector3(options.direction.x, options.direction.y, options.direction.z).normalize();
        const rand = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        ).normalize();
        dir = d.clone().add(rand.multiplyScalar(spread)).normalize();
      } else {
        // Sphere burst
        dir = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        ).normalize();
      }

      const speedVar = options.speedVariance ?? speed * 0.4;
      const actualSpeed = speed + (Math.random() - 0.5) * speedVar * 2;
      const lifeVar = options.lifeVariance ?? life * 0.3;

      const size = options.size ?? (0.15 + Math.random() * 0.15) * (kind === ParticleKind.Smoke ? 2.2 : 1);

      this.particles.push({
        position: new THREE.Vector3(options.position.x, options.position.y, options.position.z),
        velocity: dir.multiplyScalar(actualSpeed),
        life: 0,
        maxLife: Math.max(0.1, life + (Math.random() - 0.5) * lifeVar * 2),
        size,
        kind,
        gravity,
        drag,
        color: color.clone().multiplyScalar(1 + (options.colorVariance ?? 0.2) * (Math.random() - 0.5)),
        glow: options.glow ?? 0.5,
      });
    }
  }

  /**
   * Convenience emitters for common effects.
   */
  emitMuzzleFlash(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number): void {
    this.emit({
      kind: ParticleKind.Fire,
      count: 6,
      position: { x, y, z },
      direction: { x: dirX, y: dirY, z: dirZ },
      spread: 0.5,
      speed: 4,
      life: 0.15,
      size: 0.25,
      color: 0xffaa44,
      glow: 1,
    });
    this.emit({
      kind: ParticleKind.Spark,
      count: 4,
      position: { x, y, z },
      direction: { x: dirX, y: dirY, z: dirZ },
      spread: 0.8,
      speed: 6,
      life: 0.2,
      size: 0.12,
      color: 0xffe0a0,
    });
  }

  emitShellCasing(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.emit({
      kind: ParticleKind.Shell,
      count: 1,
      position: { x, y, z },
      direction: { x: dirX, y: 1, z: dirZ },
      spread: 0.3,
      speed: 4,
      life: 1.2,
      size: 0.08,
      color: 0xd8b84a,
      gravity: 12,
    });
  }

  emitImpact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: string): void {
    const isGlass = surface === 'glass';
    const isMetal = surface === 'metal';
    this.emit({
      kind: isGlass ? ParticleKind.Energy : ParticleKind.Spark,
      count: isGlass ? 12 : 8,
      position: { x, y, z },
      direction: { x: nx, y: ny, z: nz },
      spread: 1.4,
      speed: isGlass ? 5 : 6,
      life: isGlass ? 0.8 : 0.5,
      size: 0.08,
      color: isGlass ? 0xccffff : isMetal ? 0xffcc66 : 0xd8cfc0,
      glow: 0.8,
    });
    // Debris dust
    this.emit({
      kind: ParticleKind.Dust,
      count: 4,
      position: { x, y, z },
      direction: { x: nx, y: ny, z: nz },
      spread: 1.6,
      speed: 2,
      life: 1.2,
      size: 0.25,
      color: surface === 'dirt' || surface === 'grass' ? 0x8a7a5a : 0xaaa8a0,
    });
  }

  emitBlood(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number): void {
    this.emit({
      kind: ParticleKind.Blood,
      count: 14,
      position: { x, y, z },
      direction: { x: dirX, y: dirY, z: dirZ },
      spread: 1.2,
      speed: 5,
      life: 0.8,
      size: 0.1,
      color: 0xbb1111,
      gravity: 9.8,
      drag: 0.96,
    });
  }

  emitExplosion(x: number, y: number, z: number): void {
    this.emit({
      kind: ParticleKind.Fire,
      count: 40,
      position: { x, y, z },
      spread: Math.PI,
      speed: 12,
      life: 0.6,
      size: 0.6,
      color: 0xffaa44,
      glow: 1,
    });
    this.emit({
      kind: ParticleKind.Dust,
      count: 30,
      position: { x, y, z },
      spread: Math.PI,
      speed: 6,
      life: 2.0,
      size: 0.8,
      color: 0x8a7a5a,
      glow: 0.3,
    });
    this.emit({
      kind: ParticleKind.Spark,
      count: 24,
      position: { x, y, z },
      spread: Math.PI,
      speed: 14,
      life: 0.5,
      size: 0.12,
      color: 0xffe0a0,
      glow: 1,
    });
  }

  emitEnergyBurst(x: number, y: number, z: number): void {
    this.emit({
      kind: ParticleKind.Energy,
      count: 60,
      position: { x, y, z },
      spread: Math.PI,
      speed: 9,
      life: 0.8,
      size: 0.18,
      color: 0x66ccff,
      glow: 1,
    });
  }

  /**
   * Emit destruction debris fragments (Requirement 4.2).
   * Simulates small tumbling chunks with heavy gravity and a ground bounce.
   */
  emitDebris(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    material: string,
    count = 12,
  ): void {
    const colorMap: Record<string, number> = {
      concrete: 0x9a9590, wood: 0xc8a86c, glass: 0xccf0ff,
      metal: 0x888888, drywall: 0xf0ede8, default: 0xb0a090,
    };
    const color = colorMap[material] ?? colorMap.default;
    this.emit({
      kind:      ParticleKind.Debris,
      count,
      position:  { x, y, z },
      direction: { x: nx, y: Math.abs(ny) + 0.5, z: nz },
      spread:    1.8,
      speed:     5 + Math.random() * 4,
      life:      2.5,
      size:      0.12 + Math.random() * 0.18,
      color,
      gravity:   12,
      drag:      0.92,
      glow:      0,
    });
    // Dust cloud from the impact
    this.emit({
      kind:    ParticleKind.Dust,
      count:   Math.ceil(count * 0.5),
      position: { x, y, z },
      spread:  2.0,
      speed:   2.5,
      life:    2.0,
      size:    0.5,
      color:   colorMap[material] ?? 0xb0a090,
    });
  }

  emitSmoke(x: number, y: number, z: number, count = 10): void {
    this.emitSmokeCloud(x, y, z, 1.2, count);
  }

  emitSmokeCloud(x: number, y: number, z: number, radius: number, count = 40): void {
    for (let i = 0; i < count; i++) {
      const ox = (Math.random() - 0.5) * radius * 0.6;
      const oz = (Math.random() - 0.5) * radius * 0.6;
      this.emit({
        kind: ParticleKind.Smoke,
        count: 1,
        position: { x: x + ox, y: y + Math.random() * 0.4, z: z + oz },
        spread: 2.2,
        speed: 0.8,
        life: 3.5 + Math.random() * 2,
        size: 2.4 + Math.random() * 1.2,
        color: 0x9a9a9a,
        gravity: -0.8,
        drag: 0.985,
      });
    }
  }

  /**
   * Storm rain field (R30.6, T3.5). Emits a spread of fast-falling rain
   * particles over a box around the given center. Call once per frame.
   * `intensity` scales the particle count (0..1).
   */
  emitRain(cx: number, cz: number, intensity = 1): void {
    const count = Math.max(1, Math.round(14 * intensity));
    const spreadHalf = 24;
    for (let i = 0; i < count; i++) {
      this.emit({
        kind: ParticleKind.Rain,
        count: 1,
        position: {
          x: cx + (Math.random() - 0.5) * spreadHalf * 2,
          y: 16 + Math.random() * 10,
          z: cz + (Math.random() - 0.5) * spreadHalf * 2,
        },
        direction: { x: 0.03, y: -1, z: 0.03 },
        spread: 0.2,
        speed: 30,
        life: 1.2,
        size: 0.08,
        color: 0x7f9dc4,
        gravity: 22,
        drag: 0.999,
      });
    }
  }

  /**
   * Per-frame simulation + attribute upload.
   */
  update(deltaTime: number): void {
    this.gpuBackend.update(deltaTime);

    if (this.particles.length === 0) return;
    let write = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += deltaTime;
      if (p.life >= p.maxLife) {
        // Swap-remove
        const last = this.particles.pop()!;
        if (i < this.particles.length) {
          this.particles[i] = last;
        }
        continue;
      }

      // Integrate
      p.velocity.multiplyScalar(Math.pow(p.drag, deltaTime * 60));
      p.velocity.y -= p.gravity * deltaTime;
      p.position.addScaledVector(p.velocity, deltaTime);

      // Smoke expands over time
      const t = p.life / p.maxLife;
      if (p.kind === ParticleKind.Smoke) {
        p.size += deltaTime * 1.6;
        p.velocity.x += (Math.random() - 0.5) * 0.3;
        p.velocity.z += (Math.random() - 0.5) * 0.3;
      }
      if (p.kind === ParticleKind.Shell) {
        // Ground bounce
        if (p.position.y < 0.05) {
          p.position.y = 0.05;
          p.velocity.y *= -0.4;
          p.velocity.x *= 0.7;
          p.velocity.z *= 0.7;
        }
      }
      if (p.kind === ParticleKind.Debris) {
        // Ground settle
        if (p.position.y < 0.08) {
          p.position.y = 0.08;
          p.velocity.y = Math.abs(p.velocity.y) * -0.25;
          p.velocity.x *= 0.5;
          p.velocity.z *= 0.5;
        }
      }

      // Write attributes
      const o = write * 3;
      this.pos[o] = p.position.x;
      this.pos[o + 1] = p.position.y;
      this.pos[o + 2] = p.position.z;
      const fade = 1 - t;
      this.color[o] = p.color.r * (0.6 + 0.4 * fade);
      this.color[o + 1] = p.color.g * (0.6 + 0.4 * fade);
      this.color[o + 2] = p.color.b * (0.6 + 0.4 * fade);
      this.sizeAttr[write] = p.size;
      this.lifeAttr[write] = fade;
      this.kindAttr[write] = p.kind;
      write++;
    }

    this.activeCount = write;
    this.geometry.setDrawRange(0, write);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aKind as THREE.BufferAttribute).needsUpdate = true;
  }

  getParticleCount(): number {
    return this.particles.length + this.gpuBackend.maxParticles;
  }

  clear(): void {
    this.particles.length = 0;
    this.activeCount = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.gpuBackend.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
