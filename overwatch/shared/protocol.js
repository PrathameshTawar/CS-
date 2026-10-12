// shared/protocol.js — the multiplayer wire protocol (client <-> server).
//
// JSON text frames over one WebSocket. The server is authoritative: clients
// send only their inputs (one per 120 Hz fixed step, batched), the server
// steps everyone with shared/movement.js and sends snapshots back. View
// angles (yaw/pitch) are the only client-owned state, as in every FPS.
//
//   client -> server
//     { t: 'hello', v, name, room }             first message, once
//     { t: 'input', i: [[seq, f, r, flags, yaw, pitch], ...] }
//     { t: 'ping', c }                          c: client clock (ms)
//   server -> client
//     { t: 'welcome', id, seed, room, tick }
//     { t: 'snap', tick, ack, you, players }    ack: last input seq applied
//     { t: 'pong', c }
//     { t: 'error', code, message }             then the socket closes
//
// `you` is the recipient's full movement state (see packState) so the client
// can rewind to it and replay unacknowledged inputs. `players` holds every
// OTHER player as [id, x, y, z, yaw, pitch, flags, name].

export const PROTOCOL_VERSION = 1;
export const TICK_RATE = 120; // server steps per second; equals the client's FIXED_STEP
export const SNAPSHOT_EVERY = 6; // ticks between snapshots (20 Hz)
export const INPUT_SEND_EVERY = 4; // client fixed steps per input batch (30 Hz)
export const MAX_PLAYERS_PER_ROOM = 10;
export const MAX_INPUTS_PER_MESSAGE = 32;
export const MAX_MESSAGE_BYTES = 4096;

// input flags
export const IN_JUMP = 1;
export const IN_CROUCH = 2;
export const IN_SPRINT = 4;
export const IN_ADS = 8;

// player flags in snapshots
export const PL_CROUCH = 1;
export const PL_GROUNDED = 2;

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
  if (!Number.isInteger(flags) || flags < 0 || flags > 15) return null;
  if (!isAngle(yaw) || !isAngle(pitch)) return null;
  return {
    seq,
    forward: f,
    right: r,
    jump: (flags & IN_JUMP) !== 0,
    crouch: (flags & IN_CROUCH) !== 0,
    sprint: (flags & IN_SPRINT) !== 0,
    ads: flags & IN_ADS ? 1 : 0,
    yaw,
    pitch: Math.max(-1.5, Math.min(1.5, pitch)),
  };
}

export function writeInput(seq, input, yaw, pitch) {
  const flags =
    (input.jump ? IN_JUMP : 0) |
    (input.crouch ? IN_CROUCH : 0) |
    (input.sprint ? IN_SPRINT : 0) |
    (input.ads >= 0.3 ? IN_ADS : 0);
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
