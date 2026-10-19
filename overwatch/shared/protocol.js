// shared/protocol.js — the multiplayer wire protocol (client <-> server).
//
// JSON text frames over one WebSocket. The server is authoritative: clients
// send only their inputs (one per 120 Hz fixed step, batched), the server
// steps everyone with shared/movement.js and sends snapshots back. View
// angles (yaw/pitch) are the only client-owned state, as in every FPS.
//
//   client -> server
//     { t: 'hello', v, name, room, mode? }      first message, once; mode
//                                               ('bomb' | 'teams' | 'dm')
//                                               applies when the hello
//                                               creates the room
//     { t: 'input', i: [[seq, f, r, flags, yaw, pitch], ...],
//       f?: [[seq, ox, oy, oz, dx, dy, dz, viewTick], ...],   shots
//       r?: [seq, ...],                                       reload starts
//       w?: [[seq, slot], ...],                               weapon switches
//       n?: [[seq, type, ox, oy, oz, dx, dy, dz, lob], ...] }  grenade throws
//                                                (type: index in GRENADE_IDS,
//                                                d: unit aim, lob: 0 | 1)
//     { t: 'buy', w }                           buy weapon or gear id w (shared/weapons.js)
//     { t: 'sell', w }                          sell back weapon id w
//     { t: 'ping', c }                          c: client clock (ms)
//   server -> client
//     { t: 'welcome', id, seed, room, tick }
//     { t: 'snap', tick, ack, you, me, players, ev }
//     { t: 'pong', c }
//     { t: 'error', code, message }             then the socket closes
//
// Shots, reloads and switches carry the seq of the input step they happen BEFORE, so
// the server resolves them against exactly the state the client fired from.
// `viewTick` is the server tick the shooter was looking at (remote players
// are drawn in the past); the server rewinds targets to it (lag
// compensation), at most MAX_REWIND_TICKS back.
//
// Snapshot: `ack` is the last input seq applied. `you` is the recipient's full
// movement state (see packState) so the client can rewind to it and replay
// unacknowledged inputs; `me` is [hp, dead, ammo, reserve, kills, deaths,
// spawns, team, money, slot, primary, secondary, buy, armor, helmet, kit,
// useKind, useProgress] where ammo/reserve are the held weapon's,
// primary/secondary are [weaponId, ammo, reserve] (primary null when empty),
// buy is BUY_* flags, useKind is USE_* (planting or defusing right now),
// useProgress 0..1 and nades [he, flash, smoke] grenades carried. `players` holds every
// OTHER player as [id, x, y, z, yaw, pitch, flags, name, kills, deaths,
// team, heldWeaponId]. `game` is [phase, phaseEndsTick, round, scoreAlpha,
// scoreBravo, lastRoundWinner, roundsToWin, deathmatch, buyUntilTick,
// attackingTeam, bomb, mode] where bomb is [state (shared/bomb.js BOMB_*),
// x, y, z, site, carrierId] or null outside Bomb Defusal (only attackers
// are told where a carried bomb is, and by whom). `ev` lists events since
// the recipient's last snapshot (EV_* below).

export const PROTOCOL_VERSION = 6;
export const TICK_RATE = 120; // server steps per second; equals the client's FIXED_STEP
export const SNAPSHOT_EVERY = 6; // ticks between snapshots (20 Hz)
export const INPUT_SEND_EVERY = 4; // client fixed steps per input batch (30 Hz)
export const MAX_PLAYERS_PER_ROOM = 10;
export const MAX_INPUTS_PER_MESSAGE = 32;
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_SHOTS_PER_MESSAGE = 8;
export const MAX_REWIND_TICKS = 48; // 400 ms: RTT/2 + the 100 ms interpolation delay

// input flags
export const IN_JUMP = 1;
export const IN_CROUCH = 2;
export const IN_SPRINT = 4;
export const IN_ADS = 8;
export const IN_USE = 16; // plant / defuse (held)

// player flags in snapshots
export const PL_CROUCH = 1;
export const PL_GROUNDED = 2;
export const PL_DEAD = 4;

