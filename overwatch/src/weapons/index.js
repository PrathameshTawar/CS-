// weapons/index.js — the loadout, procedural viewmodels and ballistics.
//
// The player carries a primary (SMG, rifle, sniper; or none) and a pistol,
// each with its own ammo (stats in shared/weapons.js). 1 / 2 or the mouse
// wheel switch; a switch cancels a reload and the new weapon fires once it's
// drawn. Each weapon is built from primitives in ctx.viewScene (drawn after
// the world with a cleared depth buffer, so it never clips through walls).
// Handles ADS (the sniper scopes in), spring recoil, sway/bob, procedural
// draw, reload & inspect animation, and bullet ballistics with drop. Emits
// weapon:fire, weapon:switch, weapon:reload, weapon:shell, bullet:tracer
// and bullet:impact; reads player.applyRecoil/addShake/addFovPunch/setAds.
//
// Grenades: 4 takes one out (again: the next type); click throws, right
// click lobs; 1 / 2 put it away. The grenades system owns the inventory and
// the throw itself; this system only holds and animates it.
//
// Online, the server owns what you carry (net calls setLoadout on a spawn and
// syncOwned when a purchase lands); the held slot and ammo are predicted here.
//
// Determinism: all visual randomness (spread, flash rotation, shell kick)
// comes from a seeded rng fork — no Math.random.

import * as THREE from 'three';
import { shotEndpoint, traceShot } from '../../shared/combat.js';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, PRIMARY, SECONDARY, WEAPONS, defaultSlot, makeGun } from '../../shared/weapons.js';
import { GRENADES } from '../../shared/grenades.js';

const INSPECT_TIME = 1.7;

