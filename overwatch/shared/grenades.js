// shared/grenades.js — grenades, shared by the server (which simulates and
// detonates them) and every client (which runs the same flight to draw it).
//
// The flight is deterministic: fixed steps, static colliders only, plain
// float math. Given the same throw (origin, velocity) and map, the server
// and every client land the grenade in exactly the same place, so a throw
// is sent once and nobody needs per-tick grenade updates.

export const GRENADES = Object.freeze({
  he: { id: 'he', name: 'HE Grenade', price: 300, max: 1, fuse: 1.6, radius: 8, damage: 98, armorPen: 0.5 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, max: 2, fuse: 1.6, radius: 30 },
  // a smoke pops once it has settled (or after `fuse` at the latest)
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, max: 1, fuse: 3, radius: 4, duration: 18 },
});
export const GRENADE_IDS = Object.freeze(['he', 'flash', 'smoke']); // wire order

export const THROW_SPEED = 17; // m/s, left click
export const LOB_SPEED = 8; // m/s, right click
export const MIN_THROW_INTERVAL = 0.6; // s between throws
export const STEP = 1 / 120; // simulation step (the server tick)
const GRAVITY = 15;
const BOUNCE = 0.45; // velocity kept along the surface normal
const FRICTION = 0.7; // velocity kept along the surface on a bounce
const RADIUS = 0.06; // m: how far off a surface the grenade rests
const REST_SPEED = 0.6; // m/s: slower than this on the ground = settled

export function grenadeIndex(id) {
  return GRENADE_IDS.indexOf(id);
}

// The velocity of a throw along unit `dir` (lobbed or full strength), plus
// a little of the thrower's own movement.
export function throwVelocity(dir, lob, carry = null) {
  const speed = lob ? LOB_SPEED : THROW_SPEED;
  const k = 0.5;
  return {
    x: dir.x * speed + (carry ? carry.x * k : 0),
    y: dir.y * speed + (lob ? 2 : 3),
    z: dir.z * speed + (carry ? carry.z * k : 0),
  };
}

export function createFlight(origin, vel) {
  return { x: origin.x, y: origin.y, z: origin.z, vx: vel.x, vy: vel.y, vz: vel.z, t: 0, settled: false };
}

const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };

// One fixed step of flight against `world` (anything with raycastStatic).
// Bounces off surfaces; comes to rest on the ground. Returns the flight.
export function stepFlight(f, world) {
  f.t += STEP;
  if (f.settled) return f;
  f.vy -= GRAVITY * STEP;
  const dx = f.vx * STEP;
  const dy = f.vy * STEP;
  const dz = f.vz * STEP;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return f;
  _o.x = f.x;
  _o.y = f.y;
  _o.z = f.z;
  _d.x = dx / len;
  _d.y = dy / len;
  _d.z = dz / len;
  const hit = world.raycastStatic(_o, _d, len + RADIUS);
  if (!hit || !hit.hit) {
    f.x += dx;
    f.y += dy;
    f.z += dz;
    return f;
  }
  // stop just short of the surface, reflect, lose energy
  const n = hit.normal;
  const back = Math.max(0, hit.distance - RADIUS);
  f.x += _d.x * back;
  f.y += _d.y * back;
  f.z += _d.z * back;
  const vn = f.vx * n.x + f.vy * n.y + f.vz * n.z;
  f.vx = (f.vx - vn * n.x) * FRICTION - vn * n.x * BOUNCE;
  f.vy = (f.vy - vn * n.y) * FRICTION - vn * n.y * BOUNCE;
  f.vz = (f.vz - vn * n.z) * FRICTION - vn * n.z * BOUNCE;
  if (n.y > 0.7 && Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz) < REST_SPEED) {
    f.vx = f.vy = f.vz = 0;
    f.settled = true;
  }
  return f;
}

// Has this grenade gone off? HE and flash on their fuse; a smoke once it
// has settled, or on its (longer) fuse.
export function shouldDetonate(type, f) {
  const g = GRENADES[type];
  if (type === 'smoke') return f.settled || f.t >= g.fuse;
  return f.t >= g.fuse;
}

// HE damage at distance d (before armour; walls block it entirely).
export function heDamage(d) {
  const g = GRENADES.he;
  return Math.round(g.damage * Math.max(0, 1 - d / g.radius));
}

// How long (seconds) a flash at `at` blinds someone whose eye is at `eye`
// looking along unit `look`. 0 when it's out of range or behind a wall
// (`blocked`). Facing it: up to 3.5 s; side-on ~1.5 s; behind you 0.25 s.
export function flashDuration(eye, look, at, blocked) {
  if (blocked) return 0;
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const range = GRENADES.flash.radius;
  if (d > range) return 0;
  const facing = d > 1e-6 ? (look.x * dx + look.y * dy + look.z * dz) / d : 1; // -1..1
  const angle = facing > 0.5 ? 1 : facing > -0.2 ? 0.45 : 0.07;
  const dist = 1 - (d / range) * 0.6;
  return 3.5 * angle * dist;
}
