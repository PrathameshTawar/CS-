/**
 * ai-content-engine.test.ts
 *
 * Unit tests for AIContentEngine (Requirements 21, 22):
 * schema-validation rejections trigger retries, exhausted attempts fall
 * back to the procedural provider, fallback output is validated too, and
 * multi-provider chains are tried in order within an attempt.
 */

import {
  AIContentEngine,
  ContentLogEntry,
  ContentPersistence,
  PersistedContentState,
} from '../../src/engine/content/AIContentEngine';
import {
  LLMProvider,
  ProceduralFallbackProvider,
  GeneratedContent,
} from '../../src/engine/content/LLMProvider';
import { validatePayload } from '../../src/engine/content/ContentSchemas';

/** Valid weapon payload that passes validateWeaponPayload. */
const VALID_WEAPON: GeneratedContent = {
  name: 'Test Rifle',
  category: 'rifle',
  baseDamage: 30,
  fireRate: 600,
  magazineSize: 30,
  reloadTime: 2,
  recoil: { vertical: [1, 1, 1, 1], horizontal: [0, 0, 0, 0] },
  baseSpread: 0.02,
  color: 0xff00ff,
};

/** Weapon payload that FAILS schema validation (damage 500 > max 150). */
const INVALID_WEAPON: GeneratedContent = {
  name: 'Broken Rifle',
  category: 'rifle',
  baseDamage: 500,
  fireRate: 600,
  magazineSize: 30,
  reloadTime: 2,
  recoil: { vertical: [1, 1, 1, 1], horizontal: [0, 0, 0, 0] },
  baseSpread: 0.02,
  color: 0xff00ff,
};

/** Valid map payload that passes validateMapPayload. */
const VALID_MAP: GeneratedContent = {
  seed: 12345,
  biome: 'city',
  density: 0.5,
  coverZones: 6,
  elevatedPositions: 2,
};

/** Map payload that FAILS schema validation (coverZones 1 < 3). */
const INVALID_MAP: GeneratedContent = {
  seed: 12345,
  biome: 'city',
  density: 0.5,
  coverZones: 1,
  elevatedPositions: 2,
};

/**
 * Provider stub that returns a queued sequence of results in order,
 * repeating the last entry for any extra calls. Lets tests drive exactly
 * how many times the engine retries.
 */
function queueProvider(name: string, results: (GeneratedContent | null)[]): LLMProvider {
  let calls = 0;
  return {
    name,
    async generate(): Promise<GeneratedContent | null> {
      return results[Math.min(calls++, results.length - 1)];
    },
  };
}