// combat events in snapshots
export const EV_SHOT = 1; // [EV_SHOT, shooterId, ox, oy, oz, ex, ey, ez, weaponIndex]
export const EV_HIT = 2; // [EV_HIT, shooterId, targetId, damage, headshot, x, y, z]
export const EV_KILL = 3; // [EV_KILL, killerId (0: the world), victimId, headshot, weaponIndex (-1: fell, KILL_BY_BOMB: the bomb)]
export const EV_SPAWN = 4; // [EV_SPAWN, playerId]
export const EV_ROUND_END = 5; // [EV_ROUND_END, round, winnerTeam (-1 draw), reason]
export const EV_MATCH_END = 6; // [EV_MATCH_END, winnerTeam]
export const EV_BOMB = 7; // [EV_BOMB, BOMBEV_*, playerId (0: none), site]
export const EV_HALFTIME = 8; // [EV_HALFTIME, attackingTeam]: teams switch sides
// a grenade left someone's hand at server tick `tick`; everyone simulates
// the same flight (shared/grenades.js) from origin o with velocity v. Its
// first step is taken in `tick` itself: at tick T it has made T - tick + 1.
export const EV_NADE = 9; // [EV_NADE, nadeId, ownerId, type, ox, oy, oz, vx, vy, vz, tick, throwSeq]
export const EV_NADE_POP = 10; // [EV_NADE_POP, nadeId, type, x, y, z, ownerId]: it went off here

export const KILL_BY_BOMB = -2;
export const KILL_BY_HE = -3;
export const BOMBEV_PLANTED = 1;
export const BOMBEV_DEFUSED = 2;
export const BOMBEV_EXPLODED = 3;
export const BOMBEV_DROPPED = 4;
export const BOMBEV_PICKED = 5;

// what a player is doing with the use key (snapshot `me`)
export const USE_NONE = 0;
export const USE_PLANT = 1;
export const USE_DEFUSE = 2;

// snapshot `me` buy flags
export const BUY_OPEN = 1; // you can buy now (alive, buy time, in the buy zone)
export const BUY_FREE = 2; // purchases cost nothing (warmup, deathmatch)
export const BUY_SELL_PRIMARY = 4; // your primary was bought this round: it can be sold back
export const BUY_SELL_SECONDARY = 8;

// game modes (chosen by the hello that creates a room)
export const MODE_TEAMS = 'teams';
export const MODE_DM = 'dm';
export const MODE_BOMB = 'bomb'; // Bomb Defusal (team rounds on a map with bomb sites)

// teams (deathmatch players have team -1)
export const TEAM_NAMES = ['ALPHA', 'BRAVO'];

// match phases
export const PHASE_WARMUP = 0; // waiting for both teams; respawns on
export const PHASE_FREEZE = 1; // round start: placed at spawns, can't move or shoot
export const PHASE_LIVE = 2; // the round: no respawns
export const PHASE_END = 3; // round over, banner up
export const PHASE_MATCH_END = 4; // match over, scoreboard up, frozen

// why a round ended
export const END_ELIMINATION = 0;
export const END_TIME = 1;
export const END_FORFEIT = 2; // a team emptied out
export const END_BOMB = 3; // the bomb exploded
export const END_DEFUSED = 4;

export function encode(msg) {
  return JSON.stringify(msg);
}

// Parses a frame; returns null for anything that is not a JSON object with a
// string `t`, so handlers never see malformed input.
export function decode(data) {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return null;
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return null;
  return msg;
}

const isAxis = (v) => v === -1 || v === 0 || v === 1;
const isAngle = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6;

