/**
 * KillEffectSystem.ts
 *
 * Handles visual and audio feedback for enemy kills (Requirement 7):
 * - Enemy mesh dissolve animation trigger (via EnemySoldierRig)
 * - Energy burst particle effect (500+ particles, R7.1, R7.3)
 * - Floating kill-confirmation icon rising and fading over 1.0s in 3D world space (R7.1)
 * - Headshot kill screen-edge flash, amplified camera shake, critical hit marker 3x size (R7.2, R7.4)
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { ParticleSystem } from '../particles/ParticleSystem';
import { CameraShake } from './CameraShake';
import { HUD } from '../../ui/hud/HUD';
export declare class KillEffectSystem {
    private readonly scene;
    private readonly particles;
    private readonly shake;
    private readonly hud;
    private readonly activeBadges;
    private readonly normalTex;
    private readonly headshotTex;
    constructor(scene: THREE.Scene, particles: ParticleSystem, shake: CameraShake, hud: HUD);
    /**
     * Trigger AAA kill visual feedback sequence at the enemy position.
     */
    onKill(position: THREE.Vector3, headshot: boolean): void;
    /**
     * Update floating badges (rise and fade over 1.0s).
     */
    update(deltaTime: number): void;
    dispose(): void;
}
//# sourceMappingURL=KillEffectSystem.d.ts.map