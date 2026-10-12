/**
 * MuzzleFlash.ts
 *
 * Muzzle flash: a brief point light plus an additive billboard sprite
 * attached to the camera. Spawned on every weapon fire for immediate
 * visual feedback (Requirement 6.1).
 *
 * @module Rendering
 */

import * as THREE from 'three';

export class MuzzleFlash {
  private readonly light: THREE.PointLight;
  private readonly sprite: THREE.Sprite;
  private readonly spriteMat: THREE.SpriteMaterial;
  private readonly group: THREE.Group;
  private timer = 0;
  private duration = 0.05;

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();

    this.light = new THREE.PointLight(0xffd27a, 0, 8, 2);
    this.light.position.set(0, 0, -1.2);
    this.group.add(this.light);

    // Simple procedural muzzle flash texture (radial gradient)
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.4, 'rgba(255,200,80,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    this.spriteMat = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.sprite = new THREE.Sprite(this.spriteMat);
    this.sprite.position.set(0.15, -0.05, -1.1);
    this.sprite.scale.set(0.6, 0.6, 1);
    this.group.add(this.sprite);

    // Slight random rotation for variety
    this.sprite.material.rotation = Math.random() * Math.PI;

    camera.add(this.group);
    this.group.visible = false;
  }

  /**
   * Reposition the whole flash to a camera-local offset (viewmodel muzzle).
   */
  setOffset(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
  }

  trigger(sizeScale: number, intensity: number): void {
    this.timer = 0;
    this.duration = 0.05;
    this.group.visible = true;
    const scale = 0.4 * sizeScale;
    this.sprite.scale.set(scale, scale, 1);
    this.light.intensity = 25 * intensity;
  }

  update(deltaTime: number): void {
    if (!this.group.visible) return;
    this.timer += deltaTime;
    const t = this.timer / this.duration;
    if (t >= 1) {
      this.group.visible = false;
      this.light.intensity = 0;
      return;
    }
    const fade = 1 - t;
    this.light.intensity *= fade;
    this.spriteMat.opacity = fade;
  }

  dispose(): void {
    this.spriteMat.map?.dispose();
    this.spriteMat.dispose();
    this.light.dispose();
    this.group.removeFromParent();
  }
}
