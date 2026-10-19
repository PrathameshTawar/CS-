// Grenades: buying and carrying, throw validation, the shared flight (the
// server's and a client's replay must land in the same place), HE damage
// (line of sight, armour, no friendly fire, kill reward) and flash timing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA } from '../shared/maps/arena.js';
import { CollisionWorld } from '../shared/collision.js';
import { MAX_HEALTH } from '../shared/combat.js';
import {
  GRENADES,
  GRENADE_IDS,
  THROW_SPEED,
  createFlight,
  flashDuration,
  grenadeIndex,
  heDamage,
  stepFlight,
} from '../shared/grenades.js';
import { EV_KILL, EV_NADE, EV_NADE_POP, KILL_BY_HE, PHASE_LIVE, writeInput, writeThrow } from '../shared/protocol.js';
import { START_MONEY, WIN_REWARD } from '../shared/weapons.js';
import { Room } from '../server/room.js';

const RULES = { freezeTicks: 10, roundTicks: 6000, endTicks: 10, matchEndTicks: 10, roundsToWin: 5, buyTicks: 600 };
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0, use: false };

function arenaRoom(mode = 'teams', n = 2) {
  const r = new Room('g', ARENA.boxes, { map: 'arena', mapData: ARENA, mode, rules: RULES });
  const ps = [];
  for (let i = 0; i < n; i++) {
    const p = r.join(`p${i}`);
    p.next = 0;
    ps.push(p);
  }
  return { r, ps };
}
const toLive = (r) => {
  while (r.game.phase !== PHASE_LIVE) r.step();
};
const eye = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + p.move.eye, z: p.move.pos.z });
function aim(from, to) {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
}
// p throws `type` along `dir` (one input step), then the room ticks
function throwNade(r, p, type, dir, lob = false) {
  r.receiveInputs(p.id, [writeInput(p.next, IDLE, p.move.yaw, 0)], undefined, undefined, undefined, [writeThrow(p.next, grenadeIndex(type), eye(p), dir, lob)]);
  p.next++;
  r.step();
}
// every event with its tick (the room itself keeps only the last second)
function record(r) {
  const log = [];
  const emit = r._emit.bind(r);
  r._emit = (data) => {
    log.push({ tick: r.tick, data });
    emit(data);
  };
  r.log = log;
}
const events = (r, type) => (r.log || r.events).filter((e) => e.data[0] === type).map((e) => e.data);
const ticks = (r, n) => {
  for (let i = 0; i < n; i++) r.step();
};

test('grenades are bought up to a limit per type; the dead lose them, survivors keep them', () => {
  const { r, ps: [a, b] } = arenaRoom();
  r.step(); // freeze: buy time
  a.money = 5000;
  assert.equal(r.buy(a.id, 'flash'), true);
  assert.equal(r.buy(a.id, 'flash'), true);
  assert.equal(r.buy(a.id, 'flash'), 'owned', 'two flashes at most');
  assert.equal(r.buy(a.id, 'smoke'), true);
  assert.equal(r.buy(a.id, 'he'), true);
  assert.equal(a.money, 5000 - 2 * 200 - 300 - 300);
  assert.deepEqual(r.snapshotFor(a.id).me[18], [1, 2, 1]);
  b.money = START_MONEY;
  r.buy(b.id, 'he');
  toLive(r);
  r._kill(b, a, false, 'pistol');
  while (r.game.phase === PHASE_LIVE || r.game.phase !== 1) r.step(); // next freeze
  assert.deepEqual(a.nades, { he: 1, flash: 2, smoke: 1 }, 'survivor keeps them');
  assert.deepEqual(b.nades, { he: 0, flash: 0, smoke: 0 });
});

test('throws are refused while frozen, without a grenade, or too fast', () => {
  const { r, ps: [a] } = arenaRoom();
  r.step();
  a.money = 5000;
  r.buy(a.id, 'flash');
  r.buy(a.id, 'flash');
  const fwd = { x: 0, y: 0, z: -1 };
  throwNade(r, a, 'flash', fwd); // frozen
  assert.equal(a.nades.flash, 2);
  toLive(r);
  throwNade(r, a, 'smoke', fwd); // none
  throwNade(r, a, 'flash', fwd);
  assert.equal(a.nades.flash, 1);
  throwNade(r, a, 'flash', fwd); // too soon
  assert.equal(a.nades.flash, 1);
  assert.equal(a.rejected, 3);
  assert.equal(events(r, EV_NADE).length, 1);
});

