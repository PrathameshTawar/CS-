// shared/nav.js — where a player can walk, and the way there (for bots).
//
// A grid over the map, built once from its static colliders: each cell is
// the highest floor at its centre where a standing player fits, or not
// walkable. Neighbouring cells connect when the step between them is one a
// player can walk up, or a drop of at most MAX_DROP (no fall damage). Paths
// are A* over the 8-connected grid, with no corner cutting past walls.
// Pure JS, deterministic.

import { CollisionWorld } from './collision.js';
import { HALF, STEP_H } from './movement.js';

export const CELL = 0.5; // m
const MAX_DROP = 3; // m: safe to fall (fall damage starts above ~3.4 m)
const CLEAR = 0.42; // m: half-width kept clear of walls (a player is 0.34)
const NONE = -Infinity;

const cache = new WeakMap(); // colliders array -> grid

// The grid for a map's colliders, keeping only the floor reachable from the
// `seeds` ([[x, z], ...]: spawn points), not wall tops nobody gets onto.
// Cached: rooms on one map share it.
export function navGrid(boxes, seeds) {
  let g = cache.get(boxes);
  if (!g) {
    g = buildGrid(boxes);
    keepReachable(g, seeds);
    cache.set(boxes, g);
  }
  return g;
}

// Unwalkable from now on: every cell no seed can walk to.
function keepReachable(g, seeds) {
  const seen = new Uint8Array(g.w * g.d);
  const stack = [];
  for (const [x, z] of seeds) {
    const [i, j] = cellOf(g, x, z);
    if (walkable(g, i, j) && !seen[j * g.w + i]) {
      seen[j * g.w + i] = 1;
      stack.push(j * g.w + i);
    }
  }
  while (stack.length) {
    const cur = stack.pop();
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;
    for (const [di, dj] of DIRS) {
      const i = ci + di;
      const j = cj + dj;
      if (!inside(g, i, j)) continue;
      const idx = j * g.w + i;
      if (!seen[idx] && passable(g.h[cur], g.h[idx])) {
        seen[idx] = 1;
        stack.push(idx);
      }
    }
  }
  for (let k = 0; k < g.h.length; k++) if (!seen[k]) g.h[k] = NONE;
}

function buildGrid(boxes) {
  const world = new CollisionWorld(boxes);
  // the walkable extent: the floors' footprint
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.min[0]);
    x1 = Math.max(x1, b.max[0]);
    z0 = Math.min(z0, b.min[2]);
    z1 = Math.max(z1, b.max[2]);
  }
  const w = Math.ceil((x1 - x0) / CELL);
  const d = Math.ceil((z1 - z0) / CELL);
  const h = new Float64Array(w * d).fill(NONE);
  const probe = { x: 0, y: 0, z: 0 };
  const clear = { x: CLEAR, y: HALF.y - STEP_H / 2, z: CLEAR };
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + (i + 0.5) * CELL;
      const z = z0 + (j + 0.5) * CELL;
      // floors under the centre, highest first; the first one a player fits on
      const tops = [];
      for (const b of boxes) {
        if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]) tops.push(b.max[1]);
      }
      tops.sort((a, b) => b - a);
      for (const top of tops) {
        // the standing box, lifted a step: anything lower is walked onto
        probe.x = x;
        probe.y = top + STEP_H + clear.y + 0.01;
        probe.z = z;
        if (!world.overlaps(probe, clear)) {
          h[j * w + i] = top;
          break;
        }
      }
    }
  }
  const n = w * d;
  // A* scratch, reused by every search on this grid
  return { x0, z0, w, d, h, cost: new Float64Array(n), from: new Int32Array(n), mark: new Uint32Array(n), stamp: 0 };
}

const cellOf = (g, x, z) => [Math.floor((x - g.x0) / CELL), Math.floor((z - g.z0) / CELL)];
const inside = (g, i, j) => i >= 0 && j >= 0 && i < g.w && j < g.d;
const height = (g, i, j) => (inside(g, i, j) ? g.h[j * g.w + i] : NONE);
const walkable = (g, i, j) => height(g, i, j) !== NONE;

// Can a player go from height a to height b in one cell?
const passable = (a, b) => a !== NONE && b !== NONE && b - a <= STEP_H + 0.02 && a - b <= MAX_DROP;

// The floor height at (x, z), or null where nobody can stand.
export function floorAt(g, x, z) {
  const [i, j] = cellOf(g, x, z);
  const v = height(g, i, j);
  return v === NONE ? null : v;
}

