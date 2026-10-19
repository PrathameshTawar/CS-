// server/bots.js — computer players that fill a room until people join.
//
// A bot is an ordinary room player whose inputs come from a Bot instead of a
// socket: each tick it queues one input (and any shot, reload or weapon
// switch) exactly as a client would, so the server's own rules move it,
// time its weapons and resolve its shots. It sees what a player could: line
// of sight against the static map, blocked by smoke; it hears nearby
// gunfire and knows who just shot it. It aims with a reaction delay and an
// error that settles over a moment, and adds the spread a human's weapon
// would. In Bomb Defusal it carries the bomb to a site and plants, or holds
// a site and defuses; otherwise it hunts. Pure JS, seeded, deterministic.

import { findPath, navGrid, walkLine } from '../shared/nav.js';
import { siteAt, DEFUSE_RADIUS } from '../shared/bomb.js';
import { EV_HIT, EV_SHOT, MODE_BOMB, MODE_DM, PHASE_FREEZE, PHASE_LIVE, TICK_RATE, USE_DEFUSE, USE_PLANT } from '../shared/protocol.js';
import { PRIMARY, SECONDARY, WEAPONS } from '../shared/weapons.js';
import { BOMB_CARRIED, BOMB_DROPPED, BOMB_PLANTED } from '../shared/bomb.js';

export const BOT_NAMES = ['Ace', 'Blitz', 'Cobra', 'Dash', 'Echo', 'Flint', 'Ghost', 'Hawk', 'Iris', 'Jinx', 'Kilo', 'Lynx', 'Moss', 'Nova', 'Onyx', 'Pike'];
export const BOT_PREFIX = 'BOT ';

const THINK = 6; // ticks between decisions (20 Hz); aim and movement run every tick
const SIGHT = 70; // m
const FOV = Math.cos((115 / 2) * (Math.PI / 180)); // sees what's within ~115° ahead...
const AWARE = 6; // ...and anyone this close, any direction
const HEAR = 25; // m: gunfire this close turns a bot towards it
const TURN = 9; // rad/s
const REACTION = [0.4, 0.7]; // s from first sight to first shot (bots see without network delay)
const AIM_ERROR = 0.12; // rad, at first sight, plus AIM_ERROR_PER_M per metre
const AIM_ERROR_PER_M = 0.0025;
const AIM_SETTLE = 3; // 1/s: how fast the error decays
const JITTER = { still: 0.02, moving: 0.05 }; // rad per shot, like a weapon's spread
const HEAD_CHANCE = 0.25;
const CHEST = 1.15;
const HEAD = 1.62;
const WAYPOINT = 0.6; // m: close enough to a path node
const STUCK = TICK_RATE; // ticks without progress before trying something else
const SMOKE_R = 4; // m

