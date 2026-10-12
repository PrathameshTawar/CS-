// player/index.js — the first-person camera and movement state machine.
//
// Owns ctx.camera. Movement (walk/run/crouch/jump, air control, auto-step)
// runs in fixedUpdate at 120 Hz through shared/movement.js — the same step
// the multiplayer server runs; look, bob, recoil decay, FOV and lean run in
// update(). Emits player:state, player:footstep and player:land so fx/audio
// can react. Everything is deterministic — no Math.random, no per-frame
// allocation beyond preallocated scratch vectors.
//
// Collision model: this.pos is the FEET position and the camera sits at
// pos + eye (see shared/movement.js).

import * as THREE from 'three';
import { createMoveState, stepMove, EYE_STAND, SPRINT } from '../../shared/movement.js';

export class PlayerSystem {
  static id = 'player';
  static deps = ['physics'];

  init(ctx) {
    this.ctx = ctx;
    this.physics = ctx.get('physics');
    this.camera = ctx.camera;
    this.rng = ctx.rng.fork(0x51a7e);

    this.pos = new THREE.Vector3(); // feet
    this.vel = new THREE.Vector3();
    // movement state (vy, yaw, grounded, surface, crouching, sprinting, eye,
    // half) lives here; the accessors below keep the public fields working.
    this.move = createMoveState(this.pos, this.vel);
    this._moveIn = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
    this._moveOut = { hasWish: false, landed: false, impact: 0 };
    this.pitch = 0;
    this.lean = 0;
    this.ads = 0; // 0..1, driven by weapons
    this.lastAim = { dx: 0, dy: 0 };
    this._shake = 0;
    this._recoilPitch = 0;
    this._recoilYaw = 0;
    this._fovPunch = 0;
    this._bobPhase = 0;
    this._stepAcc = 0;
    this._stateT = 0;

    // scratch (reused; no per-frame allocation)
    this._e = new THREE.Euler();
    this._right = new THREE.Vector3();

    // spawn: drop onto the plaza near the fountain
    this.pos.set(6, 60, 16);
    this.vy = 0;
    this.eye = EYE_STAND;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);

