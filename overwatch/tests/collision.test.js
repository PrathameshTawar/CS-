import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../shared/collision.js';

const floor = { min: [-10, -1, -10], max: [10, 0, 10], surface: 'asphalt' };
const wall = { min: [2, 0, -10], max: [3, 3, 10], surface: 'brick' };
const curb = { min: [-10, 0, 4], max: [10, 0.3, 10], surface: 'concrete' };
const half = { x: 0.34, y: 0.9, z: 0.34 };

test('raycast returns the nearest hit with point, normal and surface', () => {
  const w = new CollisionWorld([floor, wall]);
  const r = w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50);
  assert.equal(r.hit, true);
  assert.equal(r.distance, 2);
  assert.deepEqual(r.point, { x: 2, y: 1, z: 0 });
  assert.deepEqual(r.normal, { x: -1, y: 0, z: 0 });
  assert.equal(r.surface, 'brick');
});

test('raycast misses past maxDist; dynamics are hit by raycast but not raycastStatic', () => {
  const w = new CollisionWorld([floor, wall]);
  assert.equal(w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 1.5).hit, false);
  const target = w.addDynamic({ min: [0.9, 0, -0.5], max: [1.1, 2, 0.5], surface: 'flesh' });
  assert.equal(w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50).surface, 'flesh');
  assert.equal(w.raycastStatic({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50).surface, 'brick');
  w.removeDynamic(target);
  assert.equal(w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50).surface, 'brick');
});

test('moveCharacter stops at walls and lands on the floor', () => {
  const w = new CollisionWorld([floor, wall]);
  const pos = { x: 1.5, y: half.y, z: 0 };
  const res = w.moveCharacter(pos, half, { x: 0.5, y: -0.1, z: 0 }, 0.45);
  assert.equal(pos.x, 2 - half.x);
  assert.equal(pos.y, half.y);
  assert.equal(res.grounded, true);
  assert.equal(res.surface, 'asphalt');
});

// The mover resolves overlap after each axis move rather than sweeping, so a
// delta wider than a wall tunnels through it. Fixed steps keep deltas tiny
// (8.6 m/s / 120 Hz = 7 cm); the server must never apply a large delta.
test('moveCharacter does not sweep: a delta wider than a wall passes through', () => {
  const w = new CollisionWorld([floor, wall]);
  const pos = { x: 0, y: half.y, z: 0 };
  w.moveCharacter(pos, half, { x: 5, y: 0, z: 0 }, 0.45);
  assert.equal(pos.x, 5);
});

test('moveCharacter steps up onto low ledges', () => {
  const w = new CollisionWorld([floor, curb]);
  const pos = { x: 0, y: half.y, z: 3.5 };
  const res = w.moveCharacter(pos, half, { x: 0, y: -0.01, z: 1 }, 0.45);
  assert.equal(pos.z, 4.5);
  assert.equal(pos.y, 0.3 + half.y);
  assert.equal(res.surface, 'concrete');
});

test('overlaps detects boxes intersecting an AABB', () => {
  const w = new CollisionWorld([wall]);
  assert.equal(w.overlaps({ x: 2.5, y: 1, z: 0 }, half), true);
  assert.equal(w.overlaps({ x: 0, y: 1, z: 0 }, half), false);
});
