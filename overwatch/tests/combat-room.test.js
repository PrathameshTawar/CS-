// Server-side combat: hits, damage, fire rate, ammo, reloads, death/respawn
// and lag compensation, on the real plaza map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODY_DAMAGE, MAG_SIZE, MAX_HEALTH, RELOAD_REFILL_AT, RESPAWN_TIME } from '../shared/combat.js';
import { EV_HIT, EV_KILL, EV_SHOT, EV_SPAWN, MAX_REWIND_TICKS, TICK_RATE, writeInput, writeShot } from '../shared/protocol.js';
import { Room } from '../server/room.js';

const colliders = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };

// Two deathmatch players (combat rules only; rounds are tested in
// match.test.js), spawned apart across the plaza.
function setup() {
  const room = new Room('t', colliders, { mode: 'dm' });
  const a = room.join('a');
  const b = room.join('b');
  // face to face across the plaza: A at (6, 16), B at (-6, 16)
  room._place(a, 6, 16);
  room._place(b, -6, 16);
  a.next = 0;
  b.next = 0;
  idle(room, a, 2);
  idle(room, b, 2);
  return { room, a, b };
}

// Sends `n` inputs for p and runs n ticks.
function idle(room, p, n = 1, input = IDLE, yaw = p.move.yaw) {
  for (let i = 0; i < n; i++) {
    room.receiveInputs(p.id, [writeInput(p.next++, input, yaw, 0)]);
    room.step();
  }
}
// b's "right" at yaw π/2 is -Z: across a's line of fire (which runs along X)
const STRAFE = [{ ...IDLE, right: 1 }, Math.PI / 2];

const eye = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + p.move.eye, z: p.move.pos.z });

// p fires from its eye at world point `at`, as seen at `viewTick`.
function shoot(room, p, at, viewTick = room.tick - 1, origin = eye(p)) {
  const d = { x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
  room.receiveInputs(p.id, [writeInput(p.next, IDLE, p.move.yaw, 0)], [writeShot(p.next, origin, dir, viewTick)]);
  p.next++;
  room.step();
}

const chest = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + 1.0, z: p.move.pos.z });
const head = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + 1.7, z: p.move.pos.z });
const eventsOf = (room, type) => room.events.filter((e) => e.data[0] === type).map((e) => e.data);

test('a body shot deals body damage; three kill', () => {
  const { room, a, b } = setup();
  shoot(room, a, chest(b));
  assert.equal(b.hp, MAX_HEALTH - BODY_DAMAGE);
  const [hit] = eventsOf(room, EV_HIT);
  assert.deepEqual(hit.slice(0, 5), [EV_HIT, a.id, b.id, BODY_DAMAGE, 0]);
  idle(room, a, 10);
  shoot(room, a, chest(b));
  idle(room, a, 10);
  shoot(room, a, chest(b));
  assert.equal(b.hp, 0);
  assert.equal(b.dead, true);
  assert.deepEqual(eventsOf(room, EV_KILL), [[EV_KILL, a.id, b.id, 0]]);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
});

test('a headshot kills outright', () => {
  const { room, a, b } = setup();
  shoot(room, a, head(b));
  assert.equal(b.dead, true);
  assert.deepEqual(eventsOf(room, EV_KILL), [[EV_KILL, a.id, b.id, 1]]);
});

test('fire rate, ammo and reload are enforced by the server', () => {
  const { room, a, b } = setup();
  shoot(room, a, { x: 6, y: 1, z: 40 }); // into the street, away from b
  shoot(room, a, { x: 6, y: 1, z: 40 }); // one step later: too fast
  assert.equal(a.ammo, MAG_SIZE - 1);
  assert.equal(a.rejected, 1);
  for (let i = 1; i < MAG_SIZE; i++) {
    idle(room, a, 10);
    shoot(room, a, { x: 6, y: 1, z: 40 });
  }
  assert.equal(a.ammo, 0);
  idle(room, a, 10);
  shoot(room, a, chest(b)); // empty
  assert.equal(b.hp, MAX_HEALTH);
  // reload: refilled at RELOAD_REFILL_AT, no firing until it finishes
  room.receiveInputs(a.id, [writeInput(a.next, IDLE, 0, 0)], undefined, [a.next]);
  a.next++;
  room.step();
  idle(room, a, Math.round(RELOAD_REFILL_AT * TICK_RATE) - 2);
  assert.equal(a.ammo, 0);
  idle(room, a, 2);
  assert.equal(a.ammo, MAG_SIZE);
  shoot(room, a, chest(b)); // still in the reload animation
  assert.equal(b.hp, MAX_HEALTH);
  idle(room, a, TICK_RATE);
  shoot(room, a, chest(b));
  assert.equal(b.hp, MAX_HEALTH - BODY_DAMAGE);
});

