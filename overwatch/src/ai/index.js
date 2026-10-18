// ai/index.js — enemy soldiers.
//
// Procedural skinned humanoids (THREE.Skeleton + SkinnedMesh, no art assets)
// with a small cover AI: each soldier advances to a deterministic cover point,
// holds, and fires aimed bursts at the player when line of sight is clear.
// Soldiers register a dynamic 'flesh' hitbox with physics so player rounds hit
// them, and emit damage:dealt / actor:death for the HUD, FX and audio.
//
// Skinning: geometry is authored in rest pose (module TEMPLATE). Every soldier
// gets its OWN cloned bones so animations are independent. The mesh binds with
// an identity bind matrix inside an identity root group; bone inverses are
// computed from rest pose, and the OUTER group carries position + yaw — so the
// outer transform never disturbs the skinning math.
//
// Determinism: all randomness comes from a seeded rng fork. In shot mode the
// system freezes (soldiers hold their spawn pose, nothing fires), so headless
// captures stay bit-identical.

import * as THREE from 'three';
import { createSoldier, poseSoldier } from '../characters/soldier.js';

const SOLDIER_COUNT = 6;
const BURST_MIN = 3;
const BURST_MAX = 6;
const ROUND_INTERVAL = 0.085;
const PAUSE_MIN = 0.7;
const PAUSE_MAX = 1.5;
const MAX_RANGE = 55;
const MOVE_SPEED = 3.2;
const HP = 100;

// Deterministic cover points around the plaza (near benches, curbs, fountain).
const COVER_POINTS = [
  { x: 0, z: -6.5 }, // behind the fountain
  { x: 8.5, z: 8.5 }, { x: -8.5, z: 8.5 }, { x: 8.5, z: -8.5 }, { x: -8.5, z: -8.5 },
  { x: 17, z: 0 }, { x: -17, z: 0 }, { x: 0, z: 17 }, { x: 0, z: -17 },
  { x: 24, z: 24 }, { x: -24, z: 24 }, { x: 24, z: -24 }, { x: -24, z: -24 },
  { x: 27, z: 0 }, { x: -27, z: 0 }, { x: 0, z: 27 }, { x: 0, z: -27 },
];

// Deterministic spawn candidates (open plaza ring; verified against physics).
const SPAWN_CANDIDATES = [
  { x: 0, z: 12 }, { x: 8.5, z: 8.5 }, { x: 12, z: 0 }, { x: 8.5, z: -8.5 },
  { x: 0, z: -12 }, { x: -8.5, z: -8.5 }, { x: -12, z: 0 }, { x: -8.5, z: 8.5 },
  { x: 16, z: 16 }, { x: -16, z: 16 }, { x: 16, z: -16 }, { x: -16, z: -16 },
  { x: 20, z: 0 }, { x: 0, z: -20 }, { x: -20, z: 0 }, { x: 0, z: 20 },
];

const ARENA_SPAWNS = [
  { x: -14, z: -27 }, { x: -6, z: -28 }, { x: 0, z: -28 }, { x: 6, z: -28 }, { x: 14, z: -27 },
  { x: -14, z: -20 }, { x: 0, z: -18 }, { x: 14, z: -18 },
];

const ARENA_COVER = [
  { x: -18, z: -14 }, { x: -10, z: -5 }, { x: -14, z: 0 }, { x: -18, z: 12 },
  { x: 0, z: -4 }, { x: -4, z: -6 }, { x: 4, z: -6 }, { x: 0, z: 4 },
  { x: 17, z: -5 }, { x: 10, z: -16 }, { x: 17, z: 5 }, { x: 10, z: 16 },
];


