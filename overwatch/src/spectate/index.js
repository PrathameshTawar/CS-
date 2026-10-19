// spectate/index.js — what you see while dead, online.
//
// First a death camera: lifted above where you fell, turned towards whoever
// killed you, with who it was and with what. Then, in a team round where you
// won't respawn, you watch a living teammate over the shoulder; click (or
// Space) for the next one. In deathmatch and warmup you respawn after the
// death camera. The player system leaves the camera alone while you're dead,
// so this system owns it then (lateUpdate, after net has moved everyone).

import * as THREE from 'three';
import { PHASE_LIVE, PHASE_FREEZE, PHASE_END } from '../../shared/protocol.js';

const DEATH_CAM = 2.5; // s of looking at your killer
const FOLLOW_BACK = 3.2; // m behind the watched player
const FOLLOW_UP = 0.75; // m above their eyes
const FOLLOW_SIDE = 0.55; // m to their right: over the shoulder
const EYE = 1.6;

export class SpectateSystem {
  static id = 'spectate';
  static deps = ['player', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this._deadT = -1; // time since we died, -1: alive
    this._killer = null; // { id, name, weapon, headshot }
    this._target = 0; // remote id being watched
    this._cam = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    if (ctx.config.shot || !ctx.config.server) return;
    this._el = document.createElement('div');
    this._el.style.cssText =
      'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:30;pointer-events:none;text-align:center;' +
      'font:600 14px/1.5 ui-monospace,Consolas,monospace;color:#f1f5f9;text-shadow:0 1px 3px #000;letter-spacing:1px;display:none;';
    document.body.appendChild(this._el);
    this._html = '';
    this._subs = [
      ctx.events.on('player:kill', (k) => {
        if (k.onMe) this._killer = { id: k.killerId, name: k.killer, weapon: k.weapon, headshot: k.headshot, bomb: k.bomb };
      }),
    ];
  }

  get _net() {
    return this.ctx.peek('net');
  }

  // Teammates we can watch (alive), in a stable order.
  _watchable(net) {
    const out = [];
    for (const [id, r] of net._remotes) if (!r.dead && r.team === net.team && net.team >= 0) out.push(id);
    return out.sort((a, b) => a - b);
  }

  lateUpdate(dt, ctx) {
    if (!this._el) return;
    const net = this._net;
    const p = this.player;
    if (!net || net.status !== 'online' || !p.dead) {
      if (this._deadT >= 0) {
        this._deadT = -1;
        this._killer = null;
        this._target = 0;
        this._show('');
      }
      return;
    }
    if (this._deadT < 0) this._deadT = 0;
    this._deadT += dt;

    const g = net.game;
    const phase = g ? g[0] : -1;
    const teamRound = g && !g[7] && (phase === PHASE_LIVE || phase === PHASE_FREEZE || phase === PHASE_END);
    const watch = this._watchable(net);
    const cam = ctx.camera;

    if (this._deadT < DEATH_CAM || !teamRound || !watch.length) {
      // death camera: above where we fell, looking at the killer (or down at us)
      const k = this._killer;
      const killer = k && k.id ? net._remotes.get(k.id) : null;
      const base = this._tmp.set(p.pos.x, p.pos.y, p.pos.z);
      if (killer) {
        this._look.copy(killer.group.position);
        this._look.y += killer.crouching ? 1.1 : EYE;
      } else this._look.set(base.x, base.y, base.z);
      const away = this._cam.subVectors(base, this._look).setY(0);
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize().multiplyScalar(killer ? 1.5 : 2.2);
      this._cam.set(base.x + away.x, base.y + 2.4, base.z + away.z);
      this._ease(cam, dt, 6);
      this._show(this._deathText(k, teamRound && watch.length > 0, teamRound));
      return;
    }

    // spectate a teammate; click or Space for the next one
    const inp = ctx.input;
    if (!watch.includes(this._target) || inp.firePressed() || inp.justPressed('jump')) {
      const i = watch.indexOf(this._target);
      this._target = watch[(i + 1) % watch.length];
    }
    const r = net._remotes.get(this._target);
    const yaw = r.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw); // a player looks along -Z at yaw 0
    const eye = this._look.copy(r.group.position);
    eye.y += r.crouching ? 1.1 : EYE;
    // their right is (-fz, fx) in x/z
    this._cam.set(eye.x - fx * FOLLOW_BACK - fz * FOLLOW_SIDE, eye.y + FOLLOW_UP, eye.z - fz * FOLLOW_BACK + fx * FOLLOW_SIDE);
    this._look.set(eye.x + fx * 6, eye.y + Math.sin(r.pitch) * 6, eye.z + fz * 6);
    this._ease(cam, dt, 10);
    this._show(`SPECTATING <b>${esc(r.name)}</b><div style="font-size:11px;color:#94a3b8">click or space: next teammate (${watch.indexOf(this._target) + 1}/${watch.length})</div>`);
  }

  // Glide the camera to _cam, looking at _look.
  _ease(cam, dt, rate) {
    const k = Math.min(1, dt * rate);
    cam.position.lerp(this._cam, this._deadT < 0.05 ? 1 : k);
    cam.lookAt(this._look);
  }

  _deathText(k, willSpectate, teamRound) {
    let who = 'YOU DIED';
    if (k && k.bomb) who = 'KILLED BY THE BOMB';
    else if (k && k.name) who = `KILLED BY <b style="color:#fca5a5">${esc(k.name)}</b>${k.weapon ? ` · ${esc(k.weapon)}` : ''}${k.headshot ? ' · HEADSHOT' : ''}`;
    else if (k) who = 'YOU FELL OFF THE MAP';
    const next = willSpectate ? 'spectating your team next' : teamRound ? 'back in next round' : 'respawning…';
    return `${who}<div style="font-size:11px;color:#94a3b8">${next}</div>`;
  }

  _show(html) {
    if (html === this._html) return;
    this._html = html;
    this._el.innerHTML = html;
    this._el.style.display = html ? 'block' : 'none';
  }

  dispose() {
    if (this._subs) for (const off of this._subs) off();
    if (this._el) this._el.remove();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
