// Walking or jumping off the map is a death, online and in single player.
// The plaza's ground ends at x = ±60 with no wall; beyond it players fall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KILL_Y } from '../shared/movement.js';
import { END_ELIMINATION, EV_KILL, EV_ROUND_END, PHASE_LIVE, TICK_RATE, writeInput } from '../shared/protocol.js';
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
