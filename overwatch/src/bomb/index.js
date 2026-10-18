// bomb/index.js — Bomb Defusal on the client: the bomb in the world, the
// plant/defuse bar and hints, the beeping, and the explosion.
//
// The server decides everything (server/room.js, shared/bomb.js); this
// system only draws what `net` heard in the last snapshot: net.bomb is
// [state, x, y, z, site, carrierId], net.useKind / net.useProgress our own
// plant or defuse. Hold F (the `interact` key, sent as the use flag) to
// plant or defuse. Idle outside Bomb Defusal and in single player.

import * as THREE from 'three';
import {
  BOMB_CARRIED,
  BOMB_DROPPED,
  BOMB_PLANTED,
  BOMB_RADIUS,
  DEFUSE_RADIUS,
  DEFUSE_TIME,
  KIT_DEFUSE_TIME,
  siteAt,
} from '../../shared/bomb.js';
import { ARENA } from '../../shared/maps/arena.js';
import { BOMBEV_EXPLODED, MODE_BOMB, PHASE_FREEZE, PHASE_LIVE, TICK_RATE, USE_DEFUSE, USE_PLANT } from '../../shared/protocol.js';

export class BombSystem {
  static id = 'bomb';
  static deps = ['player', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this._beepT = 0;
    this._boom = null; // { t, light, sphere }
    if (ctx.config.shot || !ctx.config.server) return; // online only
    this._buildModel();
    this._buildHud();
    this._subs = [ctx.events.on('bomb:event', (e) => e.kind === BOMBEV_EXPLODED && this._explode())];
  }

  get _net() {
    return this.ctx.peek('net');
  }

