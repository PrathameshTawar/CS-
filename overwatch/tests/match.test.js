// Team rounds: balancing, warmup, freeze, elimination, time-outs, forfeits,
// match end, late joiners and friendly fire. Short timings keep it fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_HEALTH } from '../shared/combat.js';
import {
  END_ELIMINATION,
  END_FORFEIT,
  END_TIME,
  EV_MATCH_END,
  EV_ROUND_END,
  PHASE_END,
  PHASE_FREEZE,
  PHASE_LIVE,
  PHASE_MATCH_END,
  PHASE_WARMUP,
  writeInput,
  writeShot,
} from '../shared/protocol.js';
import { Room } from '../server/room.js';

const colliders = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const RULES = { freezeTicks: 10, roundTicks: 600, endTicks: 10, matchEndTicks: 10, roundsToWin: 2 };
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };

function room(rules = {}) {
  return new Room('t', colliders, { rules: { ...RULES, ...rules } });
}
function join(r, name) {
  const p = r.join(name);
  p.next = 0;
  return p;
}
const ticks = (r, n) => {
  for (let i = 0; i < n; i++) r.step();
};
const phase = (r) => r.game.phase;
const roundEnds = (r) => r.events.filter((e) => e.data[0] === EV_ROUND_END).map((e) => e.data);

// Runs the freeze out and stands `a` and `b` face to face across the plaza.
function goLive(r, a, b) {
  while (phase(r) !== PHASE_LIVE) r.step();
  r._place(a, 6, 16);
  r._place(b, -6, 16);
  r.step();
}

function shoot(r, p, target, y = 1.7) {
  const o = { x: p.move.pos.x, y: p.move.pos.y + p.move.eye, z: p.move.pos.z };
  const t = { x: target.move.pos.x, y: target.move.pos.y + y, z: target.move.pos.z };
  const d = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
  const dir = { x: (t.x - o.x) / d, y: (t.y - o.y) / d, z: (t.z - o.z) / d };
  r.receiveInputs(p.id, [writeInput(p.next, IDLE, 0, 0)], [writeShot(p.next, o, dir, r.tick)]); // sees the newest tick
  p.next++;
  r.step();
}

test('players are balanced into two teams', () => {
  const r = room();
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((n) => join(r, n).team), [0, 1, 0, 1, 0]);
  r.leave(1);
  r.leave(3);
  assert.equal(join(r, 'f').team, 0, 'refills the smaller team');
});

test('warmup until both teams have a player, then a frozen round start at team spawns', () => {
  const r = room();
  const a = join(r, 'a');
  ticks(r, 5);
  assert.equal(phase(r), PHASE_WARMUP);
  const b = join(r, 'b');
  r.step();
  assert.equal(phase(r), PHASE_FREEZE);
  assert.equal(r.game.round, 1);
  assert.ok(a.move.pos.z > 0 && b.move.pos.z < 0, 'each team on its own side');

  // frozen: inputs are acknowledged but nobody moves or shoots
  const start = { ...a.move.pos };
  for (let i = 0; i < 5; i++) {
    r.receiveInputs(a.id, [writeInput(a.next++, { ...IDLE, forward: 1 }, 0, 0)]);
    r.step();
  }
  assert.deepEqual({ ...a.move.pos }, start);
  assert.equal(a.lastSeq, 4);
  shoot(r, a, b);
  assert.equal(b.hp, MAX_HEALTH);
  ticks(r, RULES.freezeTicks);
  assert.equal(phase(r), PHASE_LIVE);
});

test('eliminating the other team wins the round; the dead wait for the next one', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  goLive(r, a, b);
  shoot(r, a, b);
  assert.equal(b.dead, true);
  assert.equal(phase(r), PHASE_END);
  assert.deepEqual(r.game.score, [1, 0]);
  assert.deepEqual(roundEnds(r), [[EV_ROUND_END, 1, 0, END_ELIMINATION]]);
  ticks(r, RULES.endTicks - 1);
  assert.equal(b.dead, true, 'no respawn during the round');
  r.step();
  assert.equal(phase(r), PHASE_FREEZE);
  assert.equal(r.game.round, 2);
  assert.equal(b.dead, false);
  assert.equal(b.hp, MAX_HEALTH);
  assert.ok(b.move.pos.z < 0, 'back at the BRAVO spawn');
});

