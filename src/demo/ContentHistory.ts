/**
 * ContentHistory.ts
 *
 * localStorage-backed persistence for the AI Content Engine (History tab).
 * Stores the generated-content log (with content hashes) and the cumulative
 * engine stats so they survive page reloads. Kept in src/demo because it
 * depends on the browser localStorage API.
 */

import {
  ContentLogEntry,
  ContentPersistence,
  PersistedContentState,
  EMPTY_STATS,
} from '../engine/content/AIContentEngine';

const DEFAULT_KEY = 'strideops_ai_history_v1';

export class LocalStorageContentStorage implements ContentPersistence {
  private readonly key: string;

  constructor(key: string = DEFAULT_KEY) {
    this.key = key;
  }

  load(): PersistedContentState | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedContentState>;
      if (!Array.isArray(parsed.log)) return null;
      return {
        log: parsed.log as ContentLogEntry[],
        stats: { ...EMPTY_STATS, ...(parsed.stats ?? {}) },
      };
    } catch {
      return null; // storage unavailable or corrupted — start fresh
    }
  }

  save(state: PersistedContentState): void {
    try {
      localStorage.setItem(this.key, JSON.stringify({ log: state.log, stats: state.stats }));
    } catch {
      // storage unavailable (private mode / quota) — persistence is best-effort
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}
