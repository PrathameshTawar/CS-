// shared/movement.js — one fixed step of first-person character movement.
//
// Walk/run/crouch/jump, air control and auto-step against a CollisionWorld.
// Shared by the client (player system, for prediction) and the server (the
// authority), so both integrate the same input to the same position. Pure JS:
// no three.js, no DOM, no randomness, no per-step allocation.
//
// Collision model: state.pos is the FEET position. The AABB center handed to
// the collision world is pos + half.y, and the eye sits at pos + eye. That
// keeps the feet planted on the ground while the box shrinks/grows with crouch.

export const GRAVITY = 19.6;
export const JUMP_VEL = 5.4;
export const WALK = 5.4;
export const SPRINT = 8.6;
export const CROUCH = 2.5;
export const EYE_STAND = 1.7;
export const EYE_CROUCH = 1.2;
export const HALF = Object.freeze({ x: 0.34, y: 0.9, z: 0.34 });
export const HALF_Y_CROUCH = 0.55;
export const STEP_H = 0.45;
export const MAX_FALL_SPEED = 24;
// Feet below this are out of the world (walked or jumped off the map): the
// player dies. Well below every floor; falling there takes about 2 s.
export const KILL_Y = -20;
// Landing faster than this hurts: a drop of about 3.4 m is free; more costs
// FALL_DAMAGE health per m/s over it, so a fall at full speed (about 15 m)
// is 100. Armour doesn't help.
export const SAFE_FALL_SPEED = 11.5;
export const FALL_DAMAGE = 8;

// The health a landing at `impact` m/s (stepMove's out.impact) costs.
export function fallDamage(impact) {
  return impact > SAFE_FALL_SPEED ? Math.round((impact - SAFE_FALL_SPEED) * FALL_DAMAGE) : 0;
}

// `pos` and `vel` only need x/y/z fields, so the client can pass its
// THREE.Vector3s and the server plain objects.
export function createMoveState(pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 }) {
  return {
    pos, // feet
    vel, // horizontal velocity (x, z); vertical lives in vy
    vy: 0,
    yaw: Math.PI, // radians; yaw 0 moves forward along -Z, π along +Z
    grounded: false,
    surface: 'concrete',
    crouching: false,
    sprinting: false,
    eye: EYE_STAND,
    half: { ...HALF },
    prevCenterY: 0,
  };
}

// scratch (reused; no per-step allocation)
const _delta = { x: 0, y: 0, z: 0 };
const _center = { x: 0, y: 0, z: 0 };
const _probe = { x: 0, y: 0, z: 0 };

// True if the standing box fits at the feet position (crouch release check).
export function hasHeadroom(state, world) {
  _probe.x = state.pos.x;
  _probe.y = state.pos.y + HALF.y;
  _probe.z = state.pos.z;
  return !world.overlaps(_probe, HALF);
}

// Puts the feet straight down onto the highest floor beneath them (a spawn
// dropped in from above), standing still.
export function settle(state, world) {
  _center.x = state.pos.x;
  _center.y = state.pos.y + state.half.y;
  _center.z = state.pos.z;
  _delta.x = _delta.y = _delta.z = 0;
  const res = world.moveCharacter(_center, state.half, _delta, STEP_H);
  state.pos.y = _center.y - state.half.y;
  state.prevCenterY = _center.y;
  state.vy = 0;
  state.grounded = res.grounded;
  state.surface = res.surface;
  return state;
}

// Advances `state` by one fixed step of `h` seconds.
//   input: { forward: -1..1, right: -1..1, jump (pressed this step),
//            crouch, sprint, ads: 0..1 }
//   out:   reused result { hasWish, landed, impact } for presentation
//          (footsteps, landing shake/sound); gameplay reads `state`.
// Deterministic: the same input over the same world gives the same state,
// bit for bit, on the client and the server (tests/movement.test.js).
export function stepMove(state, input, h, world, out) {
  const f = input.forward;
  const r = input.right;
  // wish direction from keys, relative to yaw
  const sinY = Math.sin(state.yaw);
  const cosY = Math.cos(state.yaw);
  let wx = 0 + -sinY * f;
  let wy = 0 + 0 * f;
  let wz = 0 + -cosY * f;
  wx += cosY * r;
  wy += 0 * r;
  wz += -sinY * r;
  const hasWish = wx * wx + wy * wy + wz * wz > 0;
  if (hasWish) {
    const inv = 1 / (Math.sqrt(wx * wx + wy * wy + wz * wz) || 1);
    wx *= inv;
    wz *= inv;
  }

  state.crouching = input.crouch || (state.crouching && !hasHeadroom(state, world));
  state.sprinting = input.sprint && f > 0 && !state.crouching && input.ads < 0.3;
  const speed = state.crouching ? CROUCH : state.sprinting ? SPRINT : WALK;

  // horizontal accel (snappier on ground, loose in air)
  const accel = state.grounded ? (hasWish ? 14 : 10) : 1.5;
  const k = Math.min(1, h * accel);
  const vel = state.vel;
  vel.x += (wx * speed - vel.x) * k;
  vel.z += (wz * speed - vel.z) * k;

  // jump
  if (input.jump && state.grounded) {
    state.vy = JUMP_VEL;
    state.grounded = false;
  }
  if (!state.grounded) {
    state.vy -= GRAVITY * h;
    state.vy = Math.max(state.vy, -MAX_FALL_SPEED);
  }

  // integrate through the collision world (it works on the box CENTER)
  const pos = state.pos;
  const half = state.half;
  _delta.x = vel.x * h;
  _delta.y = state.vy * h;
  _delta.z = vel.z * h;
  _center.x = pos.x;
  _center.y = pos.y + half.y;
  _center.z = pos.z;
  // on the ground, follow it down stairs; in the air, fall until we land
  const res = world.moveCharacter(_center, half, _delta, STEP_H, state.grounded ? STEP_H : 0);
  pos.x = _center.x;
  pos.y = _center.y - half.y; // feet = center - half.y
  pos.z = _center.z;

  const wasGrounded = state.grounded;
  state.grounded = res.grounded;
  state.surface = res.surface;
  out.hasWish = hasWish;
  out.landed = false;
  out.impact = 0;
  if (state.grounded) {
    if (!wasGrounded && state.vy < -4) {
      out.landed = true;
      out.impact = -state.vy;
    }
    state.vy = 0;
  } else if (state.vy > 0 && _center.y < state.prevCenterY - 0.001) {
    state.vy = 0; // head bump
  }
  state.prevCenterY = _center.y;

  // eye height (smooth crouch; box shrinks from the top so feet stay put)
  const targetEye = state.crouching ? EYE_CROUCH : EYE_STAND;
  state.eye += (targetEye - state.eye) * Math.min(1, h * 12);
  const targetHalfY = state.crouching ? HALF_Y_CROUCH : HALF.y;
  half.y += (targetHalfY - half.y) * Math.min(1, h * 12);
  return out;
}
