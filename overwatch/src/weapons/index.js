// weapons/index.js — the procedural rifle viewmodel and ballistics.
//
// Builds a rifle from primitives in ctx.viewScene (drawn after the world with
// a cleared depth buffer, so it never clips through walls). Handles ADS, spring
// recoil, sway/bob, procedural reload & inspect animation, and bullet
// ballistics with drop. Emits weapon:fire, weapon:shell, bullet:tracer and
// bullet:impact; reads player.applyRecoil/addShake/addFovPunch/setAds.
//
// Determinism: all visual randomness (spread, flash rotation, shell kick)
// comes from a seeded rng fork — no Math.random.

import * as THREE from 'three';

const RPM = 720;
const FIRE_INTERVAL = 60 / RPM;
const MAG_SIZE = 30;
const RESERVE = 90;
const RELOAD_TIME = 2.2;
const INSPECT_TIME = 1.7;

// viewmodel poses (view space: +X right, +Y up, -Z forward)
const REST_POS = new THREE.Vector3(0.32, -0.28, -0.52);
const ADS_POS = new THREE.Vector3(0, -0.175, -0.36);
const REST_ROT = new THREE.Euler(0.02, -0.03, 0.01);
const ADS_ROT = new THREE.Euler(0, 0, 0);

export class WeaponSystem {
  static id = 'weapons';
  static deps = ['player', 'physics', 'sky', 'render'];

  init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.physics = ctx.get('physics');
    this.viewScene = ctx.viewScene;
    this.viewCamera = ctx.viewCamera;
    this.rng = ctx.rng.fork(0x5a1f3);
    this._fireRng = this.rng.fork(0xf1e0);

    this.ammo = MAG_SIZE;
    this.reserve = RESERVE;
    this.reloading = false;
    this.ads = 0; // smoothed 0..1
    this._adsTarget = 0;
    this._fireCd = 0;
    this._spread = 0;
    this._reloadT = 0;
    this._inspectT = -1;
    this._magOut = false;

    // viewmodel springs (second-order damped springs for recoil)
    this._k = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    this._sway = { x: 0, y: 0, tx: 0, ty: 0 };
    this._bobPhase = 0;

    // scratch vectors (no per-frame allocation)
    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._seg = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._e = new THREE.Euler();

    this._buildWeapon();
    this._buildMuzzleFlash();
    this._buildHud();
    this._flashT = 0;

