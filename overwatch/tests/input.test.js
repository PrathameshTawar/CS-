// Input reaches the systems that read it. Regression: the engine used to
// clear input at the top of every frame, discarding everything that arrived
// between frames, so mouse look and jump never worked.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// minimal DOM: the input module only listens on `document` and locks `canvas`
let canvas;
beforeEach(() => {
  globalThis.document = new EventTarget();
  document.pointerLockElement = null;
  canvas = {
    requestPointerLock() {
      document.pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
  };
});
const fire = (type, props, target = null) => {
  const ev = Object.assign(new Event(type), props);
  if (target) Object.defineProperty(ev, 'target', { value: target }); // clicked element
  return document.dispatchEvent(ev);
};
const key = (type, code) => fire(type, { code });
const lock = () => fire('mousedown', { button: 0 }, canvas); // the engage click locks, it doesn't shoot

test('presses: per-frame readers until endFrame, fixed-step readers until endSteps', async () => {
  const { createInput } = await import('../src/core/input.js');
  const input = createInput({ canvas });
  key('keydown', 'Space');
  assert.equal(input.justPressed('jump'), true);
  assert.equal(input.stepPressed('jump'), true);
  assert.equal(input.isDown('jump'), true);
  input.endFrame(); // a frame that ran no fixed step (above 120 fps)
  assert.equal(input.justPressed('jump'), false);
  assert.equal(input.stepPressed('jump'), true, 'the jump waits for a fixed step');
  input.endSteps();
  assert.equal(input.stepPressed('jump'), false);
  key('keydown', 'Space'); // key repeat while held is not a new press
  assert.equal(input.justPressed('jump'), false);
});

test('only a click on the game view captures the mouse (not menus or their fields)', async () => {
  const { createInput } = await import('../src/core/input.js');
  const input = createInput({ canvas });
  fire('mousedown', { button: 0 }, { tagName: 'INPUT' }); // e.g. the server address field
  assert.equal(input.locked, false);
  assert.equal(input.fire, false, 'and it is not a shot');
  lock();
  assert.equal(input.locked, true);
  assert.equal(input.fire, false, 'the engage click is not a shot either');
});

test('typing in a text field is not gameplay and is not swallowed', async () => {
  const { createInput } = await import('../src/core/input.js');
  const input = createInput({ canvas });
  const ev = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyX' });
  Object.defineProperty(ev, 'target', { value: { tagName: 'INPUT' } });
  document.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'the letter reaches the field');
  assert.equal(input.justPressed('inspect'), false);
  const game = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyX' });
  document.dispatchEvent(game);
  assert.equal(game.defaultPrevented, true, 'in play, game keys are still captured');
  assert.equal(input.justPressed('inspect'), true);
});

test('mouse movement accumulates while locked and is cleared after the frame', async () => {
  const { createInput } = await import('../src/core/input.js');
  const input = createInput({ canvas });
  fire('mousemove', { movementX: 50, movementY: 5 });
  assert.equal(input.consumeAim().dx, 0, 'ignored until the pointer is locked');
  lock();
  assert.equal(input.locked, true);
  fire('mousemove', { movementX: 30, movementY: 4 });
  fire('mousemove', { movementX: 20, movementY: 6 });
  assert.deepEqual({ ...input.consumeAim() }, { dx: 50, dy: 10 });
  input.endFrame();
  assert.deepEqual({ ...input.consumeAim() }, { dx: 0, dy: 0 });
});

test('the engine delivers input that arrived between frames to update and fixedUpdate', async () => {
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.cancelAnimationFrame = () => {};
  const { Context } = await import('../src/core/ctx.js');
  const ctx = new Context(canvas, { fov: 70, seed: 1 });
  const seen = { aim: 0, jumps: 0, steps: 0 };
  class Probe {
    static id = 'probe';
    fixedUpdate(h, c) {
      seen.steps++;
      if (c.input.stepPressed('jump')) seen.jumps++;
    }
    update(dt, c) {
      seen.aim += c.input.consumeAim().dx;
    }
  }
  ctx.register(new Probe());
  ctx._order = [ctx.get('probe')]; // what boot() would set, without booting a renderer
  ctx.start();
  const frame = (ms) => frames.shift()(ms);
  frame(0); // first frame: clock starts

  // the player moves the mouse and presses Space between two frames
  lock();
  fire('mousemove', { movementX: 120, movementY: 0 });
  key('keydown', 'Space');
  frame(1000 / 60); // 16.7 ms: two fixed steps
  assert.equal(seen.aim, 120, 'update saw the mouse movement');
  assert.equal(seen.jumps, 2, 'both fixed steps of that frame saw the jump press');

  frame(1000 / 60 + 1000 / 60);
  assert.equal(seen.aim, 120, 'consumed once, not replayed');
  assert.equal(seen.jumps, 2, 'the press is gone after its frame');
  ctx.stop();
});