test('a client replaying the throw event lands the grenade exactly where the server set it off', () => {
  const { r, ps: [a] } = arenaRoom('dm', 1);
  record(r);
  ticks(r, 2);
  a.nades.smoke = 1;
  a.nades.he = 1;
  r._place(a, 0, 20);
  // a smoke bounced off the mid container, and an HE lobbed down the lane
  throwNade(r, a, 'smoke', aim(eye(a), { x: 0.5, y: 1, z: 2 }));
  for (let i = 0; i < 80; i++) {
    // the throw rate counts the thrower's own input steps
    r.receiveInputs(a.id, [writeInput(a.next++, IDLE, a.move.yaw, 0)]);
    r.step();
  }
  throwNade(r, a, 'he', aim(eye(a), { x: 0, y: 6, z: 0 }), true);
  ticks(r, 600);
  const world = new CollisionWorld(ARENA.boxes);
  const thrown = events(r, EV_NADE);
  const popped = events(r, EV_NADE_POP);
  assert.equal(thrown.length, 2);
  assert.equal(popped.length, 2);
  for (const t of thrown) {
    const [, id, , type, ox, oy, oz, vx, vy, vz, tick] = t;
    const pop = popped.find((p) => p[1] === id);
    const popTick = r.log.find((e) => e.data === pop).tick;
    const f = createFlight({ x: ox, y: oy, z: oz }, { x: vx, y: vy, z: vz });
    for (let i = tick; i <= popTick; i++) stepFlight(f, world); // its first step is in the throw's own tick
    assert.deepEqual([pop[3], pop[4], pop[5]], [f.x, f.y, f.z].map((v) => Math.round(v * 1000) / 1000), GRENADE_IDS[type]);
  }
  const smokePop = popped.find((p) => p[2] === grenadeIndex('smoke'));
  assert.ok(Math.abs(smokePop[4]) < 0.2, 'the smoke came to rest on the ground');
});

test('HE: hurts enemies in the open, not behind a wall or teammates, and pays for a kill', () => {
  const { r, ps: [a, b, c] } = arenaRoom('teams', 3); // a, c: ALPHA; b: BRAVO
  assert.equal(c.team, a.team);
  toLive(r);
  a.nades.he = 1;
  // the grenade lands at (0, 12) (open mid); b stands 2 m away, c (a teammate) too
  r._place(a, 0, 20);
  r._place(b, 2, 12);
  r._place(c, -2, 12);
  b.hp = 50;
  const money = a.money;
  const dir = aim(eye(a), { x: 0, y: 3.2, z: 12 });
  throwNade(r, a, 'he', dir, true);
  ticks(r, Math.ceil(GRENADES.he.fuse * 120) + 2);
  const pop = events(r, EV_NADE_POP)[0];
  const d = Math.hypot(b.move.pos.x - pop[3], b.move.pos.y + 1 - pop[4] - 0.3, b.move.pos.z - pop[5]);
  assert.ok(heDamage(d) >= 50, `b is close enough to die (${d.toFixed(1)} m)`);
  assert.equal(b.dead, true);
  assert.equal(c.hp, MAX_HEALTH, 'no friendly fire');
  assert.deepEqual(events(r, EV_KILL).at(-1).slice(1), [a.id, b.id, 0, KILL_BY_HE]);
  assert.equal(a.money, money + 300 + WIN_REWARD, 'HE kill reward (and the round, b was BRAVO\'s last)');

  // behind the A-lane wall (x -8..-6) nothing gets through
  const w = arenaRoom('dm', 2);
  ticks(w.r, 2);
  const [t, v] = w.ps;
  t.nades.he = 1;
  w.r._place(t, -3, 0);
  w.r._place(v, -10, 0);
  throwNade(w.r, t, 'he', aim(eye(t), { x: -5, y: 0, z: 0 }));
  ticks(w.r, Math.ceil(GRENADES.he.fuse * 120) + 2);
  assert.equal(v.hp, MAX_HEALTH);
  assert.ok(t.hp < MAX_HEALTH, 'the thrower stood too close');
});

test('flash: longest when you face it, short from behind, nothing through a wall or out of range', () => {
  const e = { x: 0, y: 1.6, z: 0 };
  const at = { x: 0, y: 1.6, z: -8 };
  const facing = flashDuration(e, { x: 0, y: 0, z: -1 }, at, false);
  const side = flashDuration(e, { x: 1, y: 0, z: 0 }, at, false);
  const behind = flashDuration(e, { x: 0, y: 0, z: 1 }, at, false);
  assert.ok(facing > 2.5 && side > behind && behind > 0 && side < facing);
  assert.equal(flashDuration(e, { x: 0, y: 0, z: -1 }, at, true), 0);
  assert.equal(flashDuration(e, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: -40 }, false), 0);
  assert.ok(THROW_SPEED > 10);
});
