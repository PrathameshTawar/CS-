/**
 * classic-mode.test.ts
 *
 * Unit tests for Mode 1 — CLASSIC (Requirements 26-27, T0.2/T0.6):
 * curated rotation coverage, ordered advance + wraparound, reset, fixed
 * objective, no adaptation commands, and MapGenerator determinism for every
 * rotation entry (R27.1).
 */

import { ClassicMode, CLASSIC_ROTATION } from '../../src/modes/classic/ClassicMode';
import { MapGenerator, Biome } from '../../src/gameplay/maps/MapGenerator';
import type { TelemetryFrame, WorldConfig } from '../../src/modes/GameMode';

const TELEMETRY: TelemetryFrame = {
  timestamp: 0,
  health: 100,
  maxHealth: 100,
  armor: 0,
  kills: 0,
  killStreak: 0,
  deaths: 0,
  shotsFired: 0,
  shotsHit: 0,
  missionProgress: 0,
  missionTarget: 0,
  moving: false,
  firing: false,
  secondsIdle: 0,
  lowHealthSeconds: 0,
};

const WORLD: WorldConfig = {
  seed: 1,
  biome: Biome.City,
  density: 0.5,
  weather: 'clear',
  timeOfDay: 'day',
  mood: 'test',
  buildings: 0,
  roads: 0,
  enemyCamps: 0,
  difficulty: 'normal',
  coverZones: 3,
  elevatedPositions: 1,
};

describe('ClassicMode', () => {
  it('covers all six biomes in the curated rotation', () => {
    const covered = new Set(CLASSIC_ROTATION.map((e) => e.biome));
    for (const biome of Object.values(Biome)) {
      expect(covered.has(biome)).toBe(true);
    }
  });

  it('returns rotation entries in order and wraps around', async () => {
    const mode = new ClassicMode('normal');
    for (let i = 0; i < CLASSIC_ROTATION.length; i++) {
      const wc = await mode.nextWorldConfig({ difficulty: 'normal' });
      expect(wc).toMatchObject(CLASSIC_ROTATION[i]);
      expect(mode.rotationIndex).toBe((i + 1) % CLASSIC_ROTATION.length);
    }
    // Wraparound: the entry after the last is the first again
    const wrapped = await mode.nextWorldConfig({ difficulty: 'normal' });
    expect(wrapped).toMatchObject(CLASSIC_ROTATION[0]);
  });

  it('reset() restarts the rotation from the first entry', async () => {
    const mode = new ClassicMode();
    await mode.nextWorldConfig({ difficulty: 'normal' });
    expect(mode.rotationIndex).toBe(1);
    mode.reset();
    expect(mode.rotationIndex).toBe(0);
    const wc = await mode.nextWorldConfig({ difficulty: 'normal' });
    expect(wc).toMatchObject(CLASSIC_ROTATION[0]);
  });

  it('carries the requested difficulty into the world config', async () => {
    const mode = new ClassicMode('normal');
    const wc = await mode.nextWorldConfig({ difficulty: 'hard' });
    expect(wc.difficulty).toBe('hard');
  });

  it('emits no adaptation commands (no Director in Classic)', () => {
    const mode = new ClassicMode();
    expect(mode.update(1 / 60, TELEMETRY)).toEqual([]);
  });

  it('returns a fixed elimination objective', async () => {
    const mode = new ClassicMode();
    const mission = await mode.nextMission(WORLD);
    expect(mission).not.toBeNull();
    expect(mission!.objectiveType).toBe('elimination');
    expect(mission!.briefing).toBe('Eliminate all hostiles.');
  });

  it('produces a deterministic world for every rotation entry (R27.1)', () => {
    const gen = new MapGenerator();
    for (const entry of CLASSIC_ROTATION) {
      const a = gen.generate({ seed: entry.seed, biome: entry.biome });
      const b = gen.generate({ seed: entry.seed, biome: entry.biome });
      expect(a.seed).toBe(entry.seed);
      expect(a.biome).toBe(entry.biome);
      expect(a.blocks.length).toBe(b.blocks.length);
      for (let i = 0; i < Math.min(a.blocks.length, 20); i++) {
        expect(a.blocks[i].x).toBe(b.blocks[i].x);
        expect(a.blocks[i].z).toBe(b.blocks[i].z);
      }
    }
  });
});
