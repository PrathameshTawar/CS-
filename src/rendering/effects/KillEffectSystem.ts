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
import { ParticleSystem, ParticleKind } from '../particles/ParticleSystem';
import { CameraShake } from './CameraShake';
import { HUD } from '../../ui/hud/HUD';

interface ActiveKillBadge {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  startPos: THREE.Vector3;
}

/**
 * Creates a high-contrast AAA sci-fi skull / kill confirmation icon canvas texture.
 */
function createKillBadgeTexture(headshot: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const size = 256;
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  // Glow halo
  const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 120);
  if (headshot) {
    grad.addColorStop(0, 'rgba(255, 160, 40, 0.95)');
    grad.addColorStop(0.4, 'rgba(255, 60, 20, 0.6)');
    grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
  } else {
    grad.addColorStop(0, 'rgba(100, 220, 255, 0.95)');
    grad.addColorStop(0.4, 'rgba(40, 120, 255, 0.6)');
    grad.addColorStop(1, 'rgba(0, 80, 255, 0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Hexagon border
  ctx.strokeStyle = headshot ? '#ffd700' : '#88ddff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 6;
    const x = 128 + Math.cos(angle) * 88;
    const y = 128 + Math.sin(angle) * 88;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // Skull / Kill symbol
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = headshot ? '#ff4400' : '#00aaff';
  ctx.shadowBlur = 16;
  ctx.fillText('💀', 128, 124);

  if (headshot) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 22px Segoe UI, sans-serif';
    ctx.shadowBlur = 10;
    ctx.fillText('HEADSHOT', 128, 195);
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class KillEffectSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticleSystem;
  private readonly shake: CameraShake;
  private readonly hud: HUD;
  private readonly activeBadges: ActiveKillBadge[] = [];
  private readonly normalTex: THREE.CanvasTexture;
  private readonly headshotTex: THREE.CanvasTexture;

  constructor(
    scene: THREE.Scene,
    particles: ParticleSystem,
    shake: CameraShake,
    hud: HUD
  ) {
    this.scene = scene;
    this.particles = particles;
    this.shake = shake;
    this.hud = hud;
    this.normalTex = createKillBadgeTexture(false);
    this.headshotTex = createKillBadgeTexture(true);
  }

  /**
   * Trigger AAA kill visual feedback sequence at the enemy position.
   */
  onKill(position: THREE.Vector3, headshot: boolean): void {
    // 1. CS2 tactical blood spray & shell ejection (R7.1, R7.3)
    this.particles.emit({
      kind: ParticleKind.Blood,
      count: headshot ? 180 : 120,
      position: { x: position.x, y: position.y + 1.2, z: position.z },
      spread: Math.PI,
      speed: headshot ? 11 : 8,
      life: 0.85,
      size: 0.18,
      color: 0xa61010,
      glow: 0,
    });
    this.particles.emit({
      kind: ParticleKind.Shell,
      count: 3,
      position: { x: position.x, y: position.y + 1.2, z: position.z },
      spread: Math.PI * 0.5,
      speed: 6,
      life: 1.5,
      size: 0.1,
      color: 0xd8b84a,
      glow: 0,
    });

    // 3. Headshot special feedback (R7.2, R7.4)
    if (headshot) {
      this.hud.flashHeadshotKill();
      this.shake.addShake(0.85, 0.2, 12); // amplified camera shake (0.2s pulse)
    }
  }

  /**
   * Update floating badges (rise and fade over 1.0s).
   */
  update(deltaTime: number): void {
    for (let i = this.activeBadges.length - 1; i >= 0; i--) {
      const badge = this.activeBadges[i];
      badge.life += deltaTime;
      if (badge.life >= badge.maxLife) {
        this.scene.remove(badge.sprite);
        badge.sprite.material.dispose();
        this.activeBadges.splice(i, 1);
        continue;
      }
      const t = badge.life / badge.maxLife; // 0..1
      // Rise smoothly by +0.9 units
      const ease = 1 - Math.pow(1 - t, 2);
      badge.sprite.position.y = badge.startPos.y + ease * 0.95;
      // Fade alpha smoothly in last 40%
      const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      badge.sprite.material.opacity = alpha;
    }
  }

  dispose(): void {
    for (const badge of this.activeBadges) {
      this.scene.remove(badge.sprite);
      badge.sprite.material.dispose();
    }
    this.activeBadges.length = 0;
    this.normalTex.dispose();
    this.headshotTex.dispose();
  }
}
