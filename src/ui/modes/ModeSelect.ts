/**
 * ModeSelect.ts
 *
 * Full-screen CLASSIC / AI boot screen (Requirement 26, T0.3).
 * Mouse + keyboard (1 / 2) selection, and a `?mode=` query-param fast-boot
 * (R26.5). The resolver is a pure static method so it is unit-testable
 * without a DOM.
 *
 * @module UI
 */

import type { GameModeId } from '../../modes/GameMode';

export class ModeSelect {
  private el: HTMLDivElement | null = null;
  private onSelect: ((id: GameModeId) => void) | null = null;

  private readonly keyHandler = (e: KeyboardEvent): void => {
    if (e.code === 'Digit1' || e.key === '1') this.pick('classic');
    else if (e.code === 'Digit2' || e.key === '2') this.pick('ai');
    else if (e.code === 'Digit3' || e.key === '3') this.pick('creator');
  };

  /** Parse `?mode=classic|ai|creator`; returns null when absent/invalid (R26.5). */
  static resolveFromQuery(params: URLSearchParams): GameModeId | null {
    const mode = params.get('mode');
    return mode === 'classic' || mode === 'ai' || mode === 'creator' ? mode : null;
  }

  /** Show the mode-select overlay over the given container. */
  show(container: HTMLElement, onSelect: (id: GameModeId) => void): void {
    this.hide();
    this.onSelect = onSelect;
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:radial-gradient(1200px 700px at 50% 30%, rgba(30,20,60,0.55), rgba(5,8,12,0.96));' +
      'z-index:30;color:#fff;font-family:system-ui;overflow:auto;';
    this.el.innerHTML = `
      <style>
        .ms-wrap { text-align:center; padding: 32px; }
        .ms-title { font-size:52px; margin:0 0 6px; letter-spacing:6px; text-shadow:0 0 30px rgba(124,58,237,0.35); }
        .ms-sub { opacity:0.65; margin:0 0 34px; font-size:14px; letter-spacing:1px; }
        .ms-cards { display:flex; gap:22px; justify-content:center; flex-wrap:wrap; }
        .ms-card { width:300px; padding:30px 26px; border-radius:16px; cursor:pointer; text-align:left;
          border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.04);
          transition:transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease; }
        .ms-card:hover, .ms-card:focus-visible { transform:translateY(-4px); background:rgba(255,255,255,0.07); outline:none; }
        .ms-card:active { transform:translateY(-1px); }
        .ms-classic:hover, .ms-classic:focus-visible { border-color:rgba(34,197,94,0.7); box-shadow:0 8px 40px rgba(34,197,94,0.22); }
        .ms-ai:hover, .ms-ai:focus-visible { border-color:rgba(124,58,237,0.8); box-shadow:0 8px 40px rgba(124,58,237,0.28); }
        .ms-creator:hover, .ms-creator:focus-visible { border-color:rgba(245,158,11,0.8); box-shadow:0 8px 40px rgba(245,158,11,0.28); }
        .ms-badge { display:inline-block; font-size:11px; font-weight:700; letter-spacing:2px; padding:4px 10px; border-radius:999px; margin-bottom:14px; }
        .ms-badge-c { background:rgba(34,197,94,0.16); color:#4ade80; border:1px solid rgba(34,197,94,0.4); }
        .ms-badge-a { background:rgba(124,58,237,0.18); color:#a78bfa; border:1px solid rgba(124,58,237,0.5); }
        .ms-badge-cr { background:rgba(245,158,11,0.18); color:#fcd34d; border:1px solid rgba(245,158,11,0.5); }
        .ms-name { font-size:26px; font-weight:800; margin:0 0 10px; letter-spacing:1px; }
        .ms-desc { font-size:13px; line-height:1.75; opacity:0.75; margin:0 0 16px; }
        .ms-key { display:inline-block; font-size:11px; opacity:0.5; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:3px 8px; }
        .ms-foot { margin-top:30px; font-size:12px; opacity:0.45; }
      </style>
      <div class="ms-wrap">
        <h1 class="ms-title">STRIDE OPS</h1>
        <p class="ms-sub">AI-NATIVE FPS ENGINE — CHOOSE YOUR MODE</p>
        <div class="ms-cards">
          <button id="msClassic" class="ms-card ms-classic" type="button" tabindex="0">
            <span class="ms-badge ms-badge-c">MODE 1</span>
            <h2 class="ms-name">CLASSIC</h2>
            <p class="ms-desc">Fixed maps &amp; rules. Deterministic and replayable — the same
              experience every time, fully offline, like a traditional game.</p>
            <span class="ms-key">PRESS 1</span>
          </button>
          <button id="msAI" class="ms-card ms-ai" type="button" tabindex="0">
            <span class="ms-badge ms-badge-a">MODE 2</span>
            <h2 class="ms-name">AI</h2>
            <p class="ms-desc">Living world. Generate maps &amp; weapons with an LLM, adapt
              difficulty live, and let the engine evolve while you play.</p>
            <span class="ms-key">PRESS 2</span>
          </button>
          <button id="msCreator" class="ms-card ms-creator" type="button" tabindex="0">
            <span class="ms-badge ms-badge-cr">MODE 3</span>
            <h2 class="ms-name">CREATOR</h2>
            <p class="ms-desc">AI-powered level editor. Edit lighting, weather, and spawn/remove
              entities live using natural language without restarting.</p>
            <span class="ms-key">PRESS 3</span>
          </button>
        </div>
        <p class="ms-foot">Tip: launch straight into a mode with ?mode=classic, ?mode=ai, or ?mode=creator</p>
      </div>`;
    container.appendChild(this.el);
    this.el.querySelector('#msClassic')!.addEventListener('click', () => this.pick('classic'));
    this.el.querySelector('#msAI')!.addEventListener('click', () => this.pick('ai'));
    this.el.querySelector('#msCreator')!.addEventListener('click', () => this.pick('creator'));
    document.addEventListener('keydown', this.keyHandler);
  }

  hide(): void {
    document.removeEventListener('keydown', this.keyHandler);
    this.el?.remove();
    this.el = null;
    this.onSelect = null;
  }

  private pick(id: GameModeId): void {
    const cb = this.onSelect;
    this.hide();
    cb?.(id);
  }
}
