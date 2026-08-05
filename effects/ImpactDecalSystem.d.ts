/**
 * ImpactDecalSystem.ts
 *
 * Persistent impact decals — bullet holes and scorch marks — that sit on
 * world surfaces. Decals are pooled oriented quads with a procedural radial
 * texture; the oldest decal is recycled when the pool is full, and every
 * decal fades out over its lifetime so the world doesn't accumulate clutter.
 *
 * Fully procedural — the bullet-hole texture is painted on a canvas.
 *
 * @module Rendering
 */
import * as THREE from 'three';
export declare class ImpactDecalSystem {
    private readonly group;
    private readonly decals;
    private readonly up;
    private readonly q;
    private readonly baseTex;
    private readonly bloodTex;
    private readonly bloodPoolTex;
    constructor(scene: THREE.Scene);
    /** Procedural radial bullet-hole texture (dark center + scorch halo). */
    private makeBulletHoleTexture;
    /** Procedural directional blood splatter decal texture. */
    private makeBloodSplatterTexture;
    /** Procedural floor blood pool decal texture. */
    private makeBloodPoolTexture;
    /** Spawn a bullet hole at the impact point, oriented along the normal. */
    spawnBulletHole(position: {
        x: number;
        y: number;
        z: number;
    }, normal: {
        x: number;
        y: number;
        z: number;
    }, scale?: number): void;
    /** Spawn a larger scorch mark (grenades / explosions). */
    spawnScorch(position: {
        x: number;
        y: number;
        z: number;
    }, radius?: number): void;
    /** Spawn a directional wall blood splatter decal along the impact normal. */
    spawnBloodSplatter(position: {
        x: number;
        y: number;
        z: number;
    }, normal: {
        x: number;
        y: number;
        z: number;
    }, scale?: number): void;
    /** Spawn an elliptical floor blood pool decal under killed enemies. */
    spawnBloodPool(position: {
        x: number;
        y: number;
        z: number;
    }, scale?: number): void;
    private next;
    update(deltaTime: number): void;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=ImpactDecalSystem.d.ts.map