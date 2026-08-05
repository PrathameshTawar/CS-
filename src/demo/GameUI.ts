/**
 * GameUI.ts
 *
 * DOM-based settings overlays, pause menu, history rendering, and key bindings
 * for the demo game. Extracted from Game.ts to reduce its size.
 *
 * @module Demo
 */

import { Biome } from '../gameplay/maps/MapGenerator';
import type { ContentLogEntry, ContentPersistence } from '../engine/content/AIContentEngine';
import type { Difficulty, WorldConfig } from '../modes/GameMode';
import { PROVIDER_PRESETS } from './GameConstants';
import type { ProviderId } from './GameConstants';

/**
 * Bridge interface that DemoGame implements so GameUI can call back without
 * importing the full DemoGame class (avoiding circular dependencies).
 */
export interface GameUIHost {
  loadLLMKeyInternal(): string;
  generateAIMapInternal(biome: Biome, apiKey: string, statusEl: HTMLDivElement): Promise<void>;
  generateAIWeaponInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void>;
  testLLMConnectionInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void>;
  clearAIEngineLogInternal(): void;
  applyHistoryEntryInternal(hash: string, statusEl: HTMLDivElement | null): void;
  applyLiveMutationInternal(m: { weather?: WorldConfig['weather']; timeOfDay?: WorldConfig['timeOfDay'] }): void;
  getContentStorageInternal(): ContentPersistence;
  getRestoreNoticeInternal(): string;
}

/**
 * Wire result from the settings panel — shared by start overlay and pause menu.
 */
export interface SettingsPanelResult {
  biomeSel: HTMLSelectElement | null;
  diffSel: HTMLSelectElement;
  apiKeyInput: HTMLInputElement | null;
  statusEl: HTMLDivElement | null;
  promptInput: HTMLInputElement | null;
  weatherSel: HTMLSelectElement | null;
  timeSel: HTMLSelectElement | null;
}

/**
 * DOM-based UI helper for the demo game.
 * Owns the start overlay, pause menu, message elements, and key bindings.
 */
export class GameUI {
  readonly startOverlay: HTMLDivElement;
  messageEl: HTMLDivElement;
  pauseOverlay: HTMLDivElement | null = null;

  constructor(
    private readonly game: GameUIHost,
  ) {
    this.startOverlay = document.createElement('div');
    this.messageEl = document.createElement('div');
  }

  /** Show a transient message on screen. */
  showMessage(text: string, big: boolean): void {
    this.messageEl.textContent = text;
    this.messageEl.style.fontSize = big ? '32px' : '16px';
    this.messageEl.style.opacity = '1';
    setTimeout(() => {
      this.messageEl.style.opacity = '0';
    }, 3000);
  }

  /** The overlay currently on screen: the pause menu, else the start menu. */
  activeOverlay(): HTMLElement {
    return this.pauseOverlay?.isConnected ? this.pauseOverlay : this.startOverlay;
  }

  /** Shared settings-panel CSS. */
  settingsStyles(): string {
    return `
      <style>
        .so-panel { width: 460px; max-width: 92vw; background: rgba(10,14,20,0.72); border: 1px solid rgba(255,255,255,0.16); border-top: 1px solid rgba(255,255,255,0.28); border-radius: 16px; padding: 28px; backdrop-filter: blur(10px) saturate(1.3); -webkit-backdrop-filter: blur(10px) saturate(1.3); box-shadow: 0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06); }
        .so-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0; }
        .so-row label { font-size: 13px; opacity: 0.75; min-width: 110px; }
        .so-row select, .so-row input { flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.4); color: #fff; font-size: 14px; }
        .so-hint { font-size: 12px; opacity: 0.55; line-height: 1.7; }
        .so-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0; }
        .so-actions { display: flex; gap: 10px; margin-top: 14px; }
        .so-actions button { flex: 1; padding: 13px 20px; font-size: 15px; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; }
        .so-back { background: rgba(255,255,255,0.10); color: #fff; }
        .so-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
        .so-tab { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #fff; cursor: pointer; font-size: 13px; font-weight: 600; }
        .so-tab-active { background: rgba(124,58,237,0.35); border-color: rgba(124,58,237,0.6); }
        .so-hist-entry { border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: rgba(0,0,0,0.25); }
      </style>`;
  }

