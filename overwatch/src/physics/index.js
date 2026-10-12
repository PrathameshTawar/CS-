// physics/index.js — collision world + queries for the player and ballistics.
//
// The world builds `staticColliders` ({min:[x,y,z], max:[x,y,z], surface});
// this system is the only place that touches them. The collision code itself
// (slab-test raycasts, axis-separated AABB character move with auto-step) lives in
// shared/collision.js so the multiplayer server runs the exact same logic.

import { CollisionWorld } from '../../shared/collision.js';

export class PhysicsSystem extends CollisionWorld {
  static id = 'physics';
  static deps = ['world'];

  init(ctx) {
    this.ctx = ctx;
    this.boxes = ctx.get('world').staticColliders || [];
  }

  dispose() {}
}
