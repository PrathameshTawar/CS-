import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CollisionWorld } from '../shared/collision.js';
import { createMoveState, stepMove } from '../shared/movement.js';
import { TICK_RATE, packState, unpackState, writeInput } from '../shared/protocol.js';
import { Room, SPAWNS } from '../server/room.js';

const colliders = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const H = 1 / TICK_RATE;
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
const FORWARD = { ...IDLE, forward: 1 };
const wire = (seq, input = FORWARD, yaw = 0) => writeInput(seq, input, yaw, 0);

test('every spawn point lands on street level, standing', () => {
  const room = new Room('t', colliders, { maxPlayers: SPAWNS.length });
  for (let i = 0; i < SPAWNS.length; i++) {
    const p = room.join(`p${i}`);
    assert.ok(p.move.grounded, `spawn ${i} grounded`);
    assert.ok(p.move.pos.y < 1, `spawn ${i} at street level (y=${p.move.pos.y})`);
  }
});

test('a full room rejects joins; leaving frees the slot', () => {
  const room = new Room('t', colliders, { maxPlayers: 2 });
  const a = room.join('a');
  assert.ok(room.join('b'));
  assert.equal(room.join('c'), null);
  room.leave(a.id);
  assert.ok(room.join('c'));
});

test('malformed inputs are refused, stale and duplicate seqs ignored', () => {
  const room = new Room('t', colliders);
  const p = room.join('a');
  assert.equal(room.receiveInputs(p.id, [[0, 2, 0, 0, 0, 0]]), false, 'axis out of range');
  assert.equal(room.receiveInputs(p.id, [[0, 1, 0, 99, 0, 0]]), false, 'bad flags');
  assert.equal(room.receiveInputs(p.id, [[0, 1, 0, 0, NaN, 0]]), false, 'NaN yaw');
  assert.equal(room.receiveInputs(p.id, 'nope'), false);
  assert.equal(room.receiveInputs(p.id, [wire(0), wire(1), wire(1), wire(0), wire(2)]), true);
  assert.deepEqual(p.queue.map((i) => i.seq), [0, 1, 2]);
});

test('the server applies at most one input per tick (no speed hacks)', () => {
  const room = new Room('t', colliders);
  const p = room.join('a');
  room.receiveInputs(p.id, Array.from({ length: 20 }, (_, i) => wire(i)));
  room.step();
  assert.equal(p.lastSeq, 0, 'one tick of credit applies one input');
  for (let i = 0; i < 4; i++) room.step();
  assert.equal(p.lastSeq, 4);
  // a client that sends far ahead of real time is cut to the queue limit
  room.receiveInputs(p.id, Array.from({ length: 32 }, (_, i) => wire(100 + i)));
  room.receiveInputs(p.id, Array.from({ length: 32 }, (_, i) => wire(132 + i)));
  assert.ok(p.queue.length <= TICK_RATE / 2);
  assert.ok(p.dropped > 0);
});

test('credit saved while idle lets a stalled client catch up, capped at 250 ms', () => {
  const room = new Room('t', colliders);
  const p = room.join('a');
  for (let i = 0; i < 100; i++) room.step(); // no inputs: player stands still
  room.receiveInputs(p.id, Array.from({ length: 32 }, (_, i) => wire(i)));
  room.receiveInputs(p.id, Array.from({ length: 8 }, (_, i) => wire(32 + i)));
  room.step();
  assert.equal(p.lastSeq, TICK_RATE / 4 - 1, 'applied exactly the capped credit');
  assert.equal(p.queue.length, 40 - TICK_RATE / 4, 'the rest waits for later ticks');
});

test('client prediction + reconciliation lands exactly on the server state', () => {
  // the client runs the same step on its own copy of the map
  const room = new Room('t', colliders);
  const server = room.join('a');
  const world = new CollisionWorld(colliders);
  const client = createMoveState({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  unpackState(room.snapshotFor(server.id).you, client);
  const out = {};
  const sent = [];
  let seq = 0;
  // 2 s of input: forward, strafing, sprinting, a jump, turning
  for (let i = 0; i < 2 * TICK_RATE; i++) {
    const input = { ...IDLE, forward: 1, right: i % 120 < 60 ? 0 : 1, sprint: i > 60, jump: i === 90 };
    client.yaw = i * 0.01;
    stepMove(client, input, H, world, out);
    sent.push(writeInput(seq++, input, client.yaw, 0));
    if (sent.length === 4) {
      room.receiveInputs(server.id, sent.splice(0));
      for (let k = 0; k < 4; k++) room.step();
    }
  }
  const snap = room.snapshotFor(server.id);
  assert.equal(snap.ack, seq - 1);
  assert.deepEqual(snap.you, packState(client));
  assert.ok(Math.hypot(client.pos.x - 6, client.pos.z - 16) > 5, 'the player actually moved');
});

test('snapshots list everyone except the recipient', () => {
  const room = new Room('t', colliders);
  const a = room.join('alice');
  const b = room.join('bob');
  const snap = room.snapshotFor(a.id);
  assert.equal(snap.players.length, 1);
  assert.equal(snap.players[0][0], b.id);
  assert.equal(snap.players[0][7], 'bob');
  assert.equal(room.snapshotFor(999), null);
});