    // health + damage (enemy rounds arrive via damage:dealt with target
    // 'player'; the damage is applied HERE, by the target's own listener)
    this.health = 100;
    this.dead = false;
    // online, the server owns health, death and respawn (set by net)
    this.serverAuthority = false;
    this._deathT = 0;
    this._respawnAt = new THREE.Vector3(6, 60, 16);
    this._subs = [];
    const e = ctx.events;
    this._subs.push(
      e.on('damage:dealt', (p) => {
        if (!p || p.target !== 'player' || this.dead) return;
        this.health = Math.max(0, this.health - p.amount);
        e.emit('damage:taken', {
          amount: p.amount,
          from: p.point ? { x: p.point.x, y: p.point.y, z: p.point.z } : null,
          health: this.health,
        });
        if (this.health <= 0) this.dead = true;
      }),
    );
  }

  fixedUpdate(h, ctx) {
    // shot mode: the shotrig owns the camera; no physics (capture determinism)
    if (ctx.config.shot) return;
    // dead online: the server doesn't move us, so neither does prediction
    if (this.dead && this.serverAuthority) return;
    const inp = ctx.input;
    const mi = this._moveIn;
    mi.forward = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    mi.right = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    mi.jump = inp.justPressed('jump');
    mi.crouch = inp.isDown('crouch');
    mi.sprint = inp.isDown('sprint');
    mi.ads = this.ads;
    const res = stepMove(this.move, mi, h, this.physics, this._moveOut);
    const hasWish = res.hasWish;

    if (res.landed) {
      ctx.events.emit('player:land', { velocity: res.impact, surface: this.surface });
      this.addShake(Math.min(0.6, res.impact * 0.05));
    }

    // footsteps (distance-based)
    if (this.grounded && hasWish) {
      const hSpeed = Math.hypot(this.vel.x, this.vel.z);
      this._stepAcc += hSpeed * h;
      const stepDist = this.sprinting ? 3.4 : 2.2;
      if (this._stepAcc >= stepDist) {
        this._stepAcc = 0;
        ctx.events.emit('player:footstep', {
          position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
          surface: this.surface,
          running: this.sprinting,
        });
      }
    } else {
      this._stepAcc = 0;
    }

    // camera follows the body (bob applied in update)
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);

    // state event at 10 Hz
    this._stateT += h;
    if (this._stateT >= 0.1) {
      this._stateT = 0;
      ctx.events.emit('player:state', {
        stance: this.crouching ? 'crouch' : 'stand',
        sprinting: this.sprinting,
        sliding: false,
        ads: this.ads > 0.5,
      });
    }
  }

  update(dt, ctx) {
    // shot mode: camera pose is owned by the shotrig (capture determinism)
    if (ctx.config.shot) return;

    // death / respawn (online, the server respawns us)
    if (this.dead) {
      this._deathT += dt;
      if (this._deathT > 3 && !this.serverAuthority) {
        this.dead = false;
        this.health = 100;
        this._deathT = 0;
        this.pos.copy(this._respawnAt);
        this.vel.set(0, 0, 0);
        this.vy = 0;
      }
      return;
    }
    const inp = ctx.input;
    // look
    const aim = inp.consumeAim();
    const sens = ctx.config.mouseSensitivity;
    this.lastAim.dx = aim.dx;
    this.lastAim.dy = aim.dy;
    this.yaw -= aim.dx * sens;
    this.pitch -= aim.dy * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);

    // lean (Q/E)
    const leanIn = (inp.isDown('leanRight') ? 1 : 0) - (inp.isDown('leanLeft') ? 1 : 0);
    const leanTarget = leanIn * (this.ads < 0.4 ? 1 : 0.2);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 10);

    // recoil / shake / fov-punch decay
    const decay = Math.exp(-dt * 7);
    this._recoilPitch *= decay;
    this._recoilYaw *= decay;
    this._shake = Math.max(0, this._shake - dt * 1.6);
    this._fovPunch = Math.max(0, this._fovPunch - dt * 3.2);

    // head bob
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const bobAmp = this.grounded ? Math.min(1, hSpeed / SPRINT) : 0;
    this._bobPhase += dt * (6 + hSpeed * 1.2) * (1 - this.ads * 0.8);
    const bobX = Math.cos(this._bobPhase * 2) * 0.012 * bobAmp;
    const bobY = Math.abs(Math.sin(this._bobPhase)) * 0.014 * bobAmp;
    const bobRoll = Math.sin(this._bobPhase) * 0.004 * bobAmp;

    // camera shake (seeded; only draw when active so the rng fork stays quiet)
    const shA = this._shake;
    const shP = shA > 0.001 ? (this.rng.nextFloat() * 2 - 1) * 0.012 * shA : 0;
    const shY = shA > 0.001 ? (this.rng.nextFloat() * 2 - 1) * 0.012 * shA : 0;

    // compose camera orientation (YXZ, matching flycam conventions)
    this._e.set(
      this.pitch + this._recoilPitch + shP + bobY * 0.6,
      this.yaw + this._recoilYaw + shY,
      this.lean * 0.05 + bobRoll,
      'YXZ',
    );
    this.camera.quaternion.setFromEuler(this._e);

    // lean lateral offset + bob
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(
      this.pos.x + this._right.x * this.lean * 0.11 + bobX,
      this.pos.y + this.eye + bobY,
      this.pos.z + this._right.z * this.lean * 0.11,
    );

    // FOV: base + sprint kick + punch, minus ADS zoom (weapons drive ads)
    const base = ctx.config.fov;
    const target = base + (this.sprinting ? 4 : 0) + this._fovPunch * 3 - this.ads * (base - 52);
    const fov = this.camera.fov + (target - this.camera.fov) * Math.min(1, dt * 10);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- public API for weapons / fx ----

  applyRecoil(pitch, yaw) {
    this._recoilPitch += pitch;
    this._recoilYaw += yaw;
  }

  addShake(amount) {
    this._shake = Math.min(1.5, this._shake + amount);
  }

  addFovPunch(amount) {
    this._fovPunch += amount;
  }

  setAds(v) {
    this.ads = v;
  }

  getEyeWorld(out) {
    out.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    return out;
  }

  // The input the last fixed step moved with (reused object; copy it). The
  // net system sends it to the server and replays it when reconciling.
  get lastMoveInput() { return this._moveIn; }

  // ---- movement state accessors (state lives in this.move) ----

  get vy() { return this.move.vy; }
  set vy(v) { this.move.vy = v; }
  get yaw() { return this.move.yaw; }
  set yaw(v) { this.move.yaw = v; }
  get grounded() { return this.move.grounded; }
  get surface() { return this.move.surface; }
  get crouching() { return this.move.crouching; }
  get sprinting() { return this.move.sprinting; }
  get eye() { return this.move.eye; }
  set eye(v) { this.move.eye = v; }
  get half() { return this.move.half; }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
  }
}
