/**
 * memory-cap.test.ts
 *
 * Unit tests for MemorySystem (R32.1-R32.4, T4.1-T4.4): structured session
 * log with a bounded byte cap + oldest-first eviction, bounded prompt
 * summary, content-history linkage, and graceful degradation when
 * localStorage is unavailable.
 */

import {
  MemorySystem,
  MEMORY_BYTE_CAP,
  MemoryStorageLike,
} from '../../src/modes/ai/MemorySystem';

/** In-memory Storage-like adapter for deterministic tests. */
function fakeStorage(): {
  storage: MemoryStorageLike;
  get: () => string | null;
  set: (v: string) => void;
} {
  let value: string | null = null;
  return {
    storage: {
      getItem: (key: string) => (key === 'strideops_memory_v1' ? value : null),
      setItem: (key: string, v: string) => {
        if (key === 'strideops_memory_v1') value = v;
      },
      removeItem: (key: string) => {
        if (key === 'strideops_memory_v1') value = null;
      },
    },
    get: () => value,
    set: (v: string) => {
      value = v;
    },
  };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

describe('MemorySystem (R32)', () => {
  it('records a session (kills/deaths/missions/world) and summarizes it', () => {
    const m = new MemorySystem({ now: () => 1000 });
    m.startSession('default');
    m.recordKill('Scout 1');
    m.recordKill('Heavy 2');
    m.recordDeath();
    m.recordMissionComplete('Clear the Zone');
    m.recordWorld({ biome: 'snow', weather: 'snow', timeOfDay: 'night', mood: 'abandoned' });
    m.endSession();

    const sessions = m.getSessions('default');
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.kills).toBe(2);
    expect(s.deaths).toBe(1);
    expect(s.missionsCompleted).toEqual(['Clear the Zone']);
    expect(s.worldState).toEqual({ biome: 'snow', weather: 'snow', timeOfDay: 'night', mood: 'abandoned' });
    expect(s.endedAt).not.toBeNull();

    const summary = m.summarize('default');
    expect(summary).toContain('Last session: 2 kills, 1 death');
    expect(summary).toContain('Missions completed: Clear the Zone');
    expect(summary).toContain('snow');
  });

  it('summarizes an empty slot as an empty string', () => {
    const m = new MemorySystem();
    expect(m.summarize('default')).toBe('');
  });

  it('enforces the byte cap with oldest-first eviction (R32.1)', () => {
    // Tiny cap so eviction kicks in quickly; monotonic clock so session
    // ordering is unambiguous.
    const cap = 400;
    const { storage } = fakeStorage();
    let t = 0;
    const m = new MemorySystem({ storage, maxBytes: cap, now: () => ++t * 1000 });

    // Record many sessions, each larger than the cap would allow to accumulate.
    const firstSessionId = m.startSession('default');
    for (let k = 0; k < 5; k++) m.recordKill(`Very long victim name padding session 0 kill ${k}`);
    m.endSession();
    for (let i = 1; i < 40; i++) {
      m.startSession('default');
      for (let k = 0; k < 5; k++) {
        m.recordKill(`Very long victim name padding for session ${i} kill ${k}`);
      }
      m.endSession();
    }

    // Persisted state must fit under the cap…
    const raw = storage.getItem('strideops_memory_v1');
    expect(raw).not.toBeNull();
    expect(byteLength(raw!)).toBeLessThanOrEqual(cap + 8); // JSON wrapper slack

    // …and only the newest sessions survive (oldest evicted first).
    const sessions = m.getSessions('default');
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.length).toBeLessThan(40);
    const ids = sessions.map((s) => s.id);
    expect(ids).not.toContain(firstSessionId);
  });

  it('keeps the whole state under the cap even with a single huge session', () => {
    const cap = 300;
    const { storage } = fakeStorage();
    const m = new MemorySystem({ storage, maxBytes: cap, now: () => 2000 });

    m.startSession('default');
    for (let i = 0; i < 200; i++) {
      m.recordKill(`padding-padding-padding-padding-padding-padding-${i}`);
    }
    m.endSession();

    const raw = storage.getItem('strideops_memory_v1');
    expect(raw).not.toBeNull();
    // Even a single session that bloats beyond the cap must be trimmed to fit
    // (events evicted oldest-first) without losing the session itself.
    expect(byteLength(raw!)).toBeLessThanOrEqual(cap + 8);
    const sessions = m.getSessions('default');
    expect(sessions.length).toBe(1);
    expect(sessions[0].kills).toBe(200);
    expect(sessions[0].keyEvents.length).toBeLessThan(200);
    expect(sessions[0].keyEvents.length).toBeGreaterThan(0);
  });

  it('bounds the summary to the requested character budget (R32.2)', () => {
    const m = new MemorySystem({
      historySummary: () => 'R'.repeat(500),
      now: () => 3000,
    });
    m.startSession('default');
    for (let i = 0; i < 10; i++) m.recordKill('a'.repeat(100));
    m.recordMissionComplete('Mission ' + 'x'.repeat(100));
    m.endSession();

    const summary = m.summarize('default', 120);
    expect(summary.length).toBeLessThanOrEqual(120);
  });

  it('references the content-history summary when provided (R32.3)', () => {
    const m = new MemorySystem({
      historySummary: () => 'Recalled from history: 3 map(s), 2 weapon(s) available to re-apply.',
      now: () => 4000,
    });
    m.startSession('default');
    m.recordKill();
    m.endSession();

    const summary = m.summarize('default');
    expect(summary).toContain('Recalled from history: 3 map(s), 2 weapon(s)');
  });

  it('records note events as key events in the summary', () => {
    const m = new MemorySystem({ now: () => 5000 });
    m.startSession('default');
    m.recordNote('Warlord eliminated');
    m.endSession();

    expect(m.summarize('default')).toContain('Warlord eliminated');
  });

  it('records reinforcement waves so the briefing recalls them (R33.3/R32)', () => {
    const m = new MemorySystem({ now: () => 5050 });
    m.startSession('default');
    m.recordReinforcement(3, ['scout', 'heavy', 'medic']);
    m.recordReinforcement(4, ['heavy', 'heavy', 'sniper', 'medic']);
    m.endSession();

    const summary = m.summarize('default');
    expect(summary).toContain('Reinforcement wave: 3 hostiles (scout, heavy, medic)');
    expect(summary).toContain('Reinforcement wave: 4 hostiles (heavy, heavy, sniper, medic)');

    // Zero-count calls are ignored (no spam in the briefing).
    const m2 = new MemorySystem({ now: () => 5051 });
    m2.startSession('default');
    m2.recordReinforcement(0, ['scout']);
    m2.endSession();
    expect(m2.summarize('default')).not.toContain('Reinforcement wave');
  });

  it('records world mutations so the briefing recalls atmosphere changes (T3.4/R32)', () => {
    const m = new MemorySystem({ now: () => 5060 });
    m.startSession('default');
    m.recordWorldMutation('storm', 'night');
    m.endSession();

    expect(m.summarize('default')).toContain('World mutated: weather storm, time night');

    // Partial mutations and no-ops are handled without error.
    const m2 = new MemorySystem({ now: () => 5061 });
    m2.startSession('default');
    m2.recordWorldMutation('fog');
    m2.recordWorldMutation();
    m2.endSession();
    const s2 = m2.summarize('default');
    expect(s2).toContain('World mutated: weather fog');
    // The empty recordWorldMutation() call added no extra entry.
    expect(s2.match(/World mutated:/g) ?? []).toHaveLength(1);
  });

  it('isolates sessions per slot', () => {
    const m = new MemorySystem({ now: () => 6000 });
    m.startSession('slotA');
    m.recordKill('Alpha');
    m.endSession();
    m.startSession('slotB');
    m.recordKill('Bravo');
    m.endSession();

    expect(m.getSessions('slotA')).toHaveLength(1);
    expect(m.getSessions('slotB')).toHaveLength(1);
    expect(m.summarize('slotA')).toContain('1 kill');
    expect(m.summarize('slotB')).toContain('1 kill');
    expect(m.summarize('slotA')).not.toContain('Bravo');
  });

  it('degrades gracefully when storage throws (R32.4)', () => {
    const throwingStorage: MemoryStorageLike = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {
        throw new Error('storage blocked');
      },
    };
    const m = new MemorySystem({ storage: throwingStorage, now: () => 7000 });

    // None of these may throw.
    expect(() => {
      m.startSession('default');
      m.recordKill();
      m.recordDeath();
      m.recordMissionComplete('X');
      m.recordWorld({ biome: 'city', weather: 'clear', timeOfDay: 'day', mood: '' });
      m.endSession();
      m.summarize('default');
    }).not.toThrow();

    expect(m.summarize('default')).toContain('1 kill');
    expect(m.isPersistent()).toBe(true); // adapter present even if it throws
  });

  it('continues in-memory when no storage adapter exists (R32.4)', () => {
    const m = new MemorySystem({ storage: null, now: () => 8000 });
    expect(m.isPersistent()).toBe(false);
    m.startSession('default');
    m.recordKill('Offline kill');
    m.endSession();
    expect(m.summarize('default')).toContain('1 kill');
  });

  it('clears all memory', () => {
    const { storage } = fakeStorage();
    const m = new MemorySystem({ storage, now: () => 9000 });
    m.startSession('default');
    m.recordKill();
    m.endSession();
    m.clear();

    expect(m.getSessions('default')).toHaveLength(0);
    expect(m.summarize('default')).toBe('');
  });

  it('defaults to the 64 KB cap (R32.1)', () => {
    const { storage } = fakeStorage();
    const m = new MemorySystem({ storage });
    // Default cap constant must be exactly 64 KiB.
    expect(MEMORY_BYTE_CAP).toBe(64 * 1024);
    // A session log slightly larger than the cap persists within it.
    for (let i = 0; i < 30; i++) {
      m.startSession('default');
      for (let k = 0; k < 3; k++) m.recordKill('victim ' + 'p'.repeat(60) + i + '/' + k);
      m.endSession();
    }
    const raw = storage.getItem('strideops_memory_v1');
    expect(raw).not.toBeNull();
    expect(byteLength(raw!)).toBeLessThanOrEqual(MEMORY_BYTE_CAP + 8);
  });
});
