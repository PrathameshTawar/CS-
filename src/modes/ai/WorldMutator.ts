/**
 * WorldMutator.ts
 *
 * In-place world mutation (Requirement 30.4-30.6, task T3.4).
 *
 * Applies weather / time-of-day changes to the LIVE scene by updating fog
 * color/density, sun + hemisphere light colors and intensities, the renderer
 * clear color, volumetric god-ray parameters, rain particles and storm
 * ambience — WITHOUT rebuilding the world or reloading the page.
 *
 * All targets are accessor functions so the mutator survives world rebuilds
 * (Game.ts recreates lights per map; the closures always read the current
 * handles).
 *
 * @module Modes
 */

import * as THREE from 'three';
import { MapGenerator, Biome } from '../../gameplay/maps/MapGenerator';
import type { VolumetricLightEffect } from '../../rendering/volumetric/VolumetricLightEffect';
import type { WorldConfig, WorldMutation } from '../GameMode';
import type { SkyDome } from '../../rendering/environment/SkyDome';

export type Weather = WorldConfig['weather'];
export type TimeOfDay = WorldConfig['timeOfDay'];

/** Minimal clear-color surface the mutator needs (satisfied by the app Renderer). */
export interface ClearColorTarget {
  setClearColor(color: number): void;
}

/** Live handles the mutator writes to (accessors survive rebuilds). */
export interface WorldMutatorTargets {
  sun: () => THREE.DirectionalLight | null;
  hemi: () => THREE.HemisphereLight | null;
  fog: () => THREE.FogExp2 | null;
  volumetric: () => VolumetricLightEffect | null;
  renderer: () => ClearColorTarget | null;
  setRain: (active: boolean, intensity: number) => void;
  setStorm: (active: boolean) => void;
  /** Optional procedural sky dome driven by the combined atmosphere. */
  sky?: () => SkyDome | null;
}

interface TimePreset {
  /** Sun intensity multiplier. */
  sunMul: number;
  /** Hemisphere intensity multiplier. */
  hemiMul: number;
  /** Fog density multiplier. */
  fogMul: number;
  /** Fog color luminance multiplier (night darkens the fog). */
  fogDark: number;
  /** Screen-space sun position for god rays. */
  lightPos: { x: number; y: number };
  /** Renderer clear color (behind the sky dome; invisible in normal play). */
  clearColor: number;
  /** Sky dome zenith — DEEP color at the top of the sky (not the pale clear). */
  skyZenith: number;
  /** Sky dome horizon — warm atmospheric haze band blending toward fog. */
  skyHorizon: number;
  /** Volumetric intensity multiplier. */
  volumetricMul: number;
}

const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  day: {
    sunMul: 1.0,
    hemiMul: 1.0,
    fogMul: 1.0,
    fogDark: 1.0,
    lightPos: { x: 0.75, y: 0.65 },
    clearColor: 0x2a76c8,
    skyZenith: 0x2a76c8,
    skyHorizon: 0xc9d6e3,
    volumetricMul: 1.2,
  },
  dusk: {
    sunMul: 0.55,
    hemiMul: 0.6,
    fogMul: 1.35,
    fogDark: 0.78,
    lightPos: { x: 0.3, y: 0.35 },
    clearColor: 0x3a3f6b,
    skyZenith: 0x2e3360,
    skyHorizon: 0xe8956a,
    volumetricMul: 0.95,
  },
  night: {
    sunMul: 0.16,
    hemiMul: 0.22,
    fogMul: 1.7,
    fogDark: 0.42,
    lightPos: { x: 0.12, y: 0.2 },
    clearColor: 0x070d1c,
    skyZenith: 0x0a1226,
    skyHorizon: 0x1a2438,
    volumetricMul: 0.55,
  },
};

interface WeatherPreset {
  /** Fog color tint. */
  fogColor: number;
  /** Fog density multiplier on top of the biome base. */
  fogMul: number;
  /** Sun color. */
  sunColor: number;
  /** Sun intensity multiplier. */
  sunMul: number;
  /** Hemisphere sky color. */
  hemiSky: number;
  /** Hemisphere ground color. */
  hemiGround: number;
  /** Rain particle intensity 0..1 (0 = none). */
  rain: number;
  /** Storm ambience on/off. */
  storm: boolean;
}

const WEATHER_PRESETS: Record<Weather, WeatherPreset> = {
  clear: {
    // Warm-light haze color so distance fog blends into the sky horizon.
    fogColor: 0xb9c7d5,
    fogMul: 1.0,
    sunColor: 0xfff2cc,
    sunMul: 1.0,
    hemiSky: 0x87ceeb,
    hemiGround: 0x3a3a3a,
    rain: 0,
    storm: false,
  },
  fog: {
    fogColor: 0x9aa3ad,
    fogMul: 2.6,
    sunColor: 0xcccccc,
    sunMul: 0.7,
    hemiSky: 0x8a929c,
    hemiGround: 0x3a3a3a,
    rain: 0,
    storm: false,
  },
  storm: {
    fogColor: 0x3c4350,
    fogMul: 3.2,
    sunColor: 0x6b7683,
    sunMul: 0.55,
    hemiSky: 0x4a5560,
    hemiGround: 0x20242a,
    rain: 1,
    storm: true,
  },
  snow: {
    fogColor: 0xd5dde5,
    fogMul: 1.8,
    sunColor: 0xeef6ff,
    sunMul: 0.85,
    hemiSky: 0xcfe4f2,
    hemiGround: 0x8a9aa8,
    rain: 0.6,
    storm: false,
  },
  ash: {
    fogColor: 0x6b6259,
    fogMul: 2.4,
    sunColor: 0xc9a483,
    sunMul: 0.7,
    hemiSky: 0x7a6a5c,
    hemiGround: 0x2e2a26,
    rain: 0.5,
    storm: false,
  },
};

