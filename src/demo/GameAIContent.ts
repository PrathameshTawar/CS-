/**
 * GameAIContent.ts
 *
 * AI content generation for the demo game: LLM map/weapon generation, provider
 * selection, API-key storage, connection testing, and history re-application.
 * Extracted from Game.ts to reduce its size.
 *
 * The class owns the AI-only state (aiEngine, aiWeaponSlot, restoreNotice,
 * worldAgent, aiGenerating, contentStorage) and calls back into the game via
 * the GameAIHost bridge interface — the same pattern as GameUI/GameUIHost.
 *
 * @module Demo
 */

import { AIContentEngine } from '../engine/content/AIContentEngine';
import type { ContentPersistence, ContentLogEntry } from '../engine/content/AIContentEngine';
import { OpenAICompatibleProvider, ProceduralFallbackProvider } from '../engine/content/LLMProvider';
import type { MapContentPayload, WeaponContentPayload, WorldContentPayload } from '../engine/content/ContentSchemas';
import { WorldAgent } from '../modes/ai/WorldAgent';
import { AIMode } from '../modes/ai/AIMode';
import { LocalStorageContentStorage } from './ContentHistory';
import { PROVIDER_PRESETS, LLM_KEY_STORAGE } from './GameConstants';
import type { ProviderId } from './GameConstants';
import type { Biome } from '../gameplay/maps/MapGenerator';
import type { GameMode, WorldConfig } from '../modes/GameMode';
import type { MemorySystem } from '../modes/ai/MemorySystem';
import type { WorldMutator } from '../modes/ai/WorldMutator';

/**
 * Bridge interface that DemoGame implements so GameAIContent can act on the
 * live world without importing the full DemoGame class (no circular deps).
 */
export interface GameAIHost {
  /** Lazily initialize gameplay systems on the first engine frame. */
  ensureSystemsInitialized(): void;
  /** The overlay currently on screen: pause menu, else start menu. */
  activeOverlay(): HTMLElement;
  /** Re-render the persisted AI history if its tab is open. */
  refreshHistory(root: HTMLElement): void;
  /** Escape LLM-derived strings before DOM injection. */
  escapeHTML(s: string): string;
  /** Apply an AI-generated map payload to the live world (shared by gen + restore). */
  applyAIMap(map: MapContentPayload): void;
  /** Apply a generated WorldConfig to the live world (weather/time-of-day). */
  applyWorldConfig(wc: WorldContentPayload): void;
  /** Register an AI weapon into the inventory; returns its slot index. */
  registerAIWeapon(payload: WeaponContentPayload): number;
  /** Regenerate the world for a new biome/seed (optional WorldConfig). */
  rebuildWorld(biome: Biome, seed?: number, config?: WorldConfig): void;
  /** Whether the pause menu is currently open (in-menu rebuilds stay paused). */
  isPauseOpen(): boolean;
  /** Toggle the round-active flag (false re-pauses after an in-menu rebuild). */
  setRoundActive(v: boolean): void;
  /** Accessors for live world state the AI content flows mutate. */
  getWorldMutator(): WorldMutator | null;
  getMemory(): MemorySystem | null;
  getWeather(): WorldConfig['weather'];
  getTimeOfDay(): WorldConfig['timeOfDay'];
  setWeather(v: WorldConfig['weather']): void;
  setTimeOfDay(v: WorldConfig['timeOfDay']): void;
  /** The active game mode (null until a mode is entered). */
  getGameMode(): GameMode | null;
}

/**
 * AI content generation for the demo game.
 * Owns the LLM engine, provider presets, key storage, and content history.
 */
export class GameAIContent {
  private aiEngine: AIContentEngine | null = null;
  private aiWeaponSlot = -1;
  private restoreNotice = '';
  private worldAgent: WorldAgent | null = null;
  private aiGenerating = false;
  private contentStorage: LocalStorageContentStorage = new LocalStorageContentStorage();

  constructor(private readonly host: GameAIHost) {}