// The walkable cell nearest (x, z), searching outwards up to `radius` m;
// returns its centre { x, z } or null.
export function nearestWalkable(g, x, z, radius = 4) {
  const [ci, cj] = cellOf(g, x, z);
  const r = Math.ceil(radius / CELL);
  for (let k = 0; k <= r; k++) {
    let best = null;
    let bestD = Infinity;
    for (let j = cj - k; j <= cj + k; j++) {
      for (let i = ci - k; i <= ci + k; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== k || !walkable(g, i, j)) continue;
        const dd = (i - ci) ** 2 + (j - cj) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = { x: g.x0 + (i + 0.5) * CELL, z: g.z0 + (j + 0.5) * CELL };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// Is the straight walk from (ax, az) to (bx, bz) clear on the grid?
export function walkLine(g, ax, az, bx, bz) {
  const dist = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(dist / (CELL / 2)));
  let [pi, pj] = cellOf(g, ax, az);
  let prev = height(g, pi, pj);
  if (prev === NONE) return false;
  for (let k = 1; k <= n; k++) {
    const [i, j] = cellOf(g, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    if (i === pi && j === pj) continue;
    const cur = height(g, i, j);
    if (!passable(prev, cur)) return false;
    // a diagonal step between cells must not clip a corner
    if (i !== pi && j !== pj && (!walkable(g, i, pj) || !walkable(g, pi, j))) return false;
    pi = i;
    pj = j;
    prev = cur;
  }
  return true;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// A* from (ax, az) to (bx, bz). Returns waypoints [{ x, z }, ...] (cell
// centres, the start excluded, the goal last) or null when there's no way.
export function findPath(g, ax, az, bx, bz) {
  const start = nearestWalkable(g, ax, az, 2);
  const goal = nearestWalkable(g, bx, bz, 4);
  if (!start || !goal) return null;
  const [si, sj] = cellOf(g, start.x, start.z);
  const [gi, gj] = cellOf(g, goal.x, goal.z);
  const sIdx = sj * g.w + si;
  const gIdx = gj * g.w + gi;
  // mark[k] === stamp: seen this search (open), stamp + 1: closed
  g.stamp += 2;
  const { cost, from, mark, stamp } = g;
  const hEst = (i, j) => {
    const dx = Math.abs(i - gi);
    const dz = Math.abs(j - gj);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const heap = new Heap();
  cost[sIdx] = 0;
  mark[sIdx] = stamp;
  heap.push(sIdx, hEst(si, sj));
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === gIdx) {
      found = true;
      break;
    }
    if (mark[cur] === stamp + 1) continue;
    mark[cur] = stamp + 1;
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;
    const ch = g.h[cur];
    for (const [di, dj, step] of DIRS) {
      const i = ci + di;
      const j = cj + dj;
      if (!inside(g, i, j)) continue;
      const idx = j * g.w + i;
      if (mark[idx] === stamp + 1 || !passable(ch, g.h[idx])) continue;
      if (di && dj && (!walkable(g, ci + di, cj) || !walkable(g, ci, cj + dj))) continue; // corner
      const c = cost[cur] + step;
      if (mark[idx] !== stamp || c < cost[idx]) {
        mark[idx] = stamp;
        cost[idx] = c;
        from[idx] = cur;
        heap.push(idx, c + hEst(i, j));
      }
    }
  }
  if (!found) return null;
  const path = [];
  for (let at = gIdx; at !== sIdx; at = from[at]) {
    const i = at % g.w;
    path.push({ x: g.x0 + (i + 0.5) * CELL, z: g.z0 + ((at - i) / g.w + 0.5) * CELL });
  }
  path.reverse();
  return path;
}

// A small binary min-heap of (id, priority).
class Heap {
  constructor() {
    this.ids = [];
    this.pri = [];
  }
  get size() {
    return this.ids.length;
  }
  push(id, p) {
    const { ids, pri } = this;
    let k = ids.length;
    ids.push(id);
    pri.push(p);
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (pri[up] <= p) break;
      ids[k] = ids[up];
      pri[k] = pri[up];
      k = up;
    }
    ids[k] = id;
    pri[k] = p;
  }
  pop() {
    const { ids, pri } = this;
    const top = ids[0];
    const lastId = ids.pop();
    const lastP = pri.pop();
    if (ids.length) {
      let k = 0;
      const len = ids.length;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= len) break;
        if (c + 1 < len && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[k] = ids[c];
        pri[k] = pri[c];
        k = c;
      }
      ids[k] = lastId;
      pri[k] = lastP;
    }
    return top;
  }
}