  _buildModel() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x3a3f2c, roughness: 0.7, metalness: 0.2 }),
    );
    body.position.y = 0.06;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.01, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0c1a10, emissive: 0x1a4a22, emissiveIntensity: 0.8 }),
    );
    panel.position.set(-0.05, 0.125, 0);
    this._led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this._led.position.set(0.11, 0.13, 0.05);
    this._ledLight = new THREE.PointLight(0xff3020, 0, 3, 2);
    this._ledLight.position.copy(this._led.position);
    g.add(body, panel, this._led, this._ledLight);
    g.visible = false;
    this.ctx.scene.add(g);
    this._model = g;
  }

  _buildHud() {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:30;pointer-events:none;text-align:center;' +
      'font:600 13px/1.4 ui-monospace,Consolas,monospace;color:#ffe2a8;text-shadow:0 1px 3px #000;letter-spacing:1px;';
    el.innerHTML =
      '<div data-hint></div>' +
      '<div data-bar style="display:none;width:260px;height:8px;margin:6px auto 0;background:rgba(0,0,0,.55);border:1px solid rgba(255,210,140,.5);border-radius:4px;overflow:hidden">' +
      '<div data-fill style="height:100%;width:0;background:linear-gradient(90deg,#f0a63a,#ffd27a)"></div></div>';
    document.body.appendChild(el);
    this._hud = el;
    this._hint = el.querySelector('[data-hint]');
    this._bar = el.querySelector('[data-bar]');
    this._fill = el.querySelector('[data-fill]');
    this._hintText = '';
  }

  update(dt, ctx) {
    this._updateBoom(dt);
    const net = this._net;
    if (!this._hud || !net) return;
    const active = net.status === 'online' && net.mode === MODE_BOMB;
    const bomb = active ? net.bomb : null;
    const state = bomb ? bomb[0] : 0;

    // the bomb, where it lies
    const shown = state === BOMB_DROPPED || state === BOMB_PLANTED;
    this._model.visible = shown;
    if (shown) this._model.position.set(bomb[1], bomb[2], bomb[3]);

    // beeping and the blinking LED, faster as the timer runs out
    const left = state === BOMB_PLANTED ? this._secondsLeft(ctx, net) : 0;
    this._beepT -= dt;
    if (state === BOMB_PLANTED && net.game && net.game[0] === PHASE_LIVE && this._beepT <= 0) {
      this._beepT = Math.max(0.12, Math.min(1, left / 35));
      ctx.events.emit('bomb:beep', { position: { x: bomb[1], y: bomb[2], z: bomb[3] }, urgent: left < 10 });
      this._blink = 0.08;
    }
    this._blink = Math.max(0, (this._blink || 0) - dt);
    this._led.material.color.setHex(this._blink > 0 || state !== BOMB_PLANTED ? 0xff2a1a : 0x401010);
    this._ledLight.intensity = this._blink > 0 ? 2.5 : 0;

    // our own plant/defuse progress, and what we can do here
    const using = active && (net.useKind === USE_PLANT || net.useKind === USE_DEFUSE);
    this._bar.style.display = using ? 'block' : 'none';
    if (using) this._fill.style.width = `${Math.round(net.useProgress * 100)}%`;
    this._setHint(active ? this._hintFor(net, bomb, state, using) : '');
  }

  _secondsLeft(ctx, net) {
    const nowTick = ctx.time.state.raw * TICK_RATE + (net._tickOffset || 0);
    return Math.max(0, (net.game[1] - nowTick) / TICK_RATE); // the round clock is the bomb's once planted
  }

  _hintFor(net, bomb, state, using) {
    const p = this.player;
    const phase = net.game ? net.game[0] : -1;
    if (p.dead || (phase !== PHASE_LIVE && phase !== PHASE_FREEZE)) return '';
    const attacker = net.team === net.attackers;
    const carrying = attacker && state === BOMB_CARRIED && bomb[5] === net.id;
    if (phase === PHASE_FREEZE) return carrying ? 'YOU HAVE THE BOMB · plant it on site A or B' : '';
    if (using) return net.useKind === USE_PLANT ? 'PLANTING THE BOMB… stay still' : 'DEFUSING… stay still';
    const pos = p.pos;
    if (carrying) {
      return siteAt(ARENA.sites, pos.x, pos.z) ? 'HOLD F TO PLANT THE BOMB' : 'YOU HAVE THE BOMB · plant it on site A or B';
    }
    if (attacker && state === BOMB_DROPPED) return 'THE BOMB WAS DROPPED · walk over it to pick it up';
    if (!attacker && state === BOMB_PLANTED) {
      const near = Math.hypot(pos.x - bomb[1], pos.z - bomb[3]) <= DEFUSE_RADIUS;
      const secs = net.kit ? KIT_DEFUSE_TIME : DEFUSE_TIME;
      return near ? `HOLD F TO DEFUSE (${secs} s${net.kit ? ', kit' : ''})` : `BOMB PLANTED AT ${bomb[4]} · defuse it`;
    }
    return '';
  }

  _setHint(text) {
    if (text === this._hintText) return;
    this._hintText = text;
    this._hint.textContent = text;
  }

  // Flash, fireball and a shove for anyone close enough to feel it.
  _explode() {
    const net = this._net;
    const b = net && net.bomb;
    if (!b) return;
    const at = new THREE.Vector3(b[1], b[2] + 1, b[3]);
    const light = new THREE.PointLight(0xffb060, 400, 60, 2);
    light.position.copy(at);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    sphere.position.copy(at);
    this.ctx.scene.add(light, sphere);
    if (this._boom) this._clearBoom();
    this._boom = { t: 0, light, sphere };
    this._model.visible = false;
    const d = this.player.pos.distanceTo(at);
    this.player.addShake(Math.max(0, 1.5 * (1 - d / (BOMB_RADIUS * 3))));
  }

  _updateBoom(dt) {
    const boom = this._boom;
    if (!boom) return;
    boom.t += dt;
    const k = Math.min(1, boom.t / 1.2);
    boom.sphere.scale.setScalar(1 + k * BOMB_RADIUS * 0.8);
    boom.sphere.material.opacity = 0.9 * (1 - k);
    boom.light.intensity = 400 * (1 - k);
    if (k >= 1) this._clearBoom();
  }

  _clearBoom() {
    const { light, sphere } = this._boom;
    this.ctx.scene.remove(light, sphere);
    sphere.geometry.dispose();
    sphere.material.dispose();
    this._boom = null;
  }

  dispose() {
    if (this._subs) for (const off of this._subs) off();
    if (this._boom) this._clearBoom();
    if (this._model) {
      this.ctx.scene.remove(this._model);
      this._model.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    if (this._hud) this._hud.remove();
  }
}
