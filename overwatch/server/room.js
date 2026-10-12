// server/room.js — one authoritative match: players, inputs, simulation,
// combat, snapshots. No sockets here (index.js owns those), so it is
// unit-testable.
//
// Simulation model:
// - Every player is stepped with shared/movement.js at TICK_RATE, the same
//   step and rate the client predicts with, so a client that sent the same
//   inputs lands on the same position.
// - A player only moves when their inputs arrive (one input = one step). A
//   backgrounded tab stops sending and simply stands still.
// - Each tick grants every player one step of credit (capped). Inputs beyond
//   the credit wait in a bounded queue, so a client can never move faster
//   than real time (no speed hacks), only catch up after jitter.
//
// Combat model:
// - Shots and reloads are tagged with the input seq they happen before and
//   resolved right before that input is applied: the server checks them
//   against exactly the state the client fired from.
// - Fire rate, ammo and reloads are timed in the shooter's own input steps
//   (1/120 s each), the same clock the client's weapon runs on.
// - Lag compensation: every tick records each player's hitbox; a shot rewinds
//   the other players to the tick the shooter was looking at (at most
//   MAX_REWIND_TICKS back) and traces shared/combat.js against them.
//
// Match model (mode 'teams'; 'dm' is free-for-all with respawns):
// - Players are auto-balanced into ALPHA/BRAVO; no friendly fire (rounds
//   pass through teammates).
// - WARMUP (respawns on) until both teams have a player, then rounds:
//   FREEZE (everyone at their team spawns, can't move or shoot) -> LIVE (no
//   respawns; eliminate the other team, or have more players alive when the
//   clock runs out) -> END (banner) -> next round. First to roundsToWin takes
//   the match; MATCH_END shows the result, then a new match starts.
// - Late joiners sit out (dead) until the next round starts.

import { CollisionWorld } from '../shared/collision.js';
import { createMoveState, stepMove } from '../shared/movement.js';
import {
  BODY_DAMAGE,
  FIRE_INTERVAL,
  HEAD_DAMAGE,
  MAG_SIZE,
  MAX_HEALTH,
  RELOAD_REFILL_AT,
  RELOAD_TIME,
  RESERVE,
  RESPAWN_TIME,
  isHeadshot,
  playerHitbox,
  shotEndpoint,
  traceShot,
} from '../shared/combat.js';
import {
  END_ELIMINATION,
  END_FORFEIT,
  END_TIME,
  EV_HIT,
  EV_KILL,
  EV_MATCH_END,
  EV_ROUND_END,
  EV_SHOT,
  EV_SPAWN,
  MAX_INPUTS_PER_MESSAGE,
  MAX_PLAYERS_PER_ROOM,
  MAX_REWIND_TICKS,
  MAX_SHOTS_PER_MESSAGE,
  MODE_DM,
  MODE_TEAMS,
  PHASE_END,
  PHASE_FREEZE,
  PHASE_LIVE,
  PHASE_MATCH_END,
  PHASE_WARMUP,
  PL_CROUCH,
  PL_DEAD,
  PL_GROUNDED,
  TICK_RATE,
  packState,
  readInput,
  readShot,
} from '../shared/protocol.js';

const H = 1 / TICK_RATE;
const MAX_CREDIT = TICK_RATE / 4; // 250 ms of catch-up after a stall
const MAX_QUEUE = TICK_RATE / 2; // inputs waiting beyond credit; older ones are dropped
const MAX_PENDING_ACTIONS = 16; // shots/reloads waiting for their input seq
const HISTORY = 64; // ticks of hitbox history kept per player (> MAX_REWIND_TICKS)

// combat timing in input steps
const FIRE_STEPS = Math.round(FIRE_INTERVAL * TICK_RATE) - 1; // 1 step of frame-timing slack
// the client times its reload in frames, the server in steps: end the
// server's reload 50 ms early so a legit first shot after it isn't refused
const RELOAD_STEPS = Math.round(RELOAD_TIME * TICK_RATE) - 6;
const REFILL_STEPS = Math.round(RELOAD_REFILL_AT * TICK_RATE);
const RESPAWN_TICKS = RESPAWN_TIME * TICK_RATE;
// how far the reported muzzle may be from the server's eye position: the
// weapon offset (~0.26 m) plus lean, bob and recoil, with margin
const MAX_MUZZLE_OFFSET = 0.75;