export class AiSystem {
  static id = 'ai';
  static deps = ['physics', 'player', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.physics = ctx.get('physics');
    this.scene = ctx.scene;
    this.rng = ctx.rng.fork(0xa11ce);
    this.soldiers = [];
    this._subs = [];

    const materials = ctx.get('materials');
    const tint = this.rng.pick([0x525a3c, 0x5a5240, 0x4a4a3e, 0x3f4634, 0x55472f, 0x4b4f43]);
    this._mats = [
      materials.make('fabric', { tint, variant: 1, repeat: 1, size: 512 }),
      materials.make('fabric', { tint: 0xd9a97c, variant: 2, repeat: 1, size: 512 }),
      materials.make('paintedMetal', { tint: 0x2c2f33, variant: 2, repeat: 1, size: 512 }),
    ];

    // shared scratch (no per-frame allocation)
    this._camPos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._end = new THREE.Vector3();

    this._spawnSoldiers();
    this._wire();
  }

  _spawnSoldiers() {
    const half = { x: 0.35, y: 0.9, z: 0.35 };
    let placed = 0;
    for (const cand of SPAWN_CANDIDATES) {
      if (placed >= SOLDIER_COUNT) break;
      const center = { x: cand.x, y: half.y, z: cand.z };
      if (this.physics.overlaps(center, half)) continue; // inside a prop/curb
      if (Math.abs(cand.x) < 4.5 && Math.abs(cand.z) < 4.5) continue; // fountain
      this._spawnSoldier(cand.x, cand.z);
      placed++;
    }
  }

