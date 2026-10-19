// The soldier model is shared by the AI squad and remote players online.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSoldier, disposeSoldier, poseSoldier } from '../src/characters/soldier.js';

const mats = () => [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];

test('each soldier gets its own skeleton (independent animation) on shared geometry', () => {
  const a = createSoldier(mats());
  const b = createSoldier(mats());
  assert.notEqual(a.bones.hips, b.bones.hips);
  assert.equal(a.mesh.geometry, b.mesh.geometry, 'body geometry is built once');
  assert.equal(a.skeleton.bones.length, 17);
  disposeSoldier(a);
  disposeSoldier(b);
});

test('the AI pose is unchanged by the online extras (crouch 0, no aim pitch)', () => {
  const plain = createSoldier(mats()).bones;
  const extra = createSoldier(mats()).bones;
  poseSoldier(plain, 1.3, true, true);
  poseSoldier(extra, 1.3, true, true, 0, 0);
  for (const name of Object.keys(plain)) {
    assert.deepEqual(extra[name].rotation.toArray(), plain[name].rotation.toArray(), name);
    assert.deepEqual(extra[name].position.toArray(), plain[name].position.toArray(), name);
  }
});

test('crouching lowers the hips and bends the knees; aiming up tilts the torso back', () => {
  const stand = createSoldier(mats()).bones;
  const crouch = createSoldier(mats()).bones;
  poseSoldier(stand, 0, false, true);
  poseSoldier(crouch, 0, false, true, 1);
  assert.ok(crouch.hips.position.y < stand.hips.position.y - 0.25);
  assert.ok(crouch.kneeL.rotation.x > stand.kneeL.rotation.x + 1);
  const up = createSoldier(mats()).bones;
  poseSoldier(up, 0, false, true, 0, 0.5);
  assert.ok(up.chest.rotation.x < stand.chest.rotation.x, 'pitch up leans the chest back');
});

// Where the skinned vertices actually render (what players see and aim at).
function renderedHeight(crouch = 0) {
  const s = createSoldier(mats());
  const outer = new THREE.Group();
  outer.position.set(10, 0, -4); // placed in the world like a real soldier
  outer.rotation.y = 1.2;
  outer.add(s.root);
  poseSoldier(s.bones, 0, false, true, crouch);
  outer.updateMatrixWorld(true);
  s.skeleton.update();
  const v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.mesh.geometry.attributes.position.count; i++) {
    s.mesh.getVertexPosition(i, v).applyMatrix4(s.mesh.matrixWorld);
    lo = Math.min(lo, v.y);
    hi = Math.max(hi, v.y);
  }
  return [lo, hi];
}

test('a soldier renders at its real height, inside its 1.8 m hitbox', () => {
  // Regression: the bind pose was captured before the bones' matrices were
  // computed, so soldiers rendered ~3.4 m tall and pulled apart.
  const [feet, top] = renderedHeight();
  assert.ok(Math.abs(feet) < 0.1, `feet at ${feet.toFixed(2)} m`);
  assert.ok(top > 1.7 && top < 1.85, `top at ${top.toFixed(2)} m`);
  const [, crouchTop] = renderedHeight(1);
  assert.ok(crouchTop > 1.0 && crouchTop < 1.2, `crouched top at ${crouchTop.toFixed(2)} m (hitbox 1.1)`);
});

test('a soldier holds the weapon it is given; the rifle is the default and unchanged', async () => {
  const { createSoldier, setSoldierWeapon } = await import('../src/characters/soldier.js');
  const THREE = await import('three');
  const mats = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const s = createSoldier(mats);
  const size = () => new THREE.Box3().setFromObject(s.rifle).getSize(new THREE.Vector3());
  assert.equal(s.weapon, 'rifle');
  assert.deepEqual(s.rifle.children.map((c) => c.position.toArray().map((v) => +v.toFixed(3))), [[0, 0, 0.1], [0, -0.055, 0.1], [0, -0.035, 0.26]]);
  const rifleLen = size().z;
  setSoldierWeapon(s, 'sniper');
  assert.ok(size().z > rifleLen + 0.2, 'the sniper is longer');
  assert.equal(s.rifle.children.length, 4, 'with a scope');
  setSoldierWeapon(s, 'pistol');
  assert.ok(size().z < rifleLen / 2, 'a pistol is short');
  const before = s.rifle.children[0];
  setSoldierWeapon(s, 'pistol');
  assert.equal(s.rifle.children[0], before, 'same weapon: nothing rebuilt');
});
