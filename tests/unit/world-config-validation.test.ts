/**
 * world-config-validation.test.ts
 *
 * Unit tests for the prompt-to-world schema (R30.1) and keyword
 * interpretation fallback (R30.3, T3.1/T3.3): validateWorldConfig accepts
 * valid configs and rejects malformed ones; interpretWorldPrompt maps
 * biome/weather/time/difficulty words to the nearest config; the same
 * prompt always yields the same seed.
 */

import {
  validateWorldConfig,
  interpretWorldPrompt,
  hashPrompt,
  WorldContentPayload,
} from '../../src/engine/content/ContentSchemas';

const VALID: WorldContentPayload = {
  seed: 424242,
  biome: 'snow',
  density: 0.6,
  weather: 'storm',
  timeOfDay: 'night',
  mood: 'abandoned military',
  buildings: 12,
  roads: 4,
  enemyCamps: 2,
  difficulty: 'hard',
  coverZones: 8,
  elevatedPositions: 3,
};

describe('validateWorldConfig (R30.1)', () => {
  it('accepts a fully valid config', () => {
    expect(validateWorldConfig(VALID)).toBeNull();
  });

  it('accepts the minimal keyword-generated config', () => {
    const p = interpretWorldPrompt('desert');
    expect(validateWorldConfig(p)).toBeNull();
  });

  it('rejects an unknown biome', () => {
    expect(validateWorldConfig({ ...VALID, biome: 'moon' })).toContain('biome');
  });

  it('rejects an unknown weather', () => {
    expect(validateWorldConfig({ ...VALID, weather: 'acid' })).toContain('weather');
  });

  it('rejects an unknown timeOfDay', () => {
    expect(validateWorldConfig({ ...VALID, timeOfDay: 'noon' })).toContain('timeOfDay');
  });

  it('rejects an unknown difficulty', () => {
    expect(validateWorldConfig({ ...VALID, difficulty: 'nightmare' })).toContain('difficulty');
  });

  it('rejects density out of range', () => {
    expect(validateWorldConfig({ ...VALID, density: 1.5 })).toContain('Density');
  });

  it('rejects too few cover zones', () => {
    expect(validateWorldConfig({ ...VALID, coverZones: 2 })).toContain('cover zones');
  });

  it('rejects zero elevated positions', () => {
    expect(validateWorldConfig({ ...VALID, elevatedPositions: 0 })).toContain('elevated');
  });

  it('rejects seed out of range', () => {
    expect(validateWorldConfig({ ...VALID, seed: -1 })).toContain('Seed');
  });
});

describe('interpretWorldPrompt keyword fallback (R30.3)', () => {
  it('maps "snowy abandoned military base" to a snow biome', () => {
    const p = interpretWorldPrompt('snowy abandoned military base');
    expect(p.biome).toBe('snow');
    expect(p.weather).toBe('snow');
    expect(p.mood).toBe('abandoned military');
  });

  it('maps "desert dunes at night, very hard" to desert/night/hard', () => {
    const p = interpretWorldPrompt('desert dunes at night, very hard');
    expect(p.biome).toBe('desert');
    expect(p.timeOfDay).toBe('night');
    expect(p.difficulty).toBe('hard');
  });

  it('maps "dense storm" to storm weather + dense density', () => {
    const p = interpretWorldPrompt('dense storm');
    expect(p.weather).toBe('storm');
    expect(p.density).toBeGreaterThan(0.7);
  });

  it('maps "easy forest at dusk" to forest/easy/dusk', () => {
    const p = interpretWorldPrompt('easy forest at dusk');
    expect(p.biome).toBe('forest');
    expect(p.difficulty).toBe('easy');
    expect(p.timeOfDay).toBe('dusk');
  });

  it('defaults to the context biome/difficulty when no keyword matches', () => {
    const p = interpretWorldPrompt('a weird place', { biome: 'factory', difficulty: 'easy' });
    expect(p.biome).toBe('factory');
    expect(p.difficulty).toBe('easy');
    expect(p.timeOfDay).toBe('day');
    expect(p.weather).toBe('clear');
  });

  it('derives content counts from density', () => {
    const p = interpretWorldPrompt('city');
    expect(p.coverZones).toBeGreaterThanOrEqual(3);
    expect(p.elevatedPositions).toBeGreaterThanOrEqual(1);
    expect(p.enemyCamps).toBeGreaterThanOrEqual(1);
  });
});

describe('hashPrompt determinism (R30.1)', () => {
  it('produces a stable seed for the same prompt', () => {
    const a = interpretWorldPrompt('snowy abandoned military base');
    const b = interpretWorldPrompt('snowy abandoned military base');
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBe(hashPrompt('snowy abandoned military base'));
  });

  it('produces different seeds for different prompts', () => {
    expect(hashPrompt('city')).not.toBe(hashPrompt('desert'));
  });
});