  /** True while an AI generation request is in flight (guards deploy/resume). */
  get isGenerating(): boolean {
    return this.aiGenerating;
  }

  /** One-line summary of recallable AI content history for memory (R32.3). */
  recallableHistoryLine(): string {
    const state = this.contentStorage.load();
    const log = state?.log ?? [];
    const maps = log.filter((e) => e.type === 'map' || e.type === 'world').length;
    const weapons = log.filter((e) => e.type === 'weapon').length;
    if (maps === 0 && weapons === 0) return '';
    return `Recalled from history: ${maps} map(s), ${weapons} weapon(s) available to re-apply.`;
  }

  /** Read the browser-local LLM API key. */
  loadLLMKey(): string {
    try {
      return localStorage.getItem(LLM_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  }

  /** Persist the LLM API key locally (never in source). */
  saveLLMKey(key: string): void {
    try {
      if (key.trim()) {
        localStorage.setItem(LLM_KEY_STORAGE, key.trim());
      }
    } catch {
      // storage unavailable
    }
  }

  /**
   * Build (or refresh) the World Agent used for prompt-to-world (T3.2/T3.3).
   * Uses the configured LLM provider when a key is present; otherwise the
   * engine falls back to the ProceduralFallbackProvider's keyword
   * interpretation, so AI mode works fully offline.
   */
  ensureWorldAgent(apiKey: string): void {
    const gameMode = this.host.getGameMode();
    if (!gameMode || gameMode.id !== 'ai') return;
    this.saveLLMKey(apiKey);
    const preset = PROVIDER_PRESETS[this.selectedProvider()];
    const provider = apiKey.trim()
      ? new OpenAICompatibleProvider({
          apiKey: apiKey.trim(),
          baseUrl: preset.baseUrl,
          model: preset.model,
          extraHeaders: { 'HTTP-Referer': window.location.origin, 'X-Title': 'Stride Ops' },
        })
      : null;
    this.aiEngine = new AIContentEngine(
      provider ?? undefined,
      new ProceduralFallbackProvider(),
      { storage: this.contentStorage }
    );
    this.worldAgent = new WorldAgent(this.aiEngine);
    (gameMode as AIMode).setWorldAgent(this.worldAgent);
  }

  /**
   * Ask the AI content engine for a map definition, then rebuild the world.
   * Falls back to procedural generation if the LLM call fails.
   */
  async generateAIMap(biome: Biome, apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    if (this.aiGenerating) {
      statusEl.textContent = 'Already generating — please wait.';
      return;
    }
    this.aiGenerating = true;
    try {
      this.saveLLMKey(apiKey);
      const preset = PROVIDER_PRESETS[this.selectedProvider()];
      if (!apiKey.trim()) {
        statusEl.textContent = 'Enter an API key first (stored locally only).';
        return;
      }
      statusEl.textContent = 'Generating map with AI…';
      this.aiEngine = new AIContentEngine(
        new OpenAICompatibleProvider({
          apiKey: apiKey.trim(),
          baseUrl: preset.baseUrl,
          model: preset.model,
          extraHeaders: { 'HTTP-Referer': window.location.origin, 'X-Title': 'Stride Ops' },
        }),
        new ProceduralFallbackProvider(),
        { storage: this.contentStorage }
      );
      const result = await this.aiEngine.generate('map', {
        biome,
        density: 0.55,
        size: { width: 90, depth: 90 },
      });
      if (result && 'seed' in result) {
        const map = result as MapContentPayload;
        this.host.applyAIMap(map);
        statusEl.textContent = `AI map: ${map.biome} · seed ${map.seed} · ${map.coverZones} cover zones · ${map.elevatedPositions} elevated — Ready to deploy`;
      } else {
        statusEl.textContent = 'AI generation failed — using procedural fallback.';
        this.host.rebuildWorld(biome, undefined);
        if (this.host.isPauseOpen()) this.host.setRoundActive(false);
      }
      // Refresh the persisted history if the tab is open
      this.host.refreshHistory(this.host.activeOverlay());
    } catch (error) {
      console.error('[Demo] AI map generation error:', error);
      statusEl.textContent = 'AI map generation error — see console.';
    } finally {
      this.aiGenerating = false;
    }
  }

  /** Ask the AI content engine for a weapon and equip it in the last slot. */
  async generateAIWeapon(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    if (this.aiGenerating) {
      statusEl.textContent = 'Already generating — please wait.';
      return;
    }
    this.aiGenerating = true;
    try {
      this.host.ensureSystemsInitialized();
      this.saveLLMKey(apiKey);
      const preset = PROVIDER_PRESETS[this.selectedProvider()];
      if (!apiKey.trim()) {
        statusEl.textContent = 'Enter an API key first (stored locally only).';
        return;
      }
      statusEl.textContent = 'Generating weapon with AI…';
      this.aiEngine = new AIContentEngine(
        new OpenAICompatibleProvider({
          apiKey: apiKey.trim(),
          baseUrl: preset.baseUrl,
          model: preset.model,
          extraHeaders: { 'HTTP-Referer': window.location.origin, 'X-Title': 'Stride Ops' },
        }),
        new ProceduralFallbackProvider(),
        { storage: this.contentStorage }
      );
      const result = await this.aiEngine.generate('weapon', {
        category: 'rifle',
        theme: 'tactical',
        powerLevel: 0.6,
      });
      if (result && 'name' in result && 'category' in result) {
        const w = result as WeaponContentPayload;
        this.aiWeaponSlot = this.host.registerAIWeapon(w);
        statusEl.textContent = `AI weapon: ${w.name} · ${w.baseDamage} dmg · ${w.fireRate} rpm · slot ${this.aiWeaponSlot + 1}`;
      } else {
        statusEl.textContent = 'AI weapon generation failed — try again.';
      }
      // Refresh the persisted history if the tab is open
      this.host.refreshHistory(this.host.activeOverlay());
    } catch (error) {
      console.error('[Demo] AI weapon generation error:', error);
      statusEl.textContent = 'AI weapon generation error — see console.';
    } finally {
      this.aiGenerating = false;
    }
  }

  /**
   * Re-apply a previously generated payload from the history log:
   * map entries rebuild the world with their seed, weapon entries get
   * registered into the AI weapon slot. Other types aren't applicable
   * to the live demo world and are ignored.
   */
  applyHistoryEntry(entry: ContentLogEntry): void {
    const activeOverlay = this.host.activeOverlay();
    const statusEl = activeOverlay.querySelector('#aiStatus') as HTMLDivElement | null;

    // Don't restore mid-generation — the in-flight rebuild would swap the
    // world out from under the player (same guard as Deploy/Resume).
    if (this.aiGenerating) {
      if (statusEl) statusEl.textContent = 'AI generation in progress — please wait.';
      return;
    }

    if (entry.type === 'map') {
      const map = entry.payload as MapContentPayload;
      this.host.applyAIMap(map);
      if (statusEl) statusEl.textContent = `Restored map: ${map.biome} · seed ${map.seed} · #${entry.hash}`;
      this.restoreNotice = `↺ Restored map — ${this.host.escapeHTML(map.biome)} · seed ${map.seed} · #${entry.hash}`;
    } else if (entry.type === 'world') {
      const world = entry.payload as WorldContentPayload;
      this.host.applyWorldConfig(world);
      if (statusEl) statusEl.textContent = `Restored world: ${world.biome} · ${world.weather}/${world.timeOfDay} · #${entry.hash}`;
      this.restoreNotice = `↺ Restored world — ${this.host.escapeHTML(world.biome)} · ${world.weather}/${world.timeOfDay} · #${entry.hash}`;
    } else if (entry.type === 'weapon') {
      this.host.ensureSystemsInitialized();
      const weapon = entry.payload as WeaponContentPayload;
      this.aiWeaponSlot = this.host.registerAIWeapon(weapon);
      if (statusEl) statusEl.textContent = `Restored weapon: ${weapon.name} · slot ${this.aiWeaponSlot + 1} · #${entry.hash}`;
      this.restoreNotice = `↺ Restored weapon — ${this.host.escapeHTML(weapon.name)} · slot ${this.aiWeaponSlot + 1} · #${entry.hash}`;
    } else {
      return; // mission/balance payloads aren't applicable to the live world
    }

    this.host.refreshHistory(activeOverlay);
  }

  /**
   * Ping the selected LLM provider with a minimal completion (max_tokens: 1)
   * to verify the API key + model route before deploying. Reports latency and
   * the model that world/weapon generation would use.
   */
  async testLLMConnection(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    const preset = PROVIDER_PRESETS[this.selectedProvider()];
    const key = apiKey.trim();
    if (!key) {
      statusEl.textContent = 'Enter an API key first (stored locally only).';
      return;
    }
    this.saveLLMKey(key);
    statusEl.textContent = '⏳ Testing connection…';
    const started = performance.now();
    try {
      const res = await fetch(`${preset.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Stride Ops',
        },
        body: JSON.stringify({
          model: preset.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        }),
      });
      const latency = Math.round(performance.now() - started);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        statusEl.textContent = `❌ HTTP ${res.status} — ${this.llmErrorSummary(detail)} (${latency}ms)`;
        return;
      }
      statusEl.textContent = `✅ Connected — ${preset.model} · ${latency}ms`;
    } catch (error) {
      const latency = Math.round(performance.now() - started);
      console.warn('[Demo] LLM connection test failed:', error);
      statusEl.textContent = `❌ Connection failed (${latency}ms) — network/CORS error, see console.`;
    }
  }

  /** Pull a short, human-readable reason out of an LLM error body. */
  private llmErrorSummary(body: string): string {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; code?: string | number } };
      if (parsed.error?.message) return parsed.error.message.slice(0, 120);
    } catch {
      // not JSON — fall through to the generic message
    }
    return 'request rejected';
  }

  private selectedProvider(): ProviderId {
    // The provider dropdown lives in whichever overlay is active: the pause
    // menu (in-game) or the start menu (main menu).
    const root = this.host.activeOverlay();
    const sel = root.querySelector('#providerSel') as HTMLSelectElement | null;
    const v = sel?.value;
    return v && v in PROVIDER_PRESETS ? (v as ProviderId) : 'openrouter';
  }

  // ─── GameUIHost bridge methods (delegated from DemoGame) ────────────────────

  loadLLMKeyInternal(): string {
    return this.loadLLMKey();
  }

  async generateAIMapInternal(biome: Biome, apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.generateAIMap(biome, apiKey, statusEl);
  }

  async generateAIWeaponInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.generateAIWeapon(apiKey, statusEl);
  }

  async testLLMConnectionInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.testLLMConnection(apiKey, statusEl);
  }

  clearAIEngineLogInternal(): void {
    this.aiEngine?.clearLog();
    this.contentStorage.clear();
  }

  applyHistoryEntryInternal(hash: string, _statusEl: HTMLDivElement | null): void {
    const state = this.contentStorage.load();
    const entry = state?.log.find((en) => en.hash === hash);
    if (entry) this.applyHistoryEntry(entry);
  }

  applyLiveMutationInternal(m: { weather?: WorldConfig['weather']; timeOfDay?: WorldConfig['timeOfDay'] }): void {
    const mutator = this.host.getWorldMutator();
    if (this.host.isPauseOpen() && mutator) {
      mutator.apply(m);
      if (m.weather) this.host.setWeather(m.weather);
      if (m.timeOfDay) this.host.setTimeOfDay(m.timeOfDay);
      this.host.getMemory()?.recordWorldMutation(m.weather, m.timeOfDay);
    }
  }

  getContentStorageInternal(): ContentPersistence {
    return this.contentStorage;
  }

  getRestoreNoticeInternal(): string {
    const notice = this.restoreNotice;
    this.restoreNotice = '';
    return notice;
  }

  /** Null the World Agent reference on game teardown. */
  dispose(): void {
    this.worldAgent = null;
  }
}
