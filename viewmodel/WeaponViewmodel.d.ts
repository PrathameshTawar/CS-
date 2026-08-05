/**
 * WeaponViewmodel.ts
 *
 * First-person weapon viewmodels. Every weapon category (rifle, smg, shotgun,
 * sniper, pistol) gets a distinct procedural model built from primitives —
 * receiver, barrel, handguard, magazine, stock, grip, optic — with textured
 * PBR materials (brushed metal / carbon / anodized / stippled rubber, all
 * painted on canvases at runtime), an emissive red-dot reticle on optics,
 * and a pose/animation state machine: hip-fire, ADS, sprint-relax (weapon
 * lowered + canted), idle sway, movement bob, recoil kick, and a full
 * inspect animation.
 *
 * Fully procedural — no external meshes or textures.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { WeaponCategory } from '../../gameplay/weapons/WeaponCatalog';
export interface ViewmodelPose {
    moving: boolean;
    sprinting: boolean;
    ads: boolean;
    horizontalSpeed: number;
}
export declare class WeaponViewmodel {
    private readonly root;
    private readonly recoilGroup;
    private readonly barrelTip;
    private ads;
    private recoil;
    private bobT;
    private swayX;
    private swayY;
    private inspectT;
    private reloadT;
    private reloadDuration;
    private equipT;
    private equipDuration;
    private jumpOffset;
    private jumpVelocity;
    private readonly materials;
    private readonly textures;
    private readonly muzzleLight;
    constructor(camera: THREE.PerspectiveCamera);
    /**
     * Apply custom Skuller skin color palette to weapon viewmodel materials.
     */
    setSkinPalette(palette: {
        body: number;
        dark: number;
        accent: number;
    }): void;
    /** Add a small emissive red-dot reticle at an optic lens. */
    private addReticle;
    /**
     * Rebuild the viewmodel for the given weapon category. Safe to call
     * repeatedly (disposes the previous build).
     */
    setWeapon(category: WeaponCategory): void;
    /** Muzzle tip in world space (for tracer origins + camera-local conversion). */
    getMuzzleWorld(out: THREE.Vector3): THREE.Vector3;
    getRoot(): THREE.Group;
    setADS(ads: boolean): void;
    /** Kick the viewmodel back on fire (magnitude 0..1). */
    triggerRecoil(magnitude: number): void;
    /** Play the inspect animation (out-and-back arc showing the weapon's side). */
    inspect(): void;
    /** Play a full procedural reload animation (4 stages: lower/cant, eject, insert, rack bolt). */
    reload(duration?: number): void;
    /** Play weapon equip / draw animation (swings up smoothly from lower-right). */
    equip(duration?: number): void;
    /** Trigger vertical viewmodel bounce when jumping or landing. */
    triggerJumpBounce(velocity: number): void;
    /**
     * Per-frame update: sway (from look deltas), bob (from movement), recoil
     * recovery, ADS/sprint pose lerp, and the inspect arc.
     */
    update(deltaTime: number, pose: ViewmodelPose, lookDelta: {
        x: number;
        y: number;
    }): void;
    dispose(): void;
}
//# sourceMappingURL=WeaponViewmodel.d.ts.map