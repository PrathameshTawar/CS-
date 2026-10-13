// characters/soldier.js — the procedural soldier: a skinned humanoid built
// from boxes on a THREE.Skeleton (no art assets), plus its walk/aim pose.
// Shared by the AI squad and by remote players online (net), so both look
// and move the same. Not a subsystem: plain functions, owned by the lead.

import * as THREE from 'three';

// Shared rest-pose bone definition (positions are parent-relative).
const BONE_DEFS = [
  ['hips', [0, 1.0, 0], null],
  ['spine', [0, 0.15, 0], 'hips'],
  ['chest', [0, 0.2, 0], 'spine'],
  ['neck', [0, 0.15, 0], 'chest'],
  ['head', [0, 0.12, 0], 'neck'],
  ['shoulderL', [-0.25, 0.05, 0], 'chest'],
  ['elbowL', [0, -0.3, 0], 'shoulderL'],
  ['handL', [0, -0.28, 0], 'elbowL'],
  ['shoulderR', [0.25, 0.05, 0], 'chest'],
  ['elbowR', [0, -0.3, 0], 'shoulderR'],
  ['handR', [0, -0.28, 0], 'elbowR'],
  ['hipL', [-0.12, -0.02, 0], 'hips'],
  ['kneeL', [0, -0.5, 0], 'hipL'],
  ['ankleL', [0, -0.48, 0], 'kneeL'],
  ['hipR', [0.12, -0.02, 0], 'hips'],
  ['kneeR', [0, -0.5, 0], 'hipR'],
  ['ankleR', [0, -0.48, 0], 'kneeR'],
];

// Boxes: [size, center, bone, materialGroup] — 0 uniform, 1 skin, 2 gear.
const BOX_DEFS = [
  { s: [0.34, 0.18, 0.2], c: [0, 1.0, 0], b: 'hips', g: 0 },
  { s: [0.42, 0.4, 0.24], c: [0, 1.26, 0], b: 'spine', g: 0 },
  { s: [0.4, 0.22, 0.22], c: [0, 1.4, 0], b: 'chest', g: 2 },
  { s: [0.22, 0.24, 0.22], c: [0, 1.64, 0], b: 'head', g: 1 },
  { s: [0.24, 0.08, 0.24], c: [0, 1.76, 0], b: 'head', g: 2 },
  { s: [0.1, 0.3, 0.11], c: [-0.25, 1.25, 0], b: 'shoulderL', g: 0 },
  { s: [0.09, 0.28, 0.1], c: [-0.25, 0.96, 0], b: 'elbowL', g: 0 },
  { s: [0.08, 0.09, 0.09], c: [-0.25, 0.82, 0], b: 'handL', g: 1 },
  { s: [0.1, 0.3, 0.11], c: [0.25, 1.25, 0], b: 'shoulderR', g: 0 },
  { s: [0.09, 0.28, 0.1], c: [0.25, 0.96, 0], b: 'elbowR', g: 0 },
  { s: [0.08, 0.09, 0.09], c: [0.25, 0.82, 0], b: 'handR', g: 1 },
  { s: [0.14, 0.5, 0.15], c: [-0.12, 0.73, 0], b: 'hipL', g: 0 },
  { s: [0.11, 0.48, 0.12], c: [-0.12, 0.24, 0], b: 'kneeL', g: 0 },
  { s: [0.1, 0.06, 0.24], c: [-0.12, 0.03, 0.07], b: 'ankleL', g: 2 },
  { s: [0.14, 0.5, 0.15], c: [0.12, 0.73, 0], b: 'hipR', g: 0 },
  { s: [0.11, 0.48, 0.12], c: [0.12, 0.24, 0], b: 'kneeR', g: 0 },
  { s: [0.1, 0.06, 0.24], c: [0.12, 0.03, 0.07], b: 'ankleR', g: 2 },
];

