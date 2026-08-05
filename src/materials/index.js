// materials/index.js — the procedural PBR texture forge.
//
// Every surface is generated at load time from code: a heightfield drives a
// Sobel-derived normal map, albedo gets curvature-driven grime/wear, roughness
// varies, and metals get a metalness mask. Noise is periodic so everything
// tiles seamlessly. No image files, no CDN, no Math.random — hash-based noise
// seeded from the engine RNG keeps surfaces deterministic across runs.
//
// Channel layout (three's MeshStandardMaterial convention):
//   roughnessMap samples the GREEN channel, metalnessMap the BLUE channel.

import * as THREE from 'three';
import { hash2 } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Periodic (tileable) noise primitives over [0, 1)^2
// ---------------------------------------------------------------------------

function lattice(ix, iy, period, seed) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  return hash2(x, y, seed);
}

// Value noise, tileable over `period` lattice cells per unit.
function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = lattice(x0, y0, period, seed);
  const b = lattice(x0 + 1, y0, period, seed);
  const c = lattice(x0, y0 + 1, period, seed);
  const d = lattice(x0 + 1, y0 + 1, period, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Ridged multi-octave noise: sharp ridge lines (cracks, scratches).
function ridged(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = valueNoise(x * freq, y * freq, freq, seed + o * 137);
    n = 1 - Math.abs(2 * n - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Texture build helpers
// ---------------------------------------------------------------------------

function makeDataTexture(data, width, height, opts = {}) {
  const tex = new THREE.DataTexture(data, width, height);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = opts.anisotropy ?? 1;
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Sobel height -> tangent-space normal (RGBA, (n*0.5+0.5)*255).
function normalFromHeight(h, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const yp = (y - 1 + size) % size;
    const yn = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xp = (x - 1 + size) % size;
      const xn = (x + 1) % size;
      const hl = h[y * size + xp];
      const hr = h[y * size + xn];
      const hd = h[yp * size + x];
      const hu = h[yn * size + x];
      const dx = (hr - hl) * strength;
      const dy = (hd - hu) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((-dx * inv + 1) * 127.5);
      out[i + 1] = Math.round((-dy * inv + 1) * 127.5);
      out[i + 2] = Math.round(inv * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

// Mean curvature: positive = valley, negative = ridge.
function curvatureAt(h, size, x, y) {
  const yp = (y - 1 + size) % size;
  const yn = (y + 1) % size;
  const xp = (x - 1 + size) % size;
  const xn = (x + 1) % size;
  const c = h[y * size + x];
  return h[y * size + xp] + h[y * size + xn] + h[yp * size + x] + h[yn * size + x] - 4 * c;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function linstep(a, b, v) {
  return clamp01((v - a) / (b - a));
}

// ---------------------------------------------------------------------------
// Surface definitions
// ---------------------------------------------------------------------------
// Each surface implements (all take `seedOff` so the world seed varies them):
//   height(u, v, seedOff)            -> 0..1 heightfield
//   albedo(u, v, h, c, seedOff)      -> [r, g, b]
//   roughness(u, v, h, c, seedOff)   -> scalar
//   metal(u, v, c, seedOff)          -> scalar (0 or 1 mostly)
// Plus global params { heightRange, normalStrength, baseRough }.

const SURFACES = {
  concrete: {
    seed: 11,
    heightRange: 0.045,
    normalStrength: 3.2,
    baseRough: 0.92,
    height(u, v, s0) {
      const s = 0x15a0 + s0;
      let h = fbm(u, v, s, 5) * 0.55 + ridged(u, v, s + 7, 3) * 0.12;
      // formwork panel seams
      const px = Math.abs(((u * 4) % 1) - 0.5);
      const py = Math.abs(((v * 4) % 1) - 0.5);
      h += Math.pow(Math.max(px, py) - 0.47, 2) * 1.6;
      // sparse cracks
      const crackField = fbm(u + 5, v, s + 9, 2);
      h -= ridged(u * 3 + 0.31, v * 3, s + 31, 2) * (crackField > 0.62 ? 1 : 0) * 0.3;
      // pour-line stains
      h += (fbm(u, v, s + 13, 3) - 0.5) * 0.18;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x15a0 + s0;
      const stain = fbm(u * 2 + 1.7, v * 2, s + 21, 3);
      const wet = fbm(u * 5, v * 5, s + 33, 3) > 0.72 ? 1 : 0;
      let r = 0.42 + stain * 0.16;
      let g = 0.43 + stain * 0.15;
      let b = 0.45 + stain * 0.14;
      const wear = clamp01(-c * 6 + 0.5);
      const grime = clamp01(c * 5 + 0.2) * 0.55;
      r -= grime * 0.12;
      g -= grime * 0.1;
      b -= grime * 0.08;
      r += wear * 0.05;
      g += wear * 0.05;
      b += wear * 0.05;
      // rust streaks near the bottom
      const streak = Math.pow(clamp01(1 - v * 2.2), 2) * fbm(u, v, s + 41, 2);
      r += streak * 0.18;
      g -= streak * 0.05;
      b -= streak * 0.08;
      r *= 1 - wet * 0.3;
      g *= 1 - wet * 0.28;
      b *= 1 - wet * 0.24;
      return [r, g, b];
    },
    roughness(u, v, h, c, s0) {
      const s = 0x15a0 + s0;
      return clamp01(0.88 + fbm(u * 6, v * 6, s + 55, 3) * 0.1 + clamp01(c * 2) * 0.06);
    },
    metal() {
      return 0;
    },
  },

  asphalt: {
    seed: 22,
    heightRange: 0.03,
    normalStrength: 4.0,
    baseRough: 0.9,
    height(u, v, s0) {
      const s = 0x2b2 + s0;
      let h = fbm(u * 2, v * 2, s, 5) * 0.6 + ridged(u * 3, v * 3, s + 5, 2) * 0.4;
      h += (fbm(u * 4 + 9, v * 4, s + 17, 3) - 0.55) * 0.25;
      const crackField = fbm(u + 3, v + 3, s + 11, 2);
      h -= ridged(u * 2.5 + 0.7, v * 2.5, s + 29, 2) * (crackField > 0.6 ? 1 : 0) * 0.6;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x2b2 + s0;
      const patch = fbm(u * 4 + 9, v * 4, s + 17, 3);
      const r = 0.115 + fbm(u * 7, v * 7, s + 37, 3) * 0.05;
      let g = 0.115 + fbm(u * 7 + 1, v * 7, s + 43, 3) * 0.05;
      let b = 0.125 + fbm(u * 7 + 2, v * 7, s + 47, 3) * 0.05;
      const tar = clamp01(patch - 0.62) * 1.2;
      g *= 1 - tar;
      b *= 1 - tar;
      const light = clamp01(fbm(u * 32, v * 32, s + 53, 2) - 0.82) * 0.9;
      return [clamp01(r + light * 0.22), clamp01(g + light * 0.2), clamp01(b + light * 0.18)];
    },
    roughness(u, v, h, c, s0) {
      const s = 0x2b2 + s0;
      const tar = clamp01(fbm(u * 4 + 9, v * 4, s + 17, 3) - 0.62) * 1.2;
      return clamp01(0.78 + fbm(u * 9, v * 9, s + 59, 3) * 0.14 + tar * 0.14);
    },
    metal() {
      return 0;
    },
  },

  brick: {
    seed: 33,
    heightRange: 0.05,
    normalStrength: 3.6,
    baseRough: 0.8,
    height(u, v, s0) {
      const s = 0x3b3 + s0;
      const row = Math.floor(v * 8);
      const off = row % 2 === 0 ? 0 : 0.5;
      const bx = Math.abs(((u * 4 + off) % 1) - 0.5);
      const by = Math.abs(((v * 8) % 1) - 0.5);
      let h = fbm(u, v, s, 3) * 0.35;
      const mortar = Math.max(bx, by);
      h -= Math.pow(clamp01(1 - mortar * 7), 2) * 0.85;
      h += valueNoise(u * 4 + off, v * 8, 4, s + 19) * 0.3;
      h -= ridged(u * 6, v * 6, s + 31, 2) * 0.2;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x3b3 + s0;
      const row = Math.floor(v * 8);
      const off = row % 2 === 0 ? 0 : 0.5;
      const bx = Math.abs(((u * 4 + off) % 1) - 0.5);
      const by = Math.abs(((v * 8) % 1) - 0.5);
      const mortar = Math.max(bx, by);
      const brick = mortar > 0.5 - 0.0625 ? 0 : 1;
      const brickTone = valueNoise(u * 4 + off, v * 8, 4, s + 41);
      let r = 0.62;
      let g = 0.38;
      let b = 0.3;
      r += brickTone * 0.28 - 0.1;
      g += brickTone * 0.1;
      b += brickTone * 0.06;
      const smoke = fbm(u, v, s + 53, 3);
      const smokeAmt = 1 - smoke * 0.35 * (1 - v * 2);
      r *= smokeAmt;
      g *= smokeAmt * (1 - smoke * 0.05);
      b *= smokeAmt * (1 - smoke * 0.07);
      const grime = clamp01(c * 3 + 0.3) * 0.5;
      r -= grime * 0.18;
      g -= grime * 0.16;
      b -= grime * 0.14;
      if (brick === 0) {
        r = 0.62 + fbm(u, v, s + 61, 3) * 0.08;
        g = 0.6 + fbm(u, v, s + 67, 3) * 0.08;
        b = 0.58 + fbm(u, v, s + 71, 3) * 0.08;
      }
      return [clamp01(r), clamp01(g), clamp01(b)];
    },
    roughness(u, v, h, c, s0) {
      return clamp01(0.74 + fbm(u * 5, v * 5, 0x3b3 + 79 + s0, 3) * 0.12 + clamp01(c * 2) * 0.08);
    },
    metal() {
      return 0;
    },
  },

  plaster: {
    seed: 44,
    heightRange: 0.03,
    normalStrength: 2.4,
    baseRough: 0.62,
    height(u, v, s0) {
      const s = 0x4b4 + s0;
      let h = fbm(u * 1.4, v * 1.4, s, 5) * 0.5;
      h += (valueNoise(u * 1.1 + 2, v * 1.1, 1, s + 9) - 0.5) * 0.4;
      const crackField = fbm(u + 7, v, s + 13, 2);
      h -= ridged(u * 4 + 0.5, v * 4, s + 21, 2) * (crackField > 0.68 ? 1 : 0) * 0.18;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x4b4 + s0;
      const mottle = fbm(u * 3 + 1, v * 3, s + 33, 4);
      let r = 0.78 + (mottle - 0.5) * 0.16;
      let g = 0.75 + (mottle - 0.5) * 0.16;
      let b = 0.7 + (mottle - 0.5) * 0.16;
      const stain = Math.pow(clamp01(v * 1.7), 2.2) * fbm(u * 2 + 4, v, s + 47, 3);
      r -= stain * 0.22;
      g -= stain * 0.18;
      b -= stain * 0.14;
      const grime = clamp01(c * 4 + 0.25) * 0.45;
      r -= grime * 0.1;
      g -= grime * 0.09;
      b -= grime * 0.08;
      return [clamp01(r), clamp01(g), clamp01(b)];
    },
    roughness(u, v, h, c, s0) {
      return clamp01(0.5 + fbm(u * 5, v * 5, 0x4b4 + 59 + s0, 3) * 0.22 + clamp01(c * 2) * 0.12);
    },
    metal() {
      return 0;
    },
  },

  paintedMetal: {
    seed: 55,
    heightRange: 0.035,
    normalStrength: 3.4,
    baseRough: 0.42,
    height(u, v, s0) {
      const s = 0x5b5 + s0;
      let h = fbm(u * 3, v * 3, s, 3) * 0.25;
      const px = Math.abs(((u * 3) % 1) - 0.5);
      const py = Math.abs(((v * 2) % 1) - 0.5);
      h += Math.pow(Math.max(px, py) - 0.47, 2) * 1.2;
      h += (fbm(u * 6 + 3, v * 6, s + 17, 3) - 0.5) * 0.5;
      h += ridged(u * 8, v * 8, s + 31, 2) * 0.3;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x5b5 + s0;
      const base = 0.42; // paint tint multiplier applied by the caller via opts.tint
      const paint = fbm(u * 4, v * 4, s + 43, 3);
      let r = base * (0.85 + paint * 0.25);
      let g = base * (0.85 + paint * 0.25);
      let b = base * (0.85 + paint * 0.25);
      const scratch = ridged(u * 8, v * 8, s + 31, 2) > 0.72 ? 1 : 0;
      r += scratch * 0.35;
      g += scratch * 0.34;
      b += scratch * 0.32;
      const wear = clamp01(-c * 8 + 0.6);
      r += wear * 0.12;
      g += wear * 0.11;
      b += wear * 0.1;
      return [clamp01(r), clamp01(g), clamp01(b)];
    },
    roughness(u, v, h, c, s0) {
      const s = 0x5b5 + s0;
      const scratch = ridged(u * 8, v * 8, s + 31, 2) > 0.72 ? 1 : 0;
      return clamp01(0.34 + fbm(u * 6, v * 6, s + 53, 3) * 0.16 + scratch * 0.3 + clamp01(c * 3) * 0.1);
    },
    metal(u, v, c, s0) {
      const s = 0x5b5 + s0;
      const scratch = ridged(u * 8, v * 8, s + 31, 2) > 0.72 ? 1 : 0;
      return clamp01(scratch * 0.9 + clamp01(-c * 6) * 0.35);
    },
  },

  rustedMetal: {
    seed: 66,
    heightRange: 0.05,
    normalStrength: 4.0,
    baseRough: 0.68,
    height(u, v, s0) {
      const s = 0x6b6 + s0;
      let h = fbm(u * 3, v * 3, s, 4) * 0.5;
      h += (valueNoise(u * 2 + 1, v * 2, 2, s + 9) - 0.5) * 0.35;
      h += ridged(u * 5, v * 5, s + 19, 2) * 0.3;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x6b6 + s0;
      const rust = clamp01(fbm(u * 3, v * 3, s + 31, 4) - 0.42) * 1.6;
      let r = 0.28 + rust * 0.32;
      let g = 0.26 + rust * 0.1;
      let b = 0.24 - rust * 0.06;
      const grime = clamp01(c * 3 + 0.3) * 0.5;
      r -= grime * 0.16;
      g -= grime * 0.14;
      b -= grime * 0.12;
      return [clamp01(r), clamp01(g), clamp01(b)];
    },
    roughness(u, v, h, c, s0) {
      const s = 0x6b6 + s0;
      const rust = clamp01(fbm(u * 3, v * 3, s + 31, 4) - 0.42) * 1.6;
      return clamp01(0.4 + fbm(u * 7, v * 7, s + 41, 3) * 0.2 + rust * 0.45);
    },
    metal(u, v, c, s0) {
      const s = 0x6b6 + s0;
      const rust = clamp01(fbm(u * 3, v * 3, s + 31, 4) - 0.42) * 1.6;
      return clamp01(0.95 - rust * 0.9);
    },
  },

  wood: {
    seed: 77,
    heightRange: 0.06,
    normalStrength: 3.0,
    baseRough: 0.55,
    height(u, v, s0) {
      const s = 0x7b7 + s0;
      let h = 0;
      const plank = Math.abs(((v * 6) % 1) - 0.5);
      h -= Math.pow(clamp01(1 - plank * 12), 2) * 0.5;
      const grain = fbm(u * 8, v * 3 + Math.sin(u * 22) * 0.15, s, 4);
      h += (grain - 0.5) * 0.5;
      const kx = fbm(u * 3, v * 3, s + 11, 2);
      h += Math.pow(clamp01(1 - Math.abs(kx - 0.5) * 6), 3) * (fbm(u * 3 + 5, v * 3, s + 17, 2) > 0.6 ? 0.5 : 0);
      h -= ridged(u * 6, v * 6, s + 23, 2) * 0.2;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x7b7 + s0;
      const grain = fbm(u * 8, v * 3 + Math.sin(u * 22) * 0.15, s, 4);
      let r = 0.52 + (grain - 0.5) * 0.22;
      let g = 0.38 + (grain - 0.5) * 0.14;
      let b = 0.26 + (grain - 0.5) * 0.08;
      const grime = clamp01(c * 4 + 0.3) * 0.5;
      r -= grime * 0.2;
      g -= grime * 0.16;
      b -= grime * 0.12;
      const wear = clamp01(-c * 5 + 0.5);
      r += wear * 0.08;
      g += wear * 0.07;
      b += wear * 0.05;
      return [clamp01(r), clamp01(g), clamp01(b)];
    },
    roughness(u, v, h, c, s0) {
      const s = 0x7b7 + s0;
      const grain = fbm(u * 8, v * 3 + Math.sin(u * 22) * 0.15, s, 4);
      return clamp01(0.4 + grain * 0.35 + clamp01(c * 2) * 0.15);
    },
    metal() {
      return 0;
    },
  },

  sand: {
    seed: 88,
    heightRange: 0.02,
    normalStrength: 5.0,
    baseRough: 1.0,
    height(u, v, s0) {
      const s = 0x8b8 + s0;
      let h = fbm(u * 2, v * 2, s, 5) * 0.4;
      h += Math.sin((u * 47 + fbm(u, v, s + 7, 2) * 3) * Math.PI * 2) * 0.06;
      return h;
    },
    albedo(u, v, h, c, s0) {
      const s = 0x8b8 + s0;
      const mottle = fbm(u * 6, v * 6, s + 13, 4);
      const r = 0.68 + mottle * 0.14;
      const g = 0.6 + mottle * 0.12;
      const b = 0.46 + mottle * 0.08;
      const grime = clamp01(c * 3 + 0.3) * 0.3;
      return [clamp01(r - grime * 0.1), clamp01(g - grime * 0.08), clamp01(b - grime * 0.06)];
    },
    roughness() {
      return 1;
    },
    metal() {
      return 0;
    },
  },

  glass: {
    seed: 99,
    heightRange: 0.004,
    normalStrength: 1.6,
    baseRough: 0.05,
    height(u, v, s0) {
      const s = 0x9b9 + s0;
      return fbm(u * 4, v * 4, s, 4) * 0.4 + Math.sin(u * 31) * 0.02;
    },
    albedo() {
      return [0.04, 0.05, 0.06];
    },
    roughness(u, v, h, c, s0) {
      return clamp01(0.04 + fbm(u * 8, v * 8, 0x9b9 + 11 + s0, 3) * 0.08);
    },
    metal() {
      return 0;
    },
  },

  fabric: {
    seed: 110,
    heightRange: 0.02,
    normalStrength: 2.2,
    baseRough: 0.92,
    height(u, v, s0) {
      const s = 0xa10 + s0;
      return Math.sin(u * 96) * Math.sin(v * 96) * 0.12 + fbm(u * 6, v * 6, s, 3) * 0.4;
    },
    albedo(u, v, h, c, s0) {
      const s = 0xa10 + s0;
      const mottle = fbm(u * 5, v * 5, s + 17, 3);
      const grime = clamp01(c * 3 + 0.3) * 0.4;
      // neutral base so the caller's tint multiplies cleanly
      const base = 0.8 + mottle * 0.2 - grime * 0.2;
      return [clamp01(base), clamp01(base), clamp01(base)];
    },
    roughness() {
      return 0.95;
    },
    metal() {
      return 0;
    },
  },

  soil: {
    seed: 121,
    heightRange: 0.04,
    normalStrength: 3.6,
    baseRough: 0.98,
    height(u, v, s0) {
      const s = 0xb21 + s0;
      return fbm(u * 3, v * 3, s, 5) * 0.6 + ridged(u * 4, v * 4, s + 7, 2) * 0.3;
    },
    albedo(u, v, h, c, s0) {
      const s = 0xb21 + s0;
      const mottle = fbm(u * 5, v * 5, s + 13, 4);
      const grime = clamp01(c * 3 + 0.3);
      return [
        clamp01(0.2 + mottle * 0.12 - grime * 0.08),
        clamp01(0.15 + mottle * 0.08 - grime * 0.06),
        clamp01(0.11 + mottle * 0.05 - grime * 0.04),
      ];
    },
    roughness() {
      return 0.98;
    },
    metal() {
      return 0;
    },
  },
};

// ---------------------------------------------------------------------------
// The forge
// ---------------------------------------------------------------------------

const SIZES = { wall: 1024, ground: 2048 };

export class MaterialsSystem {
  static id = 'materials';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork(0x0bad5eed);
    this._sets = new Map(); // "name:repeat:variant:size" -> texture set
    this._mats = new Map(); // "name:optsKey" -> material
    this._anisotropy = 1;
    const render = ctx.peek('render');
    if (render && render.renderer) {
      this._anisotropy = Math.min(render.renderer.capabilities.getMaxAnisotropy(), 8);
    }
  }

  // Builds (or fetches) the texture set for a surface at a given repeat.
  surface(name, repeat = 1, variant = 0, size = SIZES.wall) {
    const key = `${name}:${repeat}:${variant}:${size}`;
    const cached = this._sets.get(key);
    if (cached) return cached;
    const spec = SURFACES[name];
    if (!spec) throw new Error(`materials: unknown surface '${name}'`);
    const rng = this.rng.fork((hashStr(name) ^ (variant * 7919)) >>> 0);
    const seedOff = rng.nextUint32() >>> 0;
    const h = buildHeightField(spec, size, seedOff);
    const set = {
      spec,
      map: makeDataTexture(h.albedo, size, size, { srgb: true, anisotropy: this._anisotropy }),
      normalMap: makeDataTexture(h.normal, size, size, { anisotropy: this._anisotropy }),
      roughnessMap: makeDataTexture(h.roughness, size, size, { anisotropy: this._anisotropy }),
      metalnessMap: makeDataTexture(h.metalness, size, size, { anisotropy: this._anisotropy }),
    };
    for (const tex of [set.map, set.normalMap, set.roughnessMap, set.metalnessMap]) {
      tex.repeat.set(repeat, repeat);
    }
    this._sets.set(key, set);
    return set;
  }

  // Returns a cached MeshStandardMaterial for a surface + options.
  make(name, opts = {}) {
    const optsKey = JSON.stringify(opts);
    const key = `${name}:${optsKey}`;
    const cached = this._mats.get(key);
    if (cached) return cached;
    const repeat = opts.repeat ?? 1;
    const variant = opts.variant ?? 0;
    const size = opts.size ?? (repeat >= 4 ? SIZES.ground : SIZES.wall);
    const set = this.surface(name, repeat, variant, size);
    const spec = set.spec;

    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(spec.normalStrength * 0.3, spec.normalStrength * 0.3),
      roughnessMap: set.roughnessMap,
      roughness: spec.baseRough,
      // metalness map does all the work: three multiplies metalness * map.
      metalnessMap: set.metalnessMap,
      metalness: 1,
      color: opts.tint ? new THREE.Color(opts.tint) : new THREE.Color(1, 1, 1),
      envMapIntensity: opts.env ?? 1,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0, 0, 0),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    this._mats.set(key, mat);
    return mat;
  }

  makeGlass(opts = {}) {
    const key = 'glass:' + JSON.stringify(opts);
    if (this._mats.has(key)) return this._mats.get(key);
    const set = this.surface('glass', opts.repeat ?? 1);
    const mat = new THREE.MeshPhysicalMaterial({
      color: opts.tint ? new THREE.Color(opts.tint) : new THREE.Color(0.72, 0.82, 0.9),
      transparent: true,
      opacity: opts.opacity ?? 0.28,
      roughness: 0.06,
      metalness: 0,
      envMapIntensity: opts.env ?? 1.6,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      side: opts.side ?? THREE.DoubleSide,
    });
    this._mats.set(key, mat);
    return mat;
  }

  prewarmMaterials(ctx) {
    for (const name of Object.keys(SURFACES)) {
      this.surface(name, 1, 0, SIZES.wall);
    }
    this.surface('asphalt', 5, 0, SIZES.ground);
  }

  dispose() {
    for (const set of this._sets.values()) {
      for (const tex of [set.map, set.normalMap, set.roughnessMap, set.metalnessMap]) {
        if (tex) tex.dispose();
      }
    }
    for (const mat of this._mats.values()) mat.dispose();
    this._sets.clear();
    this._mats.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildHeightField(spec, size, seedOff) {
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4); // value in GREEN (three's roughnessMap)
  const metalness = new Uint8Array(size * size * 4); // value in BLUE (three's metalnessMap)

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      h[y * size + x] = spec.height(u, v, seedOff);
    }
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const hv = h[i];
      const c = curvatureAt(h, size, x, y);
      const alb = spec.albedo(u, v, hv, c, seedOff);
      const rgh = spec.roughness(u, v, hv, c, seedOff);
      const met = spec.metal(u, v, c, seedOff);
      const a = i * 4;
      albedo[a] = Math.round(clamp01(alb[0]) * 255);
      albedo[a + 1] = Math.round(clamp01(alb[1]) * 255);
      albedo[a + 2] = Math.round(clamp01(alb[2]) * 255);
      albedo[a + 3] = 255;
      roughness[a + 1] = Math.round(clamp01(rgh) * 255);
      roughness[a + 3] = 255;
      metalness[a + 2] = Math.round(clamp01(met) * 255);
      metalness[a + 3] = 255;
    }
  }

  // normals need the whole heightfield
  const nrm = normalFromHeight(h, size, spec.normalStrength);
  normal.set(nrm);

  return { height: h, albedo, normal, roughness, metalness };
}
