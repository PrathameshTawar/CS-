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

const TEX = 512;
const ROUGH_TEX = 256;

/** Deterministic hash → [0,1). */
function hash01(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Fill a canvas with fine value-noise so metal grain reads at close range. */
function paintGrain(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: number,
  base: [number, number, number],
  amp: number
): void {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash01(Math.floor(x / 3), Math.floor(y / 3), seed);
      const n2 = hash01(Math.floor(x / 7) + 911, Math.floor(y / 7) + 411, seed + 51);
      const g = 1 - amp * (0.5 + 0.5 * n) + (n2 - 0.5) * 0.18;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(THREE.MathUtils.clamp(base[0] * g, 0, 255));
      img.data[i + 1] = Math.round(THREE.MathUtils.clamp(base[1] * g, 0, 255));
      img.data[i + 2] = Math.round(THREE.MathUtils.clamp(base[2] * g, 0, 255));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Brushed metal: fine grain + horizontal streak scratches. */
function makeBrushedMetal(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  paintGrain(ctx, TEX, seed, [168, 174, 182], 0.1);
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 160; i++) {
    const y = hash01(i * 7, 3, seed) * TEX;
    const x = hash01(i * 13, 11, seed) * TEX;
    const len = 40 + hash01(i, 17, seed) * 140;
    ctx.strokeStyle = hash01(i, 23, seed) > 0.5 ? '#ffffff' : '#0a0d12';
    ctx.lineWidth = 0.6 + hash01(i, 29, seed) * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (hash01(i, 31, seed) - 0.5) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Carbon fibre: diagonal weave grid + fine noise. */
function makeCarbon(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  paintGrain(ctx, TEX, 4242, [52, 56, 62], 0.12);
  ctx.strokeStyle = 'rgba(8,9,11,0.5)';
  ctx.lineWidth = 2;
  for (let i = -TEX; i < TEX * 2; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + TEX, TEX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, TEX);
    ctx.lineTo(i + TEX, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = -TEX; i < TEX * 2; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i + 9, 0);
    ctx.lineTo(i + 9 + TEX, TEX);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Anodized accent: brushed horizontal + faint blue/black tint variation. */
function makeAnodized(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  paintGrain(ctx, TEX, seed + 777, [120, 128, 140], 0.1);
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 90; i++) {
    const y = hash01(i * 3, 5, seed) * TEX;
    const x = hash01(i, 7, seed) * TEX;
    ctx.strokeStyle = hash01(i, 11, seed) > 0.5 ? '#e8eef5' : '#0b0e13';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 60 + hash01(i, 13, seed) * 120, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Stippled rubber grip: dark base + dense raised dots. */
function makeStippleRubber(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  paintGrain(ctx, TEX, 1919, [28, 30, 34], 0.16);
  for (let i = 0; i < 4200; i++) {
    const x = hash01(i, 1, 99) * TEX;
    const y = hash01(i, 2, 99) * TEX;
    ctx.fillStyle = hash01(i, 3, 99) > 0.5 ? 'rgba(78,84,92,0.5)' : 'rgba(8,9,11,0.6)';
    const s = 1.2 + hash01(i, 4, 99) * 2.2;
    ctx.fillRect(x, y, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared roughness map: metal ~0.2, rubber ~0.85 (grayscale luminance). */
function makeRoughnessMap(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = ROUGH_TEX;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(ROUGH_TEX, ROUGH_TEX);
  for (let y = 0; y < ROUGH_TEX; y++) {
    for (let x = 0; x < ROUGH_TEX; x++) {
      const n = hash01(x >> 2, y >> 2, 31337);
      const v = 40 + Math.round(n * 50);
      const i = (y * ROUGH_TEX + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Shared bump map: fine machined detail. */
function makeBumpMap(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = ROUGH_TEX;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(ROUGH_TEX, ROUGH_TEX);
  for (let y = 0; y < ROUGH_TEX; y++) {
    for (let x = 0; x < ROUGH_TEX; x++) {
      const n = hash01(x >> 1, y >> 1, 5150);
      const v = 124 + Math.round((n - 0.5) * 40);
      const i = (y * ROUGH_TEX + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

const BODY = new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: 0.88, roughness: 0.18 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x181a20, metalness: 0.92, roughness: 0.24 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0x474e5a, metalness: 0.95, roughness: 0.14 });
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.1, roughness: 0.9 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9ad4ff, metalness: 0.9, roughness: 0.05, emissive: 0x225577, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 });
/** Hot emissive red-dot reticle (linear >1 so ACES + bloom sell the glow).
 *  depthTest off + high renderOrder so the dot always reads on the optic. */
const RETICLE = new THREE.MeshBasicMaterial({
  color: new THREE.Color(6, 0.4, 0.35),
  depthWrite: false,
  depthTest: false,
});

/** Hip-fire default pose (right of view, angled slightly inward). */
const HIP_POS = new THREE.Vector3(0.34, -0.32, -0.62);
const HIP_ROT = new THREE.Euler(-0.04, 0.06, 0.04);
/** ADS pose — centered under the crosshair. */
const ADS_POS = new THREE.Vector3(0.0, -0.185, -0.46);
const ADS_ROT = new THREE.Euler(0, 0, 0);
/** Sprint-relax pose — weapon lowered and canted, muzzle forward. */
const SPRINT_POS = new THREE.Vector3(0.28, -0.4, -0.52);
const SPRINT_ROT = new THREE.Euler(0.12, 0.32, -0.48);

const INSPECT_DURATION = 1.4;

/**
 * Builds a box + cylinder part quickly.
 */
function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

export class WeaponViewmodel {
  private readonly root: THREE.Group;
  private readonly recoilGroup: THREE.Group;
  private readonly barrelTip: THREE.Object3D;
  private ads = false;
  private recoil = 0;
  private bobT = 0;
  private swayX = 0;
  private swayY = 0;
  private inspectT = 0;
  private reloadT = 0;
  private reloadDuration = 1.8;
  private equipT = 0;
  private equipDuration = 0.45;
  private jumpOffset = 0;
  private jumpVelocity = 0;
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly muzzleLight: THREE.PointLight;

  constructor(camera: THREE.PerspectiveCamera) {
    this.root = new THREE.Group();
    this.recoilGroup = new THREE.Group();
    this.barrelTip = new THREE.Object3D();
    this.root.add(this.recoilGroup);
    this.recoilGroup.add(this.barrelTip);
    this.muzzleLight = new THREE.PointLight(0xffaa22, 0, 8, 2);
    this.muzzleLight.position.set(0, 0, -0.6);
    this.barrelTip.add(this.muzzleLight);
    this.root.position.copy(HIP_POS);
    this.root.rotation.set(HIP_ROT.x, HIP_ROT.y, HIP_ROT.z);
    camera.add(this.root);

    // Procedural grip/metal textures (browser only — node/jest gets plain mats).
    if (typeof document !== 'undefined') {
      const bodyTex = makeBrushedMetal(101);
      const darkTex = makeCarbon();
      const accentTex = makeAnodized(202);
      const rubberTex = makeStippleRubber();
      const roughTex = makeRoughnessMap();
      const bumpTex = makeBumpMap();
      for (const [mat, map] of [
        [BODY, bodyTex],
        [DARK, darkTex],
        [ACCENT, accentTex],
        [RUBBER, rubberTex],
      ] as const) {
        mat.map = map;
        mat.bumpMap = bumpTex;
        mat.bumpScale = 0.25;
        mat.roughnessMap = roughTex;
        mat.needsUpdate = true;
      }
      this.textures.push(bodyTex, darkTex, accentTex, rubberTex, roughTex, bumpTex);
    }

    this.materials.push(BODY, DARK, ACCENT, RUBBER, GLASS, RETICLE);
  }

  /**
   * Apply custom Skuller skin color palette to weapon viewmodel materials.
   */
  setSkinPalette(palette: { body: number; dark: number; accent: number }): void {
    BODY.color.setHex(palette.body);
    DARK.color.setHex(palette.dark);
    ACCENT.color.setHex(palette.accent);
  }

  /** Add a small emissive red-dot reticle at an optic lens. */
  private addReticle(x: number, y: number, z: number, radius: number): void {
    // CircleGeometry already faces +Z (toward the camera); it must sit in
    // FRONT of the lens (more negative z) or the optic's own depth test
    // occludes it.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), RETICLE);
    disc.position.set(x, y, z);
    disc.renderOrder = 999;
    this.recoilGroup.add(disc);
  }

  /**
   * Rebuild the viewmodel for the given weapon category. Safe to call
   * repeatedly (disposes the previous build).
   */
  setWeapon(category: WeaponCategory): void {
    // Clear previous (barrelTip stays at index 0)
    while (this.recoilGroup.children.length > 1) {
      const child = this.recoilGroup.children[0];
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
      this.recoilGroup.remove(child);
    }
    this.inspectT = 0;

    // Shared box/cyl geometries (disposed with the rig on dispose()).
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r: number, h: number, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg);

    switch (category) {
      case WeaponCategory.Rifle: {
        // Receiver
        part(this.recoilGroup, box(0.07, 0.1, 0.34), BODY, 0, 0, 0);
        // Barrel + handguard
        part(this.recoilGroup, cyl(0.016, 0.34, 10), DARK, 0.008, 0.018, -0.3, Math.PI / 2, 0, 0);
        part(this.recoilGroup, cyl(0.026, 0.22, 10), ACCENT, 0.005, 0.015, -0.2, Math.PI / 2, 0, 0);
        // Stock
        part(this.recoilGroup, box(0.06, 0.1, 0.2), RUBBER, 0, 0, 0.25);
        part(this.recoilGroup, box(0.05, 0.09, 0.08), RUBBER, 0, -0.005, 0.38);
        // Magazine (curved-ish via two boxes)
        part(this.recoilGroup, box(0.045, 0.16, 0.08), ACCENT, 0, -0.11, 0.02, 0, 0.12, 0);
        part(this.recoilGroup, box(0.04, 0.08, 0.07), ACCENT, 0, -0.2, 0.05, 0, 0.2, 0);
        // Grip
        part(this.recoilGroup, box(0.045, 0.12, 0.06), RUBBER, 0, -0.08, 0.12, -0.18, 0, 0);
        // Handguard rail
        part(this.recoilGroup, box(0.03, 0.02, 0.24), ACCENT, 0.032, 0.015, -0.2);
        // Optic (red dot)
        part(this.recoilGroup, box(0.035, 0.045, 0.06), DARK, 0, 0.085, -0.06);
        part(this.recoilGroup, cyl(0.014, 0.02, 8), GLASS, 0, 0.09, -0.055, Math.PI / 2, 0, 0);
        this.addReticle(0, 0.085, -0.1, 0.011);
        // Muzzle brake
        part(this.recoilGroup, cyl(0.02, 0.05, 10), DARK, 0.008, 0.018, -0.46, Math.PI / 2, 0, 0);
        this.barrelTip.position.set(0.008, 0.018, -0.5);
        break;
      }
      case WeaponCategory.SMG: {
        part(this.recoilGroup, box(0.06, 0.09, 0.26), BODY, 0, 0, 0);
        part(this.recoilGroup, cyl(0.014, 0.2, 10), DARK, 0, 0.015, -0.26, Math.PI / 2, 0, 0);
        part(this.recoilGroup, box(0.045, 0.1, 0.09), ACCENT, 0, -0.06, -0.06);
        part(this.recoilGroup, box(0.04, 0.11, 0.07), ACCENT, 0, -0.07, 0.06, -0.15, 0, 0);
        part(this.recoilGroup, box(0.055, 0.085, 0.14), RUBBER, 0, 0, 0.2);
        part(this.recoilGroup, box(0.03, 0.02, 0.14), ACCENT, 0.03, 0.02, -0.14);
        // Slim reflex optic
        part(this.recoilGroup, box(0.03, 0.035, 0.05), DARK, 0, 0.07, -0.05);
        part(this.recoilGroup, cyl(0.011, 0.02, 8), GLASS, 0, 0.072, -0.048, Math.PI / 2, 0, 0);
        this.addReticle(0, 0.07, -0.082, 0.009);
        this.barrelTip.position.set(0, 0.015, -0.38);
        break;
      }
      case WeaponCategory.Shotgun: {
        part(this.recoilGroup, box(0.065, 0.1, 0.2), BODY, 0, 0, 0);
        // Long pump tube
        part(this.recoilGroup, cyl(0.024, 0.4, 10), DARK, 0, 0.012, -0.28, Math.PI / 2, 0, 0);
        part(this.recoilGroup, box(0.055, 0.05, 0.2), RUBBER, 0, -0.05, -0.24);
        part(this.recoilGroup, box(0.06, 0.1, 0.22), RUBBER, 0, 0, 0.24);
        part(this.recoilGroup, box(0.045, 0.1, 0.06), ACCENT, 0, -0.1, 0.02, -0.15, 0, 0);
        // Wide barrel vents
        part(this.recoilGroup, box(0.05, 0.045, 0.3), ACCENT, 0.03, 0.02, -0.18);
        this.barrelTip.position.set(0, 0.012, -0.5);
        break;
      }
      case WeaponCategory.Sniper: {
        part(this.recoilGroup, box(0.065, 0.1, 0.3), BODY, 0, 0, 0);
        part(this.recoilGroup, cyl(0.014, 0.55, 10), DARK, 0, 0.02, -0.42, Math.PI / 2, 0, 0);
        part(this.recoilGroup, box(0.05, 0.09, 0.18), RUBBER, 0, 0, 0.28);
        part(this.recoilGroup, box(0.045, 0.14, 0.08), ACCENT, 0, -0.08, -0.04);
        part(this.recoilGroup, box(0.045, 0.12, 0.07), RUBBER, 0, -0.08, 0.1, -0.2, 0, 0);
        // Long scope + mounts
        part(this.recoilGroup, cyl(0.02, 0.22, 12), DARK, 0, 0.11, -0.04, Math.PI / 2, 0, 0);
        part(this.recoilGroup, cyl(0.024, 0.05, 12), GLASS, 0, 0.12, -0.14, Math.PI / 2, 0, 0);
        this.addReticle(0, 0.112, -0.068, 0.01);
        part(this.recoilGroup, box(0.03, 0.02, 0.06), ACCENT, 0, 0.06, -0.06);
        part(this.recoilGroup, box(0.03, 0.02, 0.06), ACCENT, 0, 0.06, 0.02);
        this.barrelTip.position.set(0, 0.02, -0.72);
        break;
      }
      case WeaponCategory.Pistol: {
        // Desert Eagle style heavy metallic frame + slide serrations
        part(this.recoilGroup, box(0.048, 0.095, 0.20), BODY, 0, 0, 0);
        part(this.recoilGroup, box(0.045, 0.05, 0.12), DARK, 0, 0.02, -0.14);
        part(this.recoilGroup, box(0.052, 0.105, 0.065), RUBBER, 0, -0.08, 0.05, -0.22, 0, 0);
        part(this.recoilGroup, box(0.038, 0.09, 0.055), ACCENT, 0, -0.06, 0.0);
        part(this.recoilGroup, box(0.05, 0.035, 0.05), ACCENT, 0, 0.03, 0.05);
        this.barrelTip.position.set(0, 0.02, -0.24);
        break;
      }
    }

    // Reset pose
    this.ads = false;
    this.root.position.copy(HIP_POS);
    this.root.rotation.set(HIP_ROT.x, HIP_ROT.y, HIP_ROT.z);
  }

  /** Muzzle tip in world space (for tracer origins + camera-local conversion). */
  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.barrelTip.getWorldPosition(out);
  }

  getRoot(): THREE.Group {
    return this.root;
  }

  setADS(ads: boolean): void {
    this.ads = ads;
  }

  /** Kick the viewmodel back on fire (magnitude 0..1). */
  triggerRecoil(magnitude: number): void {
    this.recoil = Math.min(0.5, this.recoil + 0.11 + magnitude * 0.16);
    this.muzzleLight.intensity = 15;
  }

  /** Play the inspect animation (out-and-back arc showing the weapon's side). */
  inspect(): void {
    if (this.inspectT > 0 || this.reloadT > 0) return;
    this.inspectT = INSPECT_DURATION;
  }

  /** Play a full procedural reload animation (4 stages: lower/cant, eject, insert, rack bolt). */
  reload(duration = 1.8): void {
    if (this.reloadT > 0) return;
    this.reloadDuration = Math.max(0.4, duration);
    this.reloadT = this.reloadDuration;
    this.inspectT = 0; // cancel inspect
  }

  /** Play weapon equip / draw animation (swings up smoothly from lower-right). */
  equip(duration = 0.45): void {
    this.equipDuration = Math.max(0.2, duration);
    this.equipT = this.equipDuration;
    this.inspectT = 0;
    this.reloadT = 0;
  }

  /** Trigger vertical viewmodel bounce when jumping or landing. */
  triggerJumpBounce(velocity: number): void {
    this.jumpVelocity += velocity * 0.14;
  }

  /**
   * Per-frame update: sway (from look deltas), bob (from movement), recoil
   * recovery, ADS/sprint pose lerp, and the inspect arc.
   */
  update(deltaTime: number, pose: ViewmodelPose, lookDelta: { x: number; y: number }): void {
    if (this.muzzleLight.intensity > 0) {
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - deltaTime * 300);
    }
    const inspecting = this.inspectT > 0;

    // Sway from mouse movement (disabled while inspecting — the arc owns the pose)
    if (!inspecting) {
      this.swayX = THREE.MathUtils.lerp(this.swayX, -lookDelta.x * 0.0016, Math.min(1, deltaTime * 10));
      this.swayY = THREE.MathUtils.lerp(this.swayY, lookDelta.y * 0.0016, Math.min(1, deltaTime * 10));

      // Movement bob
      const speed = pose.horizontalSpeed;
      if (pose.moving && !pose.ads && !pose.sprinting && speed > 0.2) {
        const freq = 7;
        const amp = 0.016;
        this.bobT += deltaTime * freq;
        this.swayX += Math.sin(this.bobT) * amp;
        this.swayY += Math.cos(this.bobT * 2) * amp * 0.7;
      } else {
        // Breathing sway when idle
        this.bobT += deltaTime * 1.4;
        this.swayX += Math.sin(this.bobT * 0.6) * 0.002;
        this.swayY += Math.cos(this.bobT * 0.5) * 0.0016;
      }
    }

    // Recoil recovery
    this.recoil = Math.max(0, this.recoil - deltaTime * 3.2);

    // Base pose: sprint-relax > ADS > hip
    let targetPos: THREE.Vector3;
    let targetRot: THREE.Euler;
    let lerp: number;
    if (pose.sprinting && !pose.ads) {
      targetPos = SPRINT_POS;
      targetRot = SPRINT_ROT;
      lerp = Math.min(1, deltaTime * 8);
    } else if (this.ads) {
      targetPos = ADS_POS;
      targetRot = ADS_ROT;
      lerp = Math.min(1, deltaTime * 14);
    } else {
      targetPos = HIP_POS;
      targetRot = HIP_ROT;
      lerp = Math.min(1, deltaTime * 11);
    }

    this.root.position.x = THREE.MathUtils.lerp(this.root.position.x, targetPos.x + this.swayX, lerp);
    this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, targetPos.y + this.swayY - this.recoil * 0.045, lerp);
    this.root.position.z = THREE.MathUtils.lerp(this.root.position.z, targetPos.z + this.recoil * 0.16, lerp);
    this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, targetRot.x + this.swayY * 2 + this.recoil * 0.09, lerp);
    this.root.rotation.y = THREE.MathUtils.lerp(this.root.rotation.y, targetRot.y + this.swayX * 2, lerp);
    this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, targetRot.z - this.swayX * 1.5, lerp);

    // Jump / land bounce spring-damper
    this.jumpVelocity += (-this.jumpOffset * 220 - this.jumpVelocity * 16) * deltaTime;
    this.jumpOffset += this.jumpVelocity * deltaTime;
    this.root.position.y += this.jumpOffset;
    this.root.rotation.x -= this.jumpOffset * 1.5;

    // Equip / draw animation: smooth cubic swing up from lower right
    if (this.equipT > 0) {
      this.equipT = Math.max(0, this.equipT - deltaTime);
      const p = this.equipT / this.equipDuration; // 1 -> 0
      const ease = p * p * (3 - 2 * p);
      this.root.position.x += 0.32 * ease;
      this.root.position.y -= 0.42 * ease;
      this.root.rotation.z -= 0.52 * ease;
      this.root.rotation.x += 0.22 * ease;
    }

    // Procedural reload animation (4 stages: lower/cant -> eject -> insert click -> rack bolt)
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - deltaTime);
      const p = 1 - this.reloadT / this.reloadDuration; // 0 -> 1
      let dip = 0, cant = 0, pull = 0, bump = 0;
      if (p < 0.25) {
        const k = p / 0.25;
        dip = Math.sin(k * Math.PI * 0.5) * 0.22;
        cant = Math.sin(k * Math.PI * 0.5) * 0.45;
      } else if (p < 0.60) {
        const k = (p - 0.25) / 0.35;
        dip = 0.22 + Math.sin(k * Math.PI) * 0.14;
        cant = 0.45;
      } else if (p < 0.80) {
        const k = (p - 0.60) / 0.20;
        dip = 0.22 * (1 - k);
        cant = 0.45 * (1 - k);
        bump = Math.sin(k * Math.PI) * 0.05; // Magazine insertion click bump
      } else {
        const k = (p - 0.80) / 0.20;
        pull = Math.sin(k * Math.PI) * 0.12; // Racking charging handle / slide
      }
      this.root.position.y -= dip - bump;
      this.root.position.z += pull;
      this.root.rotation.z -= cant;
      this.root.rotation.x += dip * 0.5 + pull * 0.8 - bump * 2;
      this.root.rotation.y += cant * 0.3;
    }

    // Inspect arc: rise up-right, pull toward the camera, roll to show the side
    if (inspecting) {
      this.inspectT = Math.max(0, this.inspectT - deltaTime);
      const p = 1 - this.inspectT / INSPECT_DURATION; // 0..1
      const arc = Math.sin(p * Math.PI);              // 0 → 1 → 0
      const rise = Math.sin(Math.min(p * 1.6, 1) * Math.PI * 0.5); // lift early, hold
      const rot = Math.sin(Math.max(0, p - 0.12) * Math.PI);       // rotation lags the lift
      this.root.position.x += 0.26 * arc;
      this.root.position.y += 0.17 * rise;
      this.root.position.z += -0.34 * arc;
      this.root.rotation.x += 0.22 * arc;
      this.root.rotation.y += 0.95 * rot;
      this.root.rotation.z += -0.42 * rot;
    }
  }

  dispose(): void {
    this.muzzleLight.dispose();
    this.recoilGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
  }
}
