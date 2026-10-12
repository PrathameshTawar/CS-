// The server must be able to rebuild the client's map from the seed alone.
//
// tests/fixtures/plaza-colliders.json was captured from the running game in
// Chromium (seed 0x5eed1234, before the layout stream moved to shared/map.js).
// Node and Chromium can differ in the last bit of Math.sin/cos, so the
// cross-runtime comparison allows a 1e-9 m tolerance; within one runtime the
// build is exact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildColliders, layoutRng } from '../shared/map.js';
import { createRng } from '../shared/rng.js';

const SEED = 0x5eed1234;
const browser = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));

test('layoutRng reproduces the stream the world used to fork after materials', () => {
  const boot = createRng(SEED);
  boot.fork(0x0bad5eed); // materials
  const old = boot.fork(0x70a1d); // world
  const now = layoutRng(SEED);
  for (let i = 0; i < 64; i++) assert.equal(now.nextUint32(), old.nextUint32());
});

test('buildColliders in Node matches the colliders captured in the browser', async () => {
  const node = await buildColliders(SEED);
  assert.equal(node.length, browser.length);
  for (let i = 0; i < browser.length; i++) {
    assert.equal(node[i].surface, browser[i].surface, `box ${i} surface`);
    for (let a = 0; a < 3; a++) {
      assert.ok(Math.abs(node[i].min[a] - browser[i].min[a]) < 1e-9, `box ${i} min[${a}]`);
      assert.ok(Math.abs(node[i].max[a] - browser[i].max[a]) < 1e-9, `box ${i} max[${a}]`);
    }
  }
});

test('buildColliders is exact run to run, and the seed changes the layout', async () => {
  assert.deepEqual(await buildColliders(SEED), await buildColliders(SEED));
  assert.notDeepEqual(await buildColliders(SEED + 1), await buildColliders(SEED));
});