// viewmodel poses per weapon (view space: +X right, +Y up, -Z forward)
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const POSES = {
  pistol: { rest: v3(0.2, -0.2, -0.42), ads: v3(0, -0.128, -0.34) },
  heavy: { rest: v3(0.21, -0.21, -0.44), ads: v3(0, -0.135, -0.36) },
  smg: { rest: v3(0.3, -0.27, -0.48), ads: v3(0, -0.158, -0.34) },
  rifle: { rest: v3(0.32, -0.28, -0.52), ads: v3(0, -0.175, -0.36) },
  sniper: { rest: v3(0.3, -0.27, -0.55), ads: v3(0, -0.2, -0.42) },
  he: { rest: v3(0.22, -0.22, -0.4), ads: v3(0.22, -0.22, -0.4) },
  flash: { rest: v3(0.22, -0.22, -0.4), ads: v3(0.22, -0.22, -0.4) },
  smoke: { rest: v3(0.22, -0.22, -0.4), ads: v3(0.22, -0.22, -0.4) },
};
const REST_ROT = new THREE.Euler(0.02, -0.03, 0.01);
const ADS_ROT = new THREE.Euler(0, 0, 0);
const BLOOM_SCALE = 0.05;
const GRENADE_DRAW = 0.35; // s to take a grenade out
const THROW_ANIM = 0.35; // s of throwing motion // shared/weapons.js spread units -> radians

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

    // loadout: [primary | null, secondary], each { id, ammo, reserve }
    this.loadout = [makeGun(DEFAULT_PRIMARY), makeGun(DEFAULT_SECONDARY)];
    this.slot = PRIMARY;
    this._drawT = Infinity; // time since the held weapon was drawn
    this.grenadeOut = false; // holding a grenade instead of the gun in `slot`
    this.grenadeType = null;
    this._throwT = -1; // time since the last throw (animation), -1: none
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
    this._tmp = new THREE.Vector3();
    this._end = { x: 0, y: 0, z: 0 };
    this._e = new THREE.Euler();

    this._buildWeapon();
    this._buildMuzzleFlash();
    this._buildHud();
    this._showModel();
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
    this._matLens = this._mat(new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 0.2, roughness: 0.05, envMapIntensity: 2 }));

    this._root = new THREE.Group();
    this.viewScene.add(this._root);

    // one model per weapon; only the held one is visible. Each records its
    // magazine (for the reload animation) and where its muzzle is.
    this._models = {};
    this._buildRifle(this._model('rifle', -0.55));
    this._buildPistol(this._model('pistol', -0.15), false);
    this._buildPistol(this._model('heavy', -0.19), true);
    this._buildSmg(this._model('smg', -0.3));
    this._buildSniper(this._model('sniper', -0.84));
    for (const id of Object.keys(GRENADES)) this._buildGrenade(this._model(id, 0), id);

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

    this._root.position.copy(POSES.rifle.rest);
    this._root.rotation.copy(REST_ROT);
  }

  _model(id, muzzleZ) {
    const group = new THREE.Group();
    group.visible = false;
    this._root.add(group);
    const model = { group, mag: null, magBase: null, magRot: 0, muzzleZ };
    this._models[id] = model;
    this._g = group; // _box/_cyl build into it
    return model;
  }

  _setMag(model, mesh) {
    model.mag = mesh;
    model.magBase = mesh.position.clone();
    model.magRot = mesh.rotation.x;
  }

  _buildRifle(model) {
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
    const mag = this._box(0.048, 0.13, 0.07, this._matMag, 0, -0.09, -0.03);
    mag.rotation.x = 0.14;
    this._setMag(model, mag);
    // trigger guard + trigger
    this._box(0.012, 0.03, 0.1, this._matDark, 0, -0.055, 0.0);
    this._box(0.008, 0.02, 0.02, this._matBrass, 0, -0.04, -0.01);
    // charging handle
    this._box(0.018, 0.022, 0.05, this._matDark, 0, 0.06, 0.06);
    // iron-sight glow dot (tiny emissive)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), this._matGlow);
    dot.position.set(0, 0.075, 0.03);
    this._g.add(dot);
  }

  // the free pistol, or (heavy) the big-bore one: longer, thicker slide
  _buildPistol(model, heavy) {
    const k = heavy ? 1.25 : 1;
    const len = 0.19 * k;
    // slide + barrel bushing
    this._box(0.034 * k, 0.04 * k, len, heavy ? this._matReceiver : this._matDark, 0, 0, -0.03);
    this._cyl(0.008 * k, 0.02, this._matBarrel, 0, 0.004, -0.03 - len / 2, true);
    // serrations
    this._box(0.036 * k, 0.026, 0.035, this._matBarrel, 0, 0.002, 0.03 * k);
    // frame + rail
    this._box(0.03 * k, 0.026, 0.15 * k, this._matHandguard, 0, -0.03 * k, -0.04);
    // grip (angled) and the magazine base in it
    const grip = this._box(0.03 * k, 0.11, 0.046, this._matGrip, 0, -0.088 * k, 0.035);
    grip.rotation.x = -0.22;
    const mag = this._box(0.026 * k, 0.03, 0.04, this._matMag, 0, -0.15 * k, 0.05);
    mag.rotation.x = -0.22;
    this._setMag(model, mag);
    // trigger guard + trigger
    this._box(0.01, 0.022, 0.05, this._matDark, 0, -0.05 * k, -0.02);
    this._box(0.006, 0.016, 0.01, heavy ? this._matBrass : this._matDark, 0, -0.045 * k, -0.01);
    // sights: front post with a glow dot, rear notch
    this._box(0.006, 0.012, 0.008, this._matDark, 0, 0.024 * k, -0.03 - len / 2 + 0.012);
    this._box(0.022, 0.012, 0.01, this._matDark, 0, 0.024 * k, 0.05 * k);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 4), this._matGlow);
    dot.position.set(0, 0.032 * k, -0.03 - len / 2 + 0.012);
    this._g.add(dot);
  }

  _buildSmg(model) {
    // compact receiver with a top rail
    this._box(0.062, 0.075, 0.26, this._matReceiver, 0, 0, -0.02);
    this._box(0.034, 0.016, 0.22, this._matDark, 0, 0.045, -0.02);
    // short barrel in a shroud
    this._cyl(0.02, 0.1, this._matHandguard, 0, 0.012, -0.19, true);
    this._cyl(0.011, 0.08, this._matBarrel, 0, 0.012, -0.27, true);
    // folding wire stock
    this._box(0.012, 0.012, 0.2, this._matDark, 0.02, 0.01, 0.2);
    this._box(0.012, 0.012, 0.2, this._matDark, -0.02, 0.01, 0.2);
    this._box(0.05, 0.07, 0.014, this._matDark, 0, -0.01, 0.3);
    // grip, long straight magazine ahead of it
    const grip = this._box(0.04, 0.09, 0.045, this._matGrip, 0, -0.07, 0.07);
    grip.rotation.x = -0.25;
    const mag = this._box(0.032, 0.17, 0.045, this._matMag, 0, -0.12, -0.06);
    mag.rotation.x = 0.06;
    this._setMag(model, mag);
    // trigger guard, front and rear sights
    this._box(0.01, 0.025, 0.08, this._matDark, 0, -0.05, 0.01);
    this._box(0.008, 0.03, 0.01, this._matDark, 0, 0.065, -0.12);
    this._box(0.02, 0.025, 0.03, this._matDark, 0, 0.062, 0.07);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 4), this._matGlow);
    dot.position.set(0, 0.08, -0.12);
    this._g.add(dot);
  }

  _buildSniper(model) {
    // long receiver, heavy fluted barrel and muzzle brake
    this._box(0.07, 0.08, 0.36, this._matReceiver, 0, 0, -0.02);
    this._cyl(0.014, 0.56, this._matBarrel, 0, 0.015, -0.48, true);
    this._box(0.034, 0.03, 0.06, this._matDark, 0, 0.015, -0.79);
    // stock with cheek rest and butt pad
    this._box(0.06, 0.1, 0.3, this._matHandguard, 0, -0.01, 0.3);
    this._box(0.05, 0.03, 0.16, this._matDark, 0, 0.05, 0.28);
    this._box(0.064, 0.11, 0.02, this._matGrip, 0, -0.01, 0.46);
    // scope: tube, bells, lenses, rings
    this._cyl(0.022, 0.32, this._matDark, 0, 0.09, -0.02, true);
    this._cyl(0.032, 0.07, this._matDark, 0, 0.09, -0.2, true);
    this._cyl(0.028, 0.06, this._matDark, 0, 0.09, 0.15, true);
    this._cyl(0.029, 0.004, this._matLens, 0, 0.09, -0.237, true);
    this._cyl(0.025, 0.004, this._matLens, 0, 0.09, 0.182, true);
    this._box(0.05, 0.03, 0.02, this._matBarrel, 0, 0.055, -0.1);
    this._box(0.05, 0.03, 0.02, this._matBarrel, 0, 0.055, 0.06);
    // bolt handle with a brass knob
    this._box(0.06, 0.012, 0.012, this._matDark, 0.04, 0.02, 0.1);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), this._matBrass);
    knob.position.set(0.072, 0.02, 0.1);
    this._g.add(knob);
    // grip, trigger guard, small box magazine
    const grip = this._box(0.045, 0.09, 0.05, this._matGrip, 0, -0.08, 0.13);
    grip.rotation.x = -0.3;
    this._box(0.012, 0.03, 0.09, this._matDark, 0, -0.055, 0.05);
    const mag = this._box(0.046, 0.06, 0.08, this._matMag, 0, -0.065, -0.04);
    this._setMag(model, mag);
  }

  // A grenade in the hand: HE round and olive, flash a pale can, smoke a
  // darker can with a band.
  _buildGrenade(model, id) {
    const body = id === 'he' ? this._matHandguard : id === 'flash' ? this._matReceiver : this._matMag;
    if (id === 'he') {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), body);
      ball.scale.set(1, 1.15, 1);
      this._g.add(ball);
    } else {
      this._cyl(0.026, 0.1, body, 0, 0, 0, false);
      this._cyl(0.027, 0.012, id === 'flash' ? this._matBarrel : this._matGlow, 0, 0.02, 0, false);
    }
    // fuse head and spoon
    this._cyl(0.012, 0.025, this._matDark, 0, id === 'he' ? 0.045 : 0.062, 0, false);
    this._box(0.008, 0.06, 0.014, this._matDark, 0.022, id === 'he' ? 0.02 : 0.035, 0);
    // pin ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 14), this._matBrass);
    ring.position.set(-0.016, id === 'he' ? 0.058 : 0.075, 0);
    ring.rotation.y = Math.PI / 2;
    this._g.add(ring);
    // a small "magazine" stand-in so the reload code has something to hold
    this._setMag(model, ring);
  }

  _box(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    this._g.add(mesh);
    return mesh;
  }

  _cyl(r, len, mat, x, y, z, horiz) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    mesh.position.set(x, y, z);
    if (horiz) mesh.rotation.x = Math.PI / 2;
    this._g.add(mesh);
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
      '<div id="w-slots" style="font-size:11px;letter-spacing:1px;margin-bottom:4px;"></div>' +
      '<div id="w-name" style="color:#9aa4b2;font-size:12px;letter-spacing:1px;"></div>' +
      '<div id="w-ammo" style="font-size:34px;letter-spacing:1px;">30</div>' +
      '<div id="w-reserve" style="color:#9aa4b2;font-size:12px;">90</div>' +
      '<div id="w-reload" style="color:#ffb347;font-size:11px;letter-spacing:2px;opacity:0;height:14px;"></div>';
    document.body.appendChild(el);
    this._hud = el;
    this._hudSlots = el.querySelector('#w-slots');
    this._hudName = el.querySelector('#w-name');
    this._hudAmmo = el.querySelector('#w-ammo');
    this._hudReserve = el.querySelector('#w-reserve');
    this._hudReload = el.querySelector('#w-reload');
    this._hudKey = '';

    // sniper scope: black outside a circle, thin crosshair
    const scope = document.createElement('div');
    scope.style.cssText =
      'position:fixed;inset:0;z-index:25;pointer-events:none;display:none;' +
      'background:radial-gradient(circle at center,transparent 0,transparent 38vmin,#000 38.4vmin);';
    scope.innerHTML =
      '<div style="position:absolute;left:0;right:0;top:50%;height:1px;background:#000"></div>' +
      '<div style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:#000"></div>';
    document.body.appendChild(scope);
    this._scopeEl = scope;
    this.scoped = false;
  }

  // ------------------------------------------------------------------
  // loadout
  // ------------------------------------------------------------------

  get gun() {
    return this.loadout[this.slot];
  }

  get def() {
    return WEAPONS[this.gun.id];
  }

  get ammo() {
    return this.gun.ammo;
  }

  set ammo(v) {
    this.gun.ammo = v;
  }

  get reserve() {
    return this.gun.reserve;
  }

  set reserve(v) {
    this.gun.reserve = v;
  }

  get drawing() {
    return this._drawT < (this.grenadeOut ? GRENADE_DRAW : this.def.drawTime);
  }

  // Takes a grenade out (or the next type, if one is already out).
  _grenade(ctx) {
    const g = ctx.peek('grenades');
    const next = g && g.nextType(this.grenadeOut ? this.grenadeType : null);
    if (!next || (this.grenadeOut && next === this.grenadeType)) return;
    this.grenadeOut = true;
    this.grenadeType = next;
    this.reloading = false;
    this._inspectT = -1;
    this._drawT = 0;
    this._throwT = -1;
    this._showModel();
  }

  // Back to the gun in `slot` (drawn again).
  _putAwayGrenade(slot) {
    this.grenadeOut = false;
    this._throwT = -1;
    if (!this.switchTo(slot, true)) this.switchTo(this.slot, true);
  }

  // Holds `slot` (if there's a weapon in it): cancels a reload or inspect,
  // and the weapon can fire once it's drawn. `force` re-draws the held slot
  // (its weapon was replaced).
  switchTo(slot, force = false) {
    if (!this.loadout[slot] || (slot === this.slot && !force && !this.grenadeOut)) return false;
    this.grenadeOut = false; // a gun comes up: any grenade goes away
    this._throwT = -1;
    this.slot = slot;
    this.reloading = false;
    this._inspectT = -1;
    this._drawT = 0;
    this._spread = 0;
    this._fireCd = 0;
    this._showModel();
    this.ctx.events.emit('weapon:switch', { slot, weapon: this.gun.id });
    return true;
  }

  // Replaces the whole loadout (a spawn): full state, no draw animation.
  // `loadout` is [[id, ammo, reserve] | null, [id, ammo, reserve]].
  setLoadout(loadout, slot) {
    this.grenadeOut = false;
    this._throwT = -1;
    this.loadout = loadout.map((g) => g && { id: g[0], ammo: g[1], reserve: g[2] });
    this.slot = this.loadout[slot] ? slot : defaultSlot(this.loadout);
    this.reloading = false;
    this._inspectT = -1;
    this._drawT = Infinity;
    this._spread = 0;
    this._showModel();
  }

  // Takes what the server says we own, keeping our own (predicted) ammo for
  // weapons we already had. A newly bought weapon is drawn, as is the
  // pistol when the held primary is gone (sold).
  syncOwned(loadout) {
    let draw = -1;
    for (const slot of [PRIMARY, SECONDARY]) {
      const want = loadout[slot];
      const have = this.loadout[slot];
      if ((want ? want[0] : null) === (have ? have.id : null)) continue;
      this.loadout[slot] = want && { id: want[0], ammo: want[1], reserve: want[2] };
      if (want) draw = slot;
      else if (slot === this.slot) draw = SECONDARY;
    }
    if (draw >= 0) this.switchTo(draw, true);
  }

  // Single player: a weapon from the buy menu, free.
  give(id) {
    const slot = WEAPONS[id].slot;
    this.loadout[slot] = makeGun(id);
    this.switchTo(slot, true);
  }

  _showModel() {
    const shown = this.grenadeOut ? this.grenadeType : this.gun.id;
    for (const [id, model] of Object.entries(this._models)) model.group.visible = id === shown;
    const model = this._models[shown];
    this._flash.position.z = model.muzzleZ;
    this._flashLight.position.z = model.muzzleZ;
  }

  // ------------------------------------------------------------------
  // firing + ballistics
  // ------------------------------------------------------------------

  fire(origin, dir) {
    if (this.ammo <= 0 || this.reloading || this._inspectT >= 0 || this.drawing) return;
    if (this._fireCd > 0) return;
    const def = this.def;
    this._fireCd = def.interval;
    this.ammo--;

    // recoil: kick the viewmodel spring + push the camera
    const rng = this._fireRng;
    const kick = def.recoil / 0.0045; // relative to the rifle
    this._k.vx += (0.09 + rng.nextFloat() * 0.03) * Math.min(2.5, kick);
    this._k.vy += (rng.nextFloat() - 0.5) * 0.02;
    this._k.vz += 0.012 + rng.nextFloat() * 0.004;
    this.player.applyRecoil(def.recoil + rng.nextFloat() * def.recoil / 3, (rng.nextFloat() - 0.5) * def.recoil * 0.9);
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
    const end = hit ? hit.point : shotEndpoint(origin, dir, 200, this._end);
    this.ctx.events.emit('bullet:tracer', { from: origin, to: end, speed: 800 });
    if (hit) {
      this.ctx.events.emit('bullet:impact', {
        point: hit.point,
        normal: hit.normal,
        surface: hit.surface,
        incident: dir,
        damage: def.body,
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
      weapon: def.id,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      seed: rng.nextUint32() >>> 0,
    });
  }

  // trace a projectile with gravity drop (shared/combat.js — the server runs
  // the same trace); returns the shared physics hit or null
  _trace(origin, dir) {
    return traceShot(this.physics, origin, dir);
  }

  // ------------------------------------------------------------------
  // per-step: the combat clocks (fire rate, draw, reload) run on fixed steps,
  // the same clock the server times them on (one input = one step). Frame
  // time would drift from it whenever the engine caps steps per frame (below
  // 15 fps), and the server would refuse shots the client allowed.
  // ------------------------------------------------------------------

  fixedUpdate(h, ctx) {
    if (ctx.config.shot) return;
    this._fireCd -= h;
    this._drawT += h;
    if (this.reloading) this._reloadT += h;
  }

  // ------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------

  update(dt, ctx) {
    // shot mode: hold the viewmodel at rest, no firing/reload/bob — the
    // rigged frame must be a fixed point for bit-identical captures.
    if (ctx.config.shot) {
      this._root.position.copy(POSES[this.gun.id].rest);
      this._root.rotation.copy(REST_ROT);
      this.ads = 0;
      this._flash.material.opacity = 0;
      this._flashLight.intensity = 0;
      return;
    }
    const inp = ctx.input;
    const p = this.player;
    const buying = !!(ctx.peek('buy') && ctx.peek('buy').open);

    // switch: 1 / 2, or the wheel toggles; 4: a grenade (not while the buy
    // menu takes the keys)
    if (!buying && !p.dead) {
      if (inp.justPressed('grenade')) this._grenade(ctx);
      else if (this.grenadeOut && (inp.justPressed('slot1') || inp.justPressed('slot2') || inp.wheel() !== 0)) {
        this._putAwayGrenade(inp.justPressed('slot2') ? SECONDARY : inp.justPressed('slot1') ? PRIMARY : this.slot);
      } else if (inp.justPressed('slot1')) this.switchTo(PRIMARY);
      else if (inp.justPressed('slot2')) this.switchTo(SECONDARY);
      else if (inp.wheel() !== 0) this.switchTo(this.slot === PRIMARY ? SECONDARY : PRIMARY);
    }
    if (this.grenadeOut) {
      this._updateGrenade(dt, ctx, buying);
      this._animateViewmodel(dt, ctx);
      this._updateHud();
      return;
    }
    const def = this.def;

    // ADS: RMB (or when inspecting/reloading/drawing, force out)
    this._adsTarget = inp.ads && !this.reloading && this._inspectT < 0 && !this.drawing ? 1 : 0;
    this.ads += (this._adsTarget - this.ads) * Math.min(1, dt * 12);
    p.setAds(this.ads, def.adsFov);
    this.scoped = !!def.scope && this.ads > 0.85 && !p.dead;
    this._scopeEl.style.display = this.scoped ? 'block' : 'none';
    this._root.visible = !this.scoped;

    // fire (automatic: held; semi-automatic: each click); the dead and the
    // frozen (online round start) don't shoot
    const trigger = def.auto ? inp.fire : inp.firePressed();
    if (trigger && !p.dead && !p.frozen && !buying && this.ammo > 0 && this._fireCd <= 0 && !this.reloading && this._inspectT < 0 && !this.drawing) {
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
      const sp = def.spread;
      const spread = sp.base + this._spread * BLOOM_SCALE + (this.ads > 0.5 ? 0 : sp.hip);
      this._spread = Math.min(sp.bloomMax, this._spread + sp.grow);
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
      this._spread = Math.max(0, this._spread - dt * def.spread.bloomMax * 0.5);
    }

    // empty-mag auto reload (on trigger release or R) / manual R
    if (this.ammo === 0 && !this.reloading && !this.drawing) {
      if (inp.firePressed() || inp.justPressed('reload') || !inp.fire) this.startReload();
    } else if (inp.justPressed('reload') && this.ammo < def.mag && this.reserve > 0) {
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
      const t = this._reloadT;
      // the mag drops a quarter of the way in and goes back in just before the refill
      const outAt = def.reloadTime * 0.2;
      const inAt = def.refillAt - 0.2;
      if (t >= outAt && !this._magOut && t < inAt) {
        this._magOut = true;
        this.ctx.events.emit('weapon:reload', { weapon: def.id, phase: 'magout' });
      }
      if (t >= inAt && this._magOut) {
        this._magOut = false;
        this.ctx.events.emit('weapon:reload', { weapon: def.id, phase: 'magin' });
      }
      if (t >= def.refillAt && !this._refilled) {
        this._refilled = true;
        const take = Math.min(def.mag - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
      if (t >= def.reloadTime) {
        this.reloading = false;
        this.ctx.events.emit('weapon:reload', { weapon: def.id, phase: 'end' });
      }
    }

    // inspect
    if (inp.justPressed('inspect') && !this.reloading && !this.drawing && this.ammo > 0) {
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

  // Holding a grenade: click throws, right click lobs; when that type runs
  // out the next one comes up, or the gun when there are none left.
  _updateGrenade(dt, ctx, buying) {
    const inp = ctx.input;
    const p = this.player;
    const g = ctx.peek('grenades');
    this.ads += (0 - this.ads) * Math.min(1, dt * 12);
    p.setAds(this.ads, 52);
    this.scoped = false;
    this._scopeEl.style.display = 'none';
    this._root.visible = true;
    if (this._throwT >= 0) {
      this._throwT += dt;
      if (this._throwT >= THROW_ANIM) {
        this._throwT = -1;
        const next = g && (g.count(this.grenadeType) > 0 ? this.grenadeType : g.nextType(this.grenadeType));
        if (next) {
          this.grenadeType = next;
          this._drawT = 0;
          this._showModel();
        } else this._putAwayGrenade(this.slot);
      }
      return;
    }
    if (!g || buying || p.dead || p.frozen || this.drawing) return;
    const lob = inp.adsPressed();
    if ((inp.firePressed() || lob) && g.throw(this.grenadeType, lob)) this._throwT = 0;
  }

  _animateViewmodel(dt, ctx) {
    const p = this.player;
    const ads = this.ads;
    const def = this.def;
    const shown = this.grenadeOut ? this.grenadeType : def.id;
    const pose = POSES[shown];
    const model = this._models[shown];

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

    // reload pose: weapon dips, mag drops, returns (timed to this weapon)
    let dip = 0;
    let rotX = 0;
    const m = model.mag;
    if (this.reloading) {
      const t = this._reloadT;
      const outAt = def.reloadTime * 0.2;
      const inAt = def.refillAt - 0.2;
      const settle = Math.max(0.3, def.reloadTime - inAt);
      // dip into the mag-well
      if (t < outAt + 0.15) {
        const k2 = Math.sin(Math.min(1, t / (outAt + 0.15)) * Math.PI);
        dip = -k2 * 0.05;
        rotX = k2 * 0.16;
      } else if (t > inAt - 0.3) {
        const k2 = Math.sin(Math.min(1, (t - inAt + 0.3) / settle) * Math.PI);
        dip = -k2 * 0.05;
        rotX = k2 * 0.16;
      }
      // mag mesh animation
      if (t < outAt) {
        m.position.copy(model.magBase);
      } else if (t < inAt) {
        const k2 = Math.sin(Math.min(1, (t - outAt) / 0.25) * Math.PI);
        m.position.set(model.magBase.x, model.magBase.y - k2 * 0.11, model.magBase.z + k2 * 0.02);
        m.rotation.x = model.magRot + k2 * 0.9;
      } else {
        const k2 = Math.sin(Math.min(1, (t - inAt) / 0.2) * Math.PI);
        m.position.set(model.magBase.x, model.magBase.y - (1 - k2) * 0.11, model.magBase.z + (1 - k2) * 0.02);
        m.rotation.x = model.magRot + (1 - k2) * 0.9;
      }
    } else {
      m.position.copy(model.magBase);
      m.rotation.x = model.magRot;
    }

    // a throw: the hand swings forward and up, then drops out of view
    if (this.grenadeOut && this._throwT >= 0) {
      const t = this._throwT / THROW_ANIM;
      dip += Math.sin(t * Math.PI) * 0.06 - t * 0.25;
      rotX -= Math.sin(t * Math.PI) * 0.9;
    }

    // draw: rises from below the screen
    if (this.drawing) {
      const t = this._drawT / (this.grenadeOut ? GRENADE_DRAW : def.drawTime);
      const k2 = 1 - t * t * (3 - 2 * t);
      dip -= k2 * 0.22;
      rotX -= k2 * 0.7;
    }

    // inspect: rotate to show the right side
    let insp = 0;
    if (this._inspectT >= 0) {
      const t = Math.min(1, this._inspectT / INSPECT_TIME);
      insp = Math.sin(t * Math.PI);
    }

    // compose the pose
    const pos = this._tmp;
    pos.lerpVectors(pose.rest, pose.ads, ads);
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
    const def = this.def;
    const g = this.ctx.peek('grenades');
    const nades = g ? `${g.count('he')}${g.count('flash')}${g.count('smoke')}` : '';
    if (this.grenadeOut) {
      this._hudAmmo.textContent = String(g ? g.count(this.grenadeType) : 0);
      this._hudReserve.textContent = 'CLICK THROW · RIGHT CLICK LOB';
      this._hudAmmo.style.color = '#e8ecf2';
      this._hudAmmo.style.opacity = '1';
      this._hudReload.style.opacity = '0';
    } else {
      this._hudAmmo.textContent = String(this.ammo);
      this._hudReserve.textContent = String(this.reserve);
    }
    if (!this.grenadeOut) {
      const low = this.ammo <= Math.ceil(def.mag * 0.27);
      this._hudAmmo.style.color = low ? '#ffb347' : '#e8ecf2';
      this._hudAmmo.style.opacity = this.ammo === 0 ? '0.35' : '1';
      this._hudReload.style.opacity = this.reloading ? '1' : '0';
      this._hudReload.textContent = this.reloading ? 'RELOADING' : (this.ammo === 0 ? 'PRESS R' : '');
    }
    // weapon name and the two slots (held one bright); rebuilt only on change
    const key = `${this.slot}|${this.loadout[PRIMARY] ? this.loadout[PRIMARY].id : ''}|${this.loadout[SECONDARY].id}|${this.grenadeOut ? this.grenadeType : ''}|${nades}`;
    if (key !== this._hudKey) {
      this._hudKey = key;
      this._hudName.textContent = (this.grenadeOut ? GRENADES[this.grenadeType].name : def.name).toUpperCase();
      const slotText = (slot, n) => {
        const gun = this.loadout[slot];
        if (!gun) return '';
        const on = slot === this.slot && !this.grenadeOut;
        return `<span style="margin-left:10px;color:${on ? '#ffd27a' : '#6f7a88'}">${n} ${WEAPONS[gun.id].name.toUpperCase()}</span>`;
      };
      const total = g ? g.total() : 0;
      const nadeText = total
        ? `<span style="margin-left:10px;color:${this.grenadeOut ? '#ffd27a' : '#6f7a88'}">4 GRENADES ×${total}</span>`
        : '';
      this._hudSlots.innerHTML = slotText(PRIMARY, 1) + slotText(SECONDARY, 2) + nadeText;
    }
  }

  startReload() {
    if (this.reloading || this.drawing || this.ammo >= this.def.mag || this.reserve <= 0) return;
    this.reloading = true;
    this._reloadT = 0;
    this._magOut = false;
    this._refilled = false;
    this.ctx.events.emit('weapon:reload', { weapon: this.def.id, phase: 'start' });
  }

  dispose() {
    if (this._hud) this._hud.remove();
    if (this._scopeEl) this._scopeEl.remove();
    if (this._mats) for (const m of this._mats) m.dispose();
    this.viewScene.remove(this._root);
    for (const l of this._lights || []) this.viewScene.remove(l);
  }
}