// Spawn points on open ground around the plaza; tests check each one lands on
// the street level. Players spawn high and the mover drops them onto the
// surface below, exactly like single player.
export const SPAWNS = [
  [6, 16], [-6, 16], [16, 6], [16, -6],
  [6, -16], [-6, -16], [-16, 6], [-16, -6],
];
// each team spawns on its own side of the plaza (+Z / -Z)
export const TEAM_SPAWNS = [SPAWNS.filter((s) => s[1] > 0), SPAWNS.filter((s) => s[1] < 0)];

// round timings, in ticks (overridable per room, e.g. for tests)
export const DEFAULT_RULES = Object.freeze({
  freezeTicks: 3 * TICK_RATE,
  roundTicks: 115 * TICK_RATE,
  endTicks: 5 * TICK_RATE,
  matchEndTicks: 10 * TICK_RATE,
  roundsToWin: 8,
});
const SPAWN_HEIGHT = 60;
const IDLE = Object.freeze({ forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 });

export class Room {
  constructor(name, colliders, { seed, map = 'plaza', mapData = null, maxPlayers = MAX_PLAYERS_PER_ROOM, mode = MODE_TEAMS, rules = {} } = {}) {
    this.name = name;
    this.seed = seed;
    this.map = map;
    this.mapData = mapData;
    this.teamSpawns = mapData && mapData.spawns ? mapData.spawns : TEAM_SPAWNS;
    this.spawns = mapData && mapData.spawns ? [...mapData.spawns[0], ...mapData.spawns[1]] : SPAWNS;
    this.maxPlayers = maxPlayers;
    this.mode = mode === MODE_DM ? MODE_DM : MODE_TEAMS;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.game = { phase: PHASE_WARMUP, endsAt: 0, round: 0, score: [0, 0], lastWinner: -1 };
    this.world = new CollisionWorld(colliders);
    this.players = new Map();
    this.tick = 0;
    this.events = []; // { n, tick, data }
    this._eventN = 0;
    this._nextId = 1;
    this._out = { hasWish: false, landed: false, impact: 0 };
    this._end = { x: 0, y: 0, z: 0 };
    this._boxes = []; // rewound hitboxes for the shot being resolved (reused)
  }

  get size() {
    return this.players.size;
  }

  // Adds a player; returns it, or null when the room is full.
  join(name) {
    if (this.players.size >= this.maxPlayers) return null;
    const history = [];
    for (let i = 0; i < HISTORY; i++) history.push({ tick: -1, x: 0, y: 0, z: 0, halfY: 0, alive: false });
    const player = {
      id: this._nextId++,
      name,
      move: null,
      pitch: 0,
      queue: [],
      credit: 0,
      lastSeq: -1,
      dropped: 0,
      steps: 0, // inputs applied: the player's own combat clock
      actions: [], // pending { seq, shot | reload }
      hp: MAX_HEALTH,
      dead: false,
      respawnTick: 0,
      spawns: 0,
      ammo: MAG_SIZE,
      reserve: RESERVE,
      reloadStart: -1,
      lastFire: -Infinity,
      kills: 0,
      deaths: 0,
      team: this.mode === MODE_TEAMS ? this._smallerTeam() : -1,
      rejected: 0, // shots refused (rate, ammo, origin): a cheat signal
      eventsSeen: this._eventN,
      history,
      hitbox: { min: [0, 0, 0], max: [0, 0, 0], surface: 'flesh', owner: null },
    };
    player.hitbox.owner = player;
    const [x, z] = this._spawnPoint(player);
    this._place(player, x, z);
    // mid-round joiners sit out until the next round
    const phase = this.game.phase;
    if (this.mode === MODE_TEAMS && (phase === PHASE_LIVE || phase === PHASE_END || phase === PHASE_MATCH_END)) {
      player.dead = true;
      player.hp = 0;
      player.respawnTick = Infinity;
    }
    this.players.set(player.id, player);
    this._record(player);
    return player;
  }

  _smallerTeam() {
    const n = [0, 0];
    for (const p of this.players.values()) if (p.team >= 0) n[p.team]++;
    return n[1] < n[0] ? 1 : 0;
  }

  // Free movement and shooting? Not while frozen at round start or after a match.
  get frozen() {
    return this.game.phase === PHASE_FREEZE || this.game.phase === PHASE_MATCH_END;
  }

  // Respawn on death? In deathmatch and warmup; not during a team round.
  get respawning() {
    return this.mode === MODE_DM || this.game.phase === PHASE_WARMUP;
  }

  leave(id) {
    return this.players.delete(id);
  }

