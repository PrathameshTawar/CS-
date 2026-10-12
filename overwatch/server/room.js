// server/room.js — one authoritative match: players, inputs, simulation,
// snapshots. No sockets here (index.js owns those), so it is unit-testable.
//
// Simulation model:
// - Every player is stepped with shared/movement.js at TICK_RATE, the same
//   step and rate the client predicts with, so a client that sent the same
//   inputs lands on the same position.
// - A player only moves when their inputs arrive (one input = one step). A
//   backgrounded tab stops sending and simply stands still.
// - Each tick grants every player one step of credit (capped). Inputs beyond
//   the credit wait in a bounded queue, so a client can never move faster
//   than real time (no speed hacks), only catch up after jitter.

import { CollisionWorld } from '../shared/collision.js';
import { createMoveState, stepMove } from '../shared/movement.js';
import {
  MAX_PLAYERS_PER_ROOM,
  MAX_INPUTS_PER_MESSAGE,
  PL_CROUCH,
  PL_GROUNDED,
  TICK_RATE,
  packState,
  readInput,
} from '../shared/protocol.js';

const H = 1 / TICK_RATE;
const MAX_CREDIT = TICK_RATE / 4; // 250 ms of catch-up after a stall
const MAX_QUEUE = TICK_RATE / 2; // inputs waiting beyond credit; older ones are dropped

// Spawn points on open ground around the plaza; tests check each one lands on
// the street level. Players spawn high and the mover drops them onto the
// surface below, exactly like single player.
export const SPAWNS = [
  [6, 16], [-6, 16], [16, 6], [16, -6],
  [6, -16], [-6, -16], [-16, 6], [-16, -6],
];
const SPAWN_HEIGHT = 60;
const IDLE = Object.freeze({ forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 });

export class Room {
  constructor(name, colliders, { seed, maxPlayers = MAX_PLAYERS_PER_ROOM } = {}) {
    this.name = name;
    this.seed = seed;
    this.maxPlayers = maxPlayers;
    this.world = new CollisionWorld(colliders);
    this.players = new Map();
    this.tick = 0;
    this._nextId = 1;
    this._nextSpawn = 0;
    this._out = { hasWish: false, landed: false, impact: 0 };
  }

  get size() {
    return this.players.size;
  }

  // Adds a player; returns it, or null when the room is full.
  join(name) {
    if (this.players.size >= this.maxPlayers) return null;
    const [x, z] = SPAWNS[this._nextSpawn++ % SPAWNS.length];
    const player = {
      id: this._nextId++,
      name,
      move: createMoveState({ x, y: SPAWN_HEIGHT, z }, { x: 0, y: 0, z: 0 }),
      pitch: 0,
      queue: [],
      credit: 0,
      lastSeq: -1,
      dropped: 0,
    };
    // settle onto the ground with one idle step (not a client input), so the
    // first snapshot already shows the player standing at the spawn
    stepMove(player.move, IDLE, H, this.world, this._out);
    this.players.set(player.id, player);
    return player;
  }

  leave(id) {
    return this.players.delete(id);
  }

  // Queues a batch of wire inputs. Returns false if the batch is malformed
  // (the caller should drop the client). Old or duplicate seqs are ignored.
  receiveInputs(id, batch) {
    const p = this.players.get(id);
    if (!p) return false;
    if (!Array.isArray(batch) || batch.length > MAX_INPUTS_PER_MESSAGE) return false;
    const queuedSeq = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
    let last = queuedSeq;
    for (const raw of batch) {
      const input = readInput(raw);
      if (!input) return false;
      if (input.seq <= last) continue; // resend or out of order
      p.queue.push(input);
      last = input.seq;
    }
    if (p.queue.length > MAX_QUEUE) {
      p.dropped += p.queue.length - MAX_QUEUE;
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
    }
    return true;
  }

  // One authoritative tick.
  step() {
    this.tick++;
    for (const p of this.players.values()) {
      p.credit = Math.min(MAX_CREDIT, p.credit + 1);
      while (p.credit >= 1 && p.queue.length) {
        const input = p.queue.shift();
        p.credit -= 1;
        p.move.yaw = input.yaw;
        p.pitch = input.pitch;
        stepMove(p.move, input, H, this.world, this._out);
        p.lastSeq = input.seq;
      }
    }
  }

  // Snapshot for one recipient: their exact state plus everyone else.
  snapshotFor(id) {
    const me = this.players.get(id);
    if (!me) return null;
    const players = [];
    for (const p of this.players.values()) {
      if (p.id === id) continue;
      const m = p.move;
      players.push([
        p.id,
        round(m.pos.x), round(m.pos.y), round(m.pos.z),
        round(m.yaw), round(p.pitch),
        (m.crouching ? PL_CROUCH : 0) | (m.grounded ? PL_GROUNDED : 0),
        p.name,
      ]);
    }
    return { t: 'snap', tick: this.tick, ack: me.lastSeq, you: packState(me.move), players };
  }
}

// Others are only drawn, so millimetres are plenty.
const round = (v) => Math.round(v * 1000) / 1000;
