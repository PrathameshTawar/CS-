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
export const MEMORY_STORAGE_KEY = 'strideops_memory_v1';
/** Hard cap on persisted memory size (R32.1). */
export const MEMORY_BYTE_CAP = 64 * 1024;
/** Default save slot used when none is given. */
export const DEFAULT_SLOT = 'default';
/** Maximum key events kept per session (oldest trimmed first). */
const MAX_EVENTS_PER_SESSION = 200;
/**
 * The Memory System — bounded, oldest-first, localStorage-backed session
 * memory that feeds prior-session summaries back into generation prompts.
 */
export class MemorySystem {
    storage;
    storageKey;
    maxBytes;
    historySummary;
    now;
    slots = {};
    active = null;
    constructor(options = {}) {
        this.storage =
            options.storage !== undefined
                ? options.storage
                : typeof globalThis !== 'undefined' && 'localStorage' in globalThis
                    ? globalThis.localStorage
                    : null;
        this.storageKey = MEMORY_STORAGE_KEY;
        this.maxBytes = options.maxBytes ?? MEMORY_BYTE_CAP;
        this.historySummary = options.historySummary;
        this.now = options.now ?? (() => Date.now());
        this.slots = this.load();
    }
    /** Begin a new session in the given slot (ends any open session first). */
    startSession(slotId = DEFAULT_SLOT) {
        this.endSession();
        const session = {
            id: this.newSessionId(),
            startedAt: this.now(),
            endedAt: null,
            kills: 0,
            deaths: 0,
            missionsCompleted: [],
            worldState: null,
            keyEvents: [],
        };
        this.active = { slotId, session };
        if (!this.slots[slotId])
            this.slots[slotId] = [];
        this.slots[slotId].push(session);
        this.persist();
        return session.id;
    }
    /** Close the open session (no-op if none is open). */
    endSession() {
        if (this.active) {
            this.active.session.endedAt = this.now();
            this.active = null;
            this.persist();
        }
    }
    /** Record a player kill in the active session. */
    recordKill(detail = 'Enemy eliminated') {
        this.recordEvent('kill', detail, (s) => s.kills++);
    }
    /** Record a player death in the active session. */
    recordDeath(detail = 'Player eliminated') {
        this.recordEvent('death', detail, (s) => s.deaths++);
    }
    /** Record a completed mission in the active session. */
    recordMissionComplete(title) {
        this.recordEvent('mission', title, (s) => {
            if (!s.missionsCompleted.includes(title))
                s.missionsCompleted.push(title);
        });
    }
    /** Record the world state entered in the active session. */
    recordWorld(world) {
        this.recordEvent('world', `${world.biome} · ${world.weather}/${world.timeOfDay}`, (s) => {
            s.worldState = world;
        });
    }
    /** Record a free-form key event (e.g. Director mutations, lore beats). */
    recordNote(detail) {
        this.recordEvent('note', detail, () => undefined);
    }
    /**
     * Record an arriving reinforcement wave (R33.3). Surfaced in the summary's
     * "Key events" line so the next session's briefing recalls the composition
     * of recent reinforcement waves.
     */
    recordReinforcement(count, classes) {
        if (count <= 0)
            return;
        this.recordNote(`Reinforcement wave: ${count} hostiles (${classes.join(', ')})`);
    }
    /**
     * Record a live world mutation (weather/time-of-day, T3.4). Surfaced in the
     * summary's "Key events" line so the briefing recalls atmospheric changes.
     */
    recordWorldMutation(weather, timeOfDay) {
        const bits = [];
        if (weather)
            bits.push(`weather ${weather}`);
        if (timeOfDay)
            bits.push(`time ${timeOfDay}`);
        if (bits.length === 0)
            return;
        this.recordNote(`World mutated: ${bits.join(', ')}`);
    }
    /**
     * Build a bounded natural-language summary of a slot's sessions (R32.2),
     * for injection into World/Mission prompts. Returns '' when the slot is
     * empty so callers can skip injection entirely.
     */
    summarize(slotId = DEFAULT_SLOT, maxChars = 600) {
        const sessions = this.slots[slotId] ?? [];
        if (sessions.length === 0)
            return '';
        const last = sessions[sessions.length - 1];
        const older = sessions.slice(0, -1);
        const olderTotals = older.reduce((acc, s) => ({ kills: acc.kills + s.kills, deaths: acc.deaths + s.deaths }), { kills: 0, deaths: 0 });
        const parts = [];
        if (older.length > 0) {
            parts.push(`Across ${older.length} earlier session${older.length === 1 ? '' : 's'}: ${MemorySystem.plural(olderTotals.kills, 'kill')}, ${MemorySystem.plural(olderTotals.deaths, 'death')}.`);
        }
        parts.push(`Last session: ${MemorySystem.plural(last.kills, 'kill')}, ${MemorySystem.plural(last.deaths, 'death')}${last.endedAt === null ? ' (in progress)' : ''}.`);
        if (last.missionsCompleted.length > 0) {
            parts.push(`Missions completed: ${last.missionsCompleted.join(', ')}.`);
        }
        if (last.worldState) {
            parts.push(`World: ${last.worldState.biome}, ${last.worldState.weather}/${last.worldState.timeOfDay}${last.worldState.mood && last.worldState.mood !== 'generated' ? `, mood "${last.worldState.mood}"` : ''}.`);
        }
        const recentEvents = last.keyEvents
            .filter((e) => e.kind === 'mission' || e.kind === 'note')
            .slice(-3)
            .map((e) => e.detail);
        if (recentEvents.length > 0) {
            parts.push(`Key events: ${recentEvents.join('; ')}.`);
        }
        if (this.historySummary) {
            const history = this.historySummary();
            if (history)
                parts.push(history);
        }
        let summary = parts.join(' ');
        if (summary.length > maxChars)
            summary = `${summary.slice(0, maxChars - 1)}…`;
        return summary;
    }
    /** Read-only view of a slot's sessions (tests/observability). */
    getSessions(slotId = DEFAULT_SLOT) {
        return this.slots[slotId] ?? [];
    }
    /** Whether a storage adapter is actually available (false → memory-only). */
    isPersistent() {
        return this.storage !== null;
    }
    /** Delete all persisted + in-memory memory. */
    clear() {
        this.slots = {};
        this.active = null;
        try {
            this.storage?.removeItem(this.storageKey);
        }
        catch {
            // R32.4: ignore storage failures
        }
    }
    // --- internals -----------------------------------------------------------
    recordEvent(kind, detail, mutate) {
        if (!this.active)
            return; // events outside a session are ignored
        const session = this.active.session;
        mutate(session);
        session.keyEvents.push({ timestamp: this.now(), kind, detail });
        if (session.keyEvents.length > MAX_EVENTS_PER_SESSION) {
            session.keyEvents.splice(0, session.keyEvents.length - MAX_EVENTS_PER_SESSION);
        }
        this.persist();
    }
    newSessionId() {
        return `s${this.now().toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
    }
    load() {
        if (!this.storage)
            return {};
        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw)
                return {};
            const parsed = JSON.parse(raw);
            if (!parsed.slots || typeof parsed.slots !== 'object')
                return {};
            return parsed.slots;
        }
        catch {
            return {}; // R32.4: corrupted/unavailable storage → start fresh, no error
        }
    }
    /** Persist under the byte cap, evicting oldest sessions first (R32.1). */
    persist() {
        if (!this.storage)
            return; // memory-only mode (R32.4)
        try {
            let json = JSON.stringify({ slots: this.slots });
            let guard = 0;
            // Whole-session eviction (oldest first) — never delete the last session.
            while (this.byteLength(json) > this.maxBytes && this.sessionCount() > 1 && guard++ < 1000) {
                this.evictOldest();
                json = JSON.stringify({ slots: this.slots });
            }
            // A lone oversized session is trimmed oldest-first instead of dropped.
            if (this.byteLength(json) > this.maxBytes) {
                this.trimEventsToFit();
                json = JSON.stringify({ slots: this.slots });
            }
            this.storage.setItem(this.storageKey, json);
        }
        catch {
            // R32.4: quota/private mode — keep working in-memory, never throw
        }
    }
    sessionCount() {
        return Object.values(this.slots).reduce((acc, sessions) => acc + sessions.length, 0);
    }
    /**
     * Drop oldest key events (oldest session first) until the whole state fits
     * the byte cap. Keeps the session record intact when a single session alone
     * exceeds the cap (R32.1 — eviction must not lose the player's session).
     */
    trimEventsToFit() {
        let guard = 0;
        while (this.byteLength(JSON.stringify({ slots: this.slots })) > this.maxBytes && guard++ < 100000) {
            let targetSlot = null;
            let targetIndex = -1;
            let oldest = Infinity;
            for (const [slot, sessions] of Object.entries(this.slots)) {
                for (let i = 0; i < sessions.length; i++) {
                    const started = sessions[i].startedAt;
                    if (started < oldest && sessions[i].keyEvents.length > 0) {
                        oldest = started;
                        targetSlot = slot;
                        targetIndex = i;
                    }
                }
            }
            if (targetSlot === null || targetIndex < 0)
                break; // nothing left to trim
            this.slots[targetSlot][targetIndex].keyEvents.shift();
        }
    }
    /** Remove the single oldest session (by startedAt) across all slots. */
    evictOldest() {
        let targetSlot = null;
        let targetIndex = -1;
        let oldest = Infinity;
        for (const [slot, sessions] of Object.entries(this.slots)) {
            for (let i = 0; i < sessions.length; i++) {
                if (sessions[i].startedAt < oldest) {
                    oldest = sessions[i].startedAt;
                    targetSlot = slot;
                    targetIndex = i;
                }
            }
        }
        if (targetSlot === null || targetIndex < 0)
            return false;
        this.slots[targetSlot].splice(targetIndex, 1);
        if (this.slots[targetSlot].length === 0)
            delete this.slots[targetSlot];
        return true;
    }
    byteLength(s) {
        return new TextEncoder().encode(s).length;
    }
    static plural(n, word) {
        return `${n} ${n === 1 ? word : `${word}s`}`;
    }
}
//# sourceMappingURL=MemorySystem.js.map