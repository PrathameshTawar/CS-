/**
 * MemorySystem.ts
 *
 * Persistent world memory (Requirement 32, tasks T4.1-T4.4).
 *
 * Persists a structured per-slot session log (kills, deaths, missions
 * completed, world state, key events) to localStorage with a bounded size
 * (64 KB default) and oldest-first eviction (R32.1). On session start the
 * memory is summarized within a bounded character budget and injected into
 * World/Mission prompts (R32.2). The summary may reference the AI content
 * history so generated maps/weapons can be recalled and re-applied (R32.3).
 * All storage access is defensive: if localStorage is unavailable or throws,
 * the system keeps working in-memory for the session and never raises
 * (R32.4).
 *
 * Kept mode-agnostic: Game.ts only constructs it for AI mode (R26.2).
 *
 * @module Modes
 */
/** localStorage key for the memory state. */
export declare const MEMORY_STORAGE_KEY = "strideops_memory_v1";
/** Hard cap on persisted memory size (R32.1). */
export declare const MEMORY_BYTE_CAP: number;
/** Default save slot used when none is given. */
export declare const DEFAULT_SLOT = "default";
/** Minimal storage surface the memory needs (subset of the Storage API). */
export interface MemoryStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/** A single logged event within a session. */
export interface MemoryEvent {
    timestamp: number;
    kind: 'kill' | 'death' | 'mission' | 'world' | 'note';
    detail: string;
}
/** The world the player entered in a session (for continuity). */
export interface WorldMemory {
    biome: string;
    weather: string;
    timeOfDay: string;
    mood: string;
}
/** One play session's structured log (R32.1). */
export interface SessionMemory {
    id: string;
    startedAt: number;
    endedAt: number | null;
    kills: number;
    deaths: number;
    missionsCompleted: string[];
    worldState: WorldMemory | null;
    keyEvents: MemoryEvent[];
}
/** Persisted shape: save slots → session logs. */
export interface PersistedMemoryState {
    slots: Record<string, SessionMemory[]>;
}
export interface MemorySystemOptions {
    /** Storage adapter. Defaults to globalThis.localStorage; pass null to force memory-only. */
    storage?: MemoryStorageLike | null;
    /** Byte cap for persisted state (R32.1). */
    maxBytes?: number;
    /** Optional line describing recallable AI content history (R32.3). */
    historySummary?: () => string;
    /** Clock for timestamps/session ids (testable). */
    now?: () => number;
}
/**
 * The Memory System — bounded, oldest-first, localStorage-backed session
 * memory that feeds prior-session summaries back into generation prompts.
 */
export declare class MemorySystem {
    private readonly storage;
    private readonly storageKey;
    private readonly maxBytes;
    private readonly historySummary;
    private readonly now;
    private slots;
    private active;
    constructor(options?: MemorySystemOptions);
    /** Begin a new session in the given slot (ends any open session first). */
    startSession(slotId?: string): string;
    /** Close the open session (no-op if none is open). */
    endSession(): void;
    /** Record a player kill in the active session. */
    recordKill(detail?: string): void;
    /** Record a player death in the active session. */
    recordDeath(detail?: string): void;
    /** Record a completed mission in the active session. */
    recordMissionComplete(title: string): void;
    /** Record the world state entered in the active session. */
    recordWorld(world: WorldMemory): void;
    /** Record a free-form key event (e.g. Director mutations, lore beats). */
    recordNote(detail: string): void;
    /**
     * Record an arriving reinforcement wave (R33.3). Surfaced in the summary's
     * "Key events" line so the next session's briefing recalls the composition
     * of recent reinforcement waves.
     */
    recordReinforcement(count: number, classes: readonly string[]): void;
    /**
     * Record a live world mutation (weather/time-of-day, T3.4). Surfaced in the
     * summary's "Key events" line so the briefing recalls atmospheric changes.
     */
    recordWorldMutation(weather?: string, timeOfDay?: string): void;
    /**
     * Build a bounded natural-language summary of a slot's sessions (R32.2),
     * for injection into World/Mission prompts. Returns '' when the slot is
     * empty so callers can skip injection entirely.
     */
    summarize(slotId?: string, maxChars?: number): string;
    /** Read-only view of a slot's sessions (tests/observability). */
    getSessions(slotId?: string): readonly SessionMemory[];
    /** Whether a storage adapter is actually available (false → memory-only). */
    isPersistent(): boolean;
    /** Delete all persisted + in-memory memory. */
    clear(): void;
    private recordEvent;
    private newSessionId;
    private load;
    /** Persist under the byte cap, evicting oldest sessions first (R32.1). */
    private persist;
    private sessionCount;
    /**
     * Drop oldest key events (oldest session first) until the whole state fits
     * the byte cap. Keeps the session record intact when a single session alone
     * exceeds the cap (R32.1 — eviction must not lose the player's session).
     */
    private trimEventsToFit;
    /** Remove the single oldest session (by startedAt) across all slots. */
    private evictOldest;
    private byteLength;
    private static plural;
}
//# sourceMappingURL=MemorySystem.d.ts.map