// Movement must be identical on the client and the server, and must not
// change by accident.
//
// tests/fixtures/movement-trace.json is tests/movement-script.js driving the
// movement over tests/fixtures/plaza-colliders.json. It was first recorded
// from the original player and physics systems (before the move into
// shared/), and re-recorded (node tools/record-movement-trace.mjs) when falls
// became real arcs instead of snapping to the floor. Both the shared step
// (what the server runs) and the client's PlayerSystem must reproduce it
// bit-for-bit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeScript, runSharedTrace, traceRow, TRACE_STEPS, TRACE_EVERY } from './movement-script.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const colliders = fixture('plaza-colliders.json');
const golden = fixture('movement-trace.json');
const H = 1 / 120;

const runShared = runSharedTrace;

async function runPlayerSystem(boxes) {
  const THREE = await import('three');
  const { PlayerSystem } = await import('../src/player/index.js');
  const { PhysicsSystem } = await import('../src/physics/index.js');
  const { createRng } = await import('../shared/rng.js');
  let cur = { down: new Set(), jump: false };
  const physics = new PhysicsSystem();
  const ctx = {
    config: { shot: null },
    input: { isDown: (a) => cur.down.has(a), stepPressed: (a) => a === 'jump' && cur.jump },
    events: { on: () => () => {}, emit: () => {} },
    camera: new THREE.PerspectiveCamera(),
    rng: createRng(1),
    get: (id) => (id === 'world' ? { staticColliders: boxes } : physics),
  };
  physics.init(ctx);
  const player = new PlayerSystem();
  player.init(ctx);
  const next = makeScript();
  const rows = [];
  for (let i = 0; i < TRACE_STEPS; i++) {
    cur = next(i);
    player.yaw = cur.yaw;
    player.fixedUpdate(H, ctx);
    if (i % TRACE_EVERY === TRACE_EVERY - 1) rows.push(traceRow(player));
  }
  return rows;
}

function assertSameTrace(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    for (let j = 0; j < expected[i].length; j++) {
      if (!Object.is(actual[i][j], expected[i][j])) {
        assert.fail(`step ${(i + 1) * TRACE_EVERY - 1}, field ${j}: got ${actual[i][j]}, expected ${expected[i][j]}`);
      }
    }
  }
}

test('the trace exercises collisions, step-ups, crouch, sprint and jumps', () => {
  const ys = golden.map((r) => r[1]);
  assert.ok(golden.some((r) => r[6] === 1 && r[1] > 0.45 && r[1] < 50), 'stood on a raised surface');
  assert.ok(golden.some((r) => r[9] === 1), 'crouched');
  assert.ok(golden.some((r) => r[10] === 1), 'sprinted');
  assert.ok(golden.some((r) => r[5] > 0), 'jumped');
  assert.ok(Math.max(...ys) < 60, 'put down on the ground, not dropped from the spawn height');
});

test('shared stepMove reproduces the recorded movement bit-for-bit', () => {
  assertSameTrace(runShared(colliders), golden);
});

test('the client PlayerSystem reproduces the recorded movement bit-for-bit', async () => {
  assertSameTrace(await runPlayerSystem(colliders), golden);
});

test('movement is deterministic run to run', () => {
  assertSameTrace(runShared(colliders), runShared(colliders));
});