  _spawnSoldier(x, z) {
    const rng = this.rng.fork(0x50d + this.soldiers.length * 131);
    // nearest unclaimed cover point
    let cover = null;
    let bestD = Infinity;
    for (const c of COVER_POINTS) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bestD && !this._coverUsed(c)) {
        bestD = d;
        cover = c;
      }
    }
    if (!cover) cover = { x: -x, z: -z };

    const outer = new THREE.Group(); // carries position + yaw
    outer.position.set(x, 0, z);
    outer.rotation.y = Math.atan2(-x, -z); // face the plaza
    this.scene.add(outer);

    const { root, mesh, bones, skeleton } = createSoldier(this._mats);
    outer.add(root);
    this._skeleton = skeleton;

    // dynamic flesh hitbox — player rounds hit it via physics.raycast
    const box = {
      min: [x - 0.35, 0, z - 0.35],
      max: [x + 0.35, 1.8, z + 0.35],
      surface: 'flesh',
      actor: null,
    };
    this.physics.addDynamic(box);

    const soldier = {
      outer,
      root,
      mesh,
      bones,
      skeleton,
      box,
      pos: new THREE.Vector3(x, 0, z),
      vel: new THREE.Vector3(),
      hp: HP,
      cover,
      state: 'advance',
      phase: rng.nextFloat() * Math.PI * 2,
      animSpeed: 0,
      fireT: 0,
      burstLeft: 0,
      pauseT: 0,
      advanceT: 0,
      deathT: 0,
      dead: false,
      eye: new THREE.Vector3(),
      toPlayer: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      want: new THREE.Vector3(),
      half: { x: 0.35, y: 0.9, z: 0.35 },
      delta: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      muzzle: new THREE.Vector3(),
    };
    box.actor = soldier;
    this.soldiers.push(soldier);
    this._applyPose(soldier, 0);
  }

  _coverUsed(c) {
    for (const s of this.soldiers) {
      if (s.cover === c) return true;
    }
    return false;
  }

  _wire() {
    const e = this.ctx.events;
    // player rounds hitting flesh: resolve soldier, apply damage
    this._subs.push(
      e.on('bullet:impact', (p) => {
        if (p.surface !== 'flesh') return;
        const s = this._soldierAt(p.point);
        if (!s || s.dead) return;
        s.hp -= p.damage || 25;
        const killed = s.hp <= 0;
        e.emit('damage:dealt', {
          target: s,
          amount: p.damage || 25,
          headshot: p.point && p.point.y > 1.55,
          killed,
          point: p.point,
        });
        if (killed) this._kill(s, p.point, p.incident || new THREE.Vector3(0, 1, 0));
      }),
      // a grenade (single player): damage falls off with distance; walls block it
      e.on('explosion', (p) => {
        for (const s of this.soldiers) {
          if (s.dead) continue;
          const b = s.box;
          const c = { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 };
          const at = { x: p.point.x, y: p.point.y + 0.3, z: p.point.z };
          const d = Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z);
          const amount = Math.round(p.damage * Math.max(0, 1 - d / p.radius));
          if (amount <= 0) continue;
          const wall = this.physics.raycastStatic(at, { x: (c.x - at.x) / d, y: (c.y - at.y) / d, z: (c.z - at.z) / d }, d);
          if (wall && wall.hit) continue;
          s.hp -= amount;
          const killed = s.hp <= 0;
          e.emit('damage:dealt', { target: s, amount, headshot: false, killed, point: c });
          if (killed) this._kill(s, c, new THREE.Vector3(c.x - at.x, 1, c.z - at.z).normalize());
        }
      }),
    );
  }

  _soldierAt(point) {
    for (const s of this.soldiers) {
      if (s.dead) continue;
      const b = s.box;
      if (
        point.x >= b.min[0] && point.x <= b.max[0] &&
        point.y >= b.min[1] && point.y <= b.max[1] &&
        point.z >= b.min[2] && point.z <= b.max[2]
      ) {
        return s;
      }
    }
    return null;
  }

  _kill(s, point, dir) {
    s.dead = true;
    s.state = 'dead';
    s.deathT = 0;
    this.physics.removeDynamic(s.box);
    this.ctx.events.emit('actor:death', { actor: s, point, impulse: dir });
  }

  // ----------------------------------------------------------------------
  // per-frame
  // ----------------------------------------------------------------------

  fixedUpdate(h, ctx) {
    if (ctx.config.shot) return; // frozen rig: captures stay bit-identical
    for (const s of this.soldiers) this._fixedStep(s, h, ctx);
  }

  _fixedStep(s, h, ctx) {
    if (s.dead) return;
    const p = ctx.get('player');
    s.eye.set(s.pos.x, 1.5, s.pos.z);
    s.toPlayer.set(p.pos.x, p.pos.y + 1.5, p.pos.z).sub(s.eye);
    const dist = s.toPlayer.length();
    const wantYaw = Math.atan2(s.toPlayer.x, s.toPlayer.z);

    if (s.state === 'advance') {
      s.advanceT += h;
      const c = s.cover;
      s.fwd.set(c.x - s.pos.x, 0, c.z - s.pos.z);
      const d = s.fwd.length();
      if (d < 0.8 || s.advanceT > 14) {
        s.state = 'hold';
        s.advanceT = 0;
      } else {
        s.fwd.divideScalar(Math.max(d, 1e-5));
        s.vel.x = s.fwd.x * MOVE_SPEED;
        s.vel.z = s.fwd.z * MOVE_SPEED;
        s.animSpeed = MOVE_SPEED;
      }
    } else {
      s.vel.x = 0;
      s.vel.z = 0;
      s.animSpeed = 0;
      const los = this._los(s);
      if (s.state === 'hold' && los && dist < MAX_RANGE && !ctx.get('player').dead) {
        s.state = 'fire';
        s.fireT = 0;
        s.burstLeft = BURST_MIN + Math.floor(this.rng.nextFloat() * (BURST_MAX - BURST_MIN + 1));
        s.pauseT = 0;
      } else if (s.state === 'fire') {
        s.fireT += h;
        if (s.burstLeft > 0 && s.fireT >= ROUND_INTERVAL) {
          s.fireT = 0;
          s.burstLeft--;
          this._fireRound(s, ctx, dist);
        } else if (s.burstLeft <= 0) {
          s.pauseT += h;
          if (s.pauseT >= PAUSE_MIN + this.rng.nextFloat() * (PAUSE_MAX - PAUSE_MIN)) {
            s.state = 'hold';
          }
        } else if (!los) {
          s.state = 'hold';
        }
      }
    }

    // smooth yaw toward the player while engaged
    const cur = s.outer.rotation.y;
    s.outer.rotation.y += shortestAngle(cur, wantYaw) * Math.min(1, h * (s.state === 'advance' ? 4 : 10));

    // integrate with physics (character move reuses the player's collision)
    s.delta.x = s.vel.x * h;
    s.delta.y = 0;
    s.delta.z = s.vel.z * h;
    s.center.x = s.pos.x;
    s.center.y = s.pos.y + s.half.y;
    s.center.z = s.pos.z;
    this.physics.moveCharacter(s.center, s.half, s.delta, 0.45);
    s.pos.x = s.center.x;
    s.pos.y = s.center.y - s.half.y;
    s.pos.z = s.center.z;

    s.outer.position.set(s.pos.x, s.pos.y, s.pos.z);

    // keep the hitbox glued to the body
    const b = s.box;
    b.min[0] = s.pos.x - 0.35;
    b.min[2] = s.pos.z - 0.35;
    b.max[0] = s.pos.x + 0.35;
    b.max[2] = s.pos.z + 0.35;
  }

  _los(s) {
    const p = this.ctx.get('player');
    this._camPos.set(p.pos.x, 1.5, p.pos.z);
    this._dir.set(this._camPos.x - s.eye.x, 0, this._camPos.z - s.eye.z);
    const dist = this._dir.length();
    if (dist < 1e-4) return true;
    this._dir.divideScalar(dist);
    const d = this.physics.raycastStatic(s.eye, this._dir, 1e6);
    if (!d.hit) return true;
    return d.distance > dist - 0.4;
  }

  _fireRound(s, ctx, dist) {
    const rng = this.rng;
    const spread = Math.min(0.05, 0.006 + dist * 0.0008);
    const a = rng.nextFloat() * Math.PI * 2;
    const r = Math.sqrt(rng.nextFloat()) * spread;
    s.muzzle.set(s.pos.x + Math.sin(s.outer.rotation.y) * 0.5, 1.45, s.pos.z + Math.cos(s.outer.rotation.y) * 0.5);
    const p = ctx.get('player');
    this._end.set(p.pos.x + Math.cos(a) * r * dist, p.pos.y + 1.5, p.pos.z + Math.sin(a) * r * dist);
    ctx.events.emit('bullet:tracer', { from: s.muzzle, to: this._end, speed: 700 });
    ctx.events.emit('actor:fire', { origin: s.muzzle }); // you hear where they shoot from

    const onTarget = this._los(s) && dist < MAX_RANGE && rng.nextFloat() > 0.22;
    if (onTarget) {
      const dmg = 8 + Math.floor(rng.nextFloat() * 4);
      ctx.events.emit('damage:dealt', {
        target: 'player',
        amount: dmg,
        headshot: rng.nextFloat() > 0.9,
        killed: false,
        point: { x: p.pos.x, y: p.pos.y + 1.4, z: p.pos.z },
      });
    }
  }

  update(dt, ctx) {
    if (ctx.config.shot) return; // frozen rig
    for (const s of this.soldiers) this._animate(s, dt);
  }

  _animate(s, dt) {
    if (s.dead) {
      s.deathT += dt;
      const k = Math.min(1, s.deathT / 0.45);
      s.outer.rotation.x = -k * Math.PI / 2;
      s.outer.position.y = -k * 0.85;
      if (s.deathT > 4) s.outer.visible = false;
      return;
    }
    s.phase += dt * (s.animSpeed > 0.5 ? 9 : 2.2);
    this._applyPose(s, s.phase);
  }

  _applyPose(s, phase) {
    poseSoldier(s.bones, phase, s.animSpeed > 0.5, s.state === 'fire');
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    for (const s of this.soldiers) {
      this.scene.remove(s.outer);
      this.physics.removeDynamic(s.box);
    }
    this.soldiers.length = 0;
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