test('when time runs out, the team with more players alive wins; equal is a draw', () => {
  const r = room({ roundTicks: 50 });
  const a = join(r, 'a');
  const b = join(r, 'b');
  const c = join(r, 'c');
  const d = join(r, 'd');
  goLive(r, a, b);
  ticks(r, 60);
  assert.deepEqual(roundEnds(r).at(-1), [EV_ROUND_END, 1, -1, END_TIME]);
  assert.deepEqual(r.game.score, [0, 0]);

  while (phase(r) !== PHASE_LIVE) r.step();
  r._place(a, 6, 16);
  r._place(b, -6, 16);
  r._place(c, 6, 30); // keep everyone else out of the line of fire
  r._place(d, -6, 30);
  r.step();
  shoot(r, a, b); // ALPHA 2 alive, BRAVO 1
  ticks(r, 60);
  assert.deepEqual(roundEnds(r).at(-1), [EV_ROUND_END, 2, 0, END_TIME]);
  assert.deepEqual(r.game.score, [1, 0]);
});

test('first to roundsToWin takes the match; then a fresh match starts', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  for (let round = 1; round <= 2; round++) {
    goLive(r, a, b);
    shoot(r, a, b);
  }
  ticks(r, RULES.endTicks);
  assert.equal(phase(r), PHASE_MATCH_END);
  assert.deepEqual(r.events.filter((e) => e.data[0] === EV_MATCH_END).map((e) => e.data), [[EV_MATCH_END, 0]]);
  assert.equal(a.kills, 2);
  // frozen while the result is up
  const pos = { ...a.move.pos };
  r.receiveInputs(a.id, [writeInput(a.next++, { ...IDLE, forward: 1 }, 0, 0)]);
  r.step();
  assert.deepEqual({ ...a.move.pos }, pos);
  ticks(r, RULES.matchEndTicks);
  assert.equal(phase(r), PHASE_FREEZE);
  assert.equal(r.game.round, 1);
  assert.deepEqual(r.game.score, [0, 0]);
  assert.equal(a.kills, 0, 'stats reset for the new match');
});

test('mid-round joiners sit out until the next round', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  goLive(r, a, b);
  const c = join(r, 'c');
  assert.equal(c.dead, true);
  assert.equal(c.deaths, 0, 'sitting out is not a death');
  shoot(r, a, b);
  ticks(r, RULES.endTicks);
  assert.equal(c.dead, false, 'plays from the next round');
});

test('a team emptying out forfeits the round and returns to warmup', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  goLive(r, a, b);
  r.leave(b.id);
  r.step();
  assert.deepEqual(roundEnds(r).at(-1), [EV_ROUND_END, 1, 0, END_FORFEIT]);
  ticks(r, RULES.endTicks);
  assert.equal(phase(r), PHASE_WARMUP);
  assert.deepEqual(r.game.score, [0, 0]);
});

test('no friendly fire: rounds pass through teammates to the enemy behind', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  const c = join(r, 'c'); // ALPHA, like a
  join(r, 'd');
  goLive(r, a, b);
  r._place(c, 0, 16); // right between a and b
  r.step();
  shoot(r, a, b, 1.0);
  assert.equal(c.hp, MAX_HEALTH);
  assert.ok(b.hp < MAX_HEALTH, 'the enemy behind is hit');
});

test('snapshots carry the match state and teams', () => {
  const r = room();
  const a = join(r, 'a');
  const b = join(r, 'b');
  r.step();
  const s = r.snapshotFor(a.id);
  assert.deepEqual(s.game.slice(0, 5), [PHASE_FREEZE, r.game.endsAt, 1, 0, 0]);
  assert.equal(s.game[6], RULES.roundsToWin);
  assert.equal(s.me[7], 0);
  assert.equal(s.players[0][10], 1);
});

test('deathmatch rooms have no teams or rounds', () => {
  const r = new Room('dm', colliders, { mode: 'dm', rules: RULES });
  const a = join(r, 'a');
  const b = join(r, 'b');
  ticks(r, 20);
  assert.equal(phase(r), PHASE_WARMUP);
  assert.equal(a.team, -1);
  assert.equal(b.team, -1);
  assert.equal(r.snapshotFor(a.id).game[7], 1);
});