export class Bot {
  constructor(room, player, rng) {
    this.room = room;
    this.p = player;
    this.rng = rng;
    this.seq = 0;
    this.path = null;
    this.goal = null; // { x, z }
    this.goalKind = '';
    this.repathAt = 0;
    this.target = null; // the enemy being fought
    this.seenAt = 0; // tick the target came into view
    this.reactTicks = 0;
    this.err = { yaw: 0, pitch: 0 }; // current aim error
    this.aimHead = false;
    this.heard = null; // { x, z, tick } of a threat out of sight
    this.burst = 0; // shots left in this burst
    this.pauseUntil = 0;
    this.strafe = 1;
    this.strafeUntil = 0;
    this.progress = { x: 0, z: 0, tick: 0 };
    this.unstick = 0;
    this.boughtRound = -1;
    this.eventsSeen = room._eventN;
    this.input = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0, use: false, yaw: 0, pitch: 0, seq: 0 };
  }

  get grid() {
    return navGrid(this.room.world.boxes, this.room.navSeeds);
  }

  // One tick: decide (every THINK ticks), then queue this tick's input.
  tick() {
    const r = this.room;
    const p = this.p;
    const inp = this.input;
    inp.forward = inp.right = 0;
    inp.jump = inp.sprint = inp.use = false;
    if (!p.dead) {
      if (r.tick % THINK === p.id % THINK) this._think();
      this._buy();
      this._act(inp);
    }
    inp.yaw = p.move.yaw;
    inp.pitch = p.pitch;
    if (p.dead) this.target = null;
    p.queue.push({ ...inp, seq: this.seq++ });
  }

  // ---- perception ----

  _enemies() {
    const r = this.room;
    const out = [];
    for (const o of r.players.values()) {
      if (o === this.p || o.dead) continue;
      if (r.mode !== MODE_DM && o.team === this.p.team) continue;
      out.push(o);
    }
    return out;
  }

  _eye(p, out = {}) {
    out.x = p.move.pos.x;
    out.y = p.move.pos.y + p.move.eye;
    out.z = p.move.pos.z;
    return out;
  }

  // Can the bot see point (x, y, z): nothing static and no smoke between?
  _clear(x, y, z) {
    const r = this.room;
    const e = this._eye(this.p);
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-3) return true;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    const hit = r.world.raycastStatic(e, dir, d);
    if (hit && hit.hit) return false;
    for (const s of r.smokes) {
      // closest approach of the sight line to the smoke's centre
      const t = Math.max(0, Math.min(d, (s.x - e.x) * dir.x + (s.y - e.y) * dir.y + (s.z - e.z) * dir.z));
      const cx = e.x + dir.x * t - s.x, cy = e.y + dir.y * t - s.y, cz = e.z + dir.z * t - s.z;
      if (cx * cx + cy * cy + cz * cz < SMOKE_R * SMOKE_R) return false;
    }
    return true;
  }

  _visible(o) {
    const m = this.p.move;
    const op = o.move.pos;
    const dx = op.x - m.pos.x, dz = op.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > SIGHT) return false;
    if (d > AWARE) {
      // in front? (yaw 0 looks along -Z)
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
      if ((dx * fx + dz * fz) / d < FOV) return false;
    }
    const top = op.y + o.move.half.y * 2;
    return this._clear(op.x, top - 0.15, op.z) || this._clear(op.x, op.y + 1, op.z);
  }

  _think() {
    const r = this.room;
    const p = this.p;
    // what happened since last time: shots at us, gunfire nearby
    for (const e of r.events) {
      if (e.n <= this.eventsSeen) continue;
      const ev = e.data;
      if (ev[0] === EV_HIT && ev[2] === p.id && ev[1]) {
        const a = r.players.get(ev[1]);
        if (a && !a.dead) this.heard = { x: a.move.pos.x, z: a.move.pos.z, tick: r.tick };
      } else if (ev[0] === EV_SHOT && ev[1] !== p.id) {
        const a = r.players.get(ev[1]);
        if (a && (r.mode === MODE_DM || a.team !== p.team) && Math.hypot(ev[2] - p.move.pos.x, ev[4] - p.move.pos.z) < HEAR) {
          this.heard = { x: ev[2], z: ev[4], tick: r.tick };
        }
      }
    }
    this.eventsSeen = r._eventN;
    if (this.heard && r.tick - this.heard.tick > 4 * TICK_RATE) this.heard = null;

    // the closest enemy in sight; keep fighting the current one while it's visible
    let best = null;
    let bestD = Infinity;
    for (const o of this._enemies()) {
      if (!this._visible(o)) continue;
      const d = Math.hypot(o.move.pos.x - p.move.pos.x, o.move.pos.z - p.move.pos.z) - (o === this.target ? 5 : 0);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best && best !== this.target) {
      this.target = best;
      this.seenAt = r.tick;
      this.reactTicks = Math.round(this._range(REACTION) * TICK_RATE);
      const dist = Math.hypot(best.move.pos.x - p.move.pos.x, best.move.pos.z - p.move.pos.z);
      const e = AIM_ERROR + AIM_ERROR_PER_M * dist;
      this.err.yaw = (this.rng.nextFloat() * 2 - 1) * e;
      this.err.pitch = (this.rng.nextFloat() * 2 - 1) * e * 0.5;
      this.aimHead = this.rng.nextFloat() < HEAD_CHANCE;
      this.burst = 0;
    } else if (!best) {
      if (this.target && !this.target.dead) this.heard = { x: this.target.move.pos.x, z: this.target.move.pos.z, tick: r.tick };
      this.target = null;
    }

    this._chooseGoal();
    this._followPath();
  }

  // ---- goals ----

  _chooseGoal() {
    const r = this.room;
    const p = this.p;
    const g = r.game;
    let kind = 'roam';
    let at = null;
    if (r.mode === MODE_BOMB && g.bomb && g.phase === PHASE_LIVE) {
      const b = g.bomb;
      const attacking = p.team === g.attackers;
      const plan = r.botPlan();
      if (attacking) {
        if (b.state === BOMB_CARRIED && b.carrier === p.id) [kind, at] = ['plant', plan.spot];
        else if (b.state === BOMB_DROPPED) [kind, at] = ['bomb', { x: b.x, z: b.z }];
        else if (b.state === BOMB_PLANTED) [kind, at] = ['guard', this._near(b.x, b.z, 5)];
        else [kind, at] = ['site', this._near(plan.spot.x, plan.spot.z, 4)];
      } else if (b.state === BOMB_PLANTED) {
        [kind, at] = ['defuse', { x: b.x, z: b.z }];
      } else {
        const sites = Object.keys(r.sites).sort();
        const mine = r.sites[sites[p.id % sites.length]];
        [kind, at] = ['hold', this._near((mine.min[0] + mine.max[0]) / 2, (mine.min[1] + mine.max[1]) / 2, 3)];
      }
    } else if (this.heard) {
      [kind, at] = ['investigate', { x: this.heard.x, z: this.heard.z }];
    } else {
      // hunt: where an enemy is, give or take (bots aren't perfect trackers)
      const foes = this._enemies();
      if (foes.length) {
        const f = foes[p.id % foes.length];
        [kind, at] = ['hunt', this._near(f.move.pos.x, f.move.pos.z, 6)];
      }
    }
    if (!at) return;
    // keep the goal unless it changed kind or moved a lot (repath sparingly)
    const moved = !this.goal || Math.hypot(at.x - this.goal.x, at.z - this.goal.z) > (kind === 'hunt' ? 8 : 2);
    if (kind !== this.goalKind || moved || r.tick >= this.repathAt) {
      if (kind === this.goalKind && !moved && this.path && this.path.length) {
        this.repathAt = r.tick + 3 * TICK_RATE;
        return;
      }
      this.goalKind = kind;
      this.goal = at;
      this.path = findPath(this.grid, p.move.pos.x, p.move.pos.z, at.x, at.z);
      this.repathAt = r.tick + 3 * TICK_RATE;
    }
  }

  // A random point within `spread` m of (x, z), stable for this bot this round.
  _near(x, z, spread) {
    const r = this.room;
    const s = (this.p.id * 7919 + r.game.round * 104729) % 1000;
    const a = (s / 1000) * Math.PI * 2;
    const d = spread * (((s * 37) % 100) / 100);
    return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
  }

  // Drops waypoints already reached, and skips ahead where the way is straight.
  _followPath() {
    const path = this.path;
    if (!path || !path.length) return;
    const pos = this.p.move.pos;
    let k = 0;
    const lookahead = Math.min(path.length - 1, 8);
    for (let i = lookahead; i > 0; i--) {
      if (walkLine(this.grid, pos.x, pos.z, path[i].x, path[i].z)) {
        k = i;
        break;
      }
    }
    if (k) path.splice(0, k);
    while (path.length && Math.hypot(path[0].x - pos.x, path[0].z - pos.z) < WAYPOINT) path.shift();
  }

  // ---- buying (start of a round) ----

  _buy() {
    const r = this.room;
    const p = this.p;
    const g = r.game;
    const round = r.freeBuy ? -2 : g.round;
    if (this.boughtRound === round || !r.canBuy(p)) return;
    if (!r.freeBuy && g.phase !== PHASE_FREEZE) return;
    this.boughtRound = round;
    if (r.freeBuy) {
      if (!p.loadout[PRIMARY]) r.buy(p.id, 'rifle');
    } else {
      const money = p.money;
      const pistolRound = g.round === 1 || (g.halfDone && g.round === r.rules.roundsToWin);
      if (money >= WEAPONS.rifle.price + 650) r.buy(p.id, 'rifle');
      else if (money >= WEAPONS.smg.price + 650 && !pistolRound) r.buy(p.id, 'smg');
      if (p.money >= 1000 && !pistolRound) r.buy(p.id, 'vesthelm');
      else if (p.money >= 650) r.buy(p.id, 'vest');
      if (r.mode === MODE_BOMB && p.team !== g.attackers && p.money >= 400 && p.loadout[PRIMARY]) r.buy(p.id, 'kit');
    }
    if (p.loadout[PRIMARY] && p.slot !== PRIMARY) p.actions.push({ seq: this.seq, slot: PRIMARY });
  }

  // ---- acting (every tick) ----

  _act(inp) {
    const r = this.room;
    const p = this.p;
    const m = p.move;
    const dt = 1 / TICK_RATE;
    const gun = p.gun;
    const t = this.target && !this.target.dead ? this.target : null;
    if (!t && this.target) this.target = null;

    // where to look: the target, else where we heard trouble, else the way ahead
    let lookX, lookY, lookZ;
    const e = this._eye(p);
    if (t) {
      const op = t.move.pos;
      lookX = op.x;
      lookZ = op.z;
      lookY = op.y + (this.aimHead && t.move.half.y > 0.8 ? HEAD : CHEST * (t.move.half.y / 0.9));
    } else if (this.heard && this.goalKind !== 'plant' && this.goalKind !== 'defuse') {
      [lookX, lookY, lookZ] = [this.heard.x, e.y, this.heard.z];
    } else if (this.path && this.path.length) {
      const n = this.path[Math.min(2, this.path.length - 1)];
      [lookX, lookY, lookZ] = [n.x, e.y, n.z];
    } else if (this.goalKind === 'hold') {
      [lookX, lookY, lookZ] = [m.pos.x, e.y, m.pos.z + 10]; // towards the attackers (they come from +Z)
    } else {
      [lookX, lookY, lookZ] = [m.pos.x - Math.sin(m.yaw), e.y, m.pos.z - Math.cos(m.yaw)];
    }
    const dx = lookX - e.x, dy = lookY - e.y, dz = lookZ - e.z;
    const flat = Math.hypot(dx, dz);
    let wantYaw = Math.atan2(-dx, -dz);
    let wantPitch = Math.atan2(dy, flat);
    if (t) {
      this.err.yaw *= Math.exp(-AIM_SETTLE * dt);
      this.err.pitch *= Math.exp(-AIM_SETTLE * dt);
      wantYaw += this.err.yaw;
      wantPitch += this.err.pitch;
    }
    const dyaw = wrap(wantYaw - m.yaw);
    const step = TURN * dt;
    m.yaw = wrap(m.yaw + Math.max(-step, Math.min(step, dyaw)));
    p.pitch = Math.max(-1.4, Math.min(1.4, p.pitch + Math.max(-step, Math.min(step, wantPitch - p.pitch))));

    // reload when empty, or when nothing's happening and the magazine is low
    const mag = WEAPONS[gun.id].mag;
    if (p.reloadStart < 0 && gun.reserve > 0 && (gun.ammo === 0 || (!t && gun.ammo < mag * 0.4))) {
      p.actions.push({ seq: this.seq, reload: true });
    }
    if (!p.loadout[PRIMARY] && p.slot !== SECONDARY) p.actions.push({ seq: this.seq, slot: SECONDARY });

    // fight: shoot once the reaction time is up and the aim is near enough
    let moving = true;
    if (t) {
      const dist = Math.hypot(t.move.pos.x - m.pos.x, t.move.pos.z - m.pos.z);
      const tolerance = Math.atan2(0.35, dist) + 0.01;
      const aimed = Math.abs(wrap(wantYaw - this.err.yaw - m.yaw)) < tolerance + Math.abs(this.err.yaw) && r.tick - this.seenAt >= this.reactTicks;
      const ready = p.reloadStart < 0 && gun.ammo > 0 && p.steps >= p.drawEnd && p.steps - p.lastFire >= r.timing(gun.id).fire;
      // stand to shoot at range (accurate), strafe up close
      const close = dist < 10;
      moving = close;
      if (close && r.tick >= this.strafeUntil) {
        this.strafe = -this.strafe;
        this.strafeUntil = r.tick + Math.round(this._range([0.3, 0.8]) * TICK_RATE);
      }
      if (close) inp.right = this.strafe;
      if (aimed && ready && r.tick >= this.pauseUntil) {
        if (this.burst <= 0) this.burst = WEAPONS[gun.id].auto ? (dist > 20 ? 3 : 6) : 1;
        this._shoot(moving);
        if (--this.burst <= 0 && WEAPONS[gun.id].auto) this.pauseUntil = r.tick + Math.round((dist > 20 ? 0.35 : 0.15) * TICK_RATE);
      }
      return;
    }

    // the bomb: plant or defuse once there (standing still, use held)
    const b = r.game.bomb;
    if (b && r.game.phase === PHASE_LIVE) {
      const here = siteAt(r.sites, m.pos.x, m.pos.z);
      if (this.goalKind === 'plant' && here && b.carrier === p.id && m.grounded) {
        inp.use = true;
        return;
      }
      if (this.goalKind === 'defuse' && b.state === BOMB_PLANTED && Math.hypot(m.pos.x - b.x, m.pos.z - b.z) < DEFUSE_RADIUS * 0.8 && (!b.defuser || b.defuser === p.id)) {
        inp.use = true;
        return;
      }
      if (p.useKind === USE_PLANT || p.useKind === USE_DEFUSE) return; // finishing
    }

    // walk the path: move towards the next node whichever way we're facing
    const path = this.path;
    if (!path || !path.length) {
      this._stuck(false);
      return;
    }
    const n = path[0];
    const wx = n.x - m.pos.x, wz = n.z - m.pos.z;
    const wl = Math.hypot(wx, wz) || 1;
    // the wish direction in the bot's own frame (see stepMove)
    const sinY = Math.sin(m.yaw), cosY = Math.cos(m.yaw);
    inp.forward = (wx * -sinY + wz * -cosY) / wl;
    inp.right = (wx * cosY + wz * -sinY) / wl;
    inp.sprint = inp.forward > 0.7 && path.length > 6;
    this._stuck(true, inp);
  }

  // Not getting anywhere while trying to walk: jump, then find a new way.
  _stuck(walking, inp) {
    const r = this.room;
    const pos = this.p.move.pos;
    const pr = this.progress;
    if (!walking || r.frozen || Math.hypot(pos.x - pr.x, pos.z - pr.z) > 0.75) {
      pr.x = pos.x;
      pr.z = pos.z;
      pr.tick = r.tick;
      return;
    }
    if (r.tick - pr.tick < STUCK) return;
    pr.tick = r.tick;
    inp.jump = true;
    if (this.onStuck) this.onStuck(pos.x, pos.z);
    if (++this.unstick % 2 === 0) {
      this.path = null;
      this.repathAt = 0;
      this.goal = null;
    }
  }

  _shoot(moving) {
    const p = this.p;
    const m = p.move;
    const jitter = moving ? JITTER.moving : JITTER.still;
    const yaw = m.yaw + (this.rng.nextFloat() * 2 - 1) * jitter;
    const pitch = p.pitch + (this.rng.nextFloat() * 2 - 1) * jitter * 0.6;
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const origin = this._eye(p);
    p.actions.push({ seq: this.seq, shot: { seq: this.seq, origin, dir, viewTick: this.room.tick - 1 } });
  }

  _range([lo, hi]) {
    return lo + this.rng.nextFloat() * (hi - lo);
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Where the attackers go this round: a site and a spot in it.
export function chooseSite(sites, rng) {
  const names = Object.keys(sites).sort();
  const name = names[rng.nextUint32() % names.length];
  const s = sites[name];
  const spot = {
    x: s.min[0] + (s.max[0] - s.min[0]) * (0.3 + rng.nextFloat() * 0.4),
    z: s.min[1] + (s.max[1] - s.min[1]) * (0.3 + rng.nextFloat() * 0.4),
  };
  return { site: name, spot };
}

