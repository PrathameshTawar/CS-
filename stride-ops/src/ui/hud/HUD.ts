/**
 * HUD.ts
 *
 * DOM-based HUD (Requirement 20). Elements:
 *  - Crosshair with hit marker flash
 *  - Ammo counter (magazine + reserve)
 *  - Health & armor bars
 *  - Compass bearing
 *  - Minimap (canvas) showing player + enemies + objectives
 *  - Kill feed
 *  - Damage numbers (world-space → screen-space)
 *  - Ability icons with cooldown indicators
 *  - Objective tracker + ping
 *
 * @module UI
 */

import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
import {
  GAME_EVENTS,
  HealthStateEvent,
  AmmoEvent,
  HitMarkerEvent,
  KillFeedEvent,
  DamageEvent,
  KillEvent,
  AbilityEvent,
  ObjectiveEvent,
  SquadEvent,
} from '../../gameplay/core/GameTypes';

export interface HUDConfig {
  container: HTMLElement;
}

export class HUD {
  private readonly container: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly ammoEl: HTMLDivElement;
  private readonly healthEl: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly armorFill: HTMLDivElement;
  private readonly compassEl: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitMarkerEl: HTMLDivElement;
  private readonly killFeedEl: HTMLDivElement;
  private readonly damageLayer: HTMLDivElement;
  private readonly damageDirLayer: HTMLDivElement;
  private readonly abilityBar: HTMLDivElement;
  private readonly objectiveEl: HTMLDivElement;
  private readonly waveCounterEl: HTMLDivElement;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly vignette: HTMLDivElement;
  private readonly screenFlash: HTMLDivElement;
  private readonly skullerBadgeEl: HTMLDivElement;
  private readonly deathBannerEl: HTMLDivElement;

  private readonly bus: EventBus;
  private readonly camera: THREE.PerspectiveCamera;
  private disposers: (() => void)[] = [];

  // Minimap state
  private minimapBounds = { width: 90, depth: 90, offsetX: 0, offsetZ: 0 };
  private minimapEnemies: { x: number; z: number; alive: boolean }[] = [];
  private playerWorldPos = new THREE.Vector3();
  private playerYaw = 0;

  // Compass tick-tape layout (cached refs avoid per-frame querySelector/layout reads)
  private readonly compassPxPerDeg = 1.5;
  private readonly compassCopyWidth = 360 * 1.5;
  private compassStripEl: HTMLElement | null = null;
  private compassTextEl: HTMLElement | null = null;
  private compassPanelWidth = 0;

  // Directional damage indicators (CoD-style edge arcs)
  private dmgIndicators: { el: HTMLDivElement; life: number; maxLife: number }[] = [];

  // Damage numbers
  private damageNumbers: { el: HTMLDivElement; life: number; maxLife: number; world: THREE.Vector3 }[] = [];

  constructor(bus: EventBus, camera: THREE.PerspectiveCamera, config: HUDConfig) {
    this.bus = bus;
    this.camera = camera;
    this.container = config.container;

    HUD.ensureGlassStyles();

    this.root = document.createElement('div');
    this.root.className = 'hud';
    Object.assign(this.root.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden',
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#fff', zIndex: '10',
    } as Partial<CSSStyleDeclaration>);

    // Crosshair + hit marker
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;';
    this.crosshair.innerHTML = `
      <span style="position:absolute;left:50%;top:0;width:2px;height:5px;background:#fff;transform:translateX(-50%);"></span>
      <span style="position:absolute;left:50%;bottom:0;width:2px;height:5px;background:#fff;transform:translateX(-50%);"></span>
      <span style="position:absolute;top:50%;left:0;width:5px;height:2px;background:#fff;transform:translateY(-50%);"></span>
      <span style="position:absolute;top:50%;right:0;width:5px;height:2px;background:#fff;transform:translateY(-50%);"></span>`;
    this.root.appendChild(this.crosshair);

    this.hitMarkerEl = document.createElement('div');
    this.hitMarkerEl.className = 'hitmarker';
    this.hitMarkerEl.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0;transition:opacity 0.08s;font-size:28px;';
    this.root.appendChild(this.hitMarkerEl);

    // Ammo (CS2 Bottom-Right Crisp Ammo Indicator)
    this.ammoEl = document.createElement('div');
    this.ammoEl.style.cssText =
      'position:absolute;right:32px;bottom:24px;background:linear-gradient(180deg,rgba(23,30,42,0.55),rgba(10,14,22,0.62));backdrop-filter:blur(12px) saturate(1.5);-webkit-backdrop-filter:blur(12px) saturate(1.5);padding:10px 22px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);box-shadow:0 8px 28px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.16);display:flex;align-items:center;gap:16px;font-family:\'Segoe UI\',system-ui,sans-serif;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.9);';
    this.ammoEl.innerHTML = `
      <div style="text-align:right;">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span id="ammoMag" style="font-size:44px;font-weight:800;line-height:1;">30</span>
          <span id="ammoRes" style="font-size:20px;color:#94a3b8;font-weight:700;">/ 120</span>
        </div>
        <div style="font-size:11px;color:#cbd5e1;letter-spacing:1px;text-transform:uppercase;margin-top:2px;text-align:right;">DESERT EAGLE .50</div>
      </div>
      <div style="font-size:30px;opacity:0.85;">🔫</div>`;
    this.root.appendChild(this.ammoEl);

