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
// - Matches: the server runs teams and rounds (or deathmatch with
//   `&mode=dm`). We freeze the player when it says so, colour players by
//   team, give only enemies hitboxes (no friendly fire), and draw the score,
//   round timer, banners and a scoreboard (hold Tab).

import * as THREE from 'three';
import { FIRE_INTERVAL, MAG_SIZE, RESERVE, playerHitbox } from '../../shared/combat.js';
import { createSoldier, disposeSoldier, poseSoldier } from '../characters/soldier.js';
import { HALF, HALF_Y_CROUCH, stepMove } from '../../shared/movement.js';
import {
  END_ELIMINATION,
  END_FORFEIT,
  EV_HIT,
  EV_KILL,
  EV_MATCH_END,
  EV_ROUND_END,
  EV_SHOT,
  INPUT_SEND_EVERY,
  PHASE_END,
  PHASE_FREEZE,
  PHASE_LIVE,
  PHASE_MATCH_END,
  PHASE_WARMUP,
  PL_CROUCH,
  PL_DEAD,
  PL_GROUNDED,
  TEAM_NAMES,
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
const TEAM_UNIFORMS = [0xb0552e, 0x2f5fb0]; // ALPHA orange, BRAVO blue (fabric tint)
const STEP_WALK = 2.2; // m between footsteps (matches the local player)
const STEP_RUN = 3.4;
const TEAM_CSS = ['#ff9a6a', '#7fb4ff'];

export class NetSystem {
  static id = 'net';
  static deps = ['player', 'physics', 'render', 'weapons', 'materials'];

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
    this.team = -1;
    this.game = null; // [phase, endsAt, round, scoreA, scoreB, lastWinner, roundsToWin, deathmatch]
    this._banner = null; // { text, until } from round/match events
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

    // remote players: the same soldier model as the AI, uniformed by team
    this._remotes = new Map();
    this.materials = ctx.get('materials');
    this._uniforms = new Map(); // tint -> [uniform, skin, gear] (materials are cached and shared)
    this._shotSounds = []; // { at, origin }: remote gunfire, spaced at the fire rate
    this._nextShotAt = new Map();

    this._hud = document.createElement('div');
    this._hud.style.cssText =
      'position:fixed;top:12px;left:12px;font:12px/1.4 ui-monospace,monospace;color:#d8e2f0;' +
      'background:rgba(8,12,20,.55);padding:4px 8px;border-radius:4px;pointer-events:none;z-index:5';
    document.body.appendChild(this._hud);

    // match HUD: score + timer + banner (top centre), scoreboard (Tab)
    this._top = document.createElement('div');
    this._top.style.cssText =
      'position:fixed;top:10px;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;z-index:5;' +
      'font:600 15px/1.3 ui-monospace,monospace;color:#eef2f8;text-shadow:0 1px 3px #000';
    document.body.appendChild(this._top);
    this._board = document.createElement('div');
    this._board.style.cssText =
      'position:fixed;top:18%;left:50%;transform:translateX(-50%);min-width:420px;display:none;pointer-events:none;z-index:6;' +
      'background:rgba(8,12,20,.82);border-radius:6px;padding:14px 18px;font:13px/1.6 ui-monospace,monospace;color:#dfe6ee';
    document.body.appendChild(this._board);
    this._showBoard = false;
    this._onKey = (ev) => {
      if (ev.code !== 'Tab') return;
      ev.preventDefault();
      this._showBoard = ev.type === 'keydown';
    };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKey);
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
      ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: cfg.playerName, room: cfg.room, mode: cfg.mode, map: cfg.map }));
    };
    ws.onmessage = (e) => this._onMessage(decode(e.data));
    ws.onclose = (e) => {
      if (this.status !== 'error') this._fail(e.reason || 'disconnected');
    };
  }

  // Leave the match on purpose (the ESC menu's EXIT MATCH): close the socket
  // without reporting an error.
  close() {
    if (this.ws) {
      this.status = 'left';
      this.ws.onclose = null;
      this.ws.close(1000, 'left');
    }
  }

  _fail(reason) {
    this.status = 'error';
    this.error = reason;
    this.id = 0;
    // offline: other players are gone, don't leave them frozen in the world
    this._buffer.length = 0;
    this._clearRemotes();
    this.player.dead = false;
    this.player.frozen = false;
    this.game = null;
  }

  _clearRemotes() {
    for (const id of [...this._remotes.keys()]) this._removeRemote(id);
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.t === 'welcome') {
      const serverMap = msg.map || 'plaza';
      const clientMap = this.ctx.config.map || 'plaza';
      if (serverMap !== clientMap || (serverMap === 'plaza' && msg.seed !== this.ctx.config.seed)) {
        // the server plays a different map or seed: reload on matching settings
        const url = new URL(location.href);
        url.searchParams.set('map', serverMap);
        if (serverMap === 'plaza') url.searchParams.set('seed', String(msg.seed));
        location.replace(url.href);
        return;
      }
      this.id = msg.id;
      this.room = msg.room;
      this.status = 'online';
    } else if (msg.t === 'snap') {
      for (const row of msg.players) this._names.set(row[0], row[7]);
      this._lastSnap = msg;
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
        // the shot's sound; a burst arriving in one snapshot is spread back
        // out at the rifle's fire rate instead of playing as one bang
        const now = this.ctx.time.state.raw;
        const at = Math.max(now, this._nextShotAt.get(ev[1]) || 0);
        this._nextShotAt.set(ev[1], at + FIRE_INTERVAL);
        this._shotSounds.push({ at, origin: { x: ev[2], y: ev[3], z: ev[4] } });
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
          killer: killer === 0 ? null : this._nameOf(killer), // null: fell off the map
          victim: this._nameOf(victim),
          headshot: headshot === 1,
          byMe: killer === me,
          onMe: victim === me,
        });
      } else if (type === EV_ROUND_END) {
        const [, , winner, reason] = ev;
        const why = reason === END_ELIMINATION ? 'ELIMINATION' : reason === END_FORFEIT ? 'FORFEIT' : 'TIME';
        this._banner = winner < 0 ? 'ROUND DRAW' : `${TEAM_NAMES[winner]} WINS THE ROUND · ${why}`;
      } else if (type === EV_MATCH_END) {
        this._banner = `${TEAM_NAMES[ev[1]]} WINS THE MATCH`;
      }
    }

    const [hp, dead, , , kills, deaths, spawns, team] = msg.me;
    this.team = team;
    this.game = msg.game;
    const phase = msg.game[0];
    p.frozen = !msg.game[7] && (phase === PHASE_FREEZE || phase === PHASE_MATCH_END);
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
      if (p.dead || p.frozen) continue;
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
    this._interpolate(ctx, dt);
    for (let i = this._shotSounds.length - 1; i >= 0; i--) {
      const s = this._shotSounds[i];
      if (s.at <= ctx.time.state.raw) {
        ctx.events.emit('actor:fire', { origin: s.origin });
        this._shotSounds.splice(i, 1);
      }
    }
    this._drawHud();
    this._drawMatch(ctx);
  }

  _interpolate(ctx, dt) {
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
      let x = row[1], y = row[2], z = row[3], yaw = row[4], pitch = row[5], flags = row[6];
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
              pitch = next[5];
              flags = next[6];
            }
          } else {
            x += (next[1] - x) * t;
            y += (next[2] - y) * t;
            z += (next[3] - z) * t;
            yaw += angleDelta(yaw, next[4]) * t;
            pitch += (next[5] - pitch) * t;
            if (t >= 0.5) flags = next[6];
          }
        }
      }
      this._placeRemote(id, row[7], x, y, z, yaw, pitch, flags, row[10], dt);
    }
    for (const id of [...this._remotes.keys()]) {
      if (!seen.has(id)) this._removeRemote(id);
    }
  }

  _uniform(tint) {
    let mats = this._uniforms.get(tint);
    if (!mats) {
      const m = this.materials;
      mats = [
        m.make('fabric', { tint, variant: 1, repeat: 1, size: 512 }),
        m.make('fabric', { tint: 0xd9a97c, variant: 2, repeat: 1, size: 512 }),
        m.make('paintedMetal', { tint: 0x2c2f33, variant: 2, repeat: 1, size: 512 }),
      ];
      this._uniforms.set(tint, mats);
    }
    return mats;
  }

  _placeRemote(id, name, x, y, z, yaw, pitch, flags, team, dt) {
    const crouching = (flags & PL_CROUCH) !== 0;
    const dead = (flags & PL_DEAD) !== 0;
    let r = this._remotes.get(id);
    if (!r) {
      // team uniform, or a distinct colour per player in deathmatch
      const tint = team >= 0 ? TEAM_UNIFORMS[team] : new THREE.Color().setHSL((id * 0.618) % 1, 0.5, 0.4).getHex();
      const soldier = createSoldier(this._uniform(tint));
      const group = new THREE.Group(); // carries position + facing
      group.add(soldier.root);
      group.name = `remote:${name}#${id}`;
      this.ctx.scene.add(group);
      // client-side hitbox: our local trace hits it for instant blood
      const box = { min: [0, 0, 0], max: [0, 0, 0], surface: 'flesh', remoteId: id };
      this.physics.addDynamic(box);
      r = { group, soldier, box, boxed: true, phase: (id * 1.7) % 6.28, crouch: 0, deadT: 0, lastX: x, lastZ: z, stepAcc: 0 };
      this._remotes.set(id, r);
    }

    // movement from the interpolated positions: drives the walk cycle and steps
    const moved = Math.hypot(x - r.lastX, z - r.lastZ);
    r.lastX = x;
    r.lastZ = z;
    const speed = dt > 0 && moved < TELEPORT ? moved / dt : 0;
    const moving = speed > 0.5 && !dead;
    r.phase += dt * (moving ? 9 * THREE.MathUtils.clamp(speed / 3.2, 0.8, 1.8) : 2.2);
    r.crouch += ((crouching ? 1 : 0) - r.crouch) * Math.min(1, dt * 12);
    if (moving && (flags & PL_GROUNDED) !== 0) {
      r.stepAcc += moved;
      const running = speed > 6.5;
      if (r.stepAcc >= (running ? STEP_RUN : STEP_WALK)) {
        r.stepAcc = 0;
        this.ctx.events.emit('actor:footstep', { position: { x, y, z }, running });
      }
    }

    // the model faces +Z; a player looks along -Z at yaw 0
    r.group.position.set(x, y, z);
    r.group.rotation.set(0, yaw + Math.PI, 0);
    if (dead) {
      // fall over like the AI soldiers do
      r.deadT = Math.min(1, r.deadT + dt / 0.45);
      r.group.rotation.x = -r.deadT * Math.PI / 2;
      r.group.position.y = y - r.deadT * 0.85;
    } else {
      r.deadT = 0;
      poseSoldier(r.soldier.bones, r.phase, moving, true, r.crouch, pitch);
    }

    // hitboxes for living enemies only: teammates can't be shot
    const enemy = team < 0 || team !== this.team;
    if ((dead || !enemy) && r.boxed) {
      this.physics.removeDynamic(r.box);
      r.boxed = false;
    } else if (!dead && enemy) {
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
    disposeSoldier(r.soldier); // materials are shared and owned by the materials system
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

  // Score, round timer and banner at the top; the scoreboard on Tab and at
  // the end of a match.
  _drawMatch(ctx) {
    const g = this.game;
    let top = '';
    let board = false;
    if (g && this.status === 'online') {
      const [phase, endsAt, round, sa, sb, , roundsToWin, dm] = g;
      const nowTick = ctx.time.state.raw * TICK_RATE + (this._tickOffset || 0);
      const secs = Math.max(0, Math.ceil((endsAt - nowTick) / TICK_RATE));
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (dm) {
        top = 'DEATHMATCH';
      } else {
        const score =
          `<span style="color:${TEAM_CSS[0]}">${TEAM_NAMES[0]} ${sa}</span>` +
          `  ${phase === PHASE_LIVE || phase === PHASE_FREEZE ? clock : '·'}  ` +
          `<span style="color:${TEAM_CSS[1]}">${sb} ${TEAM_NAMES[1]}</span>`;
        let line = '';
        if (phase === PHASE_WARMUP) line = 'WARMUP · waiting for players on both teams';
        else if (phase === PHASE_FREEZE) line = `ROUND ${round} · GET READY`;
        else if (phase === PHASE_END || phase === PHASE_MATCH_END) line = this._banner || '';
        if (phase === PHASE_LIVE && Math.max(sa, sb) === roundsToWin - 1) line = 'MATCH POINT';
        const you = this.team >= 0 ? `<div style="font-size:11px;color:${TEAM_CSS[this.team]}">YOU ARE ${TEAM_NAMES[this.team]}</div>` : '';
        top = `<div style="white-space:pre">${score}</div><div style="font-size:12px;letter-spacing:2px;color:#ffd38a">${line}</div>${you}`;
      }
      board = this._showBoard || phase === PHASE_MATCH_END;
    }
    if (top !== this._topHtml) this._top.innerHTML = this._topHtml = top;
    this._board.style.display = board ? 'block' : 'none';
    if (board) {
      const html = this._boardHtml();
      if (html !== this._boardCache) this._board.innerHTML = this._boardCache = html;
    }
  }

  _boardHtml() {
    const snap = this._lastSnap;
    if (!snap) return '';
    const rows = snap.players.map((r) => ({ name: r[7], kills: r[8], deaths: r[9], team: r[10], me: false }));
    rows.push({ name: this.ctx.config.playerName, kills: this.kills, deaths: this.deaths, team: this.team, me: true });
    const line = (r) =>
      `<tr style="${r.me ? 'color:#fff;font-weight:700' : ''}"><td style="padding-right:24px">${esc(r.name)}${r.me ? ' (you)' : ''}</td>` +
      `<td style="text-align:right;width:40px">${r.kills}</td><td style="text-align:right;width:40px">${r.deaths}</td></tr>`;
    const head = '<tr style="color:#8b94a6"><td></td><td style="text-align:right">K</td><td style="text-align:right">D</td></tr>';
    const sort = (a, b) => b.kills - a.kills || a.deaths - b.deaths;
    if (this.game && this.game[7]) {
      return `<div style="letter-spacing:2px;margin-bottom:6px">DEATHMATCH</div><table style="width:100%;border-collapse:collapse">${head}${rows.sort(sort).map(line).join('')}</table>`;
    }
    return [0, 1]
      .map((t) => {
        const score = this.game ? this.game[3 + t] : 0;
        const members = rows.filter((r) => r.team === t).sort(sort);
        return `<div style="color:${TEAM_CSS[t]};letter-spacing:2px;margin:6px 0 2px">${TEAM_NAMES[t]} · ${score}</div><table style="width:100%;border-collapse:collapse">${head}${members.map(line).join('')}</table>`;
      })
      .join('');
  }

  dispose() {
    for (const off of this._subs) off();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keyup', this._onKey);
    this._top.remove();
    this._board.remove();
    if (this.ws) this.ws.close();
    this._clearRemotes();
    this._hud.remove();
  }
}

// player names go into HTML
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// shortest signed difference between two angles (radians)
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
