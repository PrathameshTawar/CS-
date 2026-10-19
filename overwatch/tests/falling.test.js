// Falling: walking or jumping off the map is a death, online and in single
// player (the plaza's ground ends at x = ±60 with no wall; beyond it players
// fall). Falls are real arcs, not a snap to the floor below, and a hard
// landing hurts: the server decides, everyone sees it as a hit from the world.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CollisionWorld } from '../shared/collision.js';
import { GRAVITY, JUMP_VEL, KILL_Y, MAX_FALL_SPEED, createMoveState, fallDamage, settle, stepMove } from '../shared/movement.js';
import { END_ELIMINATION, EV_HIT, EV_KILL, EV_ROUND_END, KILL_BY_FALL, PHASE_LIVE, TICK_RATE, writeInput } from '../shared/protocol.js';
import { RESPAWN_TIME } from '../shared/combat.js';
import { Room } from '../server/room.js';

const colliders = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const WALK_EAST = { forward: 1, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
const EAST = -Math.PI / 2; // yaw whose forward is +X
const kills = (r) => r.events.filter((e) => e.data[0] === EV_KILL).map((e) => e.data);

// Walks p east off the edge; returns the ticks it took to die.
function walkOff(r, p) {
  r._place(p, 57, 0);
  for (let i = 0; i < 10 * TICK_RATE && !p.dead; i++) {
    r.receiveInputs(p.id, [writeInput(p.next++, WALK_EAST, EAST, 0)]);
    r.step();
  }
  return p.dead;
}

test('server: falling off the map kills, with no kill credit, and respawns in deathmatch', () => {
  const r = new Room('dm', colliders, { mode: 'dm' });
  const a = r.join('a');
  const b = r.join('b');
  a.next = 0;
  assert.equal(walkOff(r, a), true, 'dead after walking off the edge');
  assert.ok(a.move.pos.y < KILL_Y);
  assert.deepEqual(kills(r), [[EV_KILL, 0, a.id, 0, -1]], 'killer 0: the world, no weapon');
  assert.equal(a.deaths, 1);
  assert.equal(b.kills, 0);
  for (let i = 0; i < RESPAWN_TIME * TICK_RATE + 1; i++) r.step();
  assert.equal(a.dead, false);
  assert.ok(a.move.grounded && a.move.pos.y > -1, 'back on the ground at a spawn');
});

test('server: in a team round, falling counts toward elimination', () => {
  const r = new Room('t', colliders, { rules: { freezeTicks: 5, endTicks: 5 } });
  const a = r.join('a');
  r.join('b');
  a.next = 0;
  while (r.game.phase !== PHASE_LIVE) r.step();
  assert.equal(walkOff(r, a), true);
  const end = r.events.find((e) => e.data[0] === EV_ROUND_END).data;
  assert.deepEqual(end, [EV_ROUND_END, 1, 1 - a.team, END_ELIMINATION], 'the other team wins the round');
});

test('single player: falling off the map kills the player, who respawns after 3 s', async () => {
  const THREE = await import('three');
  const { PlayerSystem } = await import('../src/player/index.js');
  const { PhysicsSystem } = await import('../src/physics/index.js');
  const { createRng } = await import('../shared/rng.js');
  const emitted = [];
  const physics = new PhysicsSystem();
  const ctx = {
    config: { shot: null, mouseSensitivity: 0.002, fov: 70 },
    input: {
      isDown: (a) => a === 'forward',
      stepPressed: () => false,
      justPressed: () => false,
      consumeAim: () => ({ dx: 0, dy: 0 }),
    },
    events: { on: () => () => {}, emit: (type, payload) => emitted.push([type, payload]) },
    camera: new THREE.PerspectiveCamera(),
    rng: createRng(1),
    get: (id) => (id === 'world' ? { staticColliders: colliders } : physics),
  };
  physics.init(ctx);
  const p = new PlayerSystem();
  p.init(ctx);
  p.pos.set(57, 0.5, 0);
  p.yaw = EAST;
  for (let i = 0; i < 10 * TICK_RATE && !p.dead; i++) p.fixedUpdate(1 / TICK_RATE, ctx);
  assert.equal(p.dead, true);
  assert.equal(p.health, 0);
  assert.ok(emitted.some(([t, e]) => t === 'damage:taken' && e.health === 0), 'the HUD hears about it');
  assert.ok(emitted.some(([t, e]) => t === 'player:kill' && e.killer === null && e.onMe), 'kill feed: fell off the map');

  for (let i = 0; i < 31; i++) p.update(0.1, ctx); // 3.1 s
  assert.equal(p.dead, false);
  assert.equal(p.health, 100);
  assert.equal(p.pos.y, 60, 'back at the spawn (drops onto the ground next step)');
});

// A floor with a tower of `height` m at x -2..2 and a 0.4 m step west of it, at x -5..-3.
const tower = (height) => [
  { min: [-50, -1, -50], max: [50, 0, 50], surface: 'concrete' },
  { min: [-2, 0, -2], max: [2, height, 2], surface: 'concrete' },
  { min: [-5, 0, -2], max: [-3, 0.4, 2], surface: 'concrete' },
];
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
const H = 1 / TICK_RATE;

test('falls are arcs: a jump stays up its full time, a ledge is a drop through the air', () => {
  const world = new CollisionWorld(tower(8));
  const out = {};
  const s = settle(createMoveState({ x: 0, y: 30, z: 0 }), world);
  assert.equal(s.pos.y, 8, 'put down on the tower top');
  assert.equal(s.grounded, true);
  stepMove(s, { ...IDLE, jump: true }, H, world, out);
  let air = 0;
  let apex = 0;
  while (!s.grounded && air < 500) {
    stepMove(s, IDLE, H, world, out);
    apex = Math.max(apex, s.pos.y - 8);
    air++;
  }
  const flight = (2 * JUMP_VEL) / GRAVITY;
  assert.ok(Math.abs(air * H - flight) < 0.03, `in the air ${(air * H).toFixed(3)} s, a full arc is ${flight.toFixed(3)} s`);
  assert.ok(apex > 0.7, 'and reached the top of it');

  // walk off the edge (east): still near the top a moment after, on the floor ~0.9 s later
  s.yaw = -Math.PI / 2;
  let steps = 0;
  while (s.pos.x < 2.4) {
    stepMove(s, { ...IDLE, forward: 1 }, H, world, out);
    steps++;
  }
  for (let i = 0; i < 6; i++) stepMove(s, { ...IDLE, forward: 1 }, H, world, out);
  assert.equal(s.grounded, false);
  assert.ok(s.pos.y > 7.5, `drifting down, not snapped (y ${s.pos.y.toFixed(2)})`);
  let fall = 0;
  while (!out.landed && fall < 500) {
    stepMove(s, IDLE, H, world, out);
    fall++;
  }
  assert.equal(s.pos.y, 0);
  assert.ok(fall * H > 0.8, `fell for ${(fall * H).toFixed(2)} s`);
  assert.equal(fallDamage(out.impact), 49, `an 8 m drop at ${out.impact.toFixed(1)} m/s`);
});

test('walking up and down a low step never leaves the ground', () => {
  const world = new CollisionWorld(tower(8));
  const out = {};
  const s = settle(createMoveState({ x: -7, y: 5, z: 0 }), world);
  s.yaw = EAST; // over the step at x -5..-3, stopping at the tower

  let air = 0;
  let onStep = false;
  for (let i = 0; i < 2 * TICK_RATE; i++) {
    stepMove(s, { ...IDLE, forward: 1 }, H, world, out);
    if (!s.grounded) air++;
    if (s.pos.y === 0.4) onStep = true;
  }
  assert.ok(onStep, 'went up onto it');
  assert.equal(s.pos.y, 0, 'and back down');
  assert.equal(air, 0);
});

test('fall damage: free up to about 3.4 m, then rising to a kill at full fall speed', () => {
  const speed = (m) => Math.sqrt(2 * GRAVITY * m);
  assert.equal(fallDamage(speed(3)), 0);
  assert.equal(fallDamage(5.4), 0, 'a jump on flat ground');
  assert.ok(fallDamage(speed(5)) > 0 && fallDamage(speed(5)) < 30);
  assert.ok(fallDamage(speed(10)) > 50 && fallDamage(speed(10)) < 100);
  assert.ok(fallDamage(MAX_FALL_SPEED) >= 100);
});

// Puts p on a tower of `height` m and walks it east off the top until it lands.
function jumpOffTower(r, p) {
  r._place(p, 0, 0);
  for (let i = 0; i < 4 * TICK_RATE && !(p.move.grounded && p.move.pos.y === 0); i++) {
    r.receiveInputs(p.id, [writeInput(p.next++, p.move.pos.x < 2.5 ? WALK_EAST : IDLE, EAST, 0)]);
    r.step();
  }
}
const hits = (r) => r.events.filter((e) => e.data[0] === EV_HIT).map((e) => e.data);

test('server: a hard landing hurts, through armour, as a hit from the world', () => {
  for (const [height, damage] of [[3, 0], [8, 49]]) {
    const r = new Room('f', tower(height), { mode: 'dm' });
    const p = r.join('p');
    p.next = 0;
    p.armor = 100;
    jumpOffTower(r, p);
    assert.equal(p.move.pos.y, 0, 'down on the floor');
    assert.equal(p.hp, 100 - damage, `${height} m`);
    assert.equal(p.armor, 100, 'armour takes none of it');
    assert.deepEqual(hits(r).map((h) => h.slice(0, 4)), damage ? [[EV_HIT, 0, p.id, damage]] : []);
  }
});

test('server: a deadly fall is a death with no kill credit, shown as a fall', () => {
  const r = new Room('f', tower(16), { mode: 'dm' });
  const p = r.join('p');
  p.next = 0;
  jumpOffTower(r, p);
  assert.equal(p.dead, true);
  assert.equal(p.deaths, 1);
  assert.deepEqual(kills(r), [[EV_KILL, 0, p.id, 0, KILL_BY_FALL]]);
});

test('single player: a hard landing hurts, a deadly one kills; the spawn is put down gently', async () => {
  const THREE = await import('three');
  const { PlayerSystem } = await import('../src/player/index.js');
  const { PhysicsSystem } = await import('../src/physics/index.js');
  const { createRng } = await import('../shared/rng.js');
  const run = (boxes, x, y) => {
    const emitted = [];
    const physics = new PhysicsSystem();
    const ctx = {
      config: { shot: null, mouseSensitivity: 0.002, fov: 70 },
      input: { isDown: () => false, stepPressed: () => false, justPressed: () => false, consumeAim: () => ({ dx: 0, dy: 0 }) },
      events: { on: () => () => {}, emit: (type, payload) => emitted.push([type, payload]) },
      camera: new THREE.PerspectiveCamera(),
      rng: createRng(1),
      get: (id) => (id === 'world' ? { staticColliders: boxes } : physics),
    };
    physics.init(ctx);
    const p = new PlayerSystem();
    p.init(ctx);
    for (let i = 0; i < 3 * TICK_RATE; i++) {
      p.fixedUpdate(H, ctx);
      if (i === 0) p.pos.set(x, y, 0); // after the spawn: dropped from y
    }
    return { p, emitted };
  };
  const spawn = run(tower(8), 0, 0);
  assert.equal(spawn.p.health, 100, 'spawning 60 m up costs nothing');
  const hurt = run(tower(0.1), 10, 8);
  assert.equal(hurt.p.health, 51);
  assert.ok(hurt.emitted.some(([t, e]) => t === 'damage:taken' && e.amount === 49 && e.from === null));
  const dead = run(tower(0.1), 10, 30);
  assert.equal(dead.p.dead, true);
  assert.ok(dead.emitted.some(([t, e]) => t === 'player:kill' && e.fall && e.onMe));
});
