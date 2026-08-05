/**
 * GPUComputeParticleBackend.ts
 *
 * High-performance GPGPU / SIMD-accelerated 100,000 particle simulation backend
 * for AAA visual effects (Requirement 5).
 *
 * Features:
 * - 100,000 simultaneous particle capacity (R5.1)
 * - O(1) ring buffer allocation / recycling with zero GC pauses (R5.5)
 * - Simulates gravity, aerodynamic drag, 3D turbulence noise, and ground-plane
 *   collision with bounce damping (R5.2)
 * - Custom ShaderMaterial with soft-particle point sprite rendering and emissive
 *   glow bloom (R5.4)
 *
 * @module Rendering
 */
import * as THREE from 'three';
export interface BackendEmitOptions {
    kind: number;
    count: number;
    position: {
        x: number;
        y: number;
        z: number;
    };
    velocity?: {
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
    color?: number | THREE.Color;
    colorVariance?: number;
    gravity?: number;
    drag?: number;
    glow?: number;
    bounce?: number;
}
export declare class GPUComputeParticleBackend {
    readonly maxParticles = 100000;
    readonly points: THREE.Points;
    private readonly posLife;
    private readonly velMaxLife;
    private readonly params;
    private readonly colorGlow;
    private readonly sizeArr;
    private readonly posLifeAttr;
    private readonly colorGlowAttr;
    private readonly sizeAttr;
    private head;
    private activeCount;
    constructor(scene: THREE.Scene);
    /**
     * O(1) particle emission via ring buffer (R5.5).
     * Allocates particles without triggering JavaScript garbage collection.
     */
    emit(options: BackendEmitOptions): void;
    /**
     * Evaluates aerodynamic drag, gravity, turbulence noise, and ground collision
     * with bounce damping (R5.2).
     */
    update(deltaTime: number): void;
    dispose(): void;
}
//# sourceMappingURL=GPUComputeParticleBackend.d.ts.map