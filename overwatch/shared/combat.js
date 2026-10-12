// shared/combat.js — the rifle's numbers, the bullet trace and player
// hitboxes. Shared by the client (weapons system: muzzle, impacts, predicted
// blood) and the server (the authority on hits and damage).

// rifle
export const RPM = 720;
export const FIRE_INTERVAL = 60 / RPM; // seconds between rounds
export const MAG_SIZE = 30;
export const RESERVE = 90;
export const RELOAD_TIME = 2.2; // full reload animation
export const RELOAD_REFILL_AT = 1.7; // the magazine is in at this point

// damage
export const MAX_HEALTH = 100;
export const BODY_DAMAGE = 34; // three body shots kill
export const HEAD_DAMAGE = 100; // one headshot kills
export const HEAD_ZONE = 0.3; // top of the hitbox that counts as the head (m)
export const RESPAWN_TIME = 3; // seconds

// player hitbox: slightly wider than the movement box so grazing shots count
export const HITBOX_HALF_X = 0.36;

// ballistics: hitscan along a gravity-dropped path (game feel, not physics)
const SPEED = 240; // m/s
export const MAX_RANGE = 220;
const DROP_G = 9.8 * 0.6;
const STEP = 0.5;

// scratch (reused; no per-shot allocation)
const _p0 = { x: 0, y: 0, z: 0 };
const _p1 = { x: 0, y: 0, z: 0 };
const _seg = { x: 0, y: 0, z: 0 };

// Traces a round from `origin` along unit `dir` with drop, in 0.5 m segments,
// against `world` (static boxes plus its dynamic boxes). Returns the world's
// shared raycast result (copy what you need) or null on a miss. The
// arithmetic mirrors the original weapon trace exactly.
export function traceShot(world, origin, dir) {
  _p0.x = origin.x;
  _p0.y = origin.y;
  _p0.z = origin.z;
  let s = 0;
  while (s < MAX_RANGE) {
    s = Math.min(s + STEP, MAX_RANGE);
    const t = s / SPEED;
    _p1.x = origin.x + dir.x * s;
    _p1.y = origin.y + dir.y * s;
    _p1.z = origin.z + dir.z * s;
    _p1.y -= 0.5 * DROP_G * t * t;
    _seg.x = _p1.x - _p0.x;
    _seg.y = _p1.y - _p0.y;
    _seg.z = _p1.z - _p0.z;
    const len = Math.sqrt(_seg.x * _seg.x + _seg.y * _seg.y + _seg.z * _seg.z);
    if (len < 1e-6) continue;
    const inv = 1 / len;
    _seg.x *= inv;
    _seg.y *= inv;
    _seg.z *= inv;
    const hit = world.raycast(_p0, _seg, len);
    if (hit && hit.hit) return hit;
    _p0.x = _p1.x;
    _p0.y = _p1.y;
    _p0.z = _p1.z;
    if (_p1.y < -5) break;
  }
  return null;
}

// Where a missed round ends (for tracers).
export function shotEndpoint(origin, dir, dist, out) {
  const t = dist / SPEED;
  out.x = origin.x + dir.x * dist;
  out.y = origin.y + dir.y * dist - 0.5 * DROP_G * t * t;
  out.z = origin.z + dir.z * dist;
  return out;
}

// Fills `box` (a {min, max} AABB) for a player standing with feet at
// (x, y, z) and collision half-height `halfY`.
export function playerHitbox(x, y, z, halfY, box) {
  box.min[0] = x - HITBOX_HALF_X;
  box.min[1] = y;
  box.min[2] = z - HITBOX_HALF_X;
  box.max[0] = x + HITBOX_HALF_X;
  box.max[1] = y + halfY * 2;
  box.max[2] = z + HITBOX_HALF_X;
  return box;
}

export function isHeadshot(box, pointY) {
  return pointY >= box.max[1] - HEAD_ZONE;
}
