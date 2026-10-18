// ui/settings.js — the SETTINGS panel, opened from the start menu and the ESC
// menu. Mouse sensitivity, field of view, invert-Y, volume and the stats
// overlay apply immediately; graphics quality needs a reload (it sizes the
// renderer and shadow maps at boot), which the panel offers.

import {
  DEFAULT_SETTINGS,
  QUALITY_CHOICES,
  SETTINGS_RANGES,
  loadSettings,
  saveSettings,
  settingsToConfig,
} from '../core/settings.js';

export class SettingsPanel {
  constructor(ctx) {
    this.ctx = ctx;
    this.open = false;
    this.settings = loadSettings();
    this._bootQuality = this.settings.quality; // what this page loaded with
    this._onClose = null;
    this._build();
    // Esc closes only the panel (not the menu underneath)
    this._onKey = (e) => {
      if (this.open && e.code === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onKey, true);
  }

  show(onClose = null) {
    this._onClose = onClose;
    this.settings = loadSettings();
    this._sync();
    this.open = true;
    this._el.classList.add('active');
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this._el.classList.remove('active');
    const done = this._onClose;
    this._onClose = null;
    if (done) done();
  }

  // Saves and applies everything that can change live.
  _apply() {
    saveSettings(this.settings);
    const params = new URL(location.href).searchParams;
    const c = settingsToConfig(this.settings, new URLSearchParams()); // the menu beats old URL values
    const config = this.ctx.config;
    config.mouseSensitivity = c.mouseSensitivity;
    config.fov = c.fov;
    config.invertY = c.invertY;
    config.showStats = c.showStats || params.has('debug');
    const audio = this.ctx.peek('audio');
    if (audio) audio.setVolume(c.volume);
    else config.volume = c.volume;
    const dev = this.ctx.peek('dev');
    if (dev && dev.setVisible) dev.setVisible(config.showStats);
    this._sync();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'ow-settings';
    el.className = 'ow-menu-overlay';
    el.style.zIndex = '10001'; // above the start and pause menus
    const r = SETTINGS_RANGES;
    const slider = (key, label, unit = '') =>
      `<div class="ow-field-group">` +
      `<label class="ow-field-label" style="display:flex;justify-content:space-between">${label}<span data-out="${key}" style="color:#e2e8f0"></span></label>` +
      `<input type="range" data-key="${key}" min="${r[key].min}" max="${r[key].max}" step="${r[key].step}" data-unit="${unit}" ` +
      `style="width:100%;accent-color:#3b82f6;cursor:pointer" /></div>`;
    const toggle = (key, label) =>
      `<label style="display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#cbd5e1;font-size:13px;cursor:pointer">` +
      `<input type="checkbox" data-key="${key}" style="width:16px;height:16px;accent-color:#3b82f6" />${label}</label>`;
    el.innerHTML = `
      <div class="ow-pause-dialog" style="text-align:left;width:460px">
        <h2 class="ow-pause-title" style="text-align:center">SETTINGS</h2>
        ${slider('sensitivity', 'Mouse sensitivity')}
        ${toggle('invertY', 'Invert mouse Y')}
        ${slider('fov', 'Field of view', '°')}
        ${slider('volume', 'Volume', '%')}
        <div class="ow-field-group">
          <label class="ow-field-label">Graphics quality</label>
          <div class="ow-options-grid" style="grid-template-columns:repeat(5,1fr)">
            ${QUALITY_CHOICES.map((q) => `<div class="ow-opt-btn" data-quality="${q}">${q.toUpperCase()}</div>`).join('')}
          </div>
          <div data-reload style="display:none;margin-top:8px;font-size:12px;color:#fbbf24">
            Quality changes apply after a reload. <a href="#" data-reload-now style="color:#93c5fd">Reload now</a>
          </div>
        </div>
        ${toggle('showStats', 'Show performance stats (FPS)')}
        <div style="display:flex;gap:12px;margin-top:8px">
          <button class="ow-secondary-btn" data-reset style="flex:1;margin:0">DEFAULTS</button>
          <button class="ow-primary-btn" data-done style="flex:1;margin:0">DONE</button>
        </div>
      </div>`;

    el.addEventListener('input', (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      this.settings[key] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
      this._apply();
    });
    el.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.quality) {
        this.settings.quality = t.dataset.quality;
        this._apply();
      } else if (t.dataset.reset !== undefined) {
        this.settings = { ...DEFAULT_SETTINGS };
        this._apply();
      } else if (t.dataset.done !== undefined) {
        this.close();
      } else if (t.dataset.reloadNow !== undefined) {
        e.preventDefault();
        // a ?q= in the address would override the new choice
        const url = new URL(location.href);
        url.searchParams.delete('q');
        url.searchParams.delete('quality');
        location.href = url.href;
      } else if (t === el) {
        this.close(); // click outside the dialog
      }
    });
    document.body.appendChild(el);
    this._el = el;
  }

  // Puts the current settings into the controls.
  _sync() {
    const s = this.settings;
    for (const input of this._el.querySelectorAll('[data-key]')) {
      const key = input.dataset.key;
      if (input.type === 'checkbox') input.checked = s[key];
      else input.value = String(s[key]);
      const out = this._el.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = `${key === 'sensitivity' ? s[key].toFixed(2) : s[key]}${input.dataset.unit || ''}`;
    }
    for (const b of this._el.querySelectorAll('[data-quality]')) b.classList.toggle('active', b.dataset.quality === s.quality);
    this._el.querySelector('[data-reload]').style.display = s.quality !== this._bootQuality ? 'block' : 'none';
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey, true);
    this._el.remove();
  }
}
