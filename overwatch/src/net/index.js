// net/index.js — multiplayer client. Registered only when the URL has
// `?server=ws://host:port` (optionally `&room=<name>&name=<you>`); single
// player never loads it.
//
// - Prediction: the player system keeps moving the local player immediately
//   with shared/movement.js. Every fixed step's input is recorded with a
//   sequence number and sent to the server in batches (30 Hz).
// - Reconciliation: each snapshot carries the server's exact state for us
//   and the last input seq it applied. We rewind to that state and replay
//   the inputs it hasn't seen yet, so we end up where the server will be.
// - Interpolation: other players are drawn INTERP_TICKS behind the newest
//   snapshot, blended between the two snapshots around that moment.
// - Combat: our shots and reloads ride the input stream, tagged with the
//   input they happen before and the server tick we were looking at (for
//   lag compensation). The weapon still traces locally for instant tracers,
//   impacts and blood (remote players carry client-side hitboxes); damage,
//   kills and respawns come only from the server.

import * as THREE from 'three';
import { MAG_SIZE, RESERVE, playerHitbox } from '../../shared/combat.js';
import { HALF, HALF_Y_CROUCH, stepMove } from '../../shared/movement.js';
import {
  EV_HIT,
  EV_KILL,
  EV_SHOT,
  INPUT_SEND_EVERY,
  PL_CROUCH,
  PL_DEAD,
  PROTOCOL_VERSION,
  TICK_RATE,
  decode,
  encode,
  unpackState,
  writeInput,
  writeShot,
} from '../../shared/protocol.js';

const INTERP_TICKS = 12; // 100 ms: two snapshot intervals of cushion
const PENDING_MAX = 256; // ~2 s of unacknowledged inputs at 120 Hz
const PING_EVERY = 1; // seconds
const TELEPORT = 4; // m between snapshots: a respawn, don't slide across the map

export class NetSystem {
  static id = 'net';
  static deps = ['player', 'physics', 'render', 'weapons'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.physics = ctx.get('physics');
    this.weapons = ctx.get('weapons');
    this.player.serverAuthority = true;
    this.id = 0;
    this.status = 'connecting';
    this.rtt = 0;
    this.kills = 0;
    this.deaths = 0;
    this.viewTick = 0; // the server tick remote players are drawn at
    this.lastCorrection = 0; // metres the last reconcile moved us (debug)

    // pending inputs: ring of preallocated slots (no per-step allocation)
    this._pending = [];
    for (let i = 0; i < PENDING_MAX; i++) {
      this._pending.push({ seq: -1, yaw: 0, input: { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 } });
    }
    this._head = 0; // next slot to write
    this._count = 0;
    this._seq = 0;
    this._outbox = [];
    this._shots = [];
    this._reloads = [];
    this._snap = null; // newest snapshot not yet reconciled against
    this._buffer = []; // recent snapshots for interpolation
    this._tickOffset = null; // server tick - local tick estimate
    this._pingT = 0;
    this._spawns = -1;
    this._lastAttacker = null;
    this._names = new Map();
    this._out = { hasWish: false, landed: false, impact: 0 };

    // remote players
    this._remotes = new Map();
    this._bodyGeo = new THREE.BoxGeometry(0.68, 1, 0.68);
    this._bodyGeo.translate(0, 0.5, 0); // origin at the feet
    this._headGeo = new THREE.SphereGeometry(0.14, 12, 8);

    this._hud = document.createElement('div');
    this._hud.style.cssText =
      'position:fixed;top:12px;left:12px;font:12px/1.4 ui-monospace,monospace;color:#d8e2f0;' +
      'background:rgba(8,12,20,.55);padding:4px 8px;border-radius:4px;pointer-events:none;z-index:5';
    document.body.appendChild(this._hud);
    this.ws = null; // opened on the first frame, once boot (shader prewarm) is done

    const e = ctx.events;
    this._subs = [
      // our shot: happens before the next input step we record
      e.on('weapon:fire', (p) => {
        if (this.id && !this.player.dead) this._shots.push(writeShot(this._seq, p.origin, p.dir, this.viewTick));
      }),
      e.on('weapon:reload', (p) => {
        if (this.id && p.phase === 'start') this._reloads.push(this._seq);
      }),
    ];
  }

