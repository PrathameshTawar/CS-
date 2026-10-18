// grenades/index.js — grenades on the client: what you carry, throwing,
// flights in the world, and the smoke cloud, flashbang and HE blast.
//
// The weapons system holds a grenade out (key 4) and calls throw() on a click
// (right click: lob). Online, a throw goes to the server through net, which
// simulates it; we draw our own grenade straight away (the same shared
// flight, shared/grenades.js), then take the server's version when its
// EV_NADE arrives. Everyone else's grenades start from that event, and they
// go off where the server's EV_NADE_POP says. Offline, the same flights run
// locally and HE damages the AI (an `explosion` event).

import * as THREE from 'three';
import {
  GRENADES,
  GRENADE_IDS,
  MIN_THROW_INTERVAL,
  createFlight,
  flashDuration,
  shouldDetonate,
  stepFlight,
  throwVelocity,
} from '../../shared/grenades.js';
import { TICK_RATE } from '../../shared/protocol.js';
import { createRng } from '../../shared/rng.js';

const COLORS = { he: 0x4a5a2a, flash: 0x9aa0a8, smoke: 0x5d6b62 };
const SMOKE_PUFFS = 34;

export class GrenadeSystem {
  static id = 'grenades';
  static deps = ['player', 'physics', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.physics = ctx.get('physics');
    // its own stream: forking ctx.rng would shift every system after this
    // one (and the screenshot captures)
    this.rng = createRng(((ctx.config.seed || 1) ^ 0x6e4de) >>> 0);
    this._local = { he: 0, flash: 0, smoke: 0 }; // offline inventory
    this._pending = new Map(); // online: seq -> type thrown, not yet confirmed
    this._flights = []; // { id, seq, type, flight, mesh }
    this._smokes = []; // { group, sprites, t }
    this._booms = []; // { t, light, sphere }
    this._blind = 0; // seconds of flash left
    this._blindMax = 0;
    this._lastThrow = -Infinity;
    if (ctx.config.shot) return;
    this._geo = new THREE.SphereGeometry(0.07, 10, 8);
    this._mats = {};
    for (const [id, c] of Object.entries(COLORS)) this._mats[id] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 });
    this._puffTex = puffTexture();
    this._white = document.createElement('div');
    this._white.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:60;';
    document.body.appendChild(this._white);
    const e = ctx.events;
    this._subs = [
      e.on('grenade:spawn', (g) => this._onSpawn(g)),
      e.on('grenade:pop', (g) => this._onPop(g)),
    ];
  }

  get _net() {
    return this.ctx.peek('net');
  }

  // ---- inventory ----

  count(type) {
    const net = this._net;
    if (!net) return this._local[type];
    let n = net.nades ? net.nades[type] : 0;
    for (const t of this._pending.values()) if (t === type) n--;
    return Math.max(0, n);
  }

  total() {
    return GRENADE_IDS.reduce((n, t) => n + this.count(t), 0);
  }

  // The next grenade type you carry after `current` (or the first), or null.
  nextType(current = null) {
    const start = current ? GRENADE_IDS.indexOf(current) + 1 : 0;
    for (let i = 0; i < GRENADE_IDS.length; i++) {
      const t = GRENADE_IDS[(start + i) % GRENADE_IDS.length];
      if (this.count(t) > 0) return t;
    }
    return null;
  }

  // Single player: from the (free) buy menu.
  give(type) {
    this._local[type] = Math.min(GRENADES[type].max, this._local[type] + 1);
  }

  canThrow() {
    return this.ctx.time.state.raw - this._lastThrow >= MIN_THROW_INTERVAL && !this.player.dead && !this.player.frozen;
  }

  // Throws a `type` grenade from the camera (lob: the short underarm throw).
  throw(type, lob) {
    if (this.count(type) <= 0 || !this.canThrow()) return false;
    this._lastThrow = this.ctx.time.state.raw;
    const cam = this.ctx.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const origin = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.3);
    origin.y -= 0.1;
    const o = { x: origin.x, y: origin.y, z: origin.z };
    const d = { x: dir.x, y: dir.y, z: dir.z };
    const net = this._net;
    let seq = null;
    if (net && net.id) {
      seq = net._seq; // the input step this throw rides on (net records it on the event)
      this._pending.set(seq, type);
      this.ctx.events.emit('grenade:throw', { type, origin: o, dir: d, lob });
    } else {
      this._local[type]--;
    }
    const vel = throwVelocity(d, lob, this.player.vel);
    this._addFlight(null, seq, type, createFlight(o, vel));
    this.ctx.events.emit('grenade:thrown', { type, lob });
    return true;
  }

  // ---- flights ----

  _addFlight(id, seq, type, flight) {
    const mesh = new THREE.Mesh(this._geo, this._mats[type]);
    mesh.position.set(flight.x, flight.y, flight.z);
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    this._flights.push({ id, seq, type, flight, mesh });
  }

  _removeFlight(i) {
    const f = this._flights[i];
    this.ctx.scene.remove(f.mesh);
    this._flights.splice(i, 1);
  }

  // The server's throw: replaces our prediction of it, or starts someone
  // else's grenade, caught up to where it is now.
  _onSpawn(g) {
    const net = this._net;
    const nowTick = Math.floor(this.ctx.time.state.raw * TICK_RATE + (net ? net._tickOffset || 0 : 0));
    const flight = createFlight(g.origin, g.vel);
    const steps = Math.min(TICK_RATE * 6, Math.max(1, nowTick - g.tick + 1)); // its first step is in g.tick
    for (let i = 0; i < steps; i++) stepFlight(flight, this.physics);
    if (g.mine) {
      this._pending.delete(g.seq);
      const i = this._flights.findIndex((f) => f.seq === g.seq && f.id === null);
      if (i >= 0) {
        this._flights[i].id = g.id;
        this._flights[i].flight = flight;
        return;
      }
    }
    this._addFlight(g.id, null, g.type, flight);
  }

  _onPop(g) {
    const i = this._flights.findIndex((f) => f.id === g.id);
    if (i >= 0) this._removeFlight(i);
    this._effect(g.type, g.pos);
  }

  fixedUpdate(h, ctx) {
    if (ctx.config.shot) return;
    const online = !!this._net;
    for (let i = this._flights.length - 1; i >= 0; i--) {
      const f = this._flights[i];
      stepFlight(f.flight, this.physics);
      if (!online && shouldDetonate(f.type, f.flight)) {
        this._removeFlight(i);
        const pos = { x: f.flight.x, y: f.flight.y, z: f.flight.z };
        this._effect(f.type, pos);
        if (f.type === 'he') ctx.events.emit('explosion', { point: pos, radius: GRENADES.he.radius, damage: GRENADES.he.damage });
      } else if (f.flight.t > 8) {
        this._removeFlight(i); // online and never confirmed (the server refused it)
      }
    }
    // an online throw the server never confirmed stops counting as spent
    if (this._pending.size && online) {
      const seq = this._net._seq;
      for (const [s] of this._pending) if (seq - s > TICK_RATE * 2) this._pending.delete(s);
    }
  }

  // ---- effects ----

  _effect(type, pos) {
    this.ctx.events.emit('grenade:effect', { type, position: pos });
    if (type === 'he') this._boom(pos);
    else if (type === 'flash') this._flash(pos);
    else this._smoke(pos);
  }

  _boom(pos) {
    const at = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z);
    const light = new THREE.PointLight(0xffa050, 150, 18, 2);
    light.position.copy(at);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    sphere.position.copy(at);
    this.ctx.scene.add(light, sphere);
    this._booms.push({ t: 0, light, sphere });
    const d = this.player.pos.distanceTo(at);
    this.player.addShake(Math.max(0, 1.1 * (1 - d / 20)));
  }

  _flash(pos) {
    // a bright pop for everyone
    const at = new THREE.Vector3(pos.x, pos.y + 0.1, pos.z);
    const light = new THREE.PointLight(0xffffff, 300, 25, 2);
    light.position.copy(at);
    this.ctx.scene.add(light);
    this._booms.push({ t: 0, light, sphere: null, life: 0.25 });
    // blinded if we can see it
    if (this.player.dead) return;
    const cam = this.ctx.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const look = cam.getWorldDirection(new THREE.Vector3());
    const to = at.clone().sub(eye);
    const dist = to.length();
    const hit = dist > 0.01 ? this.physics.raycastStatic(eye, to.clone().divideScalar(dist), dist) : null;
    const blocked = !!(hit && hit.hit && hit.distance < dist - 0.3);
    const dur = flashDuration(eye, look, at, blocked);
    if (dur <= 0) return;
    this._blind = Math.max(this._blind, dur);
    this._blindMax = Math.max(this._blindMax, this._blind);
    this.ctx.events.emit('flash:blind', { duration: dur });
  }

  _smoke(pos) {
    const g = GRENADES.smoke;
    const group = new THREE.Group();
    const sprites = [];
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({ map: this._puffTex, color: 0xb9bdc1, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      // a dome of puffs over the grenade
      const a = this.rng.nextFloat() * Math.PI * 2;
      const r = Math.sqrt(this.rng.nextFloat()) * g.radius * 0.8;
      const y = 0.6 + this.rng.nextFloat() * 2.6 * (1 - (r / g.radius) * 0.5);
      s.position.set(pos.x + Math.cos(a) * r, pos.y + y, pos.z + Math.sin(a) * r);
      const size = 2.6 + this.rng.nextFloat() * 1.6;
      s.scale.set(size, size, 1);
      s.userData.spin = (this.rng.nextFloat() - 0.5) * 0.3;
      group.add(s);
      sprites.push(s);
    }
    this.ctx.scene.add(group);
    this._smokes.push({ group, sprites, t: 0 });
  }

  update(dt, ctx) {
    if (ctx.config.shot) return;
    // grenades in the air (interpolated would be nicer; at 120 Hz steps it's fine)
    for (const f of this._flights) f.mesh.position.set(f.flight.x, f.flight.y, f.flight.z);

    // smoke clouds: billow in, hold, thin out
    const life = GRENADES.smoke.duration;
    for (let i = this._smokes.length - 1; i >= 0; i--) {
      const sm = this._smokes[i];
      sm.t += dt;
      const fade = Math.min(1, sm.t / 0.8) * Math.min(1, Math.max(0, (life - sm.t) / 3));
      for (const s of sm.sprites) {
        s.material.opacity = 0.92 * fade;
        s.material.rotation += s.userData.spin * dt;
      }
      if (sm.t >= life) {
        ctx.scene.remove(sm.group);
        for (const s of sm.sprites) s.material.dispose();
        this._smokes.splice(i, 1);
      }
    }

    // HE fireballs and flash pops
    for (let i = this._booms.length - 1; i >= 0; i--) {
      const b = this._booms[i];
      b.t += dt;
      const k = Math.min(1, b.t / (b.life || 0.5));
      b.light.intensity *= Math.exp(-dt * 12);
      if (b.sphere) {
        b.sphere.scale.setScalar(0.5 + k * 3.5);
        b.sphere.material.opacity = 0.85 * (1 - k);
      }
      if (k >= 1) {
        ctx.scene.remove(b.light);
        if (b.sphere) {
          ctx.scene.remove(b.sphere);
          b.sphere.geometry.dispose();
          b.sphere.material.dispose();
        }
        this._booms.splice(i, 1);
      }
    }

    // flashbang: full white, then fading over the last second
    if (this._blind > 0) this._blind = Math.max(0, this._blind - dt);
    else this._blindMax = 0;
    this._white.style.opacity = String(Math.min(1, this._blind / 1.0));
  }

  dispose() {
    if (this._subs) for (const off of this._subs) off();
    for (let i = this._flights.length - 1; i >= 0; i--) this._removeFlight(i);
    for (const sm of this._smokes) this.ctx.scene.remove(sm.group);
    if (this._white) this._white.remove();
    if (this._geo) this._geo.dispose();
    for (const m of Object.values(this._mats || {})) m.dispose();
    if (this._puffTex) this._puffTex.dispose();
  }
}

// A soft round puff for smoke sprites.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
