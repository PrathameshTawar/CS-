// fx/index.js — pooled world-space effects: impact sparks, dust, shell
// casings, bullet tracers and bullet-hole decals. Everything is a fixed pool
// reused every frame (no per-frame allocation), driven by events from
// weapons/player, with seeded RNG so captures stay reproducible.

import * as THREE from 'three';

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // dark core + scorch ring
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(5,4,3,1)');
  grad.addColorStop(0.35, 'rgba(14,11,9,0.95)');
  grad.addColorStop(0.7, 'rgba(52,40,30,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // a few radial cracks
  g.strokeStyle = 'rgba(10,8,6,0.7)';
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 4, 32 + Math.sin(a) * 4);
    g.lineTo(32 + Math.cos(a) * (14 + (i % 3) * 5), 32 + Math.sin(a) * (14 + (i % 3) * 5));
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

// A fixed-capacity CPU particle pool rendered as THREE.Points with
// per-vertex color fade (size attenuation via PointsMaterial).
class ParticlePool {
  constructor(max, opts) {
    this.max = max;
    this.head = 0;
    this._pos = new Float32Array(max * 3);
    this._vel = new Float32Array(max * 3);
    this._base = new Float32Array(max * 3);
    this._life = new Float32Array(max);
    this._maxLife = new Float32Array(max);
    this._grav = new Float32Array(max);
    this._active = new Uint8Array(max);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('color', new THREE.BufferAttribute(this._base, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        size: opts.size,
        map: opts.map,
        vertexColors: true,
        transparent: true,
        opacity: opts.opacity ?? 1,
        blending: opts.blending ?? THREE.NormalBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const p = i * 3;
    this._pos[p] = x;
    this._pos[p + 1] = y;
    this._pos[p + 2] = z;
    this._vel[p] = vx;
    this._vel[p + 1] = vy;
    this._vel[p + 2] = vz;
    this._base[p] = r;
    this._base[p + 1] = g;
    this._base[p + 2] = b;
    this._life[i] = life;
    this._maxLife[i] = life;
    this._grav[i] = grav ?? 0;
    this._active[i] = 1;
  }

  update(dt) {
    const p = this._pos;
    const v = this._vel;
    const l = this._life;
    const ml = this._maxLife;
    const bc = this._base;
    const g = this._grav;
    for (let i = 0; i < this.max; i++) {
      if (!this._active[i]) continue;
      l[i] -= dt;
      const p3 = i * 3;
      if (l[i] <= 0) {
        this._active[i] = 0;
        p[p3] = 0;
        p[p3 + 1] = -1000;
        p[p3 + 2] = 0;
        bc[p3] = 0;
        bc[p3 + 1] = 0;
        bc[p3 + 2] = 0;
        continue;
      }
      v[p3 + 1] -= g[i] * dt;
      p[p3] += v[p3] * dt;
      p[p3 + 1] += v[p3 + 1] * dt;
      p[p3 + 2] += v[p3 + 2] * dt;
      const f = l[i] / ml[i];
      bc[p3] *= f;
      bc[p3 + 1] *= f;
      bc[p3 + 2] *= f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class FxSystem {
  static id = 'fx';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.rng = ctx.rng.fork(0x70f00d);
    this._subs = [];
    const q = ctx.config.q;
    const glow = makeGlowTexture();

    this._sparks = new ParticlePool(Math.min(q.particleBudget, 4096), {
      size: 0.1,
      map: glow,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    });
    this._dust = new ParticlePool(700, {
      size: 0.24,
      map: glow,
      blending: THREE.NormalBlending,
      opacity: 0.42,
    });
    // smoke: soft grey puffs (muzzle smoke, death plumes) — rises, expands
    this._smoke = new ParticlePool(900, {
      size: 0.6,
      map: glow,
      blending: THREE.NormalBlending,
      opacity: 0.35,
    });
    // blood: dark red burst with gravity on flesh impacts / deaths
    this._blood = new ParticlePool(1400, {
      size: 0.09,
      map: glow,
      blending: THREE.NormalBlending,
      opacity: 0.95,
    });
    this.scene.add(this._sparks.points);
    this.scene.add(this._dust.points);
    this.scene.add(this._smoke.points);
    this.scene.add(this._blood.points);

    // tracers: a pool of additive line segments
    this._tracers = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 11;
      this.scene.add(line);
      this._tracers.push({ line, mat, life: 0, maxLife: 0.06, active: false });
    }
    this._tHead = 0;

    // shell casings: small brass boxes with gravity + spin
    const shellGeo = new THREE.BoxGeometry(0.008, 0.008, 0.02);
    this._shells = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd8a24a,
        metalness: 1,
        roughness: 0.35,
        envMapIntensity: 1.4,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(shellGeo, mat);
      mesh.castShadow = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this._shells.push({
        mesh, mat,
        vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, life: 0, active: false,
      });
    }
    this._shHead = 0;

    // bullet-hole decals
    const holeTex = makeHoleTexture();
    this._decalN = Math.min(64, q.decalBudget ?? 64);
    const decalGeo = new THREE.PlaneGeometry(0.18, 0.18);
    this._decals = [];
    this._upV = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this._decalN; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: holeTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this._decals.push({ mesh, mat, life: 0, maxLife: 30, active: false });
    }
    this._dHead = 0;
    this._q = new THREE.Quaternion();
    this._tn = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._sx = new THREE.Vector3();

    // event wiring
    const e = ctx.events;
    this._subs.push(e.on('bullet:impact', (p) => this._onImpact(p)));
    this._subs.push(e.on('weapon:shell', (p) => this._onShell(p)));
    this._subs.push(e.on('bullet:tracer', (p) => this._onTracer(p)));
    this._subs.push(e.on('player:footstep', (p) => this._onFootstep(p)));
    this._subs.push(e.on('player:land', (p) => this._onLand(p)));
    this._subs.push(e.on('weapon:fire', (p) => this._onMuzzleSmoke(p)));
    this._subs.push(e.on('actor:death', (p) => this._onDeath(p)));
  }

  // ---- event handlers ----

  _onImpact(p) {
    const rng = this.rng;
    const n = p.normal;
    const count = p.surface === 'metal' ? 16 : p.surface === 'glass' ? 12 : 10;
    // sparks burst
    for (let i = 0; i < count; i++) {
      const a = rng.nextFloat() * Math.PI * 2;
      const up = rng.nextFloat() * 0.9 + 0.1;
      const sp = rng.nextFloat() * 4 + 2;
      // hemisphere around the surface normal
      const tx = Math.cos(a) * Math.sin(Math.acos(up));
      const tz = Math.sin(a) * Math.sin(Math.acos(up));
      this._tangent(tx, up, tz, n, this._sx);
      this._sparks.spawn(
        p.point.x, p.point.y, p.point.z,
        this._sx.x * sp, this._sx.y * sp, this._sx.z * sp,
        0.25 + rng.nextFloat() * 0.4,
        1, 0.55 + rng.nextFloat() * 0.45, 0.2 + rng.nextFloat() * 0.3,
        6,
      );
    }
    // small dust puff
    for (let i = 0; i < 3; i++) {
      this._dust.spawn(
        p.point.x, p.point.y, p.point.z,
        (rng.nextFloat() - 0.5) * 0.6, rng.nextFloat() * 0.5, (rng.nextFloat() - 0.5) * 0.6,
        0.4 + rng.nextFloat() * 0.3,
        0.75, 0.7, 0.62, 0.5,
      );
    }
    // decal (not on glass/water/fabric)
    if (p.surface !== 'glass' && p.surface !== 'water' && p.surface !== 'fabric') {
      this._spawnDecal(p.point, n);
    }
  }

  _onShell(p) {
    const s = this._shells[this._shHead];
    this._shHead = (this._shHead + 1) % this._shells.length;
    s.mesh.position.set(p.position.x, p.position.y, p.position.z);
    s.vx = p.velocity.x;
    s.vy = p.velocity.y;
    s.vz = p.velocity.z;
    s.rx = (this.rng.nextFloat() - 0.5) * 14;
    s.rz = (this.rng.nextFloat() - 0.5) * 14;
    s.life = 1.2;
    s.active = true;
    s.mesh.visible = true;
    s.mat.opacity = 1;
  }

  _onTracer(p) {
    const t = this._tracers[this._tHead];
    this._tHead = (this._tHead + 1) % this._tracers.length;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = p.from.x;
    pos[1] = p.from.y;
    pos[2] = p.from.z;
    pos[3] = p.to.x;
    pos[4] = p.to.y;
    pos[5] = p.to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.life = t.maxLife;
    t.active = true;
    t.line.visible = true;
  }

  _onFootstep(p) {
    const rng = this.rng;
    for (let i = 0; i < 3; i++) {
      this._dust.spawn(
        p.position.x, p.position.y + 0.03, p.position.z,
        (rng.nextFloat() - 0.5) * 0.5, rng.nextFloat() * 0.4, (rng.nextFloat() - 0.5) * 0.5,
        0.35 + rng.nextFloat() * 0.2,
        0.7, 0.66, 0.58, 1.2,
      );
    }
  }

  _onLand(p) {
    const rng = this.rng;
    const n = Math.min(16, Math.floor(p.velocity * 2));
    for (let i = 0; i < n; i++) {
      this._dust.spawn(
        p.position.x, p.position.y + 0.05, p.position.z,
        (rng.nextFloat() - 0.5) * 1.4, rng.nextFloat() * 1.2, (rng.nextFloat() - 0.5) * 1.4,
        0.4 + rng.nextFloat() * 0.4,
        0.72, 0.68, 0.6, 2.5,
      );
    }
  }

  _onMuzzleSmoke(p) {
    if (!p || !p.origin) return;
    const rng = this.rng;
    const n = 3;
    for (let i = 0; i < n; i++) {
      this._smoke.spawn(
        p.origin.x, p.origin.y, p.origin.z,
        (rng.nextFloat() - 0.5) * 0.5, 0.5 + rng.nextFloat() * 0.4, (rng.nextFloat() - 0.5) * 0.5,
        0.5 + rng.nextFloat() * 0.3,
        0.42, 0.4, 0.38, 0.6,
      );
    }
  }

  _onDeath(p) {
    if (!p || !p.point) return;
    const rng = this.rng;
    // blood spray along the impulse
    for (let i = 0; i < 14; i++) {
      const a = rng.nextFloat() * Math.PI * 2;
      const sp = 1.5 + rng.nextFloat() * 2.5;
      this._blood.spawn(
        p.point.x, p.point.y + 0.4, p.point.z,
        Math.cos(a) * sp, 0.5 + rng.nextFloat() * 1.5, Math.sin(a) * sp,
        0.5 + rng.nextFloat() * 0.5,
        0.5, 0.04, 0.04, 7,
      );
    }
    // death smoke plume
    for (let i = 0; i < 6; i++) {
      this._smoke.spawn(
        p.point.x, p.point.y + 0.6, p.point.z,
        (rng.nextFloat() - 0.5) * 0.6, 0.8 + rng.nextFloat() * 0.5, (rng.nextFloat() - 0.5) * 0.6,
        0.8 + rng.nextFloat() * 0.6,
        0.3, 0.28, 0.26, 0.4,
      );
    }
  }

  // ---- helpers ----

  // Rotate the tangent-space direction (tx,ty,tz) so +Y maps onto the normal.
  _tangent(tx, ty, tz, n, out) {
    this._q.setFromUnitVectors(this._upV, this._tn.set(n.x, n.y, n.z));
    this._tmp.set(tx, ty, tz).applyQuaternion(this._q);
    out.copy(this._tmp);
  }

  _spawnDecal(point, n) {
    const d = this._decals[this._dHead];
    this._dHead = (this._dHead + 1) % this._decals.length;
    d.mesh.position.set(point.x, point.y, point.z);
    d.mesh.visible = true;
    d.mat.opacity = 0.95;
    this._q.setFromUnitVectors(this._upV, this._tn.set(n.x, n.y, n.z));
    d.mesh.quaternion.copy(this._q);
    d.mesh.rotateZ(this.rng.nextFloat() * Math.PI * 2);
    d.life = d.maxLife;
    d.active = true;
  }

  update(dt) {
    this._sparks.update(dt);
    this._dust.update(dt);
    this._smoke.update(dt);
    this._blood.update(dt);
    // tracers
    for (const t of this._tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.line.visible = false;
        continue;
      }
      t.mat.opacity = Math.min(0.9, t.life / t.maxLife);
    }
    // shells
    for (const s of this._shells) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.vy -= 13 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += s.rx * dt;
      s.mesh.rotation.z += s.rz * dt;
      if (s.mesh.position.y < 0.01) {
        s.mesh.position.y = 0.01;
        s.vy *= -0.35;
        s.vx *= 0.7;
        s.vz *= 0.7;
      }
      if (s.life < 0.3) s.mat.opacity = Math.max(0, s.life / 0.3);
    }
    // decals
    for (const d of this._decals) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      if (d.life > d.maxLife - 0.5) d.mat.opacity = (d.maxLife - d.life) * 2; // fade in
      else if (d.life < 1.5) d.mat.opacity = d.life / 1.5; // fade out
      else d.mat.opacity = 0.95;
    }
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    this.scene.remove(this._sparks.points);
    this.scene.remove(this._dust.points);
    this.scene.remove(this._smoke.points);
    this.scene.remove(this._blood.points);
    this._sparks.points.geometry.dispose();
    this._sparks.points.material.dispose();
    this._dust.points.geometry.dispose();
    this._dust.points.material.dispose();
    this._smoke.points.geometry.dispose();
    this._smoke.points.material.dispose();
    this._blood.points.geometry.dispose();
    this._blood.points.material.dispose();
    for (const t of this._tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.mat.dispose();
    }
    for (const s of this._shells) {
      this.scene.remove(s.mesh);
      s.mat.dispose();
    }
    for (const d of this._decals) {
      this.scene.remove(d.mesh);
      d.mat.dispose();
    }
  }
}
