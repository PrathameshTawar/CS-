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
export declare enum ParticleKind {
    Smoke = 0,
    Spark = 1,
    Blood = 2,
    Dust = 3,
    Shell = 4,
    Energy = 5,
    Wind = 6,
    Fire = 7,
    Rain = 8,
    /** Destruction debris — small tumbling fragments (Requirement 4.2). */
    Debris = 9
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
    position: {
        x: number;
        y: number;
        z: number;
    };
    direction?: {
        x: number;
        y: number;
        z: number;
    };
    spread?: number;
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
export declare class ParticleSystem {
    private readonly particles;
    private readonly points;
    private readonly geometry;
    private readonly material;
    private readonly scene;
    private readonly pos;
    private readonly color;
    private readonly sizeAttr;
    private readonly lifeAttr;
    private readonly kindAttr;
    private readonly gpuBackend;
    private activeCount;
    constructor(scene: THREE.Scene);
    /**
     * Emit a burst of particles.
     */
    emit(options: EmitterOptions): void;
    /**
     * Convenience emitters for common effects.
     */
    emitMuzzleFlash(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number): void;
    emitShellCasing(x: number, y: number, z: number, dirX: number, dirZ: number): void;
    emitImpact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: string): void;
    emitBlood(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number): void;
    emitExplosion(x: number, y: number, z: number): void;
    emitEnergyBurst(x: number, y: number, z: number): void;
    /**
     * Emit destruction debris fragments (Requirement 4.2).
     * Simulates small tumbling chunks with heavy gravity and a ground bounce.
     */
    emitDebris(x: number, y: number, z: number, nx: number, ny: number, nz: number, material: string, count?: number): void;
    emitSmoke(x: number, y: number, z: number, count?: number): void;
    emitSmokeCloud(x: number, y: number, z: number, radius: number, count?: number): void;
    /**
     * Storm rain field (R30.6, T3.5). Emits a spread of fast-falling rain
     * particles over a box around the given center. Call once per frame.
     * `intensity` scales the particle count (0..1).
     */
    emitRain(cx: number, cz: number, intensity?: number): void;
    /**
     * Per-frame simulation + attribute upload.
     */
    update(deltaTime: number): void;
    getParticleCount(): number;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=ParticleSystem.d.ts.map