  // Queues a batch of wire inputs plus optional shots/reloads. Returns false
  // if anything is malformed (the caller should drop the client). Old or
  // duplicate seqs are ignored.
  receiveInputs(id, batch, shots = undefined, reloads = undefined) {
    const p = this.players.get(id);
    if (!p) return false;
    if (!Array.isArray(batch) || batch.length > MAX_INPUTS_PER_MESSAGE) return false;
    const queuedSeq = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
    let last = queuedSeq;
    for (const raw of batch) {
      const input = readInput(raw);
      if (!input) return false;
      if (input.seq <= last) continue; // resend or out of order
      p.queue.push(input);
      last = input.seq;
    }
    if (p.queue.length > MAX_QUEUE) {
      p.dropped += p.queue.length - MAX_QUEUE;
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
    }
    if (shots !== undefined) {
      if (!Array.isArray(shots) || shots.length > MAX_SHOTS_PER_MESSAGE) return false;
      for (const raw of shots) {
        const shot = readShot(raw);
        if (!shot) return false;
        p.actions.push({ seq: shot.seq, shot });
      }
    }
    if (reloads !== undefined) {
      if (!Array.isArray(reloads) || reloads.length > MAX_SHOTS_PER_MESSAGE) return false;
      for (const seq of reloads) {
        if (!Number.isInteger(seq) || seq < 0) return false;
        p.actions.push({ seq, reload: true });
      }
    }
    if (p.actions.length > MAX_PENDING_ACTIONS) p.actions.splice(0, p.actions.length - MAX_PENDING_ACTIONS);
    return true;
  }

  // One authoritative tick.
  step() {
    this.tick++;
    for (const p of this.players.values()) {
      p.credit = Math.min(MAX_CREDIT, p.credit + 1);
      while (p.credit >= 1 && p.queue.length) {
        const input = p.queue.shift();
        p.credit -= 1;
        this._runActions(p, input.seq);
        p.lastSeq = input.seq;
        p.pitch = input.pitch;
        // inputs are consumed (acked) but the dead and the frozen don't move
        if (p.dead || this.frozen) continue;
        p.move.yaw = input.yaw;
        stepMove(p.move, input, H, this.world, this._out);
        p.steps++;
        if (p.reloadStart >= 0) {
          const t = p.steps - p.reloadStart;
          if (t === REFILL_STEPS) {
            const take = Math.min(MAG_SIZE - p.ammo, p.reserve);
            p.ammo += take;
            p.reserve -= take;
          }
          if (t >= RELOAD_STEPS) p.reloadStart = -1;
        }
      }
      if (p.dead && this.respawning && this.tick >= p.respawnTick) this._respawn(p);
    }
    if (this.mode === MODE_TEAMS) this._updateMatch();
    for (const p of this.players.values()) this._record(p);
    this._trimEvents();
  }

  // ---- rounds ----

  _updateMatch() {
    const g = this.game;
    const r = this.rules;
    const count = [0, 0];
    const alive = [0, 0];
    for (const p of this.players.values()) {
      count[p.team]++;
      if (!p.dead) alive[p.team]++;
    }
    const bothTeams = count[0] > 0 && count[1] > 0;
    switch (g.phase) {
      case PHASE_WARMUP:
        if (bothTeams) this._newMatch();
        break;
      case PHASE_FREEZE:
      case PHASE_LIVE:
        if (!bothTeams) {
          this._endRound(count[0] > 0 ? 0 : count[1] > 0 ? 1 : -1, END_FORFEIT);
        } else if (g.phase === PHASE_FREEZE) {
          if (this.tick >= g.endsAt) {
            g.phase = PHASE_LIVE;
            g.endsAt = this.tick + r.roundTicks;
          }
        } else if (alive[0] === 0 || alive[1] === 0) {
          this._endRound(alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1, END_ELIMINATION);
        } else if (this.tick >= g.endsAt) {
          this._endRound(alive[0] > alive[1] ? 0 : alive[1] > alive[0] ? 1 : -1, END_TIME);
        }
        break;
      case PHASE_END:
        if (this.tick < g.endsAt) break;
        if (!bothTeams) this._warmup();
        else if (Math.max(g.score[0], g.score[1]) >= r.roundsToWin) {
          g.phase = PHASE_MATCH_END;
          g.endsAt = this.tick + r.matchEndTicks;
          this._emit([EV_MATCH_END, g.score[0] > g.score[1] ? 0 : 1]);
        } else this._startRound(g.round + 1);
        break;
      case PHASE_MATCH_END:
        if (this.tick < g.endsAt) break;
        if (bothTeams) this._newMatch();
        else this._warmup();
        break;
    }
  }

