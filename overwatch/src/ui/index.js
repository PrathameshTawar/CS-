// ui/index.js — the DOM HUD.
//
// Owns: crosshair (with fire/ADS dynamics), hitmarkers, health bar, damage
// vignette and the killfeed. The ammo readout lives with the weapons viewmodel
// (it is part of that subsystem's HUD element). Everything is plain DOM styled
// to sit on top of the canvas; nothing here is read by the pixel gate, and in
// shot mode no events fire so the HUD stays at rest.

export class UiSystem {
  static id = 'ui';
  static deps = ['player', 'weapons', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.weapons = ctx.get('weapons');
    this._subs = [];
    this._hitT = 0;
    this._killT = 0;
    this._hurtT = 0;
    this._crossKick = 0;

    if (ctx.config.shot) return; // no DOM HUD in captured frames

    this._build();
    this._wire();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'hud';
    el.style.cssText =
      'position:fixed;inset:0;z-index:25;pointer-events:none;font-family:ui-monospace,Consolas,monospace;';

    // crosshair: center dot + 4 ticks, gap scales with fire kick / ADS
    const ch = document.createElement('div');
    ch.id = 'hud-cross';
    ch.style.cssText =
      'position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%);';
    const mk = (x, y, w, h, extra = '') => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;${x};${y};width:${w}px;height:${h}px;` +
        'background:#e8eef5;box-shadow:0 0 1px rgba(0,0,0,.8);' + extra;
      ch.appendChild(d);
      return d;
    };
    this._chTop = mk('left:-1px', 'top:-8px', '2px', '7px');
    this._chBot = mk('left:-1px', 'top:1px', '2px', '7px');
    this._chL = mk('left:-8px', 'top:-1px', '7px', '2px');
    this._chR = mk('left:1px', 'top:-1px', '7px', '2px');
    mk('left:-1px', 'top:-1px', '2px', '2px', 'border-radius:50%;');
    el.appendChild(ch);
    this._cross = ch;
    this._ticks = [this._chTop, this._chBot, this._chL, this._chR];

    // hitmarker: rotating X, flashes on a confirmed hit
    const hm = document.createElement('div');
    hm.id = 'hud-hit';
    hm.style.cssText =
      'position:absolute;left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%) rotate(45deg);' +
      'opacity:0;border-left:3px solid #fff;border-right:3px solid #fff;';
    el.appendChild(hm);
    this._hit = hm;

    // health bar + number
    const hb = document.createElement('div');
    hb.id = 'hud-health';
    hb.style.cssText = 'position:absolute;left:28px;bottom:22px;width:240px;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:12px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.25);border-radius:3px;overflow:hidden;';
    this._hpFill = document.createElement('div');
    this._hpFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#3fae5a,#7fe08a);transition:width .2s;';
    fill.appendChild(this._hpFill);
    this._hpNum = document.createElement('div');
    this._hpNum.style.cssText = 'margin-top:4px;font-size:13px;color:#dfe6ee;text-shadow:0 1px 2px #000;';
    hb.appendChild(fill);
    hb.appendChild(this._hpNum);
    el.appendChild(hb);

    // damage vignette
    const vg = document.createElement('div');
    vg.id = 'hud-vignette';
    vg.style.cssText =
      'position:absolute;inset:0;opacity:0;transition:opacity .25s;' +
      'background:radial-gradient(ellipse at center,transparent 42%,rgba(160,10,10,.55) 100%);';
    el.appendChild(vg);
    this._vignette = vg;

    // killfeed
    const kf = document.createElement('div');
    kf.id = 'hud-killfeed';
    kf.style.cssText = 'position:absolute;right:24px;top:20px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;';
    el.appendChild(kf);
    this._killfeed = kf;

    document.body.appendChild(el);
    this._el = el;
  }

  _wire() {
    const e = this.ctx.events;
    // player's bullet confirmed on a soldier -> hitmarker
    this._subs.push(
      e.on('damage:dealt', (p) => {
        if (!p || p.target === 'player') return; // enemy rounds don't mark
        this._hitT = 0.16;
        if (p.killed) this._killT = 0.3;
      }),
      e.on('actor:death', (p) => {
        this._feed('YOU ▸ ' + nameOf(p.actor), true);
      }),
      e.on('damage:taken', (p) => {
        this._hurtT = 0.5;
        this._feed(`DAMAGE ${Math.round(p.amount)}`, false);
        if (p.health <= 0) this._feed('YOU DIED', true);
      }),
      e.on('weapon:fire', () => {
        this._crossKick = 1;
      }),
    );
  }

  _feed(text, kill) {
    if (!this._killfeed) return;
    const row = document.createElement('div');
    row.textContent = text;
    row.style.cssText =
      'background:rgba(0,0,0,.55);padding:3px 9px;border-radius:3px;font-size:12px;letter-spacing:.5px;' +
      `color:${kill ? '#ffd2d2' : '#dfe6ee'};border-left:2px solid ${kill ? '#c33' : '#7fd0ff'};` +
      'text-shadow:0 1px 1px #000;animation:fadeIn .15s;';
    this._killfeed.appendChild(row);
    while (this._killfeed.children.length > 5) this._killfeed.removeChild(this._killfeed.firstChild);
    setTimeout(() => row.remove(), 3200);
  }

  update(dt) {
    if (!this._el) return;
    const p = this.player;
    const w = this.weapons;

    // health
    const hp = p && p.health !== undefined ? p.health : 100;
    const max = 100;
    this._hpFill.style.width = `${Math.max(0, Math.min(100, hp / max * 100))}%`;
    this._hpFill.style.background = hp > 50 ? 'linear-gradient(90deg,#3fae5a,#7fe08a)' : hp > 25 ? 'linear-gradient(90deg,#d9a03c,#f0c060)' : 'linear-gradient(90deg,#c23,#f05050)';
    this._hpNum.textContent = `${Math.ceil(hp)} / ${max}`;

    // hitmarker + kill flash
    this._hitT -= dt;
    this._killT -= dt;
    const hmOpacity = this._killT > 0 ? 0.95 : this._hitT > 0 ? 0.7 : 0;
    this._hit.style.opacity = String(hmOpacity);
    this._hit.style.borderColor = this._killT > 0 ? '#ff5a4a' : '#ffffff';
    this._hit.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${1 + (this._hitT > 0 || this._killT > 0 ? (1 - Math.max(this._hitT, this._killT) / 0.3) * 0.4 : 0)})`;

    // damage vignette
    this._hurtT -= dt;
    this._vignette.style.opacity = String(Math.max(0, Math.min(1, this._hurtT * 2)));

    // crosshair: rest gap 9px, kick opens to ~22px, ADS pulls in
    this._crossKick = Math.max(0, this._crossKick - dt * 6);
    const ads = w ? w.ads : 0;
    const gap = 9 + this._crossKick * 13 - ads * 6;
    const off = (gap + 3).toFixed(1);
    this._chTop.style.top = `-${off}px`;
    this._chBot.style.top = '1px';
    this._chL.style.left = `-${off}px`;
    this._chR.style.left = '1px';
    this._cross.style.opacity = String(ads > 0.5 ? 0.25 : 1);
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    if (this._el) this._el.remove();
  }
}

const NAMES = ['VEGA', 'CRANE', 'SABLE', 'ORTIZ', 'KELLER', 'NASH', 'HOLT', 'REYES'];
function nameOf(actor) {
  if (!actor) return 'HOSTILE';
  const i = actor.box ? (actor.box.min[0] * 7 + actor.box.min[2] * 13) % NAMES.length : 0;
  return NAMES[Math.abs(i) | 0];
}