// Validates one wire input; returns a normalized copy or null. The server
// trusts nothing else from the client.
export function readInput(raw) {
  if (!Array.isArray(raw) || raw.length !== 6) return null;
  const [seq, f, r, flags, yaw, pitch] = raw;
  if (!Number.isInteger(seq) || seq < 0) return null;
  if (!isAxis(f) || !isAxis(r)) return null;
  if (!Number.isInteger(flags) || flags < 0 || flags > 31) return null;
  if (!isAngle(yaw) || !isAngle(pitch)) return null;
  return {
    seq,
    forward: f,
    right: r,
    jump: (flags & IN_JUMP) !== 0,
    crouch: (flags & IN_CROUCH) !== 0,
    sprint: (flags & IN_SPRINT) !== 0,
    ads: flags & IN_ADS ? 1 : 0,
    use: (flags & IN_USE) !== 0,
    yaw,
    pitch: Math.max(-1.5, Math.min(1.5, pitch)),
  };
}

const isCoord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4;

// Validates one wire shot; returns { seq, origin, dir, viewTick } or null.
// Range checks against the shooter's real state happen on the server.
export function readShot(raw) {
  if (!Array.isArray(raw) || raw.length !== 8) return null;
  const [seq, ox, oy, oz, dx, dy, dz, viewTick] = raw;
  if (!Number.isInteger(seq) || seq < 0) return null;
  if (![ox, oy, oz, dx, dy, dz].every(isCoord)) return null;
  if (typeof viewTick !== 'number' || !Number.isFinite(viewTick) || viewTick < 0) return null;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.9 || len > 1.1) return null;
  return { seq, origin: { x: ox, y: oy, z: oz }, dir: { x: dx / len, y: dy / len, z: dz / len }, viewTick };
}

// Validates one wire weapon switch [seq, slot]; returns { seq, slot } or null.
export function readSwitch(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [seq, slot] = raw;
  if (!Number.isInteger(seq) || seq < 0 || (slot !== 0 && slot !== 1)) return null;
  return { seq, slot };
}

// Validates one wire grenade throw; returns { seq, type, origin, dir, lob } or null.
export function readThrow(raw) {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  const [seq, type, ox, oy, oz, dx, dy, dz, lob] = raw;
  if (!Number.isInteger(seq) || seq < 0 || !Number.isInteger(type) || type < 0 || type > 2) return null;
  if (![ox, oy, oz, dx, dy, dz].every(isCoord) || (lob !== 0 && lob !== 1)) return null;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.9 || len > 1.1) return null;
  return { seq, type, origin: { x: ox, y: oy, z: oz }, dir: { x: dx / len, y: dy / len, z: dz / len }, lob: lob === 1 };
}

export function writeThrow(seq, type, origin, dir, lob) {
  return [seq, type, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, lob ? 1 : 0];
}

export function writeShot(seq, origin, dir, viewTick) {
  return [seq, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, Math.round(viewTick * 100) / 100];
}

export function writeInput(seq, input, yaw, pitch) {
  const flags =
    (input.jump ? IN_JUMP : 0) |
    (input.crouch ? IN_CROUCH : 0) |
    (input.sprint ? IN_SPRINT : 0) |
    (input.ads >= 0.3 ? IN_ADS : 0) |
    (input.use ? IN_USE : 0);
  return [seq, input.forward, input.right, flags, yaw, pitch];
}

// Names and rooms: short printable text only.
export function cleanLabel(value, fallback, max = 16) {
  if (typeof value !== 'string') return fallback;
  const s = value.replace(/[^\w\- ]+/g, '').trim().slice(0, max);
  return s || fallback;
}

// Full movement state of one player (shared/movement.js), exact floats so
// client reconciliation lands on the server's numbers.
export function packState(s) {
  return [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.z, s.vy, s.grounded ? 1 : 0, s.surface, s.crouching ? 1 : 0, s.sprinting ? 1 : 0, s.eye, s.half.y, s.prevCenterY];
}

// Writes a packed state back into a movement state (yaw stays client-owned).
export function unpackState(p, s) {
  s.pos.x = p[0];
  s.pos.y = p[1];
  s.pos.z = p[2];
  s.vel.x = p[3];
  s.vel.z = p[4];
  s.vy = p[5];
  s.grounded = p[6] === 1;
  s.surface = p[7];
  s.crouching = p[8] === 1;
  s.sprinting = p[9] === 1;
  s.eye = p[10];
  s.half.y = p[11];
  s.prevCenterY = p[12];
  return s;
}
