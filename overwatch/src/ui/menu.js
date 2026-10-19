// src/ui/menu.js — Start Menu & In-Game ESC Pause / Exit Dialog.
//
// Features:
// 1. Start Menu: Single Player vs Multiplayer selection.
//    - Single Player: map (Arena / Plaza), time-of-day (Golden, Day, Dusk, Night), Deploy button.
//    - Multiplayer: server address (remembers last used), player name, map, mode (Teams / DM), room name, Join button.
// 2. In-Game ESC Menu:
//    - When the player presses ESC during a match, exits pointer lock and displays:
//      "Would you like to close the game menu?"
//    - Options: "Resume Game" (closes menu, re-locks pointer) and "Exit Match" (quits to Start Menu).

import { defaultServerUrl } from '../core/config.js';
import { SettingsPanel } from './settings.js';
import { inviteUrl, pickQuickPlay, readInvite, roomCode, roomsUrl } from '../../shared/lobby.js';

const MODE_LABELS = { bomb: 'BOMB DEFUSAL', teams: 'TEAM ROUNDS', dm: 'DEATHMATCH' };
const ROOMS_POLL_MS = 4000;

const DEFAULT_SERVER = defaultServerUrl(location, import.meta.env?.VITE_SERVER_URL);

export class MenuManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.isOpen = false;
    this.isPauseOpen = false;
    this._el = null;
    this._pauseEl = null;
    this._subs = [];

    // Load saved preferences. Storage can be unavailable (private windows,
    // blocked site data) and then throws: fall back to defaults rather than
    // failing the whole boot.
    const saved = (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    this.prefs = {
      server: saved('ow_server') || DEFAULT_SERVER,
      name: saved('ow_name') || 'player',
      map: saved('ow_map') || (ctx.config.map || 'arena'),
      mode: saved('ow_mode') || 'bomb',
      room: saved('ow_room') || 'public',
      time: saved('ow_time') || (ctx.config.timeOfDay || 'golden'),
      bots: saved('ow_bots') !== '0', // matches you start fill empty seats with bots
    };
  }

  savePrefs() {
    try {
      localStorage.setItem('ow_server', this.prefs.server);
      localStorage.setItem('ow_name', this.prefs.name);
      localStorage.setItem('ow_map', this.prefs.map);
      localStorage.setItem('ow_mode', this.prefs.mode);
      localStorage.setItem('ow_room', this.prefs.room);
      localStorage.setItem('ow_time', this.prefs.time);
      localStorage.setItem('ow_bots', this.prefs.bots ? '1' : '0');
    } catch {
      // localStorage may be disabled
    }
  }

  init() {
    if (this.ctx.config.shot) return; // never render in headless screenshot capture

    this._rooms = []; // the last room list (GET /rooms)
    this._injectStyles();
    this._buildPauseModal();
    this._buildStartMenu();
    this.settings = new SettingsPanel(this.ctx);
    this._wireEvents();

    const url = new URL(location.href);
    const hasExplicitPlay = url.searchParams.has('play') || url.searchParams.has('server');

    // If root address with no parameters, present Start Menu
    if (!hasExplicitPlay) {
      this.showStartMenu();
      // an invite link (?join=CODE): straight to multiplayer with that room
      const invite = readInvite(location.href);
      if (invite) this._showInvite(invite);
    }
  }

  _injectStyles() {
    if (document.getElementById('ow-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'ow-menu-styles';
    style.textContent = `
      .ow-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at center, rgba(14, 20, 32, 0.94) 0%, rgba(6, 9, 15, 0.98) 100%);
        backdrop-filter: blur(20px);
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #e6edf7;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .ow-menu-overlay.active {
        opacity: 1;
        pointer-events: auto;
      }
      .ow-menu-container {
        width: 680px;
        max-width: 92vw;
        max-height: 96vh;
        overflow-y: auto;
        background: rgba(18, 25, 40, 0.88);
        border: 1px solid rgba(80, 140, 255, 0.35);
        border-radius: 8px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 32px rgba(60, 120, 255, 0.15);
        overflow: hidden;
        animation: owMenuPop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes owMenuPop {
        from { transform: scale(0.96) translateY(8px); opacity: 0; }
        to { transform: scale(1) translateY(0); opacity: 1; }
      }
      .ow-menu-header {
        padding: 24px 32px 18px;
        background: linear-gradient(180deg, rgba(30, 45, 75, 0.6) 0%, rgba(20, 30, 50, 0) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .ow-logo-title {
        font-size: 26px;
        font-weight: 800;
        letter-spacing: 6px;
        color: #ffffff;
        text-shadow: 0 0 20px rgba(90, 160, 255, 0.6);
        margin: 0;
      }
      .ow-logo-sub {
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: #7d96b8;
        margin-top: 4px;
      }
      .ow-tabs {
        display: flex;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(12, 17, 28, 0.5);
      }
      .ow-tab-btn {
        flex: 1;
        padding: 14px 20px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: #8da2c0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .ow-tab-btn:hover {
        color: #dbe7f8;
        background: rgba(255, 255, 255, 0.03);
      }
      .ow-tab-btn.active {
        color: #60a5fa;
        border-bottom-color: #3b82f6;
        background: rgba(59, 130, 246, 0.08);
      }
      .ow-menu-body {
        padding: 26px 32px;
      }
      .ow-field-group {
        margin-bottom: 18px;
      }
      .ow-field-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #9cb2cf;
        margin-bottom: 8px;
      }
      .ow-input-text {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 14px;
        background: rgba(10, 15, 26, 0.7);
        border: 1px solid rgba(80, 120, 180, 0.35);
        border-radius: 4px;
        color: #ffffff;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s;
      }
      .ow-input-text:focus {
        border-color: #60a5fa;
        box-shadow: 0 0 10px rgba(96, 165, 250, 0.25);
      }
      .ow-card-selector {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .ow-select-card {
        padding: 14px 16px;
        background: rgba(13, 20, 34, 0.65);
        border: 1px solid rgba(70, 110, 170, 0.3);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }
      .ow-select-card:hover {
        border-color: rgba(100, 160, 255, 0.6);
        background: rgba(20, 30, 52, 0.8);
      }
      .ow-select-card.active {
        border-color: #3b82f6;
        background: linear-gradient(135deg, rgba(30, 58, 110, 0.5) 0%, rgba(15, 28, 55, 0.7) 100%);
        box-shadow: 0 0 16px rgba(59, 130, 246, 0.25);
      }
      .ow-card-title {
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ow-card-desc {
        font-size: 11px;
        color: #8da4c4;
        margin-top: 4px;
        line-height: 1.4;
      }
      .ow-badge {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 3px;
        background: #2563eb;
        color: #fff;
      }
      .ow-options-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .ow-opt-btn {
        padding: 8px 10px;
        background: rgba(12, 18, 30, 0.6);
        border: 1px solid rgba(70, 105, 160, 0.3);
        border-radius: 4px;
        color: #9cb2cf;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .ow-opt-btn:hover {
        border-color: rgba(96, 165, 250, 0.5);
        color: #ffffff;
      }
      .ow-opt-btn.active {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
      }
      .ow-primary-btn {
        width: 100%;
        padding: 14px;
        background: linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%);
        border: 1px solid #60a5fa;
        border-radius: 6px;
        color: #ffffff;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 2px;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 18px rgba(37, 99, 235, 0.4);
        margin-top: 10px;
      }
      .ow-primary-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 24px rgba(37, 99, 235, 0.6);
        background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
      }
      .ow-secondary-btn {
        width: 100%;
        padding: 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        color: #cbd5e1;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: 8px;
      }
      .ow-secondary-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
      .ow-menu-footer {
        padding: 12px 32px;
        background: rgba(8, 12, 20, 0.7);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 11px;
        color: #6c82a2;
        display: flex;
        justify-content: space-between;
      }
      .ow-pause-dialog {
        width: 440px;
        max-width: 90vw;
        background: rgba(14, 20, 32, 0.95);
        border: 1px solid rgba(80, 140, 255, 0.4);
        border-radius: 8px;
        padding: 30px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(59, 130, 246, 0.2);
        text-align: center;
        animation: owMenuPop 0.25s ease-out;
      }
      .ow-pause-title {
        font-size: 20px;
        font-weight: 800;
        letter-spacing: 4px;
        text-transform: uppercase;
        color: #ffffff;
        margin: 0 0 10px;
      }
      .ow-pause-prompt {
        font-size: 14px;
        color: #94a3b8;
        line-height: 1.5;
        margin-bottom: 24px;
      }
    `;
    document.head.appendChild(style);
  }

  _buildStartMenu() {
    const el = document.createElement('div');
    el.id = 'ow-start-menu';
    el.className = 'ow-menu-overlay';

    el.innerHTML = `
      <div class="ow-menu-container">
        <div class="ow-menu-header">
          <div>
            <h1 class="ow-logo-title">OVERWATCH</h1>
            <div class="ow-logo-sub">Tactical Browser FPS · Three.js Engine</div>
          </div>
          <div style="font-size:11px;color:#34d399;font-weight:700;display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:7px;height:7px;background:#34d399;border-radius:50%;"></span>
            READY
          </div>
        </div>

        <div class="ow-tabs">
          <button class="ow-tab-btn active" id="tab-sp-btn">Single Player</button>
          <button class="ow-tab-btn" id="tab-mp-btn">Multiplayer</button>
          <button class="ow-tab-btn" id="tab-settings-btn">⚙ Settings</button>
        </div>

        <!-- Single Player Panel -->
        <div class="ow-menu-body" id="tab-sp-panel">
          <div class="ow-field-group">
            <label class="ow-field-label">Select Map</label>
            <div class="ow-card-selector">
              <div class="ow-select-card ${this.prefs.map === 'arena' ? 'active' : ''}" id="sp-map-arena">
                <div class="ow-card-title">
                  ARENA
                  <span class="ow-badge">NEW</span>
                </div>
                <div class="ow-card-desc">Competitive 3-Lane tactical arena with sniper corridor, mid crates & CQB interior.</div>
              </div>
              <div class="ow-select-card ${this.prefs.map === 'plaza' ? 'active' : ''}" id="sp-map-plaza">
                <div class="ow-card-title">PLAZA</div>
                <div class="ow-card-desc">Classic market street plaza with central fountain, shops and perimeter roads.</div>
              </div>
            </div>
          </div>

          <div class="ow-field-group">
            <label class="ow-field-label">Time of Day</label>
            <div class="ow-options-grid">
              <div class="ow-opt-btn ${this.prefs.time === 'golden' ? 'active' : ''}" data-time="golden">Golden</div>
              <div class="ow-opt-btn ${this.prefs.time === 'day' ? 'active' : ''}" data-time="day">Day</div>
              <div class="ow-opt-btn ${this.prefs.time === 'dusk' ? 'active' : ''}" data-time="dusk">Dusk</div>
              <div class="ow-opt-btn ${this.prefs.time === 'night' ? 'active' : ''}" data-time="night">Night</div>
            </div>
          </div>

          <button class="ow-primary-btn" id="sp-deploy-btn">DEPLOY MISSION</button>
        </div>

        <!-- Multiplayer Panel -->
        <div class="ow-menu-body" id="tab-mp-panel" style="display:none;">
          <div id="mp-invite" style="display:none;margin-bottom:14px;padding:10px 12px;border-radius:6px;background:rgba(59,130,246,.15);border:1px solid rgba(96,165,250,.45);color:#dbeafe;font-size:13px;"></div>

          <div class="ow-field-group">
            <label class="ow-field-label" style="display:flex;justify-content:space-between">Live rooms <span id="mp-rooms-status" style="text-transform:none;letter-spacing:0;color:#7089a8"></span></label>
            <div id="mp-rooms" style="max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
            <div style="display:flex;gap:10px;margin-top:10px;">
              <button class="ow-secondary-btn" id="mp-quick-btn" style="margin:0;flex:1;">⚡ QUICK PLAY</button>
              <button class="ow-secondary-btn" id="mp-private-btn" style="margin:0;flex:1;">🔒 CREATE PRIVATE MATCH</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#a9bad0;cursor:pointer;">
              <input type="checkbox" id="mp-bots" ${this.prefs.bots ? 'checked' : ''} />
              Fill empty seats with bots <span style="color:#7089a8">(matches you start; people take their place as they join)</span>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div class="ow-field-group" style="margin:0;">
              <label class="ow-field-label">Player Name</label>
              <input type="text" class="ow-input-text" id="mp-name-input" value="${escapeHtml(this.prefs.name)}" maxlength="16" />
            </div>
            <div class="ow-field-group" style="margin:0;">
              <label class="ow-field-label">Room</label>
              <input type="text" class="ow-input-text" id="mp-room-input" value="${escapeHtml(this.prefs.room)}" maxlength="20" />
            </div>
          </div>

          <div class="ow-field-group">
            <label class="ow-field-label">Server WebSocket URL</label>
            <input type="text" class="ow-input-text" id="mp-server-input" value="${escapeHtml(this.prefs.server)}" />
            <div style="font-size:11px;color:#7089a8;margin-top:5px;">
              Tip: Run <code style="color:#60a5fa;">npm run server</code> in terminal for local hosting on port 8787.
            </div>
          </div>

          <div class="ow-field-group">
            <label class="ow-field-label">Game Mode & Map</label>
            <div class="ow-card-selector" style="grid-template-columns:repeat(3,1fr)">
              <div class="ow-select-card ${this.prefs.mode === 'bomb' ? 'active' : ''}" id="mp-mode-bomb" data-mode="bomb">
                <div class="ow-card-title">BOMB DEFUSAL</div>
                <div class="ow-card-desc">Attack: plant the bomb on site A or B. Defend: stop or defuse it. Arena.</div>
              </div>
              <div class="ow-select-card ${this.prefs.mode === 'teams' ? 'active' : ''}" id="mp-mode-teams" data-mode="teams">
                <div class="ow-card-title">TEAM ROUNDS</div>
                <div class="ow-card-desc">ALPHA vs BRAVO elimination rounds on the 3-Lane Arena.</div>
              </div>
              <div class="ow-select-card ${this.prefs.mode === 'dm' ? 'active' : ''}" id="mp-mode-dm" data-mode="dm">
                <div class="ow-card-title">DEATHMATCH</div>
                <div class="ow-card-desc">Free-for-all respawn combat on Plaza or Arena.</div>
              </div>
            </div>
          </div>

          <button class="ow-primary-btn" id="mp-join-btn">CONNECT & JOIN ROOM</button>
        </div>

        <div class="ow-menu-footer">
          <div>WASD Move · Shift Sprint · Space Jump · R Reload · 1/2 Switch · B Buy · F Plant/Defuse · Q/E Lean</div>
          <div>ESC Menu</div>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this._el = el;
  }

  _buildPauseModal() {
    const el = document.createElement('div');
    el.id = 'ow-pause-menu';
    el.className = 'ow-menu-overlay';

    el.innerHTML = `
      <div class="ow-pause-dialog">
        <h2 class="ow-pause-title">GAME MENU</h2>
        <p class="ow-pause-prompt">Would you like to close the game menu?</p>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="ow-primary-btn" id="pause-resume-btn" style="flex:1;margin:0;">RESUME GAME</button>
          <button class="ow-secondary-btn" id="pause-exit-btn" style="flex:1;margin:0;background:rgba(239,68,68,0.18);border-color:rgba(239,68,68,0.4);color:#fca5a5;">EXIT MATCH</button>
        </div>
        <button class="ow-secondary-btn" id="pause-settings-btn" style="margin-top:12px;">⚙ SETTINGS</button>
        <div id="pause-invite" style="display:none;margin-top:18px;text-align:left;">
          <label class="ow-field-label">Invite friends to this room</label>
          <div style="display:flex;gap:8px;">
            <input type="text" readonly class="ow-input-text" id="pause-invite-link" style="flex:1;font-size:12px;" />
            <button class="ow-secondary-btn" id="pause-invite-copy" style="margin:0;width:auto;padding:0 16px;">COPY</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    this._pauseEl = el;
  }

  _wireEvents() {
    // Tab switching
    const tabSpBtn = this._el.querySelector('#tab-sp-btn');
    const tabMpBtn = this._el.querySelector('#tab-mp-btn');
    const panelSp = this._el.querySelector('#tab-sp-panel');
    const panelMp = this._el.querySelector('#tab-mp-panel');

    tabSpBtn.addEventListener('click', () => {
      tabSpBtn.classList.add('active');
      tabMpBtn.classList.remove('active');
      panelSp.style.display = 'block';
      panelMp.style.display = 'none';
    });

    tabMpBtn.addEventListener('click', () => this._showMultiplayerTab());
    this._showMultiplayerTab = () => {
      tabMpBtn.classList.add('active');
      tabSpBtn.classList.remove('active');
      panelSp.style.display = 'none';
      panelMp.style.display = 'block';
      this._pollRooms();
    };

    // live rooms, Quick Play, private matches
    this._el.querySelector('#mp-quick-btn').addEventListener('click', () => this._quickPlay());
    this._el.querySelector('#mp-bots').addEventListener('change', (e) => {
      this.prefs.bots = e.target.checked;
      this.savePrefs();
    });
    this._el.querySelector('#mp-private-btn').addEventListener('click', () => {
      this._readFields();
      this.prefs.room = roomCode();
      this.joinMultiplayer({ private: true });
    });
    this._el.querySelector('#mp-rooms').addEventListener('click', (e) => {
      const row = e.target.closest('[data-room]');
      if (!row) return;
      const r = this._rooms.find((x) => x.name === row.dataset.room);
      if (!r) return;
      this._readFields();
      this.prefs.room = r.name;
      this.prefs.mode = r.mode;
      this.joinMultiplayer({ map: r.map });
    });

    // the invite link in the pause menu
    this._pauseEl.querySelector('#pause-invite-copy').addEventListener('click', () => {
      const input = this._pauseEl.querySelector('#pause-invite-link');
      const done = () => {
        const b = this._pauseEl.querySelector('#pause-invite-copy');
        b.textContent = 'COPIED';
        setTimeout(() => (b.textContent = 'COPY'), 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(done, () => input.select());
      else {
        input.select();
        document.execCommand('copy');
        done();
      }
    });

    // Single player map choice
    const spArena = this._el.querySelector('#sp-map-arena');
    const spPlaza = this._el.querySelector('#sp-map-plaza');
    spArena.addEventListener('click', () => {
      spArena.classList.add('active');
      spPlaza.classList.remove('active');
      this.prefs.map = 'arena';
      this.savePrefs();
    });
    spPlaza.addEventListener('click', () => {
      spPlaza.classList.add('active');
      spArena.classList.remove('active');
      this.prefs.map = 'plaza';
      this.savePrefs();
    });

    // Single player time of day
    this._el.querySelectorAll('.ow-opt-btn[data-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('.ow-opt-btn[data-time]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.prefs.time = btn.dataset.time;
        this.savePrefs();
      });
    });

    // Multiplayer mode choice
    const modeCards = this._el.querySelectorAll('[data-mode]');
    for (const card of modeCards) {
      card.addEventListener('click', () => {
        for (const c of modeCards) c.classList.toggle('active', c === card);
        this.prefs.mode = card.dataset.mode;
        this.savePrefs();
      });
    }

    // Single player Deploy button
    this._el.querySelector('#sp-deploy-btn').addEventListener('click', () => {
      this.deploySinglePlayer();
    });

    // Multiplayer Join button
    this._el.querySelector('#mp-join-btn').addEventListener('click', () => {
      this._readFields();
      this.joinMultiplayer();
    });

    // Settings (start menu tab and pause dialog)
    this._el.querySelector('#tab-settings-btn').addEventListener('click', () => this.settings.show());
    this._pauseEl.querySelector('#pause-settings-btn').addEventListener('click', () => this.settings.show());

    // Pause Dialog buttons
    this._pauseEl.querySelector('#pause-resume-btn').addEventListener('click', () => {
      this.resume();
    });

    this._pauseEl.querySelector('#pause-exit-btn').addEventListener('click', () => {
      this.exitMatch();
    });

    let lastPauseToggle = 0;
    const triggerPause = () => {
      if (this.isOpen || this.isPauseOpen) return;
      if (window.__owPhase !== 'running') return;
      lastPauseToggle = performance.now();
      this.showPauseMenu();
    };

    // ESC key listener for toggling pause menu
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.isOpen) return; // already in start menu

        if (this.isPauseOpen) {
          // If pause menu was just opened within 300ms, ignore accidental double-firing
          if (performance.now() - lastPauseToggle < 300) return;
          this.hidePauseMenu();
        } else {
          triggerPause();
        }
      }
    });

    // The browser releases the mouse on ESC without always delivering the
    // keydown: losing a lock we had during play opens the menu.
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const isLocked = document.pointerLockElement === this.ctx.canvas;
      // the buy menu releases the mouse on purpose: that's not a pause
      const buying = this.ctx.peek('buy') && this.ctx.peek('buy').open;
      if (wasLocked && !isLocked && !this.isOpen && !this.isPauseOpen && !buying && window.__owPhase === 'running') {
        triggerPause();
      }
      wasLocked = isLocked;
    });
  }

  showStartMenu() {
    this.isOpen = true;
    this.isPauseOpen = false;
    this._pauseEl.classList.remove('active');
    this._el.classList.add('active');
    document.exitPointerLock();
    // nothing moves (or shoots at you) behind the start menu
    if (!this.ctx.config.server) this.ctx.time.state.scale = 0;
  }

  hideStartMenu() {
    this.isOpen = false;
    clearTimeout(this._roomsTimer);
    this._el.classList.remove('active');
    this.ctx.time.state.scale = 1;
  }

  showPauseMenu() {
    if (this.isOpen) return;
    this.isPauseOpen = true;
    const cfg = this.ctx.config;
    const box = this._pauseEl.querySelector('#pause-invite');
    box.style.display = cfg.server ? 'block' : 'none';
    if (cfg.server) this._pauseEl.querySelector('#pause-invite-link').value = inviteUrl(location.href, cfg.room, cfg.server, DEFAULT_SERVER);
    this._pauseEl.classList.add('active');
    document.exitPointerLock();
    // Single player pauses behind the menu; online the match goes on.
    if (!this.ctx.config.server) this.ctx.time.state.scale = 0;
  }

  hidePauseMenu() {
    this.isPauseOpen = false;
    this._pauseEl.classList.remove('active');
    this.ctx.time.state.scale = 1;
  }

  // RESUME GAME: close the menu and capture the mouse again. Called from the
  // button's click so the browser accepts the request (it needs a user
  // gesture); a second request while one is pending makes the browser drop
  // and re-take the lock, which used to look like "ESC" and reopen the menu.
  resume() {
    this.hidePauseMenu();
    if (document.pointerLockElement !== this.ctx.canvas) this.ctx.canvas.requestPointerLock();
  }

  deploySinglePlayer() {
    this.savePrefs();
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('play', '1');
    url.searchParams.set('map', this.prefs.map);
    url.searchParams.set('time', this.prefs.time);

    // If current loaded session already matches, simply hide start menu and engage
    if (
      this.ctx.config.map === this.prefs.map &&
      this.ctx.config.timeOfDay === this.prefs.time &&
      !this.ctx.config.server
    ) {
      this.hideStartMenu();
      window.history.replaceState({}, '', url.href);
      setTimeout(() => this.ctx.canvas.requestPointerLock(), 100);
      return;
    }

    // Otherwise reload into clean state with selected parameters
    location.href = url.href;
  }

  // `map`: an existing room's map (saves a reload); `private`: a new room
  // that stays out of the room list.
  joinMultiplayer({ map = null, private: hidden = false } = {}) {
    this.savePrefs();
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('server', this.prefs.server);
    url.searchParams.set('name', this.prefs.name);
    url.searchParams.set('map', map || (this.prefs.mode === 'dm' ? this.prefs.map : 'arena')); // team modes play the arena
    url.searchParams.set('mode', this.prefs.mode);
    url.searchParams.set('room', this.prefs.room);
    if (hidden) url.searchParams.set('private', '1');
    if (!this.prefs.bots) url.searchParams.set('bots', '0');

    location.href = url.href;
  }

  // Name, room and server from the fields into prefs.
  _readFields() {
    const q = (id) => this._el.querySelector(id).value.trim();
    this.prefs.server = q('#mp-server-input') || DEFAULT_SERVER;
    this.prefs.name = q('#mp-name-input') || 'player';
    this.prefs.room = q('#mp-room-input') || 'public';
    this.savePrefs();
  }

  // The room list, refreshed while the multiplayer tab is open.
  async _pollRooms() {
    clearTimeout(this._roomsTimer);
    if (!this.isOpen) return;
    const status = this._el.querySelector('#mp-rooms-status');
    try {
      this._rooms = await this._fetchRooms();
      status.textContent = `${this._rooms.length} open · ${this._rooms.reduce((n, r) => n + r.players, 0)} playing`;
    } catch {
      this._rooms = [];
      status.textContent = 'server not reachable';
    }
    this._renderRooms();
    this._roomsTimer = setTimeout(() => this._pollRooms(), ROOMS_POLL_MS);
  }

  async _fetchRooms() {
    const url = roomsUrl(this._el.querySelector('#mp-server-input').value.trim() || DEFAULT_SERVER);
    if (!url) throw new Error('bad server address');
    const res = await fetch(url, { cache: 'no-store' });
    const body = await res.json();
    return Array.isArray(body.rooms) ? body.rooms : [];
  }

  _renderRooms() {
    const list = this._el.querySelector('#mp-rooms');
    if (!this._rooms.length) {
      list.innerHTML = '<div style="color:#7089a8;font-size:12px;padding:8px 2px;">No public matches right now. Quick Play starts one.</div>';
      return;
    }
    const phaseText = (r) => (r.phase === 0 ? 'warmup' : r.mode === 'dm' ? 'in progress' : `round ${r.round} · ${r.score[0]}–${r.score[1]}`);
    list.innerHTML = this._rooms
      .map((r) => {
        const full = r.players >= r.max;
        return (
          `<div data-room="${escapeHtml(r.name)}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;` +
          `background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);cursor:${full ? 'default' : 'pointer'};opacity:${full ? 0.5 : 1};font-size:13px;">` +
          `<span><b style="color:#e2e8f0">${escapeHtml(r.name)}</b> <span style="color:#7089a8">· ${MODE_LABELS[r.mode] || r.mode} · ${escapeHtml(r.map)} · ${phaseText(r)}</span></span>` +
          `<span style="color:${full ? '#f87171' : '#7fe08a'};white-space:nowrap">${r.players}/${r.max}${full ? ' FULL' : ''}` +
          `${r.bots ? ` <span style="color:#7089a8">+${r.bots} bots</span>` : ''}</span></div>`
        );
      })
      .join('');
  }

  // The busiest public room in the chosen mode, or a fresh public one.
  async _quickPlay() {
    this._readFields();
    let rooms = [];
    try {
      rooms = await this._fetchRooms();
    } catch {
      // can't see the list: just try the default room for this mode
    }
    const pick = pickQuickPlay(rooms, this.prefs.mode);
    this.prefs.room = pick ? pick.name : `public-${this.prefs.mode}`;
    this.joinMultiplayer({ map: pick ? pick.map : null });
  }

  // Opened from an invite link: the multiplayer tab, room filled in.
  _showInvite(invite) {
    this._showMultiplayerTab();
    this._el.querySelector('#mp-room-input').value = invite.room;
    if (invite.server) this._el.querySelector('#mp-server-input').value = invite.server;
    const banner = this._el.querySelector('#mp-invite');
    banner.style.display = 'block';
    banner.innerHTML = `You've been invited to room <b>${escapeHtml(invite.room)}</b>. Enter your name and join.`;
    this._el.querySelector('#mp-join-btn').textContent = `JOIN ${invite.room}`;
    this._el.querySelector('#mp-name-input').focus();
  }

  exitMatch() {
    // If online, leave the server cleanly before navigating away
    const net = this.ctx.peek('net');
    if (net) net.close();

    this.hidePauseMenu();

    // Clean URL query and reload to clean root URL so match is exited and start menu is shown
    const url = new URL(location.href);
    url.search = '';
    location.href = url.href;
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    if (this._el) this._el.remove();
    if (this._pauseEl) this._pauseEl.remove();
    if (this.settings) this.settings.dispose();
    const style = document.getElementById('ow-menu-styles');
    if (style) style.remove();
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
