// world/index.js — the world system.
//
// A ~120x120 m market street: ground, plaza paving, roads, modular buildings
// with real wall thickness and enterable storefronts, and several hundred
// instanced props. Every transform comes from ctx.rng.fork('world') so the
// scene is identical for a given seed. Static colliders are exposed for the
// physics system to consume later.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class WorldSystem {
  static id = 'world';
  static deps = ['render', 'materials', 'sky'];

  init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork(0x70a1d);
    const m = ctx.get('materials');
    this.m = m;
    this.scene = ctx.scene;
    this.staticColliders = [];
    this._mats = [];
    this._geoms = [];
    this._meshes = [];

    this._buildGround();
    this._buildSidewalk();
    this._buildRoads();
    this._buildCornerBuildings();
    this._buildShops();
    this._buildFountain();
    this._buildProps();
    this._buildLamps();
    this._buildCars();
    this._buildSigns();
  }

  // ---- helpers ----

  _track(obj) {
    this._meshes.push(obj);
    return obj;
  }

  _geom(geometry) {
    this._geoms.push(geometry);
    return geometry;
  }

  _mat(material) {
    this._mats.push(material);
    return material;
  }

  // axis-aligned box; registers a collider
  box(w, h, d, material, x, y, z, opts = {}) {
    const mesh = new THREE.Mesh(this._geom(new THREE.BoxGeometry(w, h, d)), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = opts.yaw ?? 0;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    if (opts.userData) mesh.userData = { ...mesh.userData, ...opts.userData };
    this.scene.add(mesh);
    this._track(mesh);
    if (opts.collide !== false) {
      const half = Math.max(w, d) / 2;
      this.staticColliders.push({
        min: [x - half, y - h / 2, z - half],
        max: [x + half, y + h / 2, z + half],
        surface: opts.surface ?? 'concrete',
      });
    }
    return mesh;
  }

  _instanced(geometry, material, count, place, opts = {}) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const data = place(i);
      if (!data) {
        _m.makeScale(0, 0, 0); // ghost instances must not render at origin
        mesh.setMatrixAt(i, _m);
        continue;
      }
      const { x, y, z, yaw = 0, scale = 1, ry = 0.6, rz = 0.4 } = data;
      _e.set(0, yaw, 0);
      _q.setFromEuler(_e);
      _p.set(x, y, z);
      _s.set(scale * (opts.sx ?? 1), scale * (opts.sy ?? 1), scale * (opts.sz ?? 1));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      if (data.collide && this.staticColliders.length < 400) {
        const half = data.half ?? 0.5;
        this.staticColliders.push({
          min: [x - half, y, z - half],
          max: [x + half, y + (data.ch ?? 1.2), z + half],
          surface: data.surface ?? opts.surface ?? 'concrete',
        });
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    this._track(mesh);
    return mesh;
  }

  // ---- construction ----

  _buildGround() {
    const m = this.m;
    const ground = new THREE.Mesh(
      this._geom(new THREE.PlaneGeometry(120, 120)),
      m.make('asphalt', { repeat: 5, size: 2048 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this._track(ground);
    this.staticColliders.push({
      min: [-60, -0.5, -60],
      max: [60, 0, 60],
      surface: 'asphalt',
    });
  }

  _buildSidewalk() {
    const m = this.m;
    const concrete = m.make('concrete', { repeat: 2 });
    const R = 34; // plaza radius
    // four sidewalk strips around the plaza
    const strips = [
      { w: R * 2 + 4, d: 3, x: 0, z: -R - 1.5 },
      { w: R * 2 + 4, d: 3, x: 0, z: R + 1.5 },
      { w: 3, d: R * 2 + 4, x: -R - 1.5, z: 0 },
      { w: 3, d: R * 2 + 4, x: R + 1.5, z: 0 },
    ];
    for (const s of strips) {
      this.box(s.w, 0.12, s.d, concrete, s.x, 0.06, s.z, { surface: 'concrete', collide: false });
    }
    // plaza paving: a grid of large slabs for surface variation
    const slab = m.make('concrete', { repeat: 1, variant: 1 });
    const N = 6;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -30 + i * 10 + 5;
        const z = -30 + j * 10 + 5;
        this.box(9.6, 0.1, 9.6, slab, x, 0.05, z, { surface: 'concrete', collide: false });
      }
    }
    // plaza edge curb
    const curb = m.make('concrete', { variant: 2 });
    const C = 30;
    this.box(C * 2 + 0.8, 0.35, 0.5, curb, 0, 0.22, -C, { surface: 'concrete' });
    this.box(C * 2 + 0.8, 0.35, 0.5, curb, 0, 0.22, C, { surface: 'concrete' });
    this.box(0.5, 0.35, C * 2 + 0.8, curb, -C, 0.22, 0, { surface: 'concrete' });
    this.box(0.5, 0.35, C * 2 + 0.8, curb, C, 0.22, 0, { surface: 'concrete' });
  }

  _buildRoads() {
    const m = this.m;
    const asphalt = m.make('asphalt', { repeat: 3, size: 2048, variant: 2 });
    // E-W road (top at y=0.06)
    this.box(120, 0.06, 16, asphalt, 0, 0.03, 38, { surface: 'asphalt', collide: false });
    // N-S road (top at y=0.065 — sits above the E-W road, no coplanar z-fight)
    this.box(16, 0.06, 120, asphalt, 38, 0.035, 0, { surface: 'asphalt', collide: false });
    // lane markings
    const markMat = this._mat(new THREE.MeshBasicMaterial({ color: 0xcfd6de }));
    const markGeom = this._geom(new THREE.BoxGeometry(0.18, 0.02, 3));
    const paint = (x, z, yaw, y = 0.07) => {
      const m2 = new THREE.Mesh(markGeom, markMat);
      m2.position.set(x, y, z);
      m2.rotation.y = yaw;
      this.scene.add(m2);
      this._track(m2);
    };
    // E-W road: edge lines + center dashes
    for (let x = -58; x < 58; x += 5) {
      paint(x, 30.5, 0, 0.065);
      paint(x, 45.5, 0, 0.065);
      paint(x, 38, 0, 0.065);
    }
    // N-S road
    for (let z = -58; z < 58; z += 5) {
      paint(30.5, z, Math.PI / 2, 0.07);
      paint(45.5, z, Math.PI / 2, 0.07);
      paint(38, z, Math.PI / 2, 0.07);
    }
  }

  _buildCornerBuildings() {
    const m = this.m;
    const defs = [
      { x: -52, z: -52, w: 22, d: 22, h: 17, mat: 'brick', yaw: 0.03 },
      { x: 52, z: -52, w: 22, d: 22, h: 21, mat: 'plaster', yaw: -0.02 },
      { x: -52, z: 52, w: 22, d: 22, h: 14, mat: 'plaster', yaw: 0.01 },
      { x: 52, z: 52, w: 22, d: 22, h: 18, mat: 'brick', yaw: -0.03 },
    ];
    for (const b of defs) {
      this._building(b);
    }
  }

  _building(b) {
    const m = this.m;
    const mat = m.make(b.mat, { repeat: b.mat === 'brick' ? 1 : 2 });
    const baseMat = m.make('concrete', { variant: 3 });
    const glassMat = m.makeGlass({});
    const frameMat = m.make('plaster', { variant: 4 });

    // solid volume (walls read as solid boxes for now; interiors come later)
    this.box(b.w, b.h, b.d, mat, b.x, b.h / 2, b.z, { yaw: b.yaw, surface: 'concrete' });
    // roof
    this.box(b.w + 1.2, 0.4, b.d + 1.2, m.make('concrete', { variant: 5 }), b.x, b.h + 0.2, b.z, { yaw: b.yaw, surface: 'concrete', collide: false });
    // roof details: AC units
    const unitMat = m.make('paintedMetal', { tint: 0x8a929c });
    for (let i = 0; i < 3; i++) {
      this.box(1.8, 1, 1.4, unitMat, b.x + (i - 1) * 3, b.h + 0.9, b.z + 2, { surface: 'metal', collide: false });
    }
    // window grid on the two street-facing faces
    const winCols = Math.floor(b.w / 3.2);
    const winRows = Math.floor(b.h / 3.4);
    const faces = [0, 1, 2, 3];
    for (const face of faces) {
      const horiz = face % 2 === 0; // face 0/2 face x, 1/3 face z
      for (let r = 1; r < winRows; r++) {
        for (let c = 0; c < winCols; c++) {
          const along = (c - (winCols - 1) / 2) * 3.2;
          const y = 1.6 + r * 3.4 + (this.rng.nextFloat() - 0.5) * 0.4;
          let wx, wz, yaw = 0;
          if (face === 0) {
            wx = b.x - b.w / 2 - 0.03;
            wz = b.z + along;
            yaw = -Math.PI / 2;
          } else if (face === 1) {
            wx = b.x + along;
            wz = b.z - b.d / 2 - 0.03;
            yaw = 0;
          } else if (face === 2) {
            wx = b.x + b.w / 2 + 0.03;
            wz = b.z + along;
            yaw = Math.PI / 2;
          } else {
            wx = b.x + along;
            wz = b.z + b.d / 2 + 0.03;
            yaw = Math.PI;
          }
          // frame
          const frame = new THREE.Mesh(this._geom(new THREE.BoxGeometry(2.1, 2.3, 0.14)), frameMat);
          frame.position.set(wx, y, wz);
          frame.rotation.y = yaw + b.yaw;
          frame.castShadow = false;
          this.scene.add(frame);
          this._track(frame);
          // glass
          const glass = new THREE.Mesh(this._geom(new THREE.BoxGeometry(1.8, 2.0, 0.06)), glassMat);
          glass.position.set(wx, y, wz);
          glass.rotation.y = yaw + b.yaw;
          glass.castShadow = false;
          this.scene.add(glass);
          this._track(glass);
          // interior glow
          const glowMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2.2) }));
          const glow = new THREE.Mesh(this._geom(new THREE.PlaneGeometry(1.7, 1.9)), glowMat);
          glow.position.set(wx - Math.cos(yaw) * 0.15, y, wz - Math.sin(yaw) * 0.15);
          glow.rotation.y = yaw + b.yaw;
          this.scene.add(glow);
          this._track(glow);
        }
      }
    }
    // base trim
    this.box(b.w + 0.4, 0.8, b.d + 0.4, baseMat, b.x, 0.4, b.z, { yaw: b.yaw, surface: 'concrete', collide: false });
  }

  _buildShops() {
    const m = this.m;
    const rng = this.rng.fork(0x5b0a);
    const defs = [
      { x: 0, z: -33, yaw: 0 },
      { x: 33, z: 0, yaw: Math.PI / 2 },
      { x: 0, z: 33, yaw: Math.PI },
      { x: -33, z: 0, yaw: -Math.PI / 2 },
    ];
    for (const s of defs) {
      this._shop(s.x, s.z, s.yaw, rng);
    }
  }

  _shop(x, z, yaw, rng) {
    const m = this.m;
    const wall = m.make('plaster', { variant: 6, repeat: 1 });
    const brick = m.make('brick', { variant: 7, repeat: 1 });
    const glassMat = m.makeGlass({});
    const awning = m.make('fabric', { tint: rng.pick([0xa0342c, 0x2c4a7a, 0x3a6b34, 0x7a6a2c]), repeat: 3 });

    // outward direction: every shop faces the plaza (the origin)
    const fx = Math.sign(-x) || 0;
    const fz = Math.sign(-z) || 0;
    const faceYaw = Math.atan2(fx, fz); // rotate local +Z toward the plaza
    const px = -fz; // perpendicular to the facing direction
    const pz = fx;

    this.box(16, 7.5, 12, wall, x, 3.75, z, { yaw, surface: 'plaster' });
    // storefront: three bays just outside the plaza-facing wall (12 deep -> 6.2)
    for (let i = -1; i <= 1; i++) {
      const along = i * 5;
      const bx = x + px * along + fx * 6.2;
      const bz = z + pz * along + fz * 6.2;
      // glass bay
      const bay = new THREE.Mesh(this._geom(new THREE.PlaneGeometry(4.4, 3.4)), glassMat);
      bay.position.set(bx, 2.2, bz);
      bay.rotation.y = faceYaw;
      bay.castShadow = false;
      this.scene.add(bay);
      this._track(bay);
      // awning (outer edge hangs toward the street)
      const awn = new THREE.Mesh(this._geom(new THREE.PlaneGeometry(4.6, 2.2)), awning);
      awn.position.set(bx + fx * 1.3, 4.4, bz + fz * 1.3);
      awn.rotation.set(0, faceYaw, 0);
      awn.rotateX(-0.35);
      awn.castShadow = false;
      awn.receiveShadow = true;
      this.scene.add(awn);
      this._track(awn);
      // awning posts at the outer corners
      this.box(0.1, 2.1, 0.1, m.make('paintedMetal', { tint: 0x3a3f47 }), bx + fx * 2.1 + px * 2.1, 1.05, bz + fz * 2.1 + pz * 2.1, { surface: 'metal', collide: false });
      this.box(0.1, 2.1, 0.1, m.make('paintedMetal', { tint: 0x3a3f47 }), bx + fx * 2.1 - px * 2.1, 1.05, bz + fz * 2.1 - pz * 2.1, { surface: 'metal', collide: false });
    }
    // shop roof detail
    this.box(16.6, 0.35, 12.6, m.make('concrete', { variant: 8 }), x, 7.7, z, { yaw, surface: 'concrete', collide: false });
    // brick pilaster corners on the plaza-facing wall
    this.box(1.1, 7.5, 1.1, brick, x + px * 7.6 + fx * 6.3, 3.75, z + pz * 7.6 + fz * 6.3, { yaw, surface: 'brick', collide: false });
    this.box(1.1, 7.5, 1.1, brick, x - px * 7.6 + fx * 6.3, 3.75, z - pz * 7.6 + fz * 6.3, { yaw, surface: 'brick', collide: false });
  }

  _buildFountain() {
    const m = this.m;
    const stone = m.make('concrete', { variant: 9, repeat: 2 });
    // basin
    const basin = new THREE.Mesh(
      this._geom(new THREE.CylinderGeometry(3.2, 3.5, 1.1, 32)),
      stone,
    );
    basin.position.set(0, 0.55, 0);
    basin.castShadow = true;
    basin.receiveShadow = true;
    this.scene.add(basin);
    this._track(basin);
    this.staticColliders.push({
      min: [-3.5, 0, -3.5],
      max: [3.5, 1.1, 3.5],
      surface: 'concrete',
    });
    // water
    const water = new THREE.Mesh(
      this._geom(new THREE.CircleGeometry(3.0, 32)),
      this._mat(new THREE.MeshPhysicalMaterial({
        color: 0x2a6f8f,
        transparent: true,
        opacity: 0.72,
        roughness: 0.06,
        metalness: 0,
        envMapIntensity: 2.2,
      })),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 1.05, 0);
    water.receiveShadow = true;
    this.scene.add(water);
    this._track(water);
    // center pillar
    const pillar = new THREE.Mesh(
      this._geom(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 16)),
      stone,
    );
    pillar.position.set(0, 1.9, 0);
    pillar.castShadow = true;
    this.scene.add(pillar);
    this._track(pillar);
    // rim light
    const light = new THREE.PointLight(0x7fd0e8, 60, 18, 2);
    light.position.set(0, 0.6, 0);
    this.scene.add(light);
    this.ctx.get('render').addLight(light, { range: 16, intensity: 60 });
  }

  _buildProps() {
    const m = this.m;
    const rng = this.rng.fork(0x7a00);
    const crateMat = m.make('wood', { repeat: 1 });
    const barrelMat = m.make('rustedMetal', { repeat: 1 });
    const palletMat = m.make('wood', { variant: 2, repeat: 1 });
    const plantMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x2f5b2c, roughness: 0.9 }));
    const potMat = m.make('concrete', { variant: 10 });
    const benchMat = m.make('wood', { variant: 3 });
    const benchMetal = m.make('paintedMetal', { tint: 0x2c323a });
    const bagMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.85 }));
    const bottleMat = this._mat(new THREE.MeshPhysicalMaterial({ color: 0x6a8a4a, transparent: true, opacity: 0.6, roughness: 0.08, metalness: 0, envMapIntensity: 1.5 }));
    const dumpsterMat = m.make('paintedMetal', { tint: 0x3c4a3a, variant: 4 });

    const crateGeom = this._geom(new THREE.BoxGeometry(1, 1, 1));
    this._instanced(crateGeom, crateMat, 42, (i) => {
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(16, 30);
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      if (Math.abs(x) < 8 && Math.abs(z) < 8) return null;
      return {
        x, y: 0.5, z, yaw: rng.range(0, Math.PI * 2),
        scale: rng.range(0.75, 1.35), ry: rng.range(0.85, 1.05), rz: rng.range(0.85, 1.05),
        collide: true, half: 0.55, ch: 1.1, surface: 'wood',
      };
    });

    const barrelGeom = this._geom(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14));
    this._instanced(barrelGeom, barrelMat, 26, (i) => {
      const x = rng.range(-38, 38);
      const z = rng.range(-38, 38);
      if (Math.abs(x) < 10 && Math.abs(z) < 10) return null;
      return { x, y: 0.55, z, yaw: rng.range(0, Math.PI), scale: rng.range(0.9, 1.15), collide: true, half: 0.6, ch: 1.2, surface: 'metal' };
    });

    const palletGeom = this._geom(new THREE.BoxGeometry(1.2, 0.15, 0.8));
    this._instanced(palletGeom, palletMat, 14, (i) => {
      const x = rng.range(-28, 28);
      const z = rng.range(-28, 28);
      if (Math.abs(x) < 5 && Math.abs(z) < 5) return null;
      return { x, y: 0.075, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.2), collide: true, half: 0.7, ch: 0.2, surface: 'wood' };
    });

    // potted plants around the fountain
    const potGeom = this._geom(new THREE.CylinderGeometry(0.4, 0.32, 0.5, 10));
    const plantGeom = this._geom(new THREE.SphereGeometry(0.5, 10, 8));
    this._instanced(potGeom, potMat, 16, (i) => {
      const angle = (i / 16) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const radius = 5.5 + rng.range(0, 1.5);
      return { x: Math.sin(angle) * radius, y: 0.25, z: Math.cos(angle) * radius, yaw: rng.range(0, Math.PI), scale: rng.range(0.85, 1.1), collide: true, half: 0.42, ch: 0.55, surface: 'concrete' };
    });
    this._instanced(plantGeom, plantMat, 16, (i) => {
      const angle = (i / 16) * Math.PI * 2;
      const radius = 5.6 + rng.range(0, 1.5);
      const s = rng.range(0.7, 1.3);
      return { x: Math.sin(angle) * radius, y: 0.75, z: Math.cos(angle) * radius, yaw: rng.range(0, Math.PI), scale: s, ry: rng.range(0.8, 1.1), rz: rng.range(0.8, 1.1) };
    });

    // benches
    const benchGeom = this._geom(new THREE.BoxGeometry(1.9, 0.1, 0.6));
    this._instanced(benchGeom, benchMat, 8, (i) => {
      const angle = (i / 8) * Math.PI * 2 + 0.2;
      const radius = 24;
      return { x: Math.sin(angle) * radius, y: 0.55, z: Math.cos(angle) * radius, yaw: -angle, scale: 1, collide: true, half: 1.1, ch: 0.9, surface: 'wood' };
    });
    const benchLegGeom = this._geom(new THREE.BoxGeometry(1.7, 0.5, 0.5));
    this._instanced(benchLegGeom, benchMetal, 8, (i) => {
      const angle = (i / 8) * Math.PI * 2 + 0.2;
      const radius = 24;
      return { x: Math.sin(angle) * radius, y: 0.25, z: Math.cos(angle) * radius, yaw: -angle, scale: 1 };
    });

    // trash bags
    const bagGeom = this._geom(new THREE.SphereGeometry(0.45, 8, 6));
    this._instanced(bagGeom, bagMat, 14, (i) => {
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(12, 30);
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      if (Math.abs(x) < 8 && Math.abs(z) < 8) return null;
      const s = rng.range(0.7, 1.1);
      return { x, y: 0.45 * s, z, yaw: rng.range(0, Math.PI), scale: s, ry: rng.range(0.9, 1.1), rz: rng.range(0.9, 1.1), collide: true, half: 0.45, ch: 0.5, surface: 'rubber' };
    });

    // bottles
    const bottleGeom = this._geom(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8));
    this._instanced(bottleGeom, bottleMat, 36, (i) => {
      const x = rng.range(-30, 30);
      const z = rng.range(-30, 30);
      if (Math.abs(x) < 6 && Math.abs(z) < 6) return null;
      return { x, y: 0.15, z, yaw: rng.range(0, Math.PI), scale: rng.range(0.8, 1.2), ry: rng.range(0.9, 1.1) };
    });

    // dumpsters at shop corners
    const dumpGeom = this._geom(new THREE.BoxGeometry(2.4, 1.5, 1.4));
    this._instanced(dumpGeom, dumpsterMat, 4, (i) => {
      const spots = [
        { x: -41, z: -30 }, { x: 30, z: 41 }, { x: 41, z: 30 }, { x: -30, z: -41 },
      ];
      const s = spots[i];
      return { ...s, y: 0.75, yaw: rng.range(-0.3, 0.3), scale: rng.range(0.9, 1.1), collide: true, half: 1.3, ch: 1.6, surface: 'metal' };
    });
  }

  _buildLamps() {
    const m = this.m;
    const r = this.ctx.get('render');
    const poleMat = m.make('paintedMetal', { tint: 0x2a2e33, variant: 5 });
    const glassMat = m.makeGlass({ opacity: 0.5 });
    const positions = [
      { x: -20, z: -20 }, { x: 20, z: -20 }, { x: -20, z: 20 }, { x: 20, z: 20 },
      { x: 0, z: -27 }, { x: 0, z: 27 }, { x: -27, z: 0 }, { x: 27, z: 0 },
    ];
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = positions[i];
      // pole
      this.box(0.22, 6, 0.22, poleMat, p.x, 3, p.z, { surface: 'metal', collide: true });
      // arm
      this.box(0.14, 0.14, 1.3, poleMat, p.x, 5.9, p.z, { surface: 'metal', collide: false });
      // lamp head
      this.box(0.55, 0.3, 1.5, poleMat, p.x, 6.1, p.z, { surface: 'metal', collide: false });
      // glass
      const glass = new THREE.Mesh(
        this._geom(new THREE.PlaneGeometry(1.1, 0.2)),
        glassMat,
      );
      glass.position.set(p.x, 6.1, p.z);
      glass.rotation.y = Math.PI / 2;
      this.scene.add(glass);
      this._track(glass);
      // point light
      const light = new THREE.PointLight(0xffd9a0, 150, 26, 2);
      light.position.set(p.x, 6.0, p.z);
      this.scene.add(light);
      r.addLight(light, { range: 22, intensity: 150 });
    }
    // ballast light: keeps the visible point-light count constant (the count
    // is a shader permutation key — see ARCHITECTURE.md)
    const ballast = new THREE.PointLight(0xffffff, 0, 1, 2);
    ballast.position.set(0, 0, 0);
    this.scene.add(ballast);
    r.addLight(ballast, { range: 1, intensity: 0 });
  }

  _buildCars() {
    const m = this.m;
    const rng = this.rng.fork(0xc0a2);
    const bodyMat = m.make('paintedMetal', { tint: rng.pick([0x8a3030, 0x2c3d56, 0x56602c, 0x3d3d3d]), variant: 6 });
    const glassMat = m.makeGlass({ opacity: 0.45 });
    const wheelMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
    const spots = [
      { x: -44, z: 44, yaw: 0.5 }, { x: 44, z: -44, yaw: 2.6 },
      { x: -44, z: 36, yaw: 1.8 }, { x: 36, z: 44, yaw: -1.1 },
    ];
    for (const s of spots) {
      const body = new THREE.Mesh(
        this._geom(new THREE.BoxGeometry(4.4, 1.3, 1.9)),
        bodyMat,
      );
      body.position.set(s.x, 0.75, s.z);
      body.rotation.y = s.yaw;
      body.castShadow = true;
      body.receiveShadow = true;
      this.scene.add(body);
      this._track(body);
      // cabin
      const cabin = new THREE.Mesh(
        this._geom(new THREE.BoxGeometry(2.4, 0.9, 1.7)),
        glassMat,
      );
      cabin.position.set(s.x - Math.sin(s.yaw) * 0.3, 1.5, s.z - Math.cos(s.yaw) * 0.3);
      cabin.rotation.y = s.yaw;
      cabin.castShadow = false;
      this.scene.add(cabin);
      this._track(cabin);
      // wheels
      const wheelGeom = this._geom(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12));
      for (const [fx, fz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]]) {
        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(
          s.x + Math.cos(s.yaw) * fx + Math.sin(s.yaw) * fz,
          0.36,
          s.z - Math.sin(s.yaw) * fx + Math.cos(s.yaw) * fz,
        );
        wheel.rotation.z = Math.PI / 2;
        this.scene.add(wheel);
        this._track(wheel);
      }
      this.staticColliders.push({
        min: [s.x - 2.3, 0, s.z - 1.1],
        max: [s.x + 2.3, 1.4, s.z + 1.1],
        surface: 'metal',
      });
    }
  }

  _buildSigns() {
    const m = this.m;
    const defs = [
      { x: 0, z: -33 },
      { x: 33, z: 0 },
      { x: 0, z: 33 },
      { x: -33, z: 0 },
    ];
    const colors = [0xffc46a, 0xff8a6a, 0x8ae0ff, 0xc8ff8a];
    for (let i = 0; i < defs.length; i++) {
      const s = defs[i];
      // bright HDR emissive so the signs actually bloom
      const signMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[i]).multiplyScalar(2.5) }));
      const sign = new THREE.Mesh(this._geom(new THREE.BoxGeometry(8, 0.9, 0.25)), signMat);
      const fx = Math.sign(-s.x) || 0;
      const fz = Math.sign(-s.z) || 0;
      sign.position.set(s.x + fx * 6.6, 6.6, s.z + fz * 6.6);
      sign.rotation.y = Math.atan2(fx, fz);
      this.scene.add(sign);
      this._track(sign);
      // sign bracket
      this.box(0.3, 0.3, 1.2, m.make('paintedMetal', { tint: 0x2a2e33 }), s.x + fx * 6.9, 6.6, s.z + fz * 6.9, { surface: 'metal', collide: false });
    }
  }

  dispose() {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      if (mesh.isInstancedMesh) mesh.dispose();
    }
    for (const g of this._geoms) g.dispose();
    for (const mat of this._mats) mat.dispose();
  }
}