    // Health / armor / money (CS2 Bottom-Left Numeric HUD)
    this.healthEl = document.createElement('div');
    this.healthEl.style.cssText = 'position:absolute;left:32px;bottom:24px;width:240px;';
    this.healthEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.9);">
        <div style="font-size:22px;font-weight:700;color:#4ade80;letter-spacing:0.5px;">$100</div>
        <div style="display:flex;align-items:center;gap:18px;background:linear-gradient(180deg,rgba(23,30,42,0.55),rgba(10,14,22,0.62));backdrop-filter:blur(12px) saturate(1.5);-webkit-backdrop-filter:blur(12px) saturate(1.5);padding:8px 18px;border-radius:12px;border:1px solid rgba(255,255,255,0.16);box-shadow:0 8px 28px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.16);">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:22px;color:#22c55e;">+</span>
            <span id="hpVal" style="font-size:36px;font-weight:800;line-height:1;">100</span>
          </div>
          <div style="width:1px;height:28px;background:rgba(255,255,255,0.2);"></div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:18px;color:#38bdf8;">🛡</span>
            <span id="armorVal" style="font-size:28px;font-weight:700;line-height:1;color:#e0f2fe;">50</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;height:4px;width:100%;">
          <div style="flex:1;background:rgba(0,0,0,0.5);border-radius:2px;overflow:hidden;"><div id="hpFill" style="height:100%;width:100%;background:#22c55e;"></div></div>
          <div style="flex:1;background:rgba(0,0,0,0.5);border-radius:2px;overflow:hidden;"><div id="armorFill" style="height:100%;width:100%;background:#38bdf8;"></div></div>
        </div>
      </div>`;
    this.root.appendChild(this.healthEl);

    this.healthFill = this.healthEl.querySelector('#hpFill') as HTMLDivElement;
    this.armorFill = this.healthEl.querySelector('#armorFill') as HTMLDivElement;

    // Top-Center CS2 Scoreboard Banner & Round Timer + Compass
    this.compassEl = document.createElement('div');
    this.compassEl.className = 'hud-glass hud-glass-gloss';
    this.compassEl.style.cssText =
      'position:absolute;top:12px;left:50%;transform:translateX(-50%);border-radius:12px;overflow:hidden;' +
      'font-family:\'Segoe UI\',system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,0.9);';
    this.compassEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;">
        <!-- CT Team Left -->
        <div style="display:flex;align-items:center;background:linear-gradient(90deg, #1e3a5f, #2563eb);padding:6px 14px;color:#fff;font-weight:700;font-size:14px;gap:8px;">
          <span>CT STAFF</span>
          <div style="display:flex;gap:3px;">
            <span style="width:14px;height:14px;background:#93c5fd;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#93c5fd;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#93c5fd;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#93c5fd;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#93c5fd;border-radius:2px;display:inline-block;"></span>
          </div>
        </div>
        <!-- Round Timer & Score Center -->
        <div style="padding:4px 20px;text-align:center;min-width:115px;">
          <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:1px;">1:50</div>
          <div style="font-size:12px;color:#cbd5e1;font-weight:700;margin-top:-2px;">0 &nbsp;|&nbsp; 0</div>
        </div>
        <!-- T Team Right -->
        <div style="display:flex;align-items:center;background:linear-gradient(90deg, #d97706, #78350f);padding:6px 14px;color:#fff;font-weight:700;font-size:14px;gap:8px;">
          <div style="display:flex;gap:3px;">
            <span style="width:14px;height:14px;background:#fde68a;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#fde68a;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#fde68a;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#fde68a;border-radius:2px;display:inline-block;"></span>
            <span style="width:14px;height:14px;background:#fde68a;border-radius:2px;display:inline-block;"></span>
          </div>
          <span>T</span>
        </div>
      </div>
      <!-- Layered compass: recessed tick tape (mid) + fixed needle + bearing pill (top) -->
      <div class="hud-compass-track">
        <div class="hud-compass-strip" id="hudCompassStrip"></div>
        <div class="hud-compass-needle">
          <div class="needle-line"></div>
          <div class="needle-tri"></div>
        </div>
      </div>
      <div style="display:flex;justify-content:center;padding:2px 0 5px;">
        <div id="hudCompassText" class="hud-compass-pill">N 0°</div>
      </div>`;
    this.buildCompassStrip();
    this.root.appendChild(this.compassEl);

    // Minimap (Top-Left Circular CS2 Radar)
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 180;
    this.minimapCanvas.height = 180;
    this.minimapCanvas.style.cssText =
      'position:absolute;top:20px;left:20px;border-radius:50%;width:175px;height:175px;opacity:0.92;border:3px solid rgba(255,255,255,0.28);box-shadow:0 4px 20px rgba(0,0,0,0.75);background:rgba(20,25,30,0.85);';
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.root.appendChild(this.minimapCanvas);

    // Kill feed
    this.killFeedEl = document.createElement('div');
    this.killFeedEl.style.cssText = 'position:absolute;top:60px;right:16px;display:flex;flex-direction:column;gap:4px;text-align:right;';
    this.root.appendChild(this.killFeedEl);

    // Damage numbers layer
    this.damageLayer = document.createElement('div');
    this.damageLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    this.root.appendChild(this.damageLayer);

    // Directional damage indicator layer (edge arcs pointing at the source)
    this.damageDirLayer = document.createElement('div');
    this.damageDirLayer.className = 'damage-dir-layer';
    this.damageDirLayer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    this.root.appendChild(this.damageDirLayer);

    // Skuller Headhunter Rewards & Skins Badge (Top Right)
    this.skullerBadgeEl = document.createElement('div');
    this.skullerBadgeEl.style.cssText =
      'position:absolute;top:20px;right:210px;background:linear-gradient(135deg,rgba(180,20,40,0.88),rgba(20,25,35,0.92));border:1px solid #ffd700;border-radius:10px;padding:8px 16px;color:#fff;font-family:\'Segoe UI\',system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.8);cursor:pointer;pointer-events:auto;display:flex;align-items:center;gap:10px;z-index:900;';
    this.skullerBadgeEl.innerHTML = `
      <span style="font-size:24px;filter:drop-shadow(0 0 6px #ffd700);">💀</span>
      <div>
        <div style="font-size:14px;font-weight:800;color:#ffd700;letter-spacing:0.5px;" id="skullerBadgeCount">💀 0 SKULLS</div>
        <div style="font-size:11px;color:#e2e8f0;font-weight:600;" id="skullerBadgeSkin">SKULLER CLASSIC</div>
      </div>
      <div style="background:rgba(255,215,0,0.2);border:1px solid #ffd700;border-radius:6px;padding:3px 8px;font-size:10px;font-weight:800;color:#ffd700;">SKINS (P)</div>
    `;
    this.root.appendChild(this.skullerBadgeEl);

    // CS2 Aftermath Death Banner (00:09 in video)
    this.deathBannerEl = document.createElement('div');
    this.deathBannerEl.style.cssText =
      'position:absolute;top:28%;left:50%;transform:translate(-50%, -50%);background:linear-gradient(90deg, rgba(180,10,10,0) 0%, rgba(180,10,10,0.88) 20%, rgba(180,10,10,0.88) 80%, rgba(180,10,10,0) 100%);color:#ffffff;font-family:Segoe UI,sans-serif;font-weight:800;font-size:32px;letter-spacing:4px;padding:12px 64px;pointer-events:none;display:none;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,0.9);box-shadow:0 0 40px rgba(180,10,10,0.5);z-index:950;';
    this.deathBannerEl.innerHTML = `<div>KILLED BY ENEMY OPERATOR</div><div style="font-size:14px;font-weight:600;color:#ffd700;margin-top:4px;letter-spacing:2px;">TACTICAL REALISM // AFTERMATH</div>`;
    this.root.appendChild(this.deathBannerEl);

    // Ability bar
    this.abilityBar = document.createElement('div');
    this.abilityBar.style.cssText =
      'position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;gap:8px;align-items:flex-end;';
    this.root.appendChild(this.abilityBar);

    // Objective tracker — rounded frosted-glass pill (below top-left radar)
    this.objectiveEl = document.createElement('div');
    this.objectiveEl.style.cssText = [
      'position:absolute;top:210px;left:20px;min-width:280px;max-width:360px;',
      'backdrop-filter:blur(14px) saturate(1.6);-webkit-backdrop-filter:blur(14px) saturate(1.6);',
      'background:linear-gradient(135deg,rgba(20,30,52,0.55),rgba(26,40,70,0.45));',
      'border:1px solid rgba(147,197,253,0.4);border-radius:999px;',
      'padding:12px 20px 13px;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.16),inset 0 -1px 0 rgba(0,0,0,0.3),0 0 24px rgba(59,130,246,0.18);',
      'font-family:\'Segoe UI\',system-ui,sans-serif;color:#e2e8f0;',
      'text-shadow:0 1px 3px rgba(0,0,0,0.9);',
      'animation:hudObjectivePulse 3s ease-in-out infinite;',
    ].join('');
    // Inject the glow-pulse keyframe once
    if (!document.getElementById('hud-mission-style')) {
      const st = document.createElement('style');
      st.id = 'hud-mission-style';
      st.textContent = `
        @keyframes hudObjectivePulse {
          0%,100% { box-shadow:0 0 18px rgba(59,130,246,0.18),0 4px 16px rgba(0,0,0,0.5); border-color:rgba(99,179,237,0.35); }
          50%      { box-shadow:0 0 32px rgba(99,179,237,0.45),0 4px 20px rgba(0,0,0,0.6); border-color:rgba(147,210,255,0.65); }
        }
        @keyframes waveCounterPop {
          0%   { transform:scale(1.3);  opacity:0.6; color:#fff; }
          60%  { transform:scale(0.96); opacity:1;   color:#fde68a; }
          100% { transform:scale(1);   opacity:1;   color:#fbbf24; }
        }
        @keyframes waveCounterIdle {
          0%,100% { text-shadow:0 0 8px rgba(251,191,36,0.4); }
          50%     { text-shadow:0 0 18px rgba(251,191,36,0.85); }
        }
        @keyframes objectiveFadeIn {
          from { opacity:0; transform:translateX(-12px); }
          to   { opacity:1; transform:translateX(0); }
        }
      `;
      document.head.appendChild(st);
    }
    this.root.appendChild(this.objectiveEl);

    // Dedicated wave counter — large glowing badge
    this.waveCounterEl = document.createElement('div');
    this.waveCounterEl.style.cssText = [
      'position:absolute;top:80px;left:16px;display:none;',
      'font-family:\'Segoe UI\',system-ui,sans-serif;font-size:26px;font-weight:800;',
      'color:#fbbf24;letter-spacing:1.5px;',
      'background:linear-gradient(135deg,rgba(15,10,5,0.82),rgba(35,25,5,0.75));',
      'border:1px solid rgba(251,191,36,0.4);border-radius:12px;',
      'padding:8px 20px;',
      'box-shadow:0 0 20px rgba(251,191,36,0.25),0 4px 12px rgba(0,0,0,0.6);',
      'text-shadow:0 0 10px rgba(251,191,36,0.6),0 2px 4px rgba(0,0,0,0.9);',
      'backdrop-filter:blur(4px);',
      'animation:waveCounterIdle 2.5s ease-in-out infinite;',
    ].join('');
    this.root.appendChild(this.waveCounterEl);

    // Damage vignette + screen flash
    this.vignette = document.createElement('div');
    this.vignette.style.cssText =
      'position:absolute;inset:0;background:radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.4) 100%);opacity:0;transition:opacity 0.3s;';
    this.root.appendChild(this.vignette);

    this.screenFlash = document.createElement('div');
    this.screenFlash.style.cssText =
      'position:absolute;inset:0;background:#fff;opacity:0;transition:opacity 0.6s;pointer-events:none;';
    this.root.appendChild(this.screenFlash);

    this.container.appendChild(this.root);
    this.registerEvents();
  }

  /**
   * Inject the shared frosted-glass stylesheet once (banner, compass tape, pill chips).
   */
  private static ensureGlassStyles(): void {
    if (document.getElementById('hud-glass-style')) return;
    const st = document.createElement('style');
    st.id = 'hud-glass-style';
    st.textContent = `
      /* --- Frosted glass surface --- */
      .hud-glass {
        backdrop-filter: blur(12px) saturate(1.6);
        -webkit-backdrop-filter: blur(12px) saturate(1.6);
        background: linear-gradient(180deg, rgba(23,30,42,0.52), rgba(10,14,22,0.62));
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.25);
      }
      .hud-glass-gloss { position: relative; }
      .hud-glass-gloss::before {
        content: ''; position: absolute; top: 0; left: 6%; right: 6%; height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
        pointer-events: none; z-index: 2;
      }
      /* --- Layered compass --- */
      .hud-compass-track {
        position: relative; height: 20px; overflow: hidden;
        background: rgba(0,0,0,0.2);
        border-top: 1px solid rgba(255,255,255,0.08);
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .hud-compass-strip { position: absolute; top: 0; left: 0; height: 100%; will-change: transform; }
      .hud-compass-tick {
        position: absolute; top: 0; height: 100%; width: 44px; margin-left: -22px;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        font-size: 11px; font-weight: 700; letter-spacing: 1px;
        color: rgba(226,232,240,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      }
      .hud-compass-tick::after { content: ''; width: 1px; height: 5px; background: rgba(255,255,255,0.45); }
      .hud-compass-tick.tick-major { color: #fbbf24; }
      .hud-compass-tick.tick-major::after { height: 7px; background: rgba(251,191,36,0.85); }
      .hud-compass-needle {
        position: absolute; left: 50%; top: 0; transform: translateX(-50%);
        display: flex; flex-direction: column; align-items: center; pointer-events: none;
      }
      .hud-compass-needle .needle-line {
        width: 2px; height: 12px; background: linear-gradient(180deg, rgba(255,255,255,0.15), #fff);
      }
      .hud-compass-needle .needle-tri {
        width: 0; height: 0; margin-top: -1px;
        border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #fff;
        filter: drop-shadow(0 0 4px rgba(255,255,255,0.8));
      }
      /* --- Pill chips --- */
      .hud-compass-pill, .hud-badge-pill {
        backdrop-filter: blur(8px) saturate(1.4);
        -webkit-backdrop-filter: blur(8px) saturate(1.4);
        border-radius: 999px; box-shadow: 0 2px 10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2);
      }
      .hud-compass-pill {
        background: linear-gradient(180deg, rgba(20,26,38,0.7), rgba(10,14,22,0.75));
        border: 1px solid rgba(255,255,255,0.18);
        padding: 2px 12px; font-size: 12px; font-weight: 800; color: #fff; letter-spacing: 1px;
        white-space: nowrap;
      }
      .hud-badge-pill {
        background: linear-gradient(180deg, rgba(59,130,246,0.38), rgba(37,99,235,0.22));
        border: 1px solid rgba(147,197,253,0.5);
        padding: 3px 12px; font-size: 9px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
        color: #bfdbfe; display: inline-flex; align-items: center; gap: 6px;
      }
      /* --- Kill feed chips / hit markers / damage arcs --- */
      .killfeed-headshot {
        background: rgba(255,215,0,0.18); border: 1px solid rgba(255,215,0,0.55);
        color: #ffd700; font-size: 10px; font-weight: 800; letter-spacing: 1px;
        border-radius: 999px; padding: 1px 8px; box-shadow: 0 0 10px rgba(255,215,0,0.35);
      }
      @keyframes killfeedIn {
        from { opacity: 0; transform: translateX(40px) scale(0.9); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes killfeedOut {
        from { opacity: 1; transform: translateY(0); }
        to   { opacity: 0; transform: translateY(-14px); }
      }
      @keyframes hitmarkerPop {
        0%   { transform: translate(-50%,-50%) scale(0.6) rotate(-12deg); }
        60%  { transform: translate(-50%,-50%) scale(1.2) rotate(4deg); }
        100% { transform: translate(-50%,-50%) scale(1) rotate(0deg); }
      }
      @keyframes hitmarkerRing {
        0%   { opacity: 0.9; transform: translate(-50%,-50%) scale(0.4); border-width: 3px; }
        100% { opacity: 0;   transform: translate(-50%,-50%) scale(2.2); border-width: 1px; }
      }
    `;
    document.head.appendChild(st);
  }

  /**
   * Build the compass tick tape: three copies of the cardinal ring so the tape
   * can always scroll beneath the fixed needle without exposing gaps.
   */
  private buildCompassStrip(): void {
    const strip = this.compassEl.querySelector('#hudCompassStrip') as HTMLElement | null;
    this.compassStripEl = strip;
    this.compassTextEl = this.compassEl.querySelector('#hudCompassText') as HTMLElement | null;
    if (!strip) return;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const width = this.compassCopyWidth;
    let html = '';
    for (let copy = -1; copy <= 1; copy++) {
      for (let i = 0; i < dirs.length; i++) {
        const angle = i * 45;
        const major = angle === 0 || angle === 180 ? ' tick-major' : '';
        const x = copy * width + angle * this.compassPxPerDeg;
        html += `<div class="hud-compass-tick${major}" style="left:${x}px;">${dirs[i]}</div>`;
      }
    }
    strip.innerHTML = html;
  }

  private registerEvents(): void {
    const bus = this.bus;

    this.disposers.push(
      bus.on<AmmoEvent>(GAME_EVENTS.AMMO, (e) => this.onAmmo(e)),
      bus.on<HealthStateEvent>(GAME_EVENTS.HEALTH, (e) => this.onHealth(e)),
      bus.on<HitMarkerEvent>(GAME_EVENTS.HIT_MARKER, (e) => this.onHitMarker(e)),
      bus.on<KillFeedEvent>(GAME_EVENTS.KILL_FEED, (e) => this.onKillFeed(e)),
      bus.on<DamageEvent>(GAME_EVENTS.DAMAGE, (e) => this.onDamage(e)),
      bus.on<KillEvent>(GAME_EVENTS.KILL, () => this.onKill()),
      bus.on<AbilityEvent>(GAME_EVENTS.ABILITY, (e) => this.onAbility(e)),
      bus.on<ObjectiveEvent>(GAME_EVENTS.OBJECTIVE, (e) => this.onObjective(e)),
      bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => this.onSquad(e)),
      bus.on<DamageEvent>(GAME_EVENTS.DAMAGE, (e) => {
        if (e.target === 'player') {
          this.flashDamage();
          this.showDirectionalDamage(e);
        }
      })
    );
  }

  private onAmmo(e: AmmoEvent): void {
    const mag = this.ammoEl.querySelector('#ammoMag') as HTMLElement;
    const res = this.ammoEl.querySelector('#ammoRes') as HTMLElement;
    if (mag) mag.textContent = String(e.magazine);
    if (res) res.textContent = `/ ${e.reserve}`;
    if (e.reloading) {
      this.ammoEl.style.opacity = '0.6';
    } else {
      this.ammoEl.style.opacity = '1';
    }
  }

  private onHealth(e: HealthStateEvent): void {
    const hpVal = this.healthEl.querySelector('#hpVal') as HTMLElement;
    const armorVal = this.healthEl.querySelector('#armorVal') as HTMLElement;
    if (hpVal) hpVal.textContent = String(Math.ceil(e.health));
    if (armorVal) armorVal.textContent = String(Math.ceil(e.armor));
    this.healthFill.style.width = `${(e.health / e.maxHealth) * 100}%`;
    this.armorFill.style.width = `${(e.armor / e.maxArmor) * 100}%`;

    // CS2 Grayscale death screen filter & Aftermath overlay (00:09 in video)
    if (e.health <= 0) {
      this.root.style.filter = 'grayscale(100%) contrast(115%)';
      this.vignette.style.opacity = '0.75';
      this.vignette.getAnimations().forEach((a) => a.cancel());
      this.deathBannerEl.style.display = 'block';
      return;
    } else {
      this.root.style.filter = 'none';
      this.deathBannerEl.style.display = 'none';
    }

    // Low-health vignette pulse (Requirement 20.5)
    if (e.health < e.maxHealth * 0.25) {
      this.vignette.style.opacity = '0.6';
      this.vignette.animate(
        [{ opacity: 0.4 }, { opacity: 0.7 }, { opacity: 0.4 }],
        { duration: 1000, iterations: Infinity }
      );
    } else {
      this.vignette.style.opacity = '0';
      this.vignette.getAnimations().forEach((a) => a.cancel());
    }
  }

  private onHitMarker(e: HitMarkerEvent): void {
    const color = e.kind === 'critical' ? '#ffd700' : e.kind === 'high' ? '#ff5050' : '#ffffff';
    const size = e.kind === 'critical' ? '58px' : '32px';
    this.hitMarkerEl.style.color = color;
    this.hitMarkerEl.style.fontSize = size;
    this.hitMarkerEl.textContent = '✕';
    // Restart the pop animation (snappy, with a slight overshoot).
    this.hitMarkerEl.style.animation = 'none';
    void (this.hitMarkerEl as HTMLElement).offsetWidth;
    this.hitMarkerEl.style.animation = 'hitmarkerPop 0.16s cubic-bezier(0.2,1.4,0.4,1)';
    this.hitMarkerEl.style.opacity = '1';
    // Criticals get an expanding gold ring.
    if (e.kind === 'critical') {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;left:50%;top:50%;width:36px;height:36px;border:2px solid #ffd700;border-radius:50%;box-shadow:0 0 12px rgba(255,215,0,0.6);animation:hitmarkerRing 0.3s ease-out forwards;';
      this.hitMarkerEl.appendChild(ring);
      setTimeout(() => ring.remove(), 320);
    }
    setTimeout(() => {
      this.hitMarkerEl.style.opacity = '0';
      this.hitMarkerEl.style.animation = 'none';
      this.hitMarkerEl.innerHTML = '';
    }, 130);
  }

  private onKillFeed(e: KillFeedEvent): void {
    const entry = document.createElement('div');
    entry.className = 'killfeed-chip';
    const killer = this.escapeHtml(e.killerName);
    const victim = this.escapeHtml(e.victimName);
    // Player = CT (blue), hostiles = T (amber/orange) — CoD-style team colors.
    const killerIsPlayer = e.killerName === 'You';
    const killerColor = killerIsPlayer ? '#7fb2ff' : '#fbbf24';
    const victimColor = e.victimName === 'You' ? '#7fb2ff' : '#f87171';
    const stripe = killerIsPlayer
      ? 'linear-gradient(180deg,#3b82f6,#1d4ed8)'
      : 'linear-gradient(180deg,#f59e0b,#b45309)';
    const hs = e.headshot ? '<span class="killfeed-headshot">HEADSHOT</span>' : '';
    entry.style.cssText = [
      'display:flex;align-items:center;gap:8px;',
      'background:linear-gradient(135deg,rgba(16,22,32,0.62),rgba(10,14,22,0.55));',
      'backdrop-filter:blur(10px) saturate(1.4);-webkit-backdrop-filter:blur(10px) saturate(1.4);',
      'border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:5px 12px 5px 0;',
      'box-shadow:0 4px 16px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.12);',
      'font-size:13px;font-weight:600;overflow:hidden;',
      'animation:killfeedIn 0.22s cubic-bezier(0.2,0.9,0.3,1.2), killfeedOut 0.5s ease-in 2.5s forwards;',
    ].join('');
    entry.innerHTML =
      `<span style="align-self:stretch;width:3px;background:${stripe};box-shadow:0 0 8px rgba(59,130,246,0.6);"></span>` +
      `<span style="font-weight:800;color:${killerColor};text-shadow:0 1px 2px rgba(0,0,0,0.8);">${killer}</span>` +
      `<span style="opacity:0.55;font-size:11px;">⚔</span>` +
      `<span style="color:${victimColor};text-shadow:0 1px 2px rgba(0,0,0,0.8);">${victim}</span>` +
      hs;
    this.killFeedEl.appendChild(entry);
    setTimeout(() => entry.remove(), 3000);
  }

  private onDamage(e: DamageEvent): void {
    if (e.target !== 'enemy' || !e.worldPosition) return;
    this.spawnDamageNumber(e.worldPosition, Math.round(e.amount), e.critical || e.headshot);
  }

  private onKill(): void {
    this.flashKill();
  }

  private onAbility(e: AbilityEvent): void {
    const bar = this.abilityBar.querySelector(`[data-ability="${e.id}"]`) as HTMLElement | null;
    if (!bar) return;
    const cd = bar.querySelector('.cd') as HTMLElement;
    if (cd) {
      cd.style.height = `${(e.cooldown / e.maxCooldown) * 100}%`;
      if (!e.ready) {
        cd.textContent = e.cooldown > 0 ? String(Math.ceil(e.cooldown)) : '';
      } else {
        cd.textContent = '';
      }
    }
  }

  private onObjective(e: ObjectiveEvent & { isWave?: boolean }): void {
    // Build the objective panel — label row + briefing
    const icon = e.isWave ? '🛡' : '🎯';
    const label = e.isWave ? 'DEFEND' : 'OBJECTIVE';
    const safeText = this.escapeHtml(e.text);

    this.objectiveEl.style.animation = 'none';
    // Force reflow so animation restarts
    void (this.objectiveEl as HTMLElement).offsetWidth;
    this.objectiveEl.style.animation = 'hudObjectivePulse 3s ease-in-out infinite, objectiveFadeIn 0.35s ease-out';

    this.objectiveEl.innerHTML =
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">` +
        `<span class="hud-badge-pill">${icon} ${label}</span>` +
        `<div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(147,197,253,0.4),transparent);"></div>` +
      `</div>` +
      `<div style="font-size:13px;line-height:1.45;color:#e2e8f0;">${safeText}</div>` +
      (e.progress && !e.isWave
        ? `<div style="margin-top:9px;height:4px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;">` +
            `<div style="height:100%;width:${Math.round((e.progress.current / e.progress.target) * 100)}%;background:linear-gradient(90deg,#3b82f6,#93c5fd);border-radius:999px;transition:width 0.4s;"></div>` +
          `</div>` +
          `<div style="margin-top:4px;font-size:11px;color:#94a3b8;text-align:right;">${e.progress.current} / ${e.progress.target}</div>`
        : '');

    if (e.isWave && e.progress) {
      this.waveCounterEl.style.display = 'block';

      const waveFraction = `${e.progress.current} / ${e.progress.target}`;
      const pct = Math.round((e.progress.current / e.progress.target) * 100);

      this.waveCounterEl.innerHTML =
        `<span style="font-size:11px;font-weight:600;letter-spacing:2px;color:#fde68a;opacity:0.75;display:block;margin-bottom:2px;">WAVE</span>` +
        `<span style="font-size:30px;line-height:1;">${waveFraction}</span>` +
        `<div style="margin-top:6px;height:3px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">` +
          `<div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#f59e0b,#fde68a);border-radius:3px;transition:width 0.5s;"></div>` +
        `</div>`;

      // Burst animation on update
      this.waveCounterEl.style.animation = 'none';
      void (this.waveCounterEl as HTMLElement).offsetWidth;
      this.waveCounterEl.style.animation =
        'waveCounterPop 0.5s cubic-bezier(0.34,1.56,0.64,1), waveCounterIdle 2.5s ease-in-out 0.5s infinite';
    } else {
      this.waveCounterEl.style.display = 'none';
    }
  }

  private onSquad(e: SquadEvent): void {
    const entry = document.createElement('div');
    entry.style.cssText = 'background:rgba(255,180,60,0.15);border:1px solid rgba(255,180,60,0.4);padding:3px 10px;border-radius:6px;font-size:12px;color:#fbbf24;animation:fadeUp 4s forwards;';
    entry.textContent = `📡 ${e.message}`;
    this.killFeedEl.appendChild(entry);
    setTimeout(() => entry.remove(), 4000);
  }

  private spawnDamageNumber(world: { x: number; y: number; z: number }, amount: number, critical: boolean): void {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;font-weight:800;text-shadow:0 1px 3px rgba(0,0,0,0.9);pointer-events:none;';
    el.style.color = critical ? '#ffd700' : '#ffffff';
    el.style.fontSize = critical ? '26px' : '20px';
    el.textContent = critical ? `${amount} ✦` : String(amount);
    this.damageLayer.appendChild(el);

    this.damageNumbers.push({
      el,
      life: 0,
      maxLife: 1.5,
      world: new THREE.Vector3(world.x, world.y + 1.2, world.z),
    });
  }

  /**
   * CoD-style directional damage indicator: a red arc pinned to the screen
   * edge in the direction of the damage source, fading over ~0.9s.
   */
  private showDirectionalDamage(e: DamageEvent): void {
    if (!e.sourcePosition) return;
    const src = e.sourcePosition;
    let dx = src.x - this.playerWorldPos.x;
    let dz = src.z - this.playerWorldPos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    dx /= len;
    dz /= len;
    // View forward in XZ (yaw convention: forward = (-sin yaw, -cos yaw)).
    const yaw = this.playerYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz; // screen-right on the ground plane
    const rz = fx;
    const sinA = dx * rx + dz * rz;
    const cosA = dx * fx + dz * fz;
    // Skip sources within ~20° of dead-ahead — they are already visible.
    if (cosA > 0.94) return;
    const angle = Math.atan2(sinA, cosA);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const margin = 0.05;
    let t = Infinity;
    if (Math.abs(s) > 1e-4) t = Math.min(t, (w / 2) * (1 - margin) / Math.abs(s));
    if (Math.abs(c) > 1e-4) t = Math.min(t, (h / 2) * (1 - margin) / Math.abs(c));
    const ex = cx + s * t;
    const ey = cy - c * t;
    const deg = (angle * 180) / Math.PI;
    const el = document.createElement('div');
    el.className = 'dmg-arc';
    el.style.cssText = [
      'position:absolute;width:96px;height:96px;border-radius:50%;pointer-events:none;',
      `left:${ex.toFixed(1)}px;top:${ey.toFixed(1)}px;transform:translate(-50%,-50%);`,
      `background:conic-gradient(from ${(deg - 22).toFixed(1)}deg, transparent 0deg, rgba(255,64,64,0.92) 18deg, rgba(255,120,60,0.55) 40deg, transparent 44deg);`,
      'filter:drop-shadow(0 0 8px rgba(255,60,60,0.9));',
    ].join('');
    this.damageDirLayer.appendChild(el);
    this.dmgIndicators.push({ el, life: 0, maxLife: 0.9 });
  }

  private flashDamage(): void {
    this.vignette.style.transition = 'opacity 0.15s';
    this.vignette.style.opacity = '0.85';
    setTimeout(() => {
      this.vignette.style.transition = 'opacity 0.5s';
      this.vignette.style.opacity = '0';
    }, 120);
  }

  private flashKill(): void {
    this.screenFlash.style.transition = 'opacity 0.15s';
    this.screenFlash.style.opacity = '0.5';
    setTimeout(() => {
      this.screenFlash.style.transition = 'opacity 0.8s';
      this.screenFlash.style.opacity = '0';
    }, 100);
  }

  /** Headshot kill screen-edge flash (Requirement 7.2). */
  flashHeadshotKill(): void {
    this.screenFlash.style.background = 'linear-gradient(135deg, rgba(255,180,40,0.65), rgba(255,255,255,0.85))';
    this.screenFlash.style.transition = 'opacity 0.08s';
    this.screenFlash.style.opacity = '0.7';
    setTimeout(() => {
      this.screenFlash.style.transition = 'opacity 0.8s';
      this.screenFlash.style.opacity = '0';
      setTimeout(() => { this.screenFlash.style.background = '#fff'; }, 800);
    }, 120);
  }

  /** Flashbang whiteout (Requirement 8.2). */
  flashbang(intensity: number): void {
    this.screenFlash.style.transition = 'opacity 0.05s';
    this.screenFlash.style.opacity = String(Math.min(1, intensity));
    setTimeout(() => {
      this.screenFlash.style.transition = `opacity ${2 + intensity * 2}s`;
      this.screenFlash.style.opacity = '0';
    }, 80);
  }

  // --- Per-frame updates ---

  update(deltaTime: number): void {
    // Compass — layered glass tape scrolls beneath a fixed needle + bearing pill
    const bearing = ((THREE.MathUtils.radToDeg(this.playerYaw) % 360) + 360) % 360;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = dirs[Math.round(bearing / 45) % 8];
    if (this.compassTextEl) this.compassTextEl.textContent = `${dir} ${Math.round(bearing)}°`;
    if (this.compassStripEl) {
      // Cache the panel width after first layout (it is static) to avoid reflow churn.
      if (this.compassPanelWidth === 0) this.compassPanelWidth = this.compassEl.clientWidth || 340;
      const half = Math.min(270, this.compassPanelWidth / 2);
      let offset = -bearing * this.compassPxPerDeg + half;
      offset = ((offset + 270) % 540 + 540) % 540 - 270;
      this.compassStripEl.style.transform = `translateX(${offset}px)`;
    }

    // Damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.life += deltaTime;
      if (dn.life >= dn.maxLife) {
        dn.el.remove();
        this.damageNumbers.splice(i, 1);
        continue;
      }
      // Project world → screen
      const projected = dn.world.clone().project(this.camera);
      if (projected.z > 1 || projected.z < -1) {
        dn.el.style.display = 'none';
        continue;
      }
      dn.el.style.display = 'block';
      const x = (projected.x * 0.5 + 0.5) * this.container.clientWidth;
      const y = (projected.y * -0.5 + 0.5) * this.container.clientHeight - dn.life * 40;
      dn.el.style.left = `${x}px`;
      dn.el.style.top = `${y}px`;
      dn.el.style.opacity = String(1 - dn.life / dn.maxLife);
    }

    // Directional damage arcs (fade out)
    for (let i = this.dmgIndicators.length - 1; i >= 0; i--) {
      const d = this.dmgIndicators[i];
      d.life += deltaTime;
      const k = 1 - d.life / d.maxLife;
      if (k <= 0) {
        d.el.remove();
        this.dmgIndicators.splice(i, 1);
        continue;
      }
      d.el.style.opacity = String(k * k);
    }

    this.renderMinimap();
  }

  /**
   * Update external data sources: minimap bounds, enemies, player pos/yaw.
   */
  setMinimapData(
    bounds: { width: number; depth: number },
    enemies: { x: number; z: number; alive: boolean }[],
    playerPos: THREE.Vector3,
    playerYaw: number
  ): void {
    this.minimapBounds.width = bounds.width;
    this.minimapBounds.depth = bounds.depth;
    this.minimapEnemies = enemies;
    this.playerWorldPos.copy(playerPos);
    this.playerYaw = playerYaw;
  }

  private renderMinimap(): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    // Circular radar clipping mask (CS2 top-left radar)
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
    ctx.clip();

    // Dark radar background
    ctx.fillStyle = 'rgba(15,20,26,0.92)';
    ctx.fillRect(0, 0, w, h);

    const scaleX = w / this.minimapBounds.width;
    const scaleZ = h / this.minimapBounds.depth;

    // CS2 Radar concentric rings
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.8, 0, Math.PI * 2);
    ctx.stroke();

    // Radar crosshairs
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();

    // Enemies (red CS2 radar blips with dark outline)
    for (const e of this.minimapEnemies) {
      if (!e.alive) continue;
      const ex = e.x * scaleX;
      const ez = e.z * scaleZ;
      ctx.beginPath();
      ctx.arc(ex, ez, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#7f1d1d';
      ctx.stroke();
    }

    // Player (white CS2 radar indicator + view cone)
    const px = this.playerWorldPos.x * scaleX;
    const pz = this.playerWorldPos.z * scaleZ;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.playerYaw);

    // View cone
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 36, -Math.PI / 5, Math.PI / 5);
    ctx.closePath();
    ctx.fill();

    // Player icon (clean white triangle with dark border)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  /** Set up ability icons (called by demo with the ability list). */
  initAbilities(abilities: { id: string; name: string }[]): void {
    this.abilityBar.innerHTML = '';
    for (const a of abilities) {
      const icon = document.createElement('div');
      icon.setAttribute('data-ability', a.id);
      icon.style.cssText = 'position:relative;width:44px;height:44px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;text-align:center;overflow:hidden;';
      icon.innerHTML = `<span style="position:relative;z-index:1">${this.escapeHtml(a.name.split(' ')[0])}</span>` +
        `<div class="cd" style="position:absolute;bottom:0;left:0;width:100%;height:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#ffd700"></div>`;
      this.abilityBar.appendChild(icon);
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Update the Skuller Headhunter rewards HUD badge.
   */
  updateSkullerBadge(skullCount: number, rankTitle: string, equippedSkinName: string): void {
    const countEl = this.skullerBadgeEl.querySelector('#skullerBadgeCount');
    const skinEl = this.skullerBadgeEl.querySelector('#skullerBadgeSkin');
    if (countEl) countEl.textContent = `💀 ${skullCount} SKULLS (${this.escapeHtml(rankTitle)})`;
    if (skinEl) skinEl.textContent = this.escapeHtml(equippedSkinName.toUpperCase());
  }

  /**
   * Show dramatic animated Skuller emoji overlay on one-tap headshot kill.
   */
  showSkullerHeadshotOverlay(skullCount: number, rankTitle: string): void {
    const popup = document.createElement('div');
    popup.style.cssText =
      'position:absolute;top:32%;left:50%;transform:translate(-50%,-50%);background:radial-gradient(circle, rgba(180,20,40,0.92) 0%, rgba(15,20,30,0.95) 75%);border:2px solid #ffd700;border-radius:18px;padding:18px 36px;text-align:center;box-shadow:0 0 40px rgba(255,40,70,0.85);z-index:9999;animation:skullPop 0.35s cubic-bezier(0.18,0.89,0.32,1.28);pointer-events:none;font-family:\'Segoe UI\',system-ui,sans-serif;';
    popup.innerHTML = `
      <div style="font-size:72px;line-height:1;filter:drop-shadow(0 0 16px #ffd700);">💀</div>
      <div style="font-size:26px;font-weight:900;color:#ffd700;letter-spacing:2px;text-transform:uppercase;margin-top:8px;text-shadow:0 2px 8px #000;">ONE-TAP HEADSHOT!</div>
      <div style="font-size:15px;font-weight:800;color:#fff;margin-top:4px;">+1 SKULL TOKEN COLLECTED &nbsp;•&nbsp; ${this.escapeHtml(rankTitle)}</div>
      <div style="font-size:12px;color:#cbd5e1;margin-top:6px;font-weight:600;">TOTAL SKULLS: 💀 ${skullCount}</div>
    `;
    this.root.appendChild(popup);

    setTimeout(() => {
      popup.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
      popup.style.opacity = '0';
      popup.style.transform = 'translate(-50%, -70%)';
      setTimeout(() => popup.remove(), 500);
    }, 2000);
  }

  /**
   * Display interactive Skuller Skins conversion modal.
   */
  showSkullerSkinsModal(rewards: any, onEquip: (skin: any) => void): void {
    const existing = document.getElementById('skuller-skins-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'skuller-skins-modal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,5,15,0.85);backdrop-filter:blur(10px);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:\'Segoe UI\',system-ui,sans-serif;color:#fff;pointer-events:auto;';

    const renderContent = () => {
      const skins = rewards.getSkins();
      const currentSkulls = rewards.getSkullCount();
      const lifetimeSkulls = rewards.getLifetimeSkulls();
      const rankTitle = rewards.getRankTitle();
      const equippedSkin = rewards.getEquippedSkin();

      modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#131824,#1a2030);border:2px solid #ffd700;border-radius:18px;width:720px;max-width:95vw;padding:28px;box-shadow:0 0 50px rgba(0,0,0,0.9);position:relative;">
          <button id="closeSkullerModal" style="position:absolute;top:18px;right:18px;background:none;border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:18px;cursor:pointer;border-radius:6px;width:34px;height:34px;">✕</button>
          <div style="display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(255,215,0,0.3);padding-bottom:18px;margin-bottom:20px;">
            <span style="font-size:48px;filter:drop-shadow(0 0 10px #ffd700);">💀</span>
            <div>
              <h2 style="margin:0;font-size:26px;font-weight:900;color:#ffd700;letter-spacing:1px;">SKULLER HEADHUNTER REWARDS & SKINS</h2>
              <p style="margin:4px 0 0;font-size:14px;color:#cbd5e1;">Earn Skull Emojis (💀) from One-Tap Headshots &bull; Rank: <strong style="color:#ffd700">${this.escapeHtml(rankTitle)}</strong></p>
            </div>
            <div style="margin-left:auto;text-align:right;background:rgba(0,0,0,0.4);border:1px solid rgba(255,215,0,0.4);border-radius:10px;padding:10px 16px;">
              <div style="font-size:11px;color:#94a3b8;font-weight:700;">AVAILABLE TOKENS</div>
              <div style="font-size:28px;font-weight:900;color:#ffd700;">💀 ${currentSkulls}</div>
              <div style="font-size:11px;color:#94a3b8;">(${lifetimeSkulls} Lifetime)</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;padding-right:6px;">
            ${skins.map((skin: any) => {
              const isEquipped = skin.id === equippedSkin.id;
              const canUnlock = !skin.unlocked && currentSkulls >= skin.cost;
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border:1px solid ${isEquipped ? '#ffd700' : 'rgba(255,255,255,0.1)'};border-radius:12px;padding:14px 18px;transition:background 0.2s;">
                  <div style="flex:1;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-size:18px;font-weight:800;color:#fff;">${this.escapeHtml(skin.name)}</span>
                      ${isEquipped ? '<span style="background:#22c55e;color:#000;font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;">EQUIPPED</span>' : ''}
                      ${!skin.unlocked ? `<span style="background:rgba(255,215,0,0.15);color:#ffd700;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid #ffd700;">REQUIRES 💀 ${skin.cost}</span>` : ''}
                    </div>
                    <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">${this.escapeHtml(skin.description)}</p>
                  </div>
                  <div>
                    ${isEquipped ? `
                      <button disabled style="background:#22c55e;border:none;color:#000;font-weight:800;font-size:13px;padding:8px 18px;border-radius:8px;cursor:default;">EQUIPPED</button>
                    ` : skin.unlocked ? `
                      <button class="equipSkinBtn" data-skin-id="${skin.id}" style="background:rgba(255,255,255,0.1);border:1px solid #ffd700;color:#ffd700;font-weight:800;font-size:13px;padding:8px 18px;border-radius:8px;cursor:pointer;">EQUIP</button>
                    ` : canUnlock ? `
                      <button class="unlockSkinBtn" data-skin-id="${skin.id}" style="background:linear-gradient(90deg,#d97706,#b45309);border:1px solid #ffd700;color:#fff;font-weight:800;font-size:13px;padding:8px 18px;border-radius:8px;cursor:pointer;box-shadow:0 0 12px rgba(245,158,11,0.5);">CONVERT ${skin.cost} 💀</button>
                    ` : `
                      <button disabled style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#64748b;font-weight:700;font-size:12px;padding:8px 14px;border-radius:8px;cursor:not-allowed;">NEED ${skin.cost - currentSkulls} MORE 💀</button>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      modal.querySelector('#closeSkullerModal')?.addEventListener('click', () => modal.remove());

      modal.querySelectorAll('.equipSkinBtn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const sid = (e.currentTarget as HTMLButtonElement).getAttribute('data-skin-id')!;
          rewards.equipSkin(sid);
          onEquip(rewards.getEquippedSkin());
          renderContent();
        });
      });

      modal.querySelectorAll('.unlockSkinBtn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const sid = (e.currentTarget as HTMLButtonElement).getAttribute('data-skin-id')!;
          const res = rewards.convertSkullsToSkin(sid);
          if (res.success) {
            onEquip(rewards.getEquippedSkin());
            renderContent();
          }
        });
      });
    };

    renderContent();
    document.body.appendChild(modal);
  }

  /**
   * Bind click event on the Skuller badge in the top right HUD.
   */
  bindSkullerBadgeClick(handler: () => void): void {
    this.skullerBadgeEl.addEventListener('click', handler);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.root.remove();
  }
}
