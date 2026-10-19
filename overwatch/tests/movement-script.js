// Deterministic input script for the movement trace: 2 s straight runs in
// random directions (so the trace walks into walls, props and curbs), with
// random sprint/crouch/strafe and occasional jumps. Must not change, or
// tests/fixtures/movement-trace.json has to be re-recorded
// (node tools/record-movement-trace.mjs).
import { createRng } from '../shared/rng.js';
import { CollisionWorld } from '../shared/collision.js';
import { createMoveState, settle, stepMove } from '../shared/movement.js';

export const TRACE_STEPS = 9600; // 80 s at 120 Hz
export const TRACE_EVERY = 16; // fixture keeps every 16th step
export const SPAWN = { x: 6, y: 60, z: 16 };

export function makeScript() {
  const s = createRng(0xc0ffee);
  let down = new Set();
  let jump = false;
  let yaw = Math.PI;
  return (i) => {
    jump = false;
    if (i % 240 === 0) {
      down = new Set();
      if (s.chance(0.85)) down.add('forward');
      else down.add('back');
      if (s.chance(0.25)) down.add(s.chance(0.5) ? 'left' : 'right');
      if (s.chance(0.5)) down.add('sprint');
      if (s.chance(0.15)) down.add('crouch');
      yaw = s.range(0, Math.PI * 2);
    }
    if (i % 90 === 45 && s.chance(0.3)) jump = true;
    return { down, jump, yaw };
  };
}

// One fixture row: the state the trace pins down.
export function traceRow(p) {
  return [p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.z, p.vy, p.grounded ? 1 : 0, p.eye, p.half.y, p.crouching ? 1 : 0, p.sprinting ? 1 : 0];
}

// The trace from the shared step (what the server runs), spawned like the
// client: put down on the ground beneath SPAWN, then driven by the script.
export function runSharedTrace(boxes, h = 1 / 120) {
  const world = new CollisionWorld(boxes);
  const state = settle(createMoveState({ ...SPAWN }, { x: 0, y: 0, z: 0 }), world);
  const input = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
  const out = {};
  const next = makeScript();
  const rows = [];
  for (let i = 0; i < TRACE_STEPS; i++) {
    const s = next(i);
    state.yaw = s.yaw;
    input.forward = (s.down.has('forward') ? 1 : 0) - (s.down.has('back') ? 1 : 0);
    input.right = (s.down.has('right') ? 1 : 0) - (s.down.has('left') ? 1 : 0);
    input.jump = s.jump;
    input.crouch = s.down.has('crouch');
    input.sprint = s.down.has('sprint');
    stepMove(state, input, h, world, out);
    if (i % TRACE_EVERY === TRACE_EVERY - 1) rows.push(traceRow(state));
  }
  return rows;
}
