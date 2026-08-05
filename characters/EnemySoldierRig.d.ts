/**
 * EnemySoldierRig.ts
 *
 * Procedural soldier characters for enemy AI. Each class (scout, heavy,
 * sniper, engineer, medic) gets a distinct silhouette: helmet, torso armor,
 * backpack, class-specific weapon and emissive class accents. A simple
 * procedural walk cycle swings the legs/arms, a hit-flash whitens the
 * materials on damage, and death plays a short fall + dissolve.
 *
 * Fully procedural — no external meshes or textures.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { EnemyClassDef } from '../../ai/classes/EnemyClasses';
export interface SoldierPose {
    moving: boolean;
    speed: number;
    alive: boolean;
}
export declare class EnemySoldierRig {
    readonly group: THREE.Group;
    private readonly legL;
    private readonly legR;
    private readonly armL;
    private readonly armR;
    private readonly bodyMesh;
    private readonly materials;
    private readonly accentMat;
    private walkPhase;
    private flashT;
    private deathT;
    private dead;
    private readonly baseScale;
    private readonly dissolveUniforms;
    constructor(def: EnemyClassDef, scale?: number);
    private makeLeg;
    private makeArm;
    private buildWeapon;
    /** White hit-flash on all materials (decays over ~0.12s). */
    hitFlash(): void;
    /** Kill the soldier: play fall + sink, then hide. */
    setDead(): void;
    isDead(): boolean;
    /** Should the group be hidden yet (after the death animation)? */
    isHidden(): boolean;
    update(deltaTime: number, pose: SoldierPose): void;
    dispose(): void;
}
//# sourceMappingURL=EnemySoldierRig.d.ts.map