test('a shot from a spoofed origin is refused', () => {
  const { room, a, b } = setup();
  const near = { x: b.move.pos.x + 2, y: 1.5, z: b.move.pos.z };
  shoot(room, a, chest(b), room.tick - 1, near);
  assert.equal(b.hp, MAX_HEALTH);
  assert.equal(a.rejected, 1);
  assert.equal(eventsOf(room, EV_SHOT).length, 0);
});

test('the dead neither move nor shoot, and respawn far from the killer', () => {
  const { room, a, b } = setup();
  shoot(room, a, head(b));
  const deathPos = { ...b.move.pos };
  idle(room, b, 30, { ...IDLE, forward: 1 });
  assert.deepEqual({ ...b.move.pos }, deathPos, 'inputs while dead do not move');
  assert.ok(b.lastSeq >= 29, 'but they are still acknowledged');
  shoot(room, b, chest(a));
  assert.equal(a.hp, MAX_HEALTH);
  // respawn after RESPAWN_TIME
  for (let i = 0; i < RESPAWN_TIME * TICK_RATE; i++) room.step();
  assert.equal(b.dead, false);
  assert.equal(b.hp, MAX_HEALTH);
  assert.equal(b.ammo, MAG_SIZE);
  assert.ok(b.move.grounded && b.move.pos.y < 1, 'standing at a spawn');
  assert.ok(Math.hypot(b.move.pos.x - a.move.pos.x, b.move.pos.z - a.move.pos.z) > 20, 'far from the killer');
  assert.deepEqual(eventsOf(room, EV_SPAWN), [[EV_SPAWN, b.id]]);
});

test('lag compensation: shots land on targets as the shooter saw them', () => {
  const { room, a, b } = setup();
  // b strafes sideways for 0.3 s; remember where b was at the start
  const seenTick = room.tick;
  const seen = chest(b);
  idle(room, b, 36, ...STRAFE);
  idle(room, a, 1);
  const moved = Math.hypot(b.move.pos.x - seen.x, b.move.pos.z - seen.z);
  assert.ok(moved > 1.0, `b moved ${moved.toFixed(2)} m`);

  // without rewinding, a shot at the old position misses
  shoot(room, a, seen, room.tick - 1);
  assert.equal(b.hp, MAX_HEALTH);
  // as seen at seenTick (within the rewind window) it hits
  idle(room, a, 10);
  shoot(room, a, seen, seenTick);
  assert.equal(b.hp, MAX_HEALTH - BODY_DAMAGE);
});

test('lag compensation is capped: a too-old view tick does not reach back', () => {
  const { room, a, b } = setup();
  const seenTick = room.tick;
  const seen = chest(b);
  idle(room, b, MAX_REWIND_TICKS + 30, ...STRAFE);
  shoot(room, a, seen, seenTick);
  assert.equal(b.hp, MAX_HEALTH);
});

test('snapshots carry combat status and deliver each event once', () => {
  const { room, a, b } = setup();
  room.snapshotFor(a.id);
  room.snapshotFor(b.id);
  shoot(room, a, chest(b));
  const sb = room.snapshotFor(b.id);
  assert.deepEqual(sb.me.slice(0, 2), [MAX_HEALTH - BODY_DAMAGE, 0]);
  assert.ok(sb.ev.some((e) => e[0] === EV_SHOT && e[1] === a.id), 'b sees a fire');
  assert.ok(sb.ev.some((e) => e[0] === EV_HIT && e[2] === b.id));
  assert.equal(room.snapshotFor(b.id).ev.length, 0, 'not delivered twice');
  const sa = room.snapshotFor(a.id);
  assert.equal(sa.me[2], MAG_SIZE - 1);
  assert.ok(!sa.ev.some((e) => e[0] === EV_SHOT), "a's own shot is not echoed back");
  assert.ok(sa.ev.some((e) => e[0] === EV_HIT && e[1] === a.id), 'a gets the hit confirmation');
});

test('malformed shots and reloads are refused', () => {
  const { room, a } = setup();
  const ok = [writeInput(0, IDLE, 0, 0)];
  assert.equal(room.receiveInputs(a.id, ok, [[0, 1, 2, 3, 0, 0, 0, 5]]), false, 'zero direction');
  assert.equal(room.receiveInputs(a.id, ok, [[0, 1, 2]]), false, 'short');
  assert.equal(room.receiveInputs(a.id, ok, 'x'), false);
  assert.equal(room.receiveInputs(a.id, ok, undefined, [-1]), false);
  assert.equal(room.receiveInputs(a.id, ok, Array(9).fill([0, 1, 2, 3, 1, 0, 0, 5])), false, 'too many');
});