  _newMatch() {
    this.game.score = [0, 0];
    this.game.lastWinner = -1;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
    }
    this._startRound(1);
  }

  // Everyone to their team spawns, full health and ammo, frozen briefly.
  _startRound(n) {
    const g = this.game;
    g.round = n;
    g.phase = PHASE_FREEZE;
    g.endsAt = this.tick + this.rules.freezeTicks;
    const used = [0, 0];
    for (const p of this.players.values()) {
      const spawns = this.teamSpawns[p.team];
      const [x, z] = spawns[used[p.team]++ % spawns.length];
      this._revive(p, x, z);
    }
  }

  _endRound(winner, reason) {
    const g = this.game;
    if (winner >= 0) g.score[winner]++;
    g.lastWinner = winner;
    g.phase = PHASE_END;
    g.endsAt = this.tick + this.rules.endTicks;
    this._emit([EV_ROUND_END, g.round, winner, reason]);
  }

  // Back to warmup (a team emptied out): free play, everyone respawns.
  _warmup() {
    const g = this.game;
    g.phase = PHASE_WARMUP;
    g.round = 0;
    g.score = [0, 0];
    g.lastWinner = -1;
    for (const p of this.players.values()) if (p.dead) p.respawnTick = this.tick;
  }

  // Shots/reloads due before input `seq` is applied.
  _runActions(p, seq) {
    if (!p.actions.length) return;
    let keep = 0;
    for (let i = 0; i < p.actions.length; i++) {
      const a = p.actions[i];
      if (a.seq > seq) {
        p.actions[keep++] = a;
        continue;
      }
      if (a.shot) this._fire(p, a.shot);
      else this._reload(p);
    }
    p.actions.length = keep;
  }

  _reload(p) {
    if (p.dead || p.reloadStart >= 0 || p.ammo >= MAG_SIZE || p.reserve <= 0) return;
    p.reloadStart = p.steps;
  }

  _fire(p, shot) {
    if (p.dead) return;
    if (this.frozen) {
      p.rejected++;
      return;
    }
    const m = p.move;
    const reloading = p.reloadStart >= 0;
    const eyeDist = Math.hypot(shot.origin.x - m.pos.x, shot.origin.y - (m.pos.y + m.eye), shot.origin.z - m.pos.z);
    if (reloading || p.ammo <= 0 || p.steps - p.lastFire < FIRE_STEPS || eyeDist > MAX_MUZZLE_OFFSET) {
      p.rejected++;
      return;
    }
    p.ammo--;
    p.lastFire = p.steps;

    // lag compensation: everyone else as the shooter saw them. The newest
    // recorded tick is the previous one (this tick is still being simulated).
    const newest = this.tick - 1;
    const viewTick = Math.max(newest - MAX_REWIND_TICKS, Math.min(newest, shot.viewTick));
    const boxes = this._boxes;
    boxes.length = 0;
    for (const other of this.players.values()) {
      if (other === p || other.dead) continue;
      if (p.team >= 0 && other.team === p.team) continue; // no friendly fire: rounds pass through
      if (this._rewind(other, viewTick)) boxes.push(other.hitbox);
    }
    this.world.dynamics = boxes;
    const hit = traceShot(this.world, shot.origin, shot.dir);
    this.world.dynamics = [];

    const o = shot.origin;
    const end = hit ? hit.point : shotEndpoint(o, shot.dir, 200, this._end);
    this._emit([EV_SHOT, p.id, r3(o.x), r3(o.y), r3(o.z), r3(end.x), r3(end.y), r3(end.z)]);
    if (!hit || !hit.box || !hit.box.owner) return;

    const target = hit.box.owner;
    const headshot = isHeadshot(hit.box, hit.point.y);
    const damage = headshot ? HEAD_DAMAGE : BODY_DAMAGE;
    target.hp = Math.max(0, target.hp - damage);
    this._emit([EV_HIT, p.id, target.id, damage, headshot ? 1 : 0, r3(hit.point.x), r3(hit.point.y), r3(hit.point.z)]);
    if (target.hp === 0) {
      target.dead = true;
      target.respawnTick = this.respawning ? this.tick + RESPAWN_TICKS : Infinity;
      target.deaths++;
      p.kills++;
      this._emit([EV_KILL, p.id, target.id, headshot ? 1 : 0]);
    }
  }

  // Positions `p.hitbox` where p was at `tick` (interpolated). False if p was
  // dead then.
  _rewind(p, tick) {
    const t0 = Math.floor(tick);
    const a = p.history[t0 % HISTORY];
    const b = p.history[(t0 + 1) % HISTORY];
    if (a.tick !== t0) {
      // no record for that tick (joined since): use where they are now
      const m = p.move;
      playerHitbox(m.pos.x, m.pos.y, m.pos.z, m.half.y, p.hitbox);
      return true;
    }
    if (!a.alive) return false;
    const f = b.tick === t0 + 1 && b.alive ? tick - t0 : 0;
    playerHitbox(
      a.x + (b.x - a.x) * f,
      a.y + (b.y - a.y) * f,
      a.z + (b.z - a.z) * f,
      a.halfY + (b.halfY - a.halfY) * f,
      p.hitbox,
    );
    return true;
  }

  _record(p) {
    const h = p.history[this.tick % HISTORY];
    const m = p.move;
    h.tick = this.tick;
    h.x = m.pos.x;
    h.y = m.pos.y;
    h.z = m.pos.z;
    h.halfY = m.half.y;
    h.alive = !p.dead;
  }

  _respawn(p) {
    const [x, z] = this._spawnPoint(p);
    this._revive(p, x, z);
    this._emit([EV_SPAWN, p.id]);
  }

  // The spawn (from the player's team side, or anywhere in deathmatch)
  // farthest from every living opponent.
  _spawnPoint(p) {
    const spawns = p.team >= 0 ? this.teamSpawns[p.team] : this.spawns;
    let best = spawns[0];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const o of this.players.values()) {
        if (o === p || o.dead || (p.team >= 0 && o.team === p.team)) continue;
        d = Math.min(d, Math.hypot(o.move.pos.x - s[0], o.move.pos.z - s[1]));
      }
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  _revive(p, x, z) {
    this._place(p, x, z);
    p.hp = MAX_HEALTH;
    p.dead = false;
    p.ammo = MAG_SIZE;
    p.reserve = RESERVE;
    p.reloadStart = -1;
    p.lastFire = -Infinity;
    p.spawns++;
  }

  // Fresh movement state at a spawn, settled onto the ground with one idle
  // step (not a client input) so snapshots show the player standing.
  _place(p, x, z) {
    const yaw = p.move ? p.move.yaw : Math.PI;
    p.move = createMoveState({ x, y: SPAWN_HEIGHT, z }, { x: 0, y: 0, z: 0 });
    p.move.yaw = yaw;
    stepMove(p.move, IDLE, H, this.world, this._out);
  }

  _emit(data) {
    this.events.push({ n: ++this._eventN, tick: this.tick, data });
  }

  _trimEvents() {
    // events older than a second have been delivered to every live client
    let drop = 0;
    while (drop < this.events.length && this.events[drop].tick < this.tick - TICK_RATE) drop++;
    if (drop) this.events.splice(0, drop);
  }

  _gameState() {
    const g = this.game;
    return [g.phase, g.endsAt, g.round, g.score[0], g.score[1], g.lastWinner, this.rules.roundsToWin, this.mode === MODE_DM ? 1 : 0];
  }

  // Snapshot for one recipient: their exact state, their combat status,
  // everyone else, and the events they haven't seen. Advances the
  // recipient's event cursor.
  snapshotFor(id) {
    const me = this.players.get(id);
    if (!me) return null;
    const players = [];
    for (const p of this.players.values()) {
      if (p.id === id) continue;
      const m = p.move;
      players.push([
        p.id,
        r3(m.pos.x), r3(m.pos.y), r3(m.pos.z),
        r3(m.yaw), r3(p.pitch),
        (m.crouching ? PL_CROUCH : 0) | (m.grounded ? PL_GROUNDED : 0) | (p.dead ? PL_DEAD : 0),
        p.name,
        p.kills,
        p.deaths,
        p.team,
      ]);
    }
    const ev = [];
    for (const e of this.events) {
      if (e.n <= me.eventsSeen) continue;
      if (e.data[0] === EV_SHOT && e.data[1] === id) continue; // drew it locally
      ev.push(e.data);
    }
    me.eventsSeen = this._eventN;
    return {
      t: 'snap',
      tick: this.tick,
      ack: me.lastSeq,
      you: packState(me.move),
      me: [me.hp, me.dead ? 1 : 0, me.ammo, me.reserve, me.kills, me.deaths, me.spawns, me.team],
      players,
      game: this._gameState(),
      ev,
    };
  }
}

// Others are only drawn, so millimetres are plenty.
const r3 = (v) => Math.round(v * 1000) / 1000;