    // sync the viewmodel env map up front — shot mode early-returns in
    // update(), so init must carry the sky's IBL into the view scene too.
    const env = ctx.get('render').requestEnvMap();
    if (env) {
      this._env = env;
      this.viewScene.environment = env;
    }
  }

  // ------------------------------------------------------------------
  // viewmodel construction
  // ------------------------------------------------------------------

  _buildWeapon() {
    const m = this.ctx.get('materials');
    // shared materials
    this._matReceiver = m.make('paintedMetal', { tint: 0x2a2e34, variant: 0, repeat: 1, size: 512 });
    this._matHandguard = m.make('paintedMetal', { tint: 0x22262c, variant: 1, repeat: 1, size: 512 });
    this._matBarrel = m.make('paintedMetal', { tint: 0x16181d, variant: 2, repeat: 1, size: 512 });
    this._matDark = m.make('paintedMetal', { tint: 0x14161a, variant: 3, repeat: 1, size: 512 });
    this._matMag = m.make('paintedMetal', { tint: 0x1c1f24, variant: 4, repeat: 1, size: 512 });
    this._matGrip = m.make('fabric', { tint: 0x101216, variant: 0, repeat: 1, size: 512 });
    this._matGlow = this._mat(new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
    this._matBrass = this._mat(new THREE.MeshStandardMaterial({
      color: 0xc89b3f,
      metalness: 0.9,
      roughness: 0.32,
      envMapIntensity: 1.2,
    }));

    this._root = new THREE.Group();
    this.viewScene.add(this._root);

    const g = this._root;
    // receiver body
    this._box(0.075, 0.085, 0.34, this._matReceiver, 0, 0, 0);
    // upper rail
    this._box(0.04, 0.018, 0.3, this._matDark, 0, 0.05, 0);
    // barrel
    this._cyl(0.012, 0.4, this._matBarrel, 0, 0.02, -0.3, true);
    // muzzle brake
    this._cyl(0.016, 0.06, this._matDark, 0, 0.02, -0.49, true);
    // handguard (with vents)
    this._box(0.052, 0.06, 0.22, this._matHandguard, 0, 0.02, -0.2);
    this._box(0.056, 0.02, 0.2, this._matDark, 0, 0.005, -0.2);
    // gas block + front sight post
    this._box(0.024, 0.032, 0.03, this._matDark, 0, 0.035, -0.36);
    this._box(0.01, 0.045, 0.012, this._matDark, 0, 0.075, -0.36);
    // rear sight
    this._box(0.02, 0.035, 0.06, this._matDark, 0, 0.07, 0.05);
    // stock
    this._box(0.06, 0.075, 0.2, this._matHandguard, 0, 0.0, 0.22);
    this._box(0.055, 0.05, 0.08, this._matDark, 0, -0.01, 0.32);
    // pistol grip (angled)
    const grip = this._box(0.045, 0.09, 0.05, this._matGrip, 0, -0.07, 0.08);
    grip.rotation.x = -0.28;
    // magazine (reference for reload anim)
    this._magMesh = this._box(0.048, 0.13, 0.07, this._matMag, 0, -0.09, -0.03);
    this._magMesh.rotation.x = 0.14;
    this._magBase = this._magMesh.position.clone();
    // trigger guard + trigger
    this._box(0.012, 0.03, 0.1, this._matDark, 0, -0.055, 0.0);
    this._box(0.008, 0.02, 0.02, this._matBrass, 0, -0.04, -0.01);
    // charging handle
    this._box(0.018, 0.022, 0.05, this._matDark, 0, 0.06, 0.06);
    // iron-sight glow dot (tiny emissive)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), this._matGlow);
    dot.position.set(0, 0.075, 0.03);
    g.add(dot);

    // lights for the view scene (fixed set — never culled, no permutation churn)
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.2, 1.6, 1.8);
    const fill = new THREE.DirectionalLight(0x9ab8ff, 0.7);
    fill.position.set(-1.6, 0.4, 0.6);
    const rim = new THREE.DirectionalLight(0xffc890, 0.5);
    rim.position.set(-0.6, -1.2, -1.4);
    this.viewScene.add(key, fill, rim);
    // env map for metal reflections (re-synced each frame if it changes)
    this._env = null;
    this._lights = [key, fill, rim];

    this._root.position.copy(REST_POS);
    this._root.rotation.copy(REST_ROT);
  }

  _box(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    this._root.add(mesh);
    return mesh;
  }

  _cyl(r, len, mat, x, y, z, horiz) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    mesh.position.set(x, y, z);
    if (horiz) mesh.rotation.x = Math.PI / 2;
    this._root.add(mesh);
    return mesh;
  }

  _mat(material) {
    this._mats = this._mats || [];
    this._mats.push(material);
    return material;
  }

  _buildMuzzleFlash() {
    // radial flash sprite + a point light that pulses
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,220,150,0.95)');
    grad.addColorStop(0.55, 'rgba(255,140,40,0.5)');
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);

    this._flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }));
    this._flash.position.set(0, 0.02, -0.55);
    this._flash.scale.set(0.22, 0.22, 1);
    this._root.add(this._flash);

    this._flashLight = new THREE.PointLight(0xffb060, 0, 6, 2);
    this._flashLight.position.set(0, 0.02, -0.55);
    this._root.add(this._flashLight);
  }

  _buildHud() {
    const el = document.createElement('div');
    el.id = 'hud-weapon';
    el.style.cssText =
      'position:fixed;right:24px;bottom:20px;z-index:30;text-align:right;' +
      'font:600 15px/1.2 ui-monospace,Consolas,monospace;color:#e8ecf2;' +
      'text-shadow:0 1px 3px rgba(0,0,0,.9);pointer-events:none;' +
      'font-variant-numeric:tabular-nums;';
    el.innerHTML =
      '<div id="w-ammo" style="font-size:34px;letter-spacing:1px;">30</div>' +
      '<div id="w-reserve" style="color:#9aa4b2;font-size:12px;">90</div>' +
      '<div id="w-reload" style="color:#ffb347;font-size:11px;letter-spacing:2px;opacity:0;height:14px;"></div>';
    document.body.appendChild(el);
    this._hud = el;
    this._hudAmmo = el.querySelector('#w-ammo');
    this._hudReserve = el.querySelector('#w-reserve');
    this._hudReload = el.querySelector('#w-reload');
  }

  // ------------------------------------------------------------------
  // firing + ballistics
  // ------------------------------------------------------------------

  fire(origin, dir) {
    if (this.ammo <= 0 || this.reloading || this._inspectT >= 0) return;
    if (this._fireCd > 0) return;
    this._fireCd = FIRE_INTERVAL;
    this.ammo--;

    // recoil: kick the viewmodel spring + push the camera
    const rng = this._fireRng;
    this._k.vx += 0.09 + rng.nextFloat() * 0.03;
    this._k.vy += (rng.nextFloat() - 0.5) * 0.02;
    this._k.vz += 0.012 + rng.nextFloat() * 0.004;
    this.player.applyRecoil(0.0045 + rng.nextFloat() * 0.0015, (rng.nextFloat() - 0.5) * 0.004);
    this.player.addShake(0.28);
    this.player.addFovPunch(0.5);

    // muzzle flash (seeded scale)
    this._flashT = 0.05;
    this._flash.material.opacity = 0.95;
    const s = 0.18 + rng.nextFloat() * 0.12;
    this._flash.scale.set(s, s, 1);
    this._flashLight.intensity = 60 + rng.nextFloat() * 40;

    // ballistics: ray with drop, surface-tagged hits
    const hit = this._trace(origin, dir);
    const end = hit ? hit.point : this._endpoint(origin, dir, 200);
    this.ctx.events.emit('bullet:tracer', { from: origin, to: end, speed: 800 });
    if (hit) {
      this.ctx.events.emit('bullet:impact', {
        point: hit.point,
        normal: hit.normal,
        surface: hit.surface,
        incident: dir,
        damage: 34,
      });
    }

    // eject a shell (offset behind the ejection port)
    const up = this._up.set(0, 1, 0).applyQuaternion(this.ctx.camera.quaternion);
    const right = this._right.set(1, 0, 0).applyQuaternion(this.ctx.camera.quaternion);
    this.ctx.events.emit('weapon:shell', {
      position: {
        x: origin.x + up.x * 0.02,
        y: origin.y + up.y * 0.02,
        z: origin.z + up.z * 0.02,
      },
      velocity: {
        x: right.x * 0.9 + (rng.nextFloat() - 0.5) * 0.4,
        y: 1.1 + rng.nextFloat() * 0.6,
        z: right.z * 0.9 + (rng.nextFloat() - 0.5) * 0.4,
      },
    });
    this.ctx.events.emit('weapon:fire', {
      weapon: 'rifle',
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      seed: rng.nextUint32() >>> 0,
    });
  }

  // trace a projectile with gravity drop; returns shared physics hit or null
  _trace(origin, dir) {
    const speed = 240; // m/s (game feel; hitscan-ish but with drop)
    const maxDist = 220;
    const g = 9.8 * 0.6;
    const step = 0.5;
    this._p0.copy(origin);
    let s = 0;
    while (s < maxDist) {
      s = Math.min(s + step, maxDist);
      const t = s / speed;
      this._p1.copy(origin).addScaledVector(dir, s);
      this._p1.y -= 0.5 * g * t * t;
      this._seg.subVectors(this._p1, this._p0);
      const len = this._seg.length();
      if (len < 1e-6) continue;
      this._seg.divideScalar(len);
      const hit = this.physics.raycast(this._p0, this._seg, len);
      if (hit && hit.hit) return hit;
      this._p0.copy(this._p1);
      if (this._p1.y < -5) break;
    }
    return null;
  }

  _endpoint(origin, dir, dist) {
    const t = dist / 240;
    return {
      x: origin.x + dir.x * dist,
      y: origin.y + dir.y * dist - 0.5 * 9.8 * 0.6 * t * t,
      z: origin.z + dir.z * dist,
    };
  }

  // ------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------

  update(dt, ctx) {
    // shot mode: hold the viewmodel at rest, no firing/reload/bob — the
    // rigged frame must be a fixed point for bit-identical captures.
    if (ctx.config.shot) {
      this._root.position.copy(REST_POS);
      this._root.rotation.copy(REST_ROT);
      this.ads = 0;
      this._flash.material.opacity = 0;
      this._flashLight.intensity = 0;
      return;
    }
    const inp = ctx.input;
    const p = this.player;

    // ADS: RMB (or when inspecting/reloading, force out)
    this._adsTarget = inp.ads && !this.reloading && this._inspectT < 0 ? 1 : 0;
    this.ads += (this._adsTarget - this.ads) * Math.min(1, dt * 12);
    p.setAds(this.ads);

    // fire (auto)
    this._fireCd -= dt;
    if (inp.fire && this.ammo > 0 && this._fireCd <= 0 && !this.reloading && this._inspectT < 0) {
      const cam = ctx.camera;
      cam.getWorldDirection(this._dir);
      cam.getWorldPosition(this._origin);
      // muzzle offset: right + slight down, along the barrel
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._origin.addScaledVector(this._right, 0.16);
      this._origin.addScaledVector(this._up, -0.06);
      this._origin.addScaledVector(this._dir, 0.18);
      // spread: grows with sustained fire, shrinks with ADS
      const spread = 0.004 + this._spread * 0.05 + (this.ads > 0.5 ? 0 : 0.002);
      this._spread = Math.min(0.12, this._spread + 0.012);
      // apply spread in camera space
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const a = this._fireRng.nextFloat() * Math.PI * 2;
      const r = Math.sqrt(this._fireRng.nextFloat()) * spread;
      this._dir.addScaledVector(this._right, Math.cos(a) * r);
      this._dir.addScaledVector(this._up, Math.sin(a) * r);
      this._dir.normalize();
      this.fire(this._origin, this._dir);
    } else if (!inp.fire) {
      this._spread = Math.max(0, this._spread - dt * 0.06);
    }

    // empty-mag auto reload (on trigger release or R) / manual R
    if (this.ammo === 0 && !this.reloading) {
      if (inp.firePressed() || inp.justPressed('reload') || !inp.fire) this.startReload();
    } else if (inp.justPressed('reload') && this.ammo < MAG_SIZE && this.reserve > 0) {
      this.startReload();
    }

    // keep the viewmodel env map in sync with the sky's current env map
    const env = this.ctx.get('render').requestEnvMap();
    if (env && env !== this._env) {
      this._env = env;
      this.viewScene.environment = env;
    }

    // reload timeline
    if (this.reloading) {
      this._reloadT += dt;
      const t = this._reloadT;
      if (t >= 0.45 && !this._magOut) {
        this._magOut = true;
        this.ctx.events.emit('weapon:reload', { weapon: 'rifle', phase: 'magout' });
      }
      if (t >= 1.5 && this._magOut) {
        this._magOut = false;
        this.ctx.events.emit('weapon:reload', { weapon: 'rifle', phase: 'magin' });
      }
      if (t >= 1.7) {
        const take = Math.min(MAG_SIZE - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
      if (t >= RELOAD_TIME) {
        this.reloading = false;
        this.ctx.events.emit('weapon:reload', { weapon: 'rifle', phase: 'end' });
      }
    }

    // inspect
    if (inp.justPressed('inspect') && !this.reloading && this.ammo > 0) {
      this._inspectT = 0;
    }
    if (this._inspectT >= 0) {
      this._inspectT += dt;
      if (this._inspectT > INSPECT_TIME) this._inspectT = -1;
    }

    // decay flash
    this._flashT -= dt;
    if (this._flashT <= 0) {
      this._flash.material.opacity = 0;
      this._flashLight.intensity = 0;
    } else {
      this._flash.material.opacity = Math.max(0, this._flashT / 0.05) * 0.95;
      this._flashLight.intensity *= Math.exp(-dt * 40);
    }

    this._animateViewmodel(dt, ctx);
    this._updateHud();
  }

  _animateViewmodel(dt, ctx) {
    const p = this.player;
    const ads = this.ads;

    // sway: follow mouse velocity with smoothing, damped back to center
    this._sway.tx = THREE.MathUtils.clamp(this._sway.tx + p.lastAim.dx * 0.0009, -0.04, 0.04);
    this._sway.ty = THREE.MathUtils.clamp(this._sway.ty + p.lastAim.dy * 0.0009, -0.04, 0.04);
    this._sway.x += (this._sway.tx - this._sway.x) * Math.min(1, dt * 10);
    this._sway.y += (this._sway.ty - this._sway.y) * Math.min(1, dt * 10);
    this._sway.tx *= Math.exp(-dt * 3.2);
    this._sway.ty *= Math.exp(-dt * 3.2);

    // bob (driven by player speed)
    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    const bobAmp = p.grounded ? Math.min(1, hSpeed / 6) : 0.4;
    this._bobPhase += dt * (6 + hSpeed * 1.4) * (1 - ads * 0.85);
    const bobX = Math.cos(this._bobPhase * 2) * 0.01 * bobAmp;
    const bobY = Math.abs(Math.sin(this._bobPhase)) * 0.012 * bobAmp;

    // recoil spring: second-order damped back to rest
    const k = 140;
    const c = 16;
    this._k.vx += (-k * this._k.x - c * this._k.vx) * dt;
    this._k.x += this._k.vx * dt;
    this._k.vy += (-k * this._k.y - c * this._k.vy) * dt;
    this._k.y += this._k.vy * dt;
    this._k.vz += (-k * this._k.z - c * this._k.vz) * dt;
    this._k.z += this._k.vz * dt;

    // reload pose: weapon dips, mag drops, returns
    let dip = 0;
    let rotX = 0;
    if (this.reloading) {
      const t = this._reloadT;
      // dip into the mag-well
      if (t < 0.6) {
        const k2 = Math.sin(Math.min(1, t / 0.6) * Math.PI);
        dip = -k2 * 0.05;
        rotX = k2 * 0.16;
      } else if (t > 1.2) {
        const k2 = Math.sin(Math.min(1, (t - 1.2) / 0.7) * Math.PI);
        dip = -k2 * 0.05;
        rotX = k2 * 0.16;
      }
      // mag mesh animation
      const m = this._magMesh;
      if (t < 0.45) {
        m.position.copy(this._magBase);
      } else if (t < 1.5) {
        const k2 = Math.sin(Math.min(1, (t - 0.45) / 0.25) * Math.PI);
        m.position.set(this._magBase.x, this._magBase.y - k2 * 0.11, this._magBase.z + k2 * 0.02);
        m.rotation.x = 0.14 + k2 * 0.9;
      } else {
        const k2 = Math.sin(Math.min(1, (t - 1.5) / 0.2) * Math.PI);
        m.position.set(this._magBase.x, this._magBase.y - (1 - k2) * 0.11, this._magBase.z + (1 - k2) * 0.02);
        m.rotation.x = 0.14 + (1 - k2) * 0.9;
      }
    } else {
      this._magMesh.position.copy(this._magBase);
      this._magMesh.rotation.x = 0.14;
    }

    // inspect: rotate to show the right side
    let insp = 0;
    if (this._inspectT >= 0) {
      const t = Math.min(1, this._inspectT / INSPECT_TIME);
      insp = Math.sin(t * Math.PI);
    }

    // compose the pose
    const pos = this._tmp;
    pos.lerpVectors(REST_POS, ADS_POS, ads);
    pos.x += bobX + this._sway.x * 0.012 - this._k.z * 2.4 + insp * -0.1;
    pos.y += bobY + this._sway.y * 0.012 + dip + insp * 0.02;
    pos.z += this._k.z * 2.0 + this._sway.x * 0.01;
    this._root.position.copy(pos);

    const rot = this._e;
    rot.set(
      REST_ROT.x + (ADS_ROT.x - REST_ROT.x) * ads + this._k.x * 1.1 + rotX + insp * 0.14,
      REST_ROT.y + (ADS_ROT.y - REST_ROT.y) * ads + this._k.y * 1.1 + insp * 0.7,
      REST_ROT.z + (ADS_ROT.z - REST_ROT.z) * ads + this._sway.x * 0.6 + insp * -0.12,
    );
    this._root.rotation.copy(rot);
  }

  _updateHud() {
    if (!this._hud) return;
    this._hudAmmo.textContent = String(this.ammo);
    this._hudReserve.textContent = String(this.reserve);
    const low = this.ammo <= 8;
    this._hudAmmo.style.color = low ? '#ffb347' : '#e8ecf2';
    this._hudAmmo.style.opacity = this.ammo === 0 ? '0.35' : '1';
    this._hudReload.style.opacity = this.reloading ? '1' : '0';
    this._hudReload.textContent = this.reloading ? 'RELOADING' : (this.ammo === 0 ? 'PRESS R' : '');
  }

  startReload() {
    if (this.reloading || this.ammo >= MAG_SIZE || this.reserve <= 0) return;
    this.reloading = true;
    this._reloadT = 0;
    this._magOut = false;
    this.ctx.events.emit('weapon:reload', { weapon: 'rifle', phase: 'start' });
  }

  dispose() {
    if (this._hud) this._hud.remove();
    if (this._mats) for (const m of this._mats) m.dispose();
    this.viewScene.remove(this._root);
    for (const l of this._lights || []) this.viewScene.remove(l);
  }
}