// Shared rest-pose geometry (bind pose). Bone indices match BONE_DEFS order.
function buildGeometry() {
  const pos = [];
  const nrm = [];
  const uv = [];
  const skinI = [];
  const skinW = [];
  const groups = [];
  let vcount = 0;
  for (const p of BOX_DEFS) {
    const g = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    g.translate(p.c[0], p.c[1], p.c[2]);
    const n = g.attributes.position.count;
    const idx = BONE_DEFS.findIndex((b) => b[0] === p.b);
    for (let i = 0; i < n; i++) {
      pos.push(g.attributes.position.array[i * 3], g.attributes.position.array[i * 3 + 1], g.attributes.position.array[i * 3 + 2]);
      nrm.push(g.attributes.normal.array[i * 3], g.attributes.normal.array[i * 3 + 1], g.attributes.normal.array[i * 3 + 2]);
      uv.push(g.attributes.uv.array[i * 2], g.attributes.uv.array[i * 2 + 1]);
      skinI.push(idx, 0, 0, 0);
      skinW.push(1, 0, 0, 0);
    }
    groups.push({ start: vcount, count: n, materialIndex: p.g });
    vcount += n;
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  for (const gr of groups) geometry.addGroup(gr.start, gr.count, gr.materialIndex);
  return geometry;
}


let GEOMETRY = null; // built once, on first use

// crouch pose (see poseSoldier)
export const CROUCH_DROP = 0.65;
export const CROUCH_HIP = 1.0;
export const CROUCH_KNEE = 2.4;
export const CROUCH_LEAN = 0.45;

// Builds one soldier. `mats` is [uniform, skin, gear] (materials.make()).
// Add `root` under a group that carries position and yaw; the rig itself
// stays at identity so skinning is transform-free.
export function createSoldier(mats) {
  if (!GEOMETRY) GEOMETRY = buildGeometry();
  // identity root: bones + mesh live here so skinning is transform-free
  const root = new THREE.Group();

  // per-soldier bone instances (independent animation)
  const bones = {};
  for (const [name, pos, parent] of BONE_DEFS) {
    const b = new THREE.Bone();
    b.position.set(pos[0], pos[1], pos[2]);
    if (parent) bones[parent].add(b);
    bones[name] = b;
  }
  const skeleton = new THREE.Skeleton(BONE_DEFS.map(([n]) => bones[n]));
  const mesh = new THREE.SkinnedMesh(GEOMETRY, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.add(bones.hips);
  // Bind at the rest pose, at identity (`root` is not parented yet). The
  // bones' world matrices must be computed first: the inverse bind matrices
  // come from them. (They used to be taken before any update, i.e. as
  // identity, which applied every bone offset twice: soldiers rendered ~3.4 m
  // tall and pulled apart, well above their 1.8 m hitbox.)
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);

  // rifle as a child of the chest bone (non-skinned, follows the torso)
  const rifle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.55), mats[2]);
  body.position.set(0, 0, 0.1);
  rifle.add(body);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.06), mats[2]);
  mag.position.set(0, -0.055, 0.1);
  rifle.add(mag);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.04), mats[2]);
  grip.position.set(0, -0.035, 0.26);
  grip.rotation.x = 0.5;
  rifle.add(grip);
  rifle.position.set(0.18, -0.02, 0.3);
  rifle.rotation.y = -0.25;
  bones.chest.add(rifle);

  return { root, mesh, bones, skeleton, rifle };
}

// Frees the soldier's own geometry (the skinned body geometry is shared).
export function disposeSoldier(soldier) {
  soldier.rifle.traverse((o) => o.geometry && o.geometry.dispose());
  soldier.skeleton.dispose();
}

// Poses the rig for walk-cycle `phase`.
//   moving: walking/running; firing: rifle up at the shoulder;
//   crouch: 0..1 (online players); aimPitch: radians, tilts the torso.
export function poseSoldier(b, phase, moving, firing, crouch = 0, aimPitch = 0) {
  const step = Math.sin(phase);
  const step2 = Math.sin(phase * 2);

  const swing = moving ? step * 0.6 : 0;
  b.hipL.rotation.x = swing;
  b.hipR.rotation.x = -swing;
  b.kneeL.rotation.x = moving ? Math.max(0, -step) * 0.5 : 0.06;
  b.kneeR.rotation.x = moving ? Math.max(0, step) * 0.5 : 0.06;
  b.ankleL.rotation.x = moving ? -b.kneeL.rotation.x * 0.5 : 0;
  b.ankleR.rotation.x = moving ? -b.kneeR.rotation.x * 0.5 : 0;

  const armLift = firing ? 1 : moving ? 0.25 : 0.4;
  b.shoulderL.rotation.x = -1.15 * armLift + (moving ? -step * 0.35 : 0);
  b.shoulderR.rotation.x = -1.15 * armLift + (moving ? step * 0.35 : 0);
  b.shoulderL.rotation.z = 0.18;
  b.shoulderR.rotation.z = -0.18;
  b.elbowL.rotation.x = -(0.9 + armLift * 0.6);
  b.elbowR.rotation.x = -(0.9 + armLift * 0.6);

  b.hips.rotation.x = 0.08 + (moving ? step2 * 0.02 : Math.sin(phase * 0.5) * 0.01);
  b.hips.position.y = 1.0 + (moving ? Math.abs(step2) * 0.04 : Math.sin(phase * 0.5) * 0.008);
  b.spine.rotation.x = -0.04 + (moving ? -step2 * 0.015 : 0);
  b.chest.rotation.x = 0.06;
  b.neck.rotation.x = -0.12;

  if (aimPitch !== 0) {
    // look up/down with the torso and head (pitch > 0 looks up)
    b.chest.rotation.x -= aimPitch * 0.6;
    b.neck.rotation.x -= aimPitch * 0.4;
  }
  if (crouch > 0) {
    // deep knee bend and a forward lean: the head ends up at ~1.1 m, the
    // crouched hitbox height (2 x HALF_Y_CROUCH)
    b.hips.position.y -= CROUCH_DROP * crouch;
    b.hipL.rotation.x -= CROUCH_HIP * crouch;
    b.hipR.rotation.x -= CROUCH_HIP * crouch;
    b.kneeL.rotation.x += CROUCH_KNEE * crouch;
    b.kneeR.rotation.x += CROUCH_KNEE * crouch;
    b.ankleL.rotation.x -= (CROUCH_KNEE - CROUCH_HIP) * crouch;
    b.ankleR.rotation.x -= (CROUCH_KNEE - CROUCH_HIP) * crouch;
    b.spine.rotation.x += CROUCH_LEAN * crouch;
  }
}