  /** Shared settings panel markup. */
  settingsPanelHTML(aiPanel: boolean): string {
    const biomeOptions = Object.values(Biome)
      .map((b) => `<option value="${b}">${b.charAt(0).toUpperCase() + b.slice(1)}</option>`)
      .join('');
    const diffOptions = (['easy', 'normal', 'hard'] as Difficulty[])
      .map((d) => `<option value="${d}">${d.charAt(0).toUpperCase() + d.slice(1)}</option>`)
      .join('');
    const aiBody = aiPanel
      ? `
        <div class="so-divider"></div>
        <div class="so-row" style="align-items:flex-start">
          <label for="worldPrompt" style="padding-top:9px">Describe your adventure</label>
          <input id="worldPrompt" type="text" placeholder="e.g. snowy abandoned military base at night" autocomplete="off" style="min-height:38px" />
        </div>
        <div class="so-row" style="justify-content:flex-start;gap:10px">
          <label for="weatherSel" style="min-width:80px">Weather</label>
          <select id="weatherSel" style="flex:0 0 120px">
            <option value="clear">Clear</option>
            <option value="storm">Storm</option>
            <option value="fog">Fog</option>
            <option value="snow">Snow</option>
            <option value="ash">Ash</option>
          </select>
          <label for="timeSel" style="min-width:80px">Time</label>
          <select id="timeSel" style="flex:0 0 120px">
            <option value="day">Day</option>
            <option value="dusk">Dusk</option>
            <option value="night">Night</option>
          </select>
        </div>
        <div class="so-divider"></div>
        <div class="so-row">
          <label for="biomeSel">Map biome</label>
          <select id="biomeSel">${biomeOptions}</select>
        </div>
        <div class="so-divider"></div>
        <div class="so-row">
          <label for="providerSel">LLM provider</label>
          <select id="providerSel">
            ${(Object.keys(PROVIDER_PRESETS) as ProviderId[])
              .map((p) => `<option value="${p}">${PROVIDER_PRESETS[p].label}</option>`)
              .join('')}
          </select>
        </div>
        <div class="so-row">
          <label for="apiKey">API key</label>
          <input id="apiKey" type="password" placeholder="sk-or-v1-… (stored locally only)" autocomplete="off" />
        </div>
        <div class="so-row" style="justify-content:flex-start;flex-wrap:wrap">
          <button id="aiMapBtn" style="padding:10px 18px;font-size:14px;background:#7c3aed;border:none;border-radius:8px;color:#fff;cursor:pointer">✨ Generate AI map</button>
          <button id="aiWeaponBtn" style="padding:10px 18px;font-size:14px;background:#0ea5e9;border:none;border-radius:8px;color:#fff;cursor:pointer">🔫 Generate AI weapon</button>
          <button id="aiTestBtn" style="padding:10px 18px;font-size:14px;background:#22c55e;border:none;border-radius:8px;color:#fff;cursor:pointer">🔌 Test connection</button>
        </div>
        <div id="aiStatus" style="margin-top:10px;font-size:12px;opacity:0.8;min-height:16px;color:#a7f3d0"></div>`
      : '';
    const tabs = aiPanel
      ? `<div class="so-tabs">
        <button id="tabSettings" class="so-tab so-tab-active" type="button">⚙ Settings</button>
        <button id="tabHistory" class="so-tab" type="button">🕘 History</button>
      </div>`
      : '';
    const history = aiPanel
      ? `
      <div id="historyBody" style="display:none">
        <div id="aiHistory" style="max-height:240px;overflow-y:auto;margin:4px 0 10px;min-height:40px"></div>
        <button id="clearHistoryBtn" style="padding:8px 14px;font-size:12px;background:rgba(255,255,255,0.12);border:none;border-radius:8px;color:#fff;cursor:pointer">🗑 Clear history</button>
      </div>`
      : '';
    return `
      ${tabs}
      <div id="settingsBody">
        <div class="so-row">
          <label for="diffSel">Difficulty</label>
          <select id="diffSel">${diffOptions}</select>
        </div>
        ${aiBody}
      </div>
      ${history}`;
  }