  _connect(url) {
    const cfg = this.ctx.config;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this._fail(`bad server URL: ${url}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: cfg.playerName, room: cfg.room }));
    };
    ws.onmessage = (e) => this._onMessage(decode(e.data));
    ws.onclose = (e) => {
      if (this.status !== 'error') this._fail(e.reason || 'disconnected');
    };
  }

  _fail(reason) {
    this.status = 'error';
    this.error = reason;
    this.id = 0;
    // offline: other players are gone, don't leave them frozen in the world
    this._buffer.length = 0;
    this._clearRemotes();
    this.player.dead = false;
  }

  _clearRemotes() {
    for (const id of [...this._remotes.keys()]) this._removeRemote(id);
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.t === 'welcome') {
      if (msg.seed !== this.ctx.config.seed) {
        // the server plays a different map: reload on its seed
        const url = new URL(location.href);
        url.searchParams.set('seed', String(msg.seed));
        location.replace(url.href);
        return;
      }
      this.id = msg.id;
      this.room = msg.room;
      this.status = 'online';
    } else if (msg.t === 'snap') {
      for (const row of msg.players) this._names.set(row[0], row[7]);
      this._applyCombat(msg);
      this._snap = msg;
      this._buffer.push(msg);
      const nowTicks = this.ctx.time.state.raw * TICK_RATE;
      const target = msg.tick - nowTicks;
      if (this._tickOffset === null || Math.abs(target - this._tickOffset) > TICK_RATE) this._tickOffset = target;
      else this._tickOffset += (target - this._tickOffset) * 0.05;
    } else if (msg.t === 'pong') {
      this.rtt = performance.now() - msg.c;
    } else if (msg.t === 'error') {
      this._fail(msg.message || msg.code);
    }
  }

  // Server-owned combat state and events from one snapshot.
  _applyCombat(msg) {
    const e = this.ctx.events;
    const p = this.player;
    const me = this.id;
    for (const ev of msg.ev) {
      const type = ev[0];
      if (type === EV_SHOT) {
        // someone else fired: tracer from their muzzle (ours were drawn locally)
        e.emit('bullet:tracer', { from: { x: ev[2], y: ev[3], z: ev[4] }, to: { x: ev[5], y: ev[6], z: ev[7] }, speed: 800 });
      } else if (type === EV_HIT) {
        const [, shooter, target, amount, headshot, x, y, z] = ev;
        const point = { x, y, z };
        if (shooter === me) {
          e.emit('damage:dealt', { target: { remoteId: target }, amount, headshot: headshot === 1, killed: false, point });
        } else {
          // blood for hits we didn't predict ourselves
          e.emit('bullet:impact', { point, normal: { x: 0, y: 1, z: 0 }, surface: 'flesh', damage: amount });
        }
        if (target === me) this._lastAttacker = shooter;
      } else if (type === EV_KILL) {
        const [, killer, victim, headshot] = ev;
        if (killer === me) e.emit('damage:dealt', { target: { remoteId: victim }, amount: 0, headshot: headshot === 1, killed: true, point: null });
        e.emit('player:kill', {
          killer: this._nameOf(killer),
          victim: this._nameOf(victim),
          headshot: headshot === 1,
          byMe: killer === me,
          onMe: victim === me,
        });
      }
    }

    const [hp, dead, , , kills, deaths, spawns] = msg.me;
    if (hp < p.health) {
      const from = this._remotes.get(this._lastAttacker);
      e.emit('damage:taken', { amount: p.health - hp, from: from ? { ...from.group.position } : null, health: hp });
    }
    p.health = hp;
    p.dead = dead === 1;
    this.kills = kills;
    this.deaths = deaths;
    if (spawns !== this._spawns) {
      // (re)spawned: fresh magazine; the snapshot's state moves us there
      if (this._spawns >= 0) {
        const w = this.weapons;
        w.ammo = MAG_SIZE;
        w.reserve = RESERVE;
        w.reloading = false;
      }
      this._spawns = spawns;
    }
  }

  _nameOf(id) {
    return id === this.id ? this.ctx.config.playerName : this._names.get(id) || `#${id}`;
  }

  // Runs right after the player's fixed step (deps order): record and send
  // the input it just moved with, then reconcile against any new snapshot.
  fixedUpdate(h, ctx) {
    if (!this.id) return;
    const p = this.player;
    const mi = p.lastMoveInput;

    const slot = this._pending[this._head];
    slot.seq = this._seq;
    slot.yaw = p.yaw;
    Object.assign(slot.input, mi);
    this._head = (this._head + 1) % PENDING_MAX;
    this._count = Math.min(PENDING_MAX, this._count + 1);
    this._outbox.push(writeInput(this._seq, mi, p.yaw, p.pitch));
    this._seq++;
    if (this._outbox.length >= INPUT_SEND_EVERY && this.ws.readyState === WebSocket.OPEN) {
      const msg = { t: 'input', i: this._outbox };
      if (this._shots.length) msg.f = this._shots;
      if (this._reloads.length) msg.r = this._reloads;
      this.ws.send(encode(msg));
      this._outbox = [];
      this._shots = [];
      this._reloads = [];
    }

    if (this._snap) this._reconcile(h);
  }

  _reconcile(h) {
    const snap = this._snap;
    this._snap = null;
    const p = this.player;
    const move = p.move;
    const bx = move.pos.x, by = move.pos.y, bz = move.pos.z;
    const yaw = p.yaw;

    // rewind to the server's state, then replay what it hasn't applied yet
    // (nothing while dead: the server doesn't move the dead either)
    unpackState(snap.you, move);
    const start = (this._head - this._count + PENDING_MAX) % PENDING_MAX;
    let kept = 0;
    for (let k = 0; k < this._count; k++) {
      const slot = this._pending[(start + k) % PENDING_MAX];
      if (slot.seq <= snap.ack) continue;
      kept++;
      if (p.dead) continue;
      move.yaw = slot.yaw;
      stepMove(move, slot.input, h, this.physics, this._out);
    }
    this._count = kept; // the unacknowledged slots are the newest ones
    move.yaw = yaw;
    this.lastCorrection = Math.hypot(move.pos.x - bx, move.pos.y - by, move.pos.z - bz);
  }

  update(dt, ctx) {
    // Connect only once the game is running: boot compiles shaders and can
    // block the page for seconds, which would stall the handshake.
    if (!this.ws && this.status === 'connecting') this._connect(ctx.config.server);
    this._pingT += dt;
    if (this._pingT >= PING_EVERY && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._pingT = 0;
      // wall clock on purpose: the engine clock only advances per frame,
      // which would round round-trip times down to whole frames
      this.ws.send(encode({ t: 'ping', c: performance.now() }));
    }
    this._interpolate(ctx);
    this._drawHud();
  }

  _interpolate(ctx) {
    const buf = this._buffer;
    if (!buf.length) return;
    const renderTick = ctx.time.state.raw * TICK_RATE + this._tickOffset - INTERP_TICKS;
    this.viewTick = Math.max(0, renderTick);
    // keep one snapshot at or before renderTick, drop older ones
    while (buf.length > 2 && buf[1].tick <= renderTick) buf.shift();
    const a = buf[0];
    const b = buf.length > 1 && buf[1].tick > renderTick ? buf[1] : null;
    const t = b ? THREE.MathUtils.clamp((renderTick - a.tick) / (b.tick - a.tick), 0, 1) : 0;
    const from = b ? a : buf[buf.length - 1]; // past the newest: hold it

    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (const row of from.players) {
      const id = row[0];
      seen.add(id);
      let x = row[1], y = row[2], z = row[3], yaw = row[4], flags = row[6];
      if (b) {
        const next = b.players.find((r) => r[0] === id);
        if (next) {
          if (Math.hypot(next[1] - x, next[3] - z) > TELEPORT) {
            // respawned between snapshots: jump, don't slide
            if (t >= 0.5) {
              x = next[1];
              y = next[2];
              z = next[3];
              yaw = next[4];
              flags = next[6];
            }
          } else {
            x += (next[1] - x) * t;
            y += (next[2] - y) * t;
            z += (next[3] - z) * t;
            yaw += angleDelta(yaw, next[4]) * t;
            if (t >= 0.5) flags = next[6];
          }
        }
      }
      this._placeRemote(id, row[7], x, y, z, yaw, (flags & PL_CROUCH) !== 0, (flags & PL_DEAD) !== 0);
    }
    for (const id of [...this._remotes.keys()]) {
      if (!seen.has(id)) this._removeRemote(id);
    }
  }

  _placeRemote(id, name, x, y, z, yaw, crouching, dead) {
    let r = this._remotes.get(id);
    if (!r) {
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((id * 0.618) % 1, 0.55, 0.5), roughness: 0.7 });
      const body = new THREE.Mesh(this._bodyGeo, material);
      const head = new THREE.Mesh(this._headGeo, material);
      body.castShadow = head.castShadow = true;
      const group = new THREE.Group();
      group.add(body, head);
      group.name = `remote:${name}#${id}`;
      this.ctx.scene.add(group);
      // client-side hitbox: our local trace hits it for instant blood
      const box = { min: [0, 0, 0], max: [0, 0, 0], surface: 'flesh', remoteId: id };
      this.physics.addDynamic(box);
      r = { group, body, head, material, box, boxed: true };
      this._remotes.set(id, r);
    }
    const height = crouching ? 1.1 : 1.8;
    r.body.scale.y = height - 0.25;
    r.head.position.y = height - 0.12;
    r.group.position.set(x, dead ? y + 0.34 : y, z);
    r.group.rotation.set(0, yaw, dead ? Math.PI / 2 : 0, 'YXZ'); // the dead lie down
    if (dead && r.boxed) {
      this.physics.removeDynamic(r.box);
      r.boxed = false;
    } else if (!dead) {
      if (!r.boxed) {
        this.physics.addDynamic(r.box);
        r.boxed = true;
      }
      playerHitbox(x, y, z, crouching ? HALF_Y_CROUCH : HALF.y, r.box);
    }
  }

  _removeRemote(id) {
    const r = this._remotes.get(id);
    if (!r) return;
    this.ctx.scene.remove(r.group);
    r.material.dispose();
    if (r.boxed) this.physics.removeDynamic(r.box);
    this._remotes.delete(id);
  }

  _drawHud() {
    let text;
    if (this.status === 'online') {
      text =
        `ONLINE · ${this.room} · ${this._remotes.size + 1} players · ${Math.round(this.rtt)} ms` +
        ` · K ${this.kills} / D ${this.deaths}` +
        (this.player.dead ? ' · RESPAWNING…' : '');
    } else if (this.status === 'error') {
      text = `OFFLINE · ${this.error}`;
    } else {
      text = 'CONNECTING…';
    }
    if (text !== this._hudText) this._hud.textContent = this._hudText = text;
  }

  dispose() {
    for (const off of this._subs) off();
    if (this.ws) this.ws.close();
    this._clearRemotes();
    this._bodyGeo.dispose();
    this._headGeo.dispose();
    this._hud.remove();
  }
}

// shortest signed difference between two angles (radians)
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