/** Hex string ("#rrggbb") → number. */
function hexToNumber(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : 0xffffff;
}

/**
 * Applies weather + time-of-day to the live scene, in place.
 */
export class WorldMutator {
  private readonly biome: Biome;
  private readonly targets: WorldMutatorTargets;
  private weather: Weather = 'clear';
  private timeOfDay: TimeOfDay = 'day';

  constructor(targets: WorldMutatorTargets, biome: Biome, initial?: { weather?: Weather; timeOfDay?: TimeOfDay }) {
    this.targets = targets;
    this.biome = biome;
    if (initial?.weather) this.weather = initial.weather;
    if (initial?.timeOfDay) this.timeOfDay = initial.timeOfDay;
    this.applyConfig({ weather: this.weather, timeOfDay: this.timeOfDay });
  }

  getState(): { weather: Weather; timeOfDay: TimeOfDay } {
    return { weather: this.weather, timeOfDay: this.timeOfDay };
  }

  /** Apply a partial mutation (weather and/or timeOfDay and/or tunings). */
  apply(mutation: WorldMutation): void {
    if (mutation.weather) this.weather = mutation.weather;
    if (mutation.timeOfDay) this.timeOfDay = mutation.timeOfDay;
    this.write(mutation);
  }

  /** Apply a full weather + timeOfDay pair (e.g. from a generated WorldConfig). */
  applyConfig(config: { weather: Weather; timeOfDay: TimeOfDay }): void {
    this.weather = config.weather;
    this.timeOfDay = config.timeOfDay;
    this.write();
  }

  /** Compute the combined atmosphere and write it into the live scene. */
  private write(mutation?: WorldMutation): void {
    const w = WEATHER_PRESETS[this.weather];
    const t = TIME_PRESETS[this.timeOfDay];
    const palette = MapGenerator.getPalette(this.biome);

    const sun = this.targets.sun();
    const hemi = this.targets.hemi();
    const fog = this.targets.fog();
    const volumetric = this.targets.volumetric();
    const renderer = this.targets.renderer();

    // Fog color/density (R30.4) — night/dusk darken the fog tint (R30.5),
    // and mutation.fogDensity overrides the computed density.
    const fogColor = new THREE.Color(w.fogColor).multiplyScalar(t.fogDark);
    if (fog) {
      fog.color.copy(fogColor);
      fog.density = mutation?.fogDensity ?? palette.fogDensity * w.fogMul * t.fogMul;
    }

    // Sun: color + intensity scaled by weather and time of day (R30.5).
    // Base 4.2 (legacy units) keeps the sun clearly dominant over the
    // hemisphere — without real shadow maps the directional sun is the main
    // source of scene contrast (sunlit vs. away-facing surfaces).
    if (sun) {
      const sunColor = mutation?.sunColor ? hexToNumber(mutation.sunColor) : w.sunColor;
      sun.color.setHex(sunColor);
      sun.intensity = 4.2 * w.sunMul * t.sunMul;
    }

    // Hemisphere: sky/ground tint + intensity
    if (hemi) {
      hemi.color.setHex(mutation?.ambientColor ? hexToNumber(mutation.ambientColor) : w.hemiSky);
      hemi.groundColor.setHex(w.hemiGround);
      hemi.intensity = 1.15 * t.hemiMul;
    }

    // Renderer clear color (sky behind geometry)
    if (renderer) {
      renderer.setClearColor(mutation?.ambientColor ? hexToNumber(mutation.ambientColor) : t.clearColor);
    }

    // Volumetric god rays: retint + reposition + rescale (R30.5)
    if (volumetric) {
      volumetric.setFogColor(fogColor.getHex());
      volumetric.setFogDensity(palette.fogDensity * w.fogMul * t.fogMul * 0.4);
      volumetric.setIntensity(t.volumetricMul * w.sunMul);
      volumetric.setLightScreenPosition(t.lightPos.x, t.lightPos.y);
    }

    // Sky dome — drive the procedural sky from the combined atmosphere
    const sky = this.targets.sky?.();
    if (sky) {
      const cloudCover =
        this.weather === 'storm' ? 0.95 :
        this.weather === 'fog' ? 0.8 :
        this.weather === 'snow' ? 0.6 :
        this.weather === 'ash' ? 0.55 : 0.12;
      const starIntensity = this.timeOfDay === 'night' ? 1.0 : this.timeOfDay === 'dusk' ? 0.35 : 0.0;
      const sunDir = sun ? sun.position.clone().normalize() : undefined;
      // Horizon honors fogDark (dusk/night darken the fog tint) so the sky
      // meets the fog line without a bright seam (R30.5).
      const skyHorizon = new THREE.Color(t.skyHorizon).multiplyScalar(Math.max(t.fogDark, 0.32)).getHex();
      sky.setAtmosphere({
        // Dedicated sky palette — deep zenith, warm horizon (previously the
        // pale clear color washed the whole sky out). Horizon matches the
        // fog tint so the sky fades seamlessly into the fog line.
        zenith: t.skyZenith,
        horizon: skyHorizon,
        sunColor: w.sunColor,
        sunDirection: sunDir,
        cloudCover,
        sunIntensity: w.sunMul * t.sunMul,
        starIntensity,
      });
    }

    // Rain particles + storm ambience (R30.6)
    const rainIntensity = mutation?.rainIntensity ?? w.rain;
    this.targets.setRain(rainIntensity > 0, rainIntensity);
    this.targets.setStorm(w.storm);
  }
}
