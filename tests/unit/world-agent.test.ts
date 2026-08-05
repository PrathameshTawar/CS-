/**
 * world-agent.test.ts
 *
 * Unit tests for the World Agent (R30.1-30.3, T3.2/T3.3): a valid LLM
 * payload is coerced to WorldConfig; schema-invalid LLM output triggers the
 * engine retry path; the procedural fallback interprets the prompt by
 * keyword; coercion falls back to the session context.
 */

import { AIContentEngine } from '../../src/engine/content/AIContentEngine';
import { LLMProvider, GeneratedContent, ProceduralFallbackProvider } from '../../src/engine/content/LLMProvider';
import { WorldContentPayload } from '../../src/engine/content/ContentSchemas';
import { Biome } from '../../src/gameplay/maps/MapGenerator';
import { WorldAgent, coerceWorldConfig } from '../../src/modes/ai/WorldAgent';

/** Valid world payload that passes validateWorldConfig. */
const VALID_WORLD: WorldContentPayload = {
  seed: 777,
  biome: 'snow',
  density: 0.7,
  weather: 'storm',
  timeOfDay: 'night',
  mood: 'abandoned military',
  buildings: 14,
  roads: 5,
  enemyCamps: 3,
  difficulty: 'hard',
  coverZones: 9,
  elevatedPositions: 4,
};

/** World payload that FAILS schema validation (unknown biome). */
const INVALID_WORLD: WorldContentPayload = {
  ...VALID_WORLD,
  biome: 'lava',
};

function queueProvider(results: (GeneratedContent | null)[]): LLMProvider {
  let calls = 0;
  return {
    name: 'stub-llm',
    async generate(): Promise<GeneratedContent | null> {
      return results[Math.min(calls++, results.length - 1)];
    },
  };
}

describe('WorldAgent prompt-to-world (R30.1-30.3)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the validated LLM world config directly', async () => {
    const engine = new AIContentEngine(queueProvider([VALID_WORLD]));
    const agent = new WorldAgent(engine);

    const wc = await agent.generateWorld('snowy base', { difficulty: 'normal' });

    expect(wc.biome).toBe(Biome.Snow);
    expect(wc.weather).toBe('storm');
    expect(wc.timeOfDay).toBe('night');
    expect(wc.difficulty).toBe('hard');
    expect(wc.seed).toBe(777);
  });

  it('retries schema-invalid LLM output, then falls back to keyword interpretation', async () => {
    // One invalid payload, then the fallback provider (keyword) must succeed.
    const engine = new AIContentEngine(queueProvider([INVALID_WORLD]), new ProceduralFallbackProvider(), {
      maxRetries: 2,
    });
    const agent = new WorldAgent(engine);

    const wc = await agent.generateWorld('desert dunes at night, very hard', { difficulty: 'normal' });

    // Fallback interpreted the prompt by keyword.
    expect(wc.biome).toBe(Biome.Desert);
    expect(wc.timeOfDay).toBe('night');
    expect(wc.difficulty).toBe('hard');
    expect(engine.getStats().rejected).toBeGreaterThanOrEqual(1);
    expect(engine.getStats().fallbacks).toBe(1);
  });

  it('falls back to keywords when the LLM returns null (no provider success)', async () => {
    const engine = new AIContentEngine(queueProvider([null, null]), new ProceduralFallbackProvider(), {
      maxRetries: 2,
    });
    const agent = new WorldAgent(engine);

    const wc = await agent.generateWorld('easy forest at dusk', { difficulty: 'normal' });

    expect(wc.biome).toBe(Biome.Forest);
    expect(wc.difficulty).toBe('easy');
    expect(wc.timeOfDay).toBe('dusk');
  });

  it('produces a deterministic seed from the prompt when using the fallback', async () => {
    const engine = new AIContentEngine(queueProvider([null]), new ProceduralFallbackProvider(), { maxRetries: 1 });
    const agent = new WorldAgent(engine);

    const a = await agent.generateWorld('snowy abandoned military base', { difficulty: 'normal' });
    const b = await agent.generateWorld('snowy abandoned military base', { difficulty: 'normal' });

    expect(a.seed).toBe(b.seed);
  });
});

describe('coerceWorldConfig', () => {
  it('falls back to the session context when the payload has unknown enums', () => {
    // biome AND difficulty are invalid → both fall back to the context.
    const wc = coerceWorldConfig(
      { ...VALID_WORLD, biome: 'mars', difficulty: 'nightmare' },
      { difficulty: 'easy', biome: Biome.Factory }
    );
    expect(wc.biome).toBe(Biome.Factory);
    expect(wc.difficulty).toBe('easy');
  });

  it('keeps valid payload enums instead of the context values', () => {
    const wc = coerceWorldConfig(VALID_WORLD, { difficulty: 'easy', biome: Biome.Factory });
    expect(wc.biome).toBe(Biome.Snow);
    expect(wc.difficulty).toBe('hard');
  });

  it('falls back to default weather/timeOfDay for unknown enum values', () => {
    const wc = coerceWorldConfig(
      { ...VALID_WORLD, weather: 'acid', timeOfDay: 'noon' },
      { difficulty: 'normal' }
    );
    expect(wc.weather).toBe('clear');
    expect(wc.timeOfDay).toBe('day');
  });
});