describe('AIContentEngine schema validation + retries', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Keep the engine's console.warn noise out of the test output
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns a valid payload from the primary provider on the first attempt', async () => {
    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]));

    const result = await engine.generate('weapon', { category: 'rifle' });

    expect(result).toBe(VALID_WEAPON);
    const stats = engine.getStats();
    expect(stats.generated).toBe(1);
    expect(stats.validated).toBe(1);
    expect(stats.rejected).toBe(0);
    expect(stats.retried).toBe(0);
    expect(stats.fallbacks).toBe(0);
    expect(engine.getLog()).toHaveLength(1);
    expect(engine.getLog()[0].provider).toBe('primary');
  });

  it('schema-validation rejections trigger retries until a valid payload arrives', async () => {
    // Two invalid payloads rejected, third attempt returns valid content.
    const engine = new AIContentEngine(queueProvider('primary', [INVALID_WEAPON, INVALID_WEAPON, VALID_WEAPON]));

    const result = await engine.generate('weapon', { category: 'rifle' });

    expect(result).toBe(VALID_WEAPON);
    const stats = engine.getStats();
    expect(stats.rejected).toBe(2);
    expect(stats.retried).toBe(2);
    expect(stats.validated).toBe(1);
    expect(stats.fallbacks).toBe(0);
    // Only the valid payload is logged
    expect(engine.getLog()).toHaveLength(1);
    expect(engine.getLog()[0].provider).toBe('primary');
  });

  it('falls back to the procedural provider when every LLM attempt is schema-invalid', async () => {
    // The user-visible path: a real LLM keeps returning out-of-schema JSON,
    // so after maxRetries the engine must produce a schema-valid payload
    // from the procedural fallback — the game still gets playable content.
    const engine = new AIContentEngine(
      queueProvider('llm', [INVALID_WEAPON, INVALID_WEAPON, INVALID_WEAPON]),
      new ProceduralFallbackProvider()
    );

    const result = await engine.generate('weapon', { category: 'rifle', powerLevel: 0.5 });

    expect(result).not.toBeNull();
    expect(validatePayload('weapon', result!)).toBeNull();
    const stats = engine.getStats();
    expect(stats.rejected).toBe(3);
    expect(stats.retried).toBe(3);
    expect(stats.fallbacks).toBe(1);
    expect(engine.getLog()).toHaveLength(1);
    expect(engine.getLog()[0].provider).toBe('procedural-fallback');
  });

  it('falls back to the procedural provider when the LLM returns null', async () => {
    const engine = new AIContentEngine(
      queueProvider('llm', [null, null, null]),
      new ProceduralFallbackProvider()
    );

    const result = await engine.generate('map', { biome: 'snow', density: 0.55 });

    expect(result).not.toBeNull();
    expect(validatePayload('map', result!)).toBeNull();
    const stats = engine.getStats();
    expect(stats.rejected).toBe(0);
    expect(stats.retried).toBe(3);
    expect(stats.fallbacks).toBe(1);
    expect((result as { biome: string }).biome).toBe('snow');
  });

  it('respects a custom maxRetries config', async () => {
    let calls = 0;
    const counting: LLMProvider = {
      name: 'counting',
      async generate(): Promise<GeneratedContent | null> {
        calls++;
        return null;
      },
    };
    const engine = new AIContentEngine(counting, new ProceduralFallbackProvider(), { maxRetries: 2 });

    const result = await engine.generate('mission', { objectiveType: 'elimination' });

    expect(calls).toBe(2); // only 2 attempts, not the default 3
    expect(result).not.toBeNull();
    expect(engine.getStats().retried).toBe(2);
    expect(engine.getStats().fallbacks).toBe(1);
  });

  it('returns null when the fallback ALSO fails validation', async () => {
    const engine = new AIContentEngine(
      queueProvider('llm', [INVALID_MAP, INVALID_MAP, INVALID_MAP]),
      queueProvider('fallback', [INVALID_MAP])
    );

    const result = await engine.generate('map', { biome: 'city' });

    expect(result).toBeNull();
    const stats = engine.getStats();
    // rejected counts LLM validation rejections only; an invalid fallback
    // result is discarded without being counted (engine returns null).
    expect(stats.rejected).toBe(3);
    expect(stats.retried).toBe(3);
    expect(stats.fallbacks).toBe(0); // fallback result was invalid → not counted
  });

  it('returns null when both the LLM and the fallback return null', async () => {
    const engine = new AIContentEngine(queueProvider('llm', [null, null, null]), queueProvider('fallback', [null]));

    const result = await engine.generate('balance', { difficulty: 'normal' });

    expect(result).toBeNull();
    const stats = engine.getStats();
    expect(stats.retried).toBe(3);
    expect(stats.fallbacks).toBe(0);
    expect(stats.validated).toBe(0);
  });

  it('tries additional providers in order within the same attempt after a rejection', async () => {
    const engine = new AIContentEngine(queueProvider('first', [INVALID_WEAPON]));
    engine.addProvider(queueProvider('second', [VALID_WEAPON]));
    // No fallback — the second provider must succeed on attempt 1.
    engine.setFallback(new ProceduralFallbackProvider());

    const result = await engine.generate('weapon', { category: 'rifle' });

    expect(result).toBe(VALID_WEAPON);
    const stats = engine.getStats();
    expect(stats.rejected).toBe(1);
    expect(stats.retried).toBe(0); // succeeded inside the first attempt
    expect(stats.fallbacks).toBe(0);
    expect(engine.getLog()[0].provider).toBe('second');
  });

  it('procedural fallback generates schema-valid content for every content type', async () => {
    const fallback = new ProceduralFallbackProvider();
    const contexts: Record<string, Record<string, unknown>> = {
      weapon: { category: 'smg', powerLevel: 0.6 },
      map: { biome: 'dungeon', density: 0.6 },
      mission: { objectiveType: 'capture', difficulty: 0.5 },
      balance: { difficulty: 'hard', enemyClass: 'heavy' },
    };

    for (const type of Object.keys(contexts)) {
      const result = await fallback.generate({ type, context: contexts[type] });
      expect(result).not.toBeNull();
      expect(validatePayload(type, result!)).toBeNull();
    }
  });

  it('does not write to the log when logging is disabled', async () => {
    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]), undefined, {
      enableLogging: false,
    });

    const result = await engine.generate('weapon', { category: 'rifle' });

    expect(result).toBe(VALID_WEAPON);
    expect(engine.getStats().validated).toBe(1);
    expect(engine.getLog()).toHaveLength(0);
  });

  it('produces a deterministic content hash for identical payloads', async () => {
    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]));

    await engine.generate('weapon', { category: 'rifle' });
    const first = engine.getLog()[0].hash;

    await engine.generate('weapon', { category: 'rifle' });
    const second = engine.getLog()[1].hash;

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('AIContentEngine persistence', () => {
  /** In-memory ContentPersistence double for asserting load/save calls. */
  function memoryStorage(): {
    storage: ContentPersistence;
    state: PersistedContentState | null;
  } {
    const box: { state: PersistedContentState | null } = { state: null };
    return {
      storage: {
        load: () => box.state,
        save: (s: PersistedContentState) => {
          box.state = { log: s.log.map((e) => ({ ...e })), stats: { ...s.stats } };
        },
      },
      get state() {
        return box.state;
      },
      set state(v) {
        box.state = v;
      },
    };
  }

  it('restores a persisted log + stats on construction', async () => {
    const mem = memoryStorage();
    const previous: ContentLogEntry = {
      timestamp: 123456,
      type: 'weapon',
      hash: 'deadbeef',
      provider: 'procedural-fallback',
      payload: VALID_WEAPON,
    };
    mem.state = { log: [previous], stats: { generated: 5, validated: 3, retried: 1, fallbacks: 1, rejected: 1 } };

    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]), undefined, { storage: mem.storage });

    expect(engine.getLog()).toHaveLength(1);
    expect(engine.getLog()[0]).toEqual(previous);
    const stats = engine.getStats();
    expect(stats.generated).toBe(5);
    expect(stats.validated).toBe(3);

    // A new generation continues the restored counters instead of resetting.
    await engine.generate('weapon', { category: 'rifle' });
    expect(engine.getStats().generated).toBe(6);
    expect(engine.getLog()).toHaveLength(2);
  });

  it('persists new content + stats after a successful generation', async () => {
    const mem = memoryStorage();
    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]), undefined, { storage: mem.storage });

    const result = await engine.generate('weapon', { category: 'rifle' });
    expect(result).toBe(VALID_WEAPON);

    const saved = mem.state;
    expect(saved).not.toBeNull();
    expect(saved!.log).toHaveLength(1);
    expect(saved!.log[0].provider).toBe('primary');
    expect(saved!.log[0].hash).toMatch(/^[0-9a-f]{8}$/);
    expect(saved!.stats.generated).toBe(1);
    expect(saved!.stats.validated).toBe(1);
  });

  it('persists failure stats when generation exhausts retries', async () => {
    const mem = memoryStorage();
    const engine = new AIContentEngine(
      queueProvider('llm', [null, null, null]),
      queueProvider('fallback', [null]),
      { storage: mem.storage }
    );

    const result = await engine.generate('map', { biome: 'city' });
    expect(result).toBeNull();

    const saved = mem.state;
    expect(saved).not.toBeNull();
    expect(saved!.stats.retried).toBe(3);
    expect(saved!.stats.generated).toBe(1);
    expect(saved!.log).toHaveLength(0); // nothing valid to log
  });

  it('clearLog persists an empty log while keeping the cumulative stats', async () => {
    const mem = memoryStorage();
    const engine = new AIContentEngine(queueProvider('primary', [VALID_WEAPON]), undefined, { storage: mem.storage });

    await engine.generate('weapon', { category: 'rifle' });
    expect(mem.state!.log).toHaveLength(1);

    engine.clearLog();

    expect(engine.getLog()).toHaveLength(0);
    expect(mem.state!.log).toHaveLength(0);
    expect(mem.state!.stats.generated).toBe(1); // stats retained across clear
  });
});