  /** Wire the shared settings controls inside a container. */
  wireSettingsPanel(root: HTMLElement, aiPanel: boolean): SettingsPanelResult {
    const biomeSel = root.querySelector('#biomeSel') as HTMLSelectElement | null;
    const diffSel = root.querySelector('#diffSel') as HTMLSelectElement;
    const apiKeyInput = root.querySelector('#apiKey') as HTMLInputElement | null;
    const statusEl = root.querySelector('#aiStatus') as HTMLDivElement | null;
    const promptInput = root.querySelector('#worldPrompt') as HTMLInputElement | null;
    const weatherSel = root.querySelector('#weatherSel') as HTMLSelectElement | null;
    const timeSel = root.querySelector('#timeSel') as HTMLSelectElement | null;
    if (apiKeyInput) apiKeyInput.value = this.game.loadLLMKeyInternal();

    if (aiPanel) {
      root.querySelector('#aiMapBtn')!.addEventListener('click', () => {
        void this.game.generateAIMapInternal(biomeSel!.value as Biome, apiKeyInput!.value, statusEl!);
      });
      root.querySelector('#aiWeaponBtn')!.addEventListener('click', () => {
        void this.game.generateAIWeaponInternal(apiKeyInput!.value, statusEl!);
      });
      root.querySelector('#aiTestBtn')!.addEventListener('click', () => {
        void this.game.testLLMConnectionInternal(apiKeyInput!.value, statusEl!);
      });

      const settingsBody = root.querySelector('#settingsBody') as HTMLDivElement;
      const historyBody = root.querySelector('#historyBody') as HTMLDivElement;
      const tabSettings = root.querySelector('#tabSettings') as HTMLButtonElement;
      const tabHistory = root.querySelector('#tabHistory') as HTMLButtonElement;
      const historyList = root.querySelector('#aiHistory') as HTMLDivElement;
      const showTab = (tab: 'settings' | 'history'): void => {
        const isSettings = tab === 'settings';
        settingsBody.style.display = isSettings ? '' : 'none';
        historyBody.style.display = isSettings ? 'none' : '';
        tabSettings.classList.toggle('so-tab-active', isSettings);
        tabHistory.classList.toggle('so-tab-active', !isSettings);
        if (!isSettings) this.renderHistory(historyList);
      };
      tabSettings.addEventListener('click', () => showTab('settings'));
      tabHistory.addEventListener('click', () => showTab('history'));

      root.querySelector('#clearHistoryBtn')!.addEventListener('click', () => {
        this.game.clearAIEngineLogInternal();
        this.renderHistory(historyList);
      });

      historyList.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-restore]') as HTMLButtonElement | null;
        if (!btn) return;
        const hash = btn.getAttribute('data-restore')!;
        this.game.applyHistoryEntryInternal(hash, statusEl);
      });

      const applyLive = (m: { weather?: WorldConfig['weather']; timeOfDay?: WorldConfig['timeOfDay'] }): void => {
        this.game.applyLiveMutationInternal(m);
      };
      weatherSel?.addEventListener('change', () => {
        applyLive({ weather: weatherSel.value as WorldConfig['weather'] });
      });
      timeSel?.addEventListener('change', () => {
        applyLive({ timeOfDay: timeSel.value as WorldConfig['timeOfDay'] });
      });
    }
    return { biomeSel, diffSel, apiKeyInput, statusEl, promptInput, weatherSel, timeSel };
  }

  /** Re-render the persisted AI content history. */
  renderHistory(container: HTMLDivElement): void {
    const state = this.game.getContentStorageInternal().load();
    const stats = state?.stats;
    const entries = state?.log ?? [];
    const statsLine = stats
      ? `Generated ${stats.generated} · validated ${stats.validated} · retried ${stats.retried} · fallbacks ${stats.fallbacks} · rejected ${stats.rejected}`
      : 'No stats yet';
    if (entries.length === 0) {
      container.innerHTML = `<div style="opacity:0.6;padding:6px 0;font-size:12px">${statsLine}<br>No AI content generated yet — generate a map or weapon to populate history.</div>`;
      return;
    }
    const notice = this.game.getRestoreNoticeInternal();
    const items = entries
      .slice()
      .reverse()
      .map((e) => this.historyEntryHTML(e))
      .join('');
    container.innerHTML = `<div style="opacity:0.6;margin-bottom:8px;font-size:11px">${statsLine}</div>${notice}${items}`;
  }

  /** Refresh the history list if the history tab is currently open. */
  refreshHistory(root: HTMLElement): void {
    const body = root.querySelector('#historyBody') as HTMLDivElement | null;
    if (!body || body.style.display === 'none') return;
    const list = root.querySelector('#aiHistory') as HTMLDivElement | null;
    if (list) this.renderHistory(list);
  }

  private historyEntryHTML(entry: ContentLogEntry): string {
    const time = new Date(entry.timestamp).toLocaleString();
    const color =
      entry.type === 'weapon' ? '#0ea5e9'
      : entry.type === 'map' || entry.type === 'world' ? '#a78bfa'
      : entry.type === 'mission' ? '#f59e0b' : '#34d399';
    const applicable = entry.type === 'map' || entry.type === 'weapon' || entry.type === 'world';
    const applyBtn = applicable
      ? `<button data-restore="${entry.hash}" style="flex-shrink:0;padding:5px 10px;font-size:11px;background:rgba(34,197,94,0.18);border:1px solid rgba(34,197,94,0.5);border-radius:6px;color:#86efac;cursor:pointer">↺ Apply</button>`
      : '';
    return `
      <div class="so-hist-entry">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span>
            <span style="color:${color};font-weight:700;text-transform:uppercase">${entry.type}</span>
            <span style="opacity:0.55;font-size:11px;margin-left:6px">${time}</span>
          </span>
          <span style="font-family:monospace;font-size:11px;opacity:0.85">${entry.provider} · #${entry.hash}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:3px">
          <div style="opacity:0.9;font-size:12px;flex:1">${this.summarizePayload(entry)}</div>
          ${applyBtn}
        </div>
      </div>`;
  }

  private summarizePayload(entry: ContentLogEntry): string {
    const p = entry.payload as unknown as Record<string, unknown>;
    switch (entry.type) {
      case 'weapon':
        return `${this.escapeHTML(String(p.name ?? '?'))} · ${p.baseDamage ?? 0} dmg · ${p.fireRate ?? 0} rpm · mag ${p.magazineSize ?? 0}`;
      case 'map':
        return `${this.escapeHTML(String(p.biome ?? '?'))} · seed ${p.seed ?? 0} · density ${p.density ?? 0} · ${p.coverZones ?? 0} zones · ${p.elevatedPositions ?? 0} elevated`;
      case 'world':
        return `${this.escapeHTML(String(p.biome ?? '?'))} · ${p.weather ?? 'clear'}/${p.timeOfDay ?? 'day'} · seed ${p.seed ?? 0} · ${p.buildings ?? 0} bldg · ${this.escapeHTML(String(p.mood ?? ''))}`;
      case 'mission':
        return `${this.escapeHTML(String(p.title ?? '?'))} · ${p.objectiveType ?? '?'} · targets ${p.targetCount ?? 0}`;
      case 'balance':
        return `${this.escapeHTML(String(p.difficulty ?? '?'))} ${this.escapeHTML(String(p.enemyClass ?? '?'))} · hp×${Number(p.healthMultiplier ?? 0).toFixed(2)} · acc×${Number(p.accuracyMultiplier ?? 0).toFixed(2)}`;
      default:
        return this.escapeHTML(JSON.stringify(entry.payload)).slice(0, 90);
    }
  }

  /** Escape LLM-derived strings before injecting them into the DOM. */
  escapeHTML(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
}