// shotrig/index.js — deterministic camera rig for headless captures.
//
// `?shot=<name>` parks the world camera at a fixed pose (position + quaternion
// derived from a look target) and a fixed FOV, and freezes every time-dependent
// visual: player physics/look, viewmodel animation and the dev overlay all
// early-out in shot mode (see player/weapons/dev). The resulting frame is a
// pure function of { seed, time-of-day, quality preset, shot name } — bit
// identical across runs on the same machine, which is what makes
// tools/imagediff.mjs a meaningful gate.
//
// SHOT_POSES is exported so tools/shotset.mjs can derive the capture URL list
// from the same source of truth.

import * as THREE from 'three';

export const SHOT_POSES = {
  // golden hour — sun azimuth 2.9 rad (~ -Z), elevation 0.24
  plaza: { pos: [0, 1.7, 24], look: [0, 1.6, -12], fov: 70 },
  street: { pos: [0, 1.7, 32], look: [20, 1.5, 38], fov: 70 },
  fountain: { pos: [7, 1.5, 9], look: [0, 1.4, 0], fov: 70 },
  shop: { pos: [0, 1.7, -22], look: [0, 3, -32], fov: 70 },
  alley: { pos: [-30, 1.7, -30], look: [-45, 6, -45], fov: 70 },
  roof: { pos: [0, 34, 30], look: [0, 0, -20], fov: 60 },
  night: { pos: [0, 1.7, 18], look: [0, 2, -12], fov: 70 },
};

export class ShotRigSystem {
  static id = 'shotrig';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    const pose = SHOT_POSES[ctx.config.shot];
    if (!pose) {
      this._disabled = true;
      return;
    }
    this._disabled = false;
    this._pos = new THREE.Vector3().fromArray(pose.pos);
    // orientation from a look-at matrix (one-off; no per-frame allocation)
    const m = new THREE.Matrix4();
    m.lookAt(this._pos, new THREE.Vector3().fromArray(pose.look), new THREE.Vector3(0, 1, 0));
    this._q = new THREE.Quaternion().setFromRotationMatrix(m);
    if (pose.fov) {
      ctx.config.fov = pose.fov;
      ctx.camera.fov = pose.fov;
      ctx.camera.updateProjectionMatrix();
      ctx.viewCamera.fov = pose.fov;
      ctx.viewCamera.updateProjectionMatrix();
    }
    this._apply();
  }

  _apply() {
    this.ctx.camera.position.copy(this._pos);
    this.ctx.camera.quaternion.copy(this._q);
  }

  update() {
    if (this._disabled) return;
    // Repark every frame — anything that moved the camera (player, physics,
    // recoil) gets overridden so the shot is a fixed point.
    this._apply();
  }

  dispose() {}
}
