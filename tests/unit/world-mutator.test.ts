/**
 * world-mutator.test.ts
 *
 * Unit tests for WorldMutator (R30.4-30.6, T3.4): night reduces sun
 * intensity and darkens fog/clear color; storm thickens fog and enables
 * rain + storm ambience; partial mutations preserve the other axis.
 */

import * as THREE from 'three';
import { Biome } from '../../src/gameplay/maps/MapGenerator';
import {
  WorldMutator,
  WorldMutatorTargets,
  Weather,
  TimeOfDay,
} from '../../src/modes/ai/WorldMutator';
import { VolumetricLightEffect } from '../../src/rendering/volumetric/VolumetricLightEffect';

/** In-memory target harness with spies for every mutator write. */
function makeHarness(initial?: { weather?: Weather; timeOfDay?: TimeOfDay }) {
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a3a, 0.7);
  const fog = new THREE.FogExp2(0x9aa5b1, 0.012);
  const clearColors: number[] = [];
  const rainCalls: { active: boolean; intensity: number }[] = [];
  const stormCalls: boolean[] = [];

  // Volumetric mock: every setter is a jest.fn() — write() calls all four.
  const volumetric = {
    setFogColor: jest.fn(),
    setFogDensity: jest.fn(),
    setIntensity: jest.fn(),
    setLightScreenPosition: jest.fn(),
  } as unknown as VolumetricLightEffect;

  const targets: WorldMutatorTargets = {
    sun: () => sun,
    hemi: () => hemi,
    fog: () => fog,
    volumetric: () => volumetric,
    renderer: () => ({ setClearColor: (c: number) => clearColors.push(c) }) as unknown as THREE.WebGLRenderer,
    setRain: (active, intensity) => rainCalls.push({ active, intensity }),
    setStorm: (active) => stormCalls.push(active),
  };
  return { mutator: new WorldMutator(targets, Biome.City, initial), sun, hemi, fog, clearColors, rainCalls, stormCalls };
}

function luminance(c: number): number {
  return new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 }).l;
}

describe('WorldMutator (R30.4-30.6)', () => {

  it('starts at the biome default day/clear when no initial state is given', () => {
    const h = makeHarness();
    expect(h.mutator.getState()).toEqual({ weather: 'clear', timeOfDay: 'day' });
    expect(h.sun.intensity).toBeCloseTo(4.2, 5);
    expect(h.rainCalls[h.rainCalls.length - 1].active).toBe(false);
    expect(h.stormCalls[h.stormCalls.length - 1]).toBe(false);
  });

  it('night reduces sun intensity, darkens fog and clear color (R30.5)', () => {
    const h = makeHarness();
    const daySun = h.sun.intensity;
    const dayFogLum = luminance(h.fog.color.getHex());
    const dayClearLum = luminance(h.clearColors[h.clearColors.length - 1]);

    h.mutator.apply({ timeOfDay: 'night' });

    expect(h.mutator.getState().timeOfDay).toBe('night');
    expect(h.sun.intensity).toBeLessThan(daySun);
    expect(luminance(h.fog.color.getHex())).toBeLessThan(dayFogLum);
    expect(luminance(h.clearColors[h.clearColors.length - 1])).toBeLessThan(dayClearLum);
  });

  it('storm thickens fog and enables rain + storm ambience (R30.6)', () => {
    const h = makeHarness();
    const clearFog = h.fog.density;

    h.mutator.apply({ weather: 'storm' });

    expect(h.fog.density).toBeGreaterThan(clearFog);
    const lastRain = h.rainCalls[h.rainCalls.length - 1];
    expect(lastRain.active).toBe(true);
    expect(lastRain.intensity).toBeGreaterThan(0);
    expect(h.stormCalls[h.stormCalls.length - 1]).toBe(true);
  });

  it('partial weather mutation preserves the current timeOfDay', () => {
    const h = makeHarness();
    h.mutator.apply({ timeOfDay: 'night' });

    h.mutator.apply({ weather: 'fog' });

    expect(h.mutator.getState()).toEqual({ weather: 'fog', timeOfDay: 'night' });
  });

  it('applyConfig sets both axes at once', () => {
    const h = makeHarness();
    h.mutator.applyConfig({ weather: 'snow', timeOfDay: 'dusk' });
    expect(h.mutator.getState()).toEqual({ weather: 'snow', timeOfDay: 'dusk' });
  });

  it('storm ambience stops when weather clears', () => {
    const h = makeHarness();
    h.mutator.apply({ weather: 'storm' });
    h.mutator.apply({ weather: 'clear' });
    expect(h.stormCalls[h.stormCalls.length - 1]).toBe(false);
    expect(h.rainCalls[h.rainCalls.length - 1].active).toBe(false);
  });

  it('fogDensity mutation overrides the computed density', () => {
    const h = makeHarness();
    h.mutator.apply({ weather: 'storm', fogDensity: 0.09 });
    expect(h.fog.density).toBeCloseTo(0.09, 5);
  });
});
