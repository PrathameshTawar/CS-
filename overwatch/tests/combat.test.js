// The bullet trace moved from the weapon system into shared/combat.js so the
// server can run it. tests/fixtures/ballistics-trace.json was recorded from
// the ORIGINAL WeaponSystem._trace (400 shots across the plaza); the shared
// trace must land every shot on the same point, normal and surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CollisionWorld } from '../shared/collision.js';
import { HEAD_ZONE, isHeadshot, playerHitbox, traceShot } from '../shared/combat.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const world = new CollisionWorld(fixture('plaza-colliders.json'));
const shots = fixture('ballistics-trace.json');

test('the shared trace reproduces the original weapon trace bit-for-bit', () => {
  let hits = 0;
  for (const [ox, oy, oz, dx, dy, dz, expected] of shots) {
    const hit = traceShot(world, { x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    if (!expected) {
      assert.equal(hit, null);
      continue;
    }
    hits++;
    const got = [hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z, hit.surface, hit.distance];
    for (let i = 0; i < got.length; i++) assert.ok(Object.is(got[i], expected[i]), `shot field ${i}: ${got[i]} vs ${expected[i]}`);
  }
  assert.ok(hits > 100, 'the fixture covers plenty of hits');
});

test('a dynamic player hitbox stops the round and reports its owner', () => {
  const w = new CollisionWorld([{ min: [-50, -1, -50], max: [50, 0, 50], surface: 'asphalt' }]);
  const box = playerHitbox(0, 0, -10, 0.9, { min: [0, 0, 0], max: [0, 0, 0], surface: 'flesh', owner: 7 });
  w.dynamics.push(box);
  const hit = traceShot(w, { x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(hit.surface, 'flesh');
  assert.equal(hit.box.owner, 7);
  assert.equal(isHeadshot(box, hit.point.y), false);
  const head = traceShot(w, { x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(isHeadshot(box, head.point.y), true);
  assert.equal(box.max[1] - HEAD_ZONE, 1.5);
});
