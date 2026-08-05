// physics/index.js — collision world + queries for the player and ballistics.
//
// The world builds `staticColliders` ({min:[x,y,z], max:[x,y,z], surface});
// this system is the only place that touches them. It provides slab-test
// raycasts (used by ballistics) and a swept-AABB character move with
// auto-step (used by the player). Deterministic: no randomness, no per-frame
// allocation — `raycast` returns a shared result object that is only valid
// until the next call, so callers must copy values out immediately.

export class PhysicsSystem {
  static id = 'physics';
  static deps = ['world'];

  init(ctx) {
    this.ctx = ctx;
    this.boxes = ctx.get('world').staticColliders || [];
    // dynamic AABBs (enemy hitboxes, breakables): raycast hits them but the
    // character mover and overlap tests ignore them.
    this.dynamics = [];
    // shared raycast result (reused; only valid until the next raycast)
    this._res = {
      hit: false,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      surface: 'concrete',
      distance: 0,
    };
    // shared moveCharacter result (reused; no per-frame allocation)
    this._out = { grounded: false, surface: 'concrete' };
  }
  // Returns the shared result: { hit, point, normal, surface, distance }.
  // Hits BOTH static colliders and dynamic hitboxes (surface 'flesh' etc).
  raycast(o, d, maxDist) {
    return this._scan(o, d, maxDist, this.boxes, this.dynamics);
  }

  // Static-only raycast (AI line-of-sight ignores enemy hitboxes).
  raycastStatic(o, d, maxDist) {
    return this._scan(o, d, maxDist, this.boxes, null);
  }

  _scan(o, d, maxDist, staticBoxes, dynamicBoxes) {
    const res = this._res;
    res.hit = false;
    let best = maxDist;
    let bestBox = null;
    const boxes = staticBoxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const t = this._slab(b.min, b.max, o, d, maxDist);
      if (t >= 0 && t < best) {
        best = t;
        bestBox = b;
      }
    }
    if (dynamicBoxes) {
      for (let i = 0; i < dynamicBoxes.length; i++) {
        const b = dynamicBoxes[i];
        const t = this._slab(b.min, b.max, o, d, maxDist);
        if (t >= 0 && t < best) {
          best = t;
          bestBox = b;
        }
      }
    }
    if (!bestBox) return res;
    res.hit = true;
    res.point.x = o.x + d.x * best;
    res.point.y = o.y + d.y * best;
    res.point.z = o.z + d.z * best;
    this._faceNormal(bestBox, res.point, res.normal);
    res.surface = bestBox.surface;
    res.distance = best;
    return res;
  }

  addDynamic(box) {
    this.dynamics.push(box);
    return box;
  }

  removeDynamic(box) {
    const i = this.dynamics.indexOf(box);
    if (i >= 0) this.dynamics.splice(i, 1);
  }

  // Static-only raycast helper used by AI cover/LOS checks.

  _slab(min, max, o, d, tmax) {
    let tmin = 0;
    let tmax2 = tmax;
    for (let a = 0; a < 3; a++) {
      const oc = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const dc = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = min[a];
      const hi = max[a];
      if (Math.abs(dc) < 1e-9) {
        if (oc < lo || oc > hi) return -1;
        continue;
      }
      const inv = 1 / dc;
      let t1 = (lo - oc) * inv;
      let t2 = (hi - oc) * inv;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax2) tmax2 = t2;
      if (tmin > tmax2) return -1;
    }
    return tmin;
  }

  _faceNormal(b, p, out) {
    const EPS = 1e-4;
    out.x = out.y = out.z = 0;
    if (Math.abs(p.x - b.min[0]) < EPS) out.x = -1;
    else if (Math.abs(p.x - b.max[0]) < EPS) out.x = 1;
    if (Math.abs(p.y - b.min[1]) < EPS) out.y = -1;
    else if (Math.abs(p.y - b.max[1]) < EPS) out.y = 1;
    if (Math.abs(p.z - b.min[2]) < EPS) out.z = -1;
    else if (Math.abs(p.z - b.max[2]) < EPS) out.z = 1;
    if (out.x === 0 && out.y === 0 && out.z === 0) out.y = -1;
  }

  // True if an AABB centered at pos with half-extents `half` overlaps any box.
  overlaps(pos, half) {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (
        pos.x + half.x > b.min[0] && pos.x - half.x < b.max[0] &&
        pos.y + half.y > b.min[1] && pos.y - half.y < b.max[1] &&
        pos.z + half.z > b.min[2] && pos.z - half.z < b.max[2]
      ) {
        return true;
      }
    }
    return false;
  }

  // Move a player AABB by delta (axis-separated). `pos` is the CENTER of the
  // box, `half` its extents. Boxes whose tops are within `stepH` of the feet
  // are stepped onto instead of blocking. Returns { grounded, surface }.
  moveCharacter(pos, half, delta, stepH) {
    const out = this._out;
    out.grounded = false;
    out.surface = 'concrete';
    this._axis(pos, half, delta, 0, stepH);
    this._axis(pos, half, delta, 2, stepH);
    // vertical
    pos.y += delta.y;
    if (delta.y <= 0) {
      let top = -Infinity;
      let gb = null;
      const boxes = this.boxes;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this._overlapXZ(pos, half, b)) continue;
        if (pos.y - half.y < b.min[1] - 0.02) continue; // feet below a floor
        if (b.max[1] > top) {
          top = b.max[1];
          gb = b;
        }
      }
      if (gb) {
        pos.y = top + half.y;
        out.grounded = true;
        out.surface = gb.surface;
      }
    } else {
      let bot = Infinity;
      let cb = null;
      const boxes = this.boxes;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!this._overlapXZ(pos, half, b)) continue;
        if (b.max[1] >= pos.y + half.y - 0.01 && b.min[1] < bot) {
          bot = b.min[1];
          cb = b;
        }
      }
      if (cb) pos.y = bot - half.y; // head bump
    }
    return out;
  }

  _axis(pos, half, delta, axis, stepH) {
    const d = axis === 0 ? delta.x : delta.z;
    if (d === 0) return;
    if (axis === 0) pos.x += d;
    else pos.z += d;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!this._overlap(pos, half, b)) continue;
      const feet = pos.y - half.y;
      const stepable = b.max[1] - feet <= stepH + 0.02 && b.min[1] < pos.y + half.y;
      if (stepable) continue; // the vertical pass will step us up
      if (d > 0) {
        if (axis === 0) pos.x = b.min[0] - half.x;
        else pos.z = b.min[2] - half.z;
      } else {
        if (axis === 0) pos.x = b.max[0] + half.x;
        else pos.z = b.max[2] + half.z;
      }
    }
  }

  _overlap(pos, half, b) {
    return (
      pos.x + half.x > b.min[0] && pos.x - half.x < b.max[0] &&
      pos.y + half.y > b.min[1] && pos.y - half.y < b.max[1] &&
      pos.z + half.z > b.min[2] && pos.z - half.z < b.max[2]
    );
  }

  _overlapXZ(pos, half, b) {
    return (
      pos.x + half.x > b.min[0] && pos.x - half.x < b.max[0] &&
      pos.z + half.z > b.min[2] && pos.z - half.z < b.max[2]
    );
  }

  dispose() {}
}
