// player/index.js — the first-person camera and movement state machine.
//
// Owns ctx.camera. Movement (walk/run/crouch/jump, air control, auto-step)
// runs in fixedUpdate at 120 Hz against the physics system; look, bob, recoil
// decay, FOV and lean run in update(). Emits player:state, player:footstep
// and player:land so fx/audio can react. Everything is deterministic — no
// Math.random, no per-frame allocation beyond preallocated scratch vectors.
//
// Collision model: this.pos is the FEET position. The AABB center handed to
// physics is pos + half.y, and the camera sits at pos + eye. That keeps the
// feet planted on the ground while the box shrinks/grows with crouch.

import * as THREE from 'three';

const GRAVITY = 19.6;
const JUMP_VEL = 5.4;
const WALK = 5.4;
const SPRINT = 8.6;
const CROUCH = 2.5;
const EYE_STAND = 1.7;
const EYE_CROUCH = 1.2;
const HALF = { x: 0.34, y: 0.9, z: 0.34 };
const STEP_H = 0.45;

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
    this.vy = 0;
    this.yaw = Math.PI; // face -Z (toward the plaza from z=16)
    this.pitch = 0;
    this.lean = 0;
    this.grounded = false;
    this.surface = 'concrete';
    this.crouching = false;
    this.sprinting = false;
    this.ads = 0; // 0..1, driven by weapons
    this.eye = EYE_STAND;
    this.half = { ...HALF };
    this.lastAim = { dx: 0, dy: 0 };
    this._shake = 0;
    this._recoilPitch = 0;
    this._recoilYaw = 0;
    this._fovPunch = 0;
    this._bobPhase = 0;
    this._stepAcc = 0;
    this._stateT = 0;
    this._prevCenterY = 0;

    // scratch (reused; no per-frame allocation)
    this._e = new THREE.Euler();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._delta = { x: 0, y: 0, z: 0 };
    this._center = { x: 0, y: 0, z: 0 };
    this._probe = { x: 0, y: 0, z: 0 };

    // spawn: drop onto the plaza near the fountain
    this.pos.set(6, 60, 16);
    this.vy = 0;
    this.eye = EYE_STAND;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);

    // health + damage (enemy rounds arrive via damage:dealt with target
    // 'player'; the damage is applied HERE, by the target's own listener)
    this.health = 100;
    this.dead = false;
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
    const inp = ctx.input;
    // wish direction from keys, relative to yaw
    const f = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    const r = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    this._fwd.set(-sinY, 0, -cosY);
    this._right.set(cosY, 0, -sinY);
    this._wish.set(0, 0, 0)
      .addScaledVector(this._fwd, f)
      .addScaledVector(this._right, r);
    const hasWish = this._wish.lengthSq() > 0;
    if (hasWish) this._wish.normalize();

    this.crouching = inp.isDown('crouch') || (this.crouching && !this._hasHeadroom());
    const wantSprint = inp.isDown('sprint') && f > 0 && !this.crouching && this.ads < 0.3;
    this.sprinting = wantSprint;
    const speed = this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;

    // horizontal accel (snappier on ground, loose in air)
    const accel = this.grounded ? (hasWish ? 14 : 10) : 1.5;
    const k = Math.min(1, h * accel);
    this.vel.x += (this._wish.x * speed - this.vel.x) * k;
    this.vel.z += (this._wish.z * speed - this.vel.z) * k;

    // jump
    if (inp.justPressed('jump') && this.grounded) {
      this.vy = JUMP_VEL;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * h;
      this.vy = Math.max(this.vy, -24);
    }

    // integrate through physics (physics works on the box CENTER)
    this._delta.x = this.vel.x * h;
    this._delta.y = this.vy * h;
    this._delta.z = this.vel.z * h;
    this._center.x = this.pos.x;
    this._center.y = this.pos.y + this.half.y;
    this._center.z = this.pos.z;
    const res = this.physics.moveCharacter(this._center, this.half, this._delta, STEP_H);
    this.pos.x = this._center.x;
    this.pos.y = this._center.y - this.half.y; // feet = center - half.y
    this.pos.z = this._center.z;

    const wasGrounded = this.grounded;
    this.grounded = res.grounded;
    this.surface = res.surface;
    if (this.grounded) {
      if (!wasGrounded && this.vy < -4) {
        // landed
        const impact = -this.vy;
        ctx.events.emit('player:land', { velocity: impact, surface: this.surface });
        this.addShake(Math.min(0.6, impact * 0.05));
      }
      this.vy = 0;
    } else if (this.vy > 0 && this._center.y < this._prevCenterY - 0.001) {
      this.vy = 0; // head bump
    }
    this._prevCenterY = this._center.y;

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

    // eye height (smooth crouch; box shrinks from the top so feet stay put)
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, h * 12);
    const targetHalfY = this.crouching ? 0.55 : HALF.y;
    this.half.y += (targetHalfY - this.half.y) * Math.min(1, h * 12);

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

    // death / respawn
    if (this.dead) {
      this._deathT += dt;
      if (this._deathT > 3) {
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

  _hasHeadroom() {
    // test the standing box at the feet position
    this._probe.x = this.pos.x;
    this._probe.y = this.pos.y + HALF.y;
    this._probe.z = this.pos.z;
    return !this.physics.overlaps(this._probe, HALF);
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
  }
}
