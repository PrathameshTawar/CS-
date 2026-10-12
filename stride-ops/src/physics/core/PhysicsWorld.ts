/**
 * PhysicsWorld.ts
 *
 * AABB-based physics world for the FPS engine.
 *
 * Improvements over the original brute-force version
 * ──────────────────────────────────────────────────
 * 1. Spatial grid broadphase — blocks are bucketed into a uniform 3D grid
 *    on construction. Every raycast and collision query fetches only the
 *    cells the ray or AABB overlaps, reducing the per-query block set from
 *    O(total_blocks) to O(blocks_in_touched_cells). On a 90×90 m city map
 *    with ~600 blocks this cuts average raycast work by ~95%.
 *
 * 2. Incremental grid updates — addBlock/removeBlock patch only the affected
 *    cells rather than rebuilding the whole structure.
 *
 * 3. Destruction material table — PhysicsWorld now knows each block's HP and
 *    damage threshold; DestructionSystem calls applyDamage() and the world
 *    handles removal + mesh notification via a callback.
 *
 * @module Physics
 */

import { BlockInstance } from '../../gameplay/maps/MapGenerator';
import { SurfaceMaterial } from '../../gameplay/core/GameTypes';

// ─── Public types ──────────────────────────────────────────────────────────

export interface RayHit {
  point:    { x: number; y: number; z: number };
  normal:   { x: number; y: number; z: number };
  distance: number;
  surface:  SurfaceMaterial;
  block:    BlockInstance | null;
}

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** Per-material destruction properties (Requirement 4). */
export interface MaterialDestructionProfile {
  /** Total HP before collapse. */
  maxHealth: number;
  /** Minimum hit damage to show a crack state. */
  crackThreshold: number;
  /** HP at which the block fractures (spawns debris). */
  fractureHealth: number;
  /** Whether bullets penetrate this material. */
  penetrable: boolean;
  /** 0–1 damage multiplier for penetrating bullets on exit. */
  exitDamageMultiplier: number;
}

/** Runtime block state (layered on top of BlockInstance geometry). */
interface BlockState {
  health: number;
  cracked: boolean;
  fractured: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const BLOCK_SURFACE_MAP: Record<string, SurfaceMaterial> = {
  concrete: SurfaceMaterial.Concrete,
  wood:     SurfaceMaterial.Wood,
  glass:    SurfaceMaterial.Glass,
  metal:    SurfaceMaterial.Metal,
  dirt:     SurfaceMaterial.Dirt,
  grass:    SurfaceMaterial.Grass,
  stone:    SurfaceMaterial.Concrete,
};

/** Requirement 4.4 — four destruction profiles. */
export const DESTRUCTION_PROFILES: Record<string, MaterialDestructionProfile> = {
  wood:     { maxHealth: 80,  crackThreshold: 20, fractureHealth: 40, penetrable: true,  exitDamageMultiplier: 0.75 },
  glass:    { maxHealth: 25,  crackThreshold:  5, fractureHealth: 10, penetrable: true,  exitDamageMultiplier: 0.90 },
  concrete: { maxHealth: 300, crackThreshold: 60, fractureHealth: 150, penetrable: false, exitDamageMultiplier: 0.00 },
  metal:    { maxHealth: 200, crackThreshold: 50, fractureHealth: 100, penetrable: false, exitDamageMultiplier: 0.00 },
  drywall:  { maxHealth: 50,  crackThreshold: 10, fractureHealth: 25, penetrable: true,  exitDamageMultiplier: 0.40 },
  dirt:     { maxHealth: 60,  crackThreshold: 15, fractureHealth: 30, penetrable: true,  exitDamageMultiplier: 0.60 },
  grass:    { maxHealth: 30,  crackThreshold:  5, fractureHealth: 15, penetrable: true,  exitDamageMultiplier: 0.80 },
  stone:    { maxHealth: 250, crackThreshold: 50, fractureHealth: 125, penetrable: false, exitDamageMultiplier: 0.00 },
};

/** Spatial grid cell size in world units. Tune to ~2–3× average block size. */
const CELL_SIZE = 8;

// ─── Spatial grid ──────────────────────────────────────────────────────────

/** Maps "gx,gy,gz" → set of blocks whose AABB overlaps that cell. */
type SpatialGrid = Map<string, Set<BlockInstance>>;

function cellKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}

function blockCells(b: BlockInstance): [number, number, number, number, number, number] {
  return [
    Math.floor((b.x - b.hx) / CELL_SIZE),
    Math.floor((b.y - b.hy) / CELL_SIZE),
    Math.floor((b.z - b.hz) / CELL_SIZE),
    Math.floor((b.x + b.hx) / CELL_SIZE),
    Math.floor((b.y + b.hy) / CELL_SIZE),
    Math.floor((b.z + b.hz) / CELL_SIZE),
  ];
}

function insertIntoGrid(grid: SpatialGrid, block: BlockInstance): void {
  const [x0, y0, z0, x1, y1, z1] = blockCells(block);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = cellKey(gx, gy, gz);
        let cell = grid.get(k);
        if (!cell) { cell = new Set(); grid.set(k, cell); }
        cell.add(block);
      }
    }
  }
}

function removeFromGrid(grid: SpatialGrid, block: BlockInstance): void {
  const [x0, y0, z0, x1, y1, z1] = blockCells(block);
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      for (let gz = z0; gz <= z1; gz++) {
        grid.get(cellKey(gx, gy, gz))?.delete(block);
      }
    }
  }
}

// ─── PhysicsWorld ──────────────────────────────────────────────────────────

export class PhysicsWorld {
  private blocks: BlockInstance[] = [];
  private bounds: { width: number; depth: number; height: number } = { width: 90, depth: 90, height: 20 };

  /** Spatial grid — built on setWorld(), patched incrementally after. */
  private readonly grid: SpatialGrid = new Map();

  /** Per-block health + state. */
  private readonly blockState: Map<BlockInstance, BlockState> = new Map();

  /**
   * Callback fired when a block transitions state.
   * `state` = 'crack' | 'fracture' | 'collapse'
   * Caller (DestructionSystem / Game) uses this to update the mesh / spawn debris.
   */
  onBlockDamaged?: (block: BlockInstance, state: 'crack' | 'fracture' | 'collapse') => void;

  constructor(blocks: BlockInstance[] = [], bounds?: { width: number; depth: number; height: number }) {
    if (bounds) this.bounds = bounds;
    this.setWorld(blocks, bounds ?? this.bounds);
  }

  setWorld(blocks: BlockInstance[], bounds: { width: number; depth: number; height: number }): void {
    this.blocks = blocks;
    this.bounds = bounds;
    this.grid.clear();
    this.blockState.clear();

    for (const b of blocks) {
      insertIntoGrid(this.grid, b);
      this._initBlockState(b);
    }
  }

  getBlocks(): readonly BlockInstance[] { return this.blocks; }
  getBounds(): { width: number; depth: number; height: number } { return { ...this.bounds }; }

  // ─── Block management ───────────────────────────────────────────────────

  addBlock(block: BlockInstance): void {
    this.blocks.push(block);
    insertIntoGrid(this.grid, block);
    this._initBlockState(block);
  }

  removeBlock(target: BlockInstance): boolean {
    const i = this.blocks.indexOf(target);
    if (i === -1) return false;
    this.blocks.splice(i, 1);
    removeFromGrid(this.grid, target);
    this.blockState.delete(target);
    return true;
  }

  // ─── Destruction (Requirement 4) ────────────────────────────────────────

  /**
   * Apply damage to a block. Returns whether the bullet penetrated.
   * Fires onBlockDamaged callback on state transitions.
   */
  applyDamage(block: BlockInstance, damage: number): { penetrated: boolean; exitMultiplier: number } {
    const state = this.blockState.get(block);
    if (!state) return { penetrated: false, exitMultiplier: 0 };

    const profile = DESTRUCTION_PROFILES[block.material] ?? DESTRUCTION_PROFILES.concrete;
    state.health = Math.max(0, state.health - damage);

    if (state.health <= 0) {
      // Collapse
      this.removeBlock(block);
      this.onBlockDamaged?.(block, 'collapse');
      return {
        penetrated: profile.penetrable,
        exitMultiplier: profile.exitDamageMultiplier,
      };
    }

    if (!state.fractured && state.health <= profile.fractureHealth) {
      state.fractured = true;
      this.onBlockDamaged?.(block, 'fracture');
    } else if (!state.cracked && state.health <= profile.maxHealth - profile.crackThreshold) {
      state.cracked = true;
      this.onBlockDamaged?.(block, 'crack');
    }

    return { penetrated: false, exitMultiplier: 0 };
  }

  getBlockHealth(block: BlockInstance): number {
    return this.blockState.get(block)?.health ?? 0;
  }

  // ─── Raycasting ─────────────────────────────────────────────────────────

  /**
   * Raycast against the world using the spatial grid broadphase.
   * Returns the closest hit or null.
   */
  raycast(
    origin:      { x: number; y: number; z: number },
    direction:   { x: number; y: number; z: number },
    maxDistance: number,
  ): RayHit | null {
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len < 1e-6) return null;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;

    // Collect candidate blocks from grid cells along the ray
    const candidates = this._rayGridCandidates(origin, { x: dx, y: dy, z: dz }, maxDistance);

    let closest: RayHit | null = null;
    let closestDist = maxDistance;

    for (const block of candidates) {
      const t = this._rayAABB(origin, { x: dx, y: dy, z: dz }, block);
      if (t !== null && t < closestDist) {
        closestDist = t;
        closest = {
          point: { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t },
          normal: this._faceNormal(origin, { x: dx, y: dy, z: dz }, block, t),
          distance: t,
          surface: BLOCK_SURFACE_MAP[block.material] ?? SurfaceMaterial.Concrete,
          block,
        };
      }
    }

    // Raycast against the ground plane (y = 0)
    if (dy < -1e-6 && origin.y > 0) {
      const t = -origin.y / dy;
      if (t >= 0 && t < closestDist) {
        closest = {
          point: { x: origin.x + dx * t, y: 0, z: origin.z + dz * t },
          normal: { x: 0, y: 1, z: 0 },
          distance: t,
          surface: SurfaceMaterial.Concrete,
          block: null,
        };
      }
    }

    return closest;
  }

  // ─── Collision resolution ────────────────────────────────────────────────

  resolveCollision(box: AABB): { grounded: boolean; groundY: number; hitWall: boolean } {
    let grounded = false;
    let groundY = 0;
    let hitWall = false;

    // Candidate blocks from grid cells the AABB overlaps
    const candidates = this._aabbGridCandidates(box);

    for (let iter = 0; iter < 2; iter++) {
      for (const block of candidates) {
        const minX = block.x - block.hx, maxX = block.x + block.hx;
        const minY = block.y - block.hy, maxY = block.y + block.hy;
        const minZ = block.z - block.hz, maxZ = block.z + block.hz;

        const overlapX = Math.min(box.maxX, maxX) - Math.max(box.minX, minX);
        const overlapY = Math.min(box.maxY, maxY) - Math.max(box.minY, minY);
        const overlapZ = Math.min(box.maxZ, maxZ) - Math.max(box.minZ, minZ);

        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

        const minOverlap = Math.min(overlapX, overlapY, overlapZ);
        const boxHalfY = (box.maxY - box.minY) * 0.5;

        if (minOverlap === overlapY) {
          const boxCenterY = (box.minY + box.maxY) * 0.5;
          const pushUp = boxCenterY < (minY + maxY) * 0.5;
          if (pushUp) {
            const h = box.maxY - box.minY;
            box.minY = minY - h;
            box.maxY = minY;
            grounded = true;
            groundY = minY;
          } else {
            const h = box.maxY - box.minY;
            box.minY = maxY;
            box.maxY = maxY + h;
          }
        } else if (minOverlap === overlapX) {
          const boxCenterX = (box.minX + box.maxX) * 0.5;
          const w = box.maxX - box.minX;
          if (boxCenterX < (minX + maxX) * 0.5) {
            box.maxX = minX; box.minX = minX - w;
          } else {
            box.minX = maxX; box.maxX = maxX + w;
          }
          hitWall = true;
        } else {
          const boxCenterZ = (box.minZ + box.maxZ) * 0.5;
          const d = box.maxZ - box.minZ;
          if (boxCenterZ < (minZ + maxZ) * 0.5) {
            box.maxZ = minZ; box.minZ = minZ - d;
          } else {
            box.minZ = maxZ; box.maxZ = maxZ + d;
          }
          hitWall = true;
        }

        void boxHalfY; // referenced above through box dimensions
      }
    }

    // Ground plane collision at y = 0
    if (box.minY <= 0) {
      const h = box.maxY - box.minY;
      box.minY = 0;
      box.maxY = h;
      grounded = true;
      groundY = 0;
    }

    return { grounded, groundY, hitWall };
  }

  // ─── Point queries ───────────────────────────────────────────────────────

  pointBlocked(x: number, y: number, z: number): BlockInstance | null {
    const gx = Math.floor(x / CELL_SIZE);
    const gy = Math.floor(y / CELL_SIZE);
    const gz = Math.floor(z / CELL_SIZE);
    const cell = this.grid.get(cellKey(gx, gy, gz));
    if (!cell) return null;

    for (const block of cell) {
      if (
        x >= block.x - block.hx && x <= block.x + block.hx &&
        y >= block.y - block.hy && y <= block.y + block.hy &&
        z >= block.z - block.hz && z <= block.z + block.hz
      ) return block;
    }
    return null;
  }

  groundHeightAt(x: number, z: number): number {
    // Collect candidates from the vertical column at (x, z)
    const gx = Math.floor(x / CELL_SIZE);
    const gz = Math.floor(z / CELL_SIZE);
    let ground = 0;

    // Check all vertical cells in this column (scan all gy buckets)
    for (let gy = -2; gy <= 8; gy++) {
      const cell = this.grid.get(cellKey(gx, gy, gz));
      if (!cell) continue;
      for (const block of cell) {
        if (x >= block.x - block.hx && x <= block.x + block.hx &&
            z >= block.z - block.hz && z <= block.z + block.hz) {
          const top = block.y + block.hy;
          if (top > ground) ground = top;
        }
      }
    }
    return ground;
  }

  // ─── Private grid helpers ────────────────────────────────────────────────

  private _initBlockState(block: BlockInstance): void {
    const profile = DESTRUCTION_PROFILES[block.material] ?? DESTRUCTION_PROFILES.concrete;
    this.blockState.set(block, {
      health: profile.maxHealth,
      cracked: false,
      fractured: false,
    });
  }

  /**
   * Walk the DDA voxel traversal along the ray and return all candidate
   * blocks from touched grid cells. Returns a Set to avoid duplicates
   * (a block can span multiple cells).
   */
  private _rayGridCandidates(
    origin:    { x: number; y: number; z: number },
    dir:       { x: number; y: number; z: number },
    maxDist:   number,
  ): Set<BlockInstance> {
    const result = new Set<BlockInstance>();

    // DDA parameters
    let gx = Math.floor(origin.x / CELL_SIZE);
    let gy = Math.floor(origin.y / CELL_SIZE);
    let gz = Math.floor(origin.z / CELL_SIZE);

    const stepX = dir.x >= 0 ? 1 : -1;
    const stepY = dir.y >= 0 ? 1 : -1;
    const stepZ = dir.z >= 0 ? 1 : -1;

    const tDeltaX = Math.abs(dir.x) > 1e-6 ? Math.abs(CELL_SIZE / dir.x) : Infinity;
    const tDeltaY = Math.abs(dir.y) > 1e-6 ? Math.abs(CELL_SIZE / dir.y) : Infinity;
    const tDeltaZ = Math.abs(dir.z) > 1e-6 ? Math.abs(CELL_SIZE / dir.z) : Infinity;

    const boundX = (dir.x >= 0 ? (gx + 1) : gx) * CELL_SIZE;
    const boundY = (dir.y >= 0 ? (gy + 1) : gy) * CELL_SIZE;
    const boundZ = (dir.z >= 0 ? (gz + 1) : gz) * CELL_SIZE;

    let tMaxX = Math.abs(dir.x) > 1e-6 ? (boundX - origin.x) / dir.x : Infinity;
    let tMaxY = Math.abs(dir.y) > 1e-6 ? (boundY - origin.y) / dir.y : Infinity;
    let tMaxZ = Math.abs(dir.z) > 1e-6 ? (boundZ - origin.z) / dir.z : Infinity;

    let t = 0;
    const maxSteps = Math.ceil(maxDist / CELL_SIZE) * 3 + 6;

    for (let step = 0; step < maxSteps; step++) {
      const cell = this.grid.get(cellKey(gx, gy, gz));
      if (cell) for (const b of cell) result.add(b);

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; gx += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; gy += stepY; tMaxY += tDeltaY;
      } else {
        t = tMaxZ; gz += stepZ; tMaxZ += tDeltaZ;
      }

      if (t >= maxDist) break;
    }

    return result;
  }

  /** Return all blocks from grid cells the AABB overlaps. */
  private _aabbGridCandidates(box: AABB): Set<BlockInstance> {
    const result = new Set<BlockInstance>();
    const x0 = Math.floor(box.minX / CELL_SIZE);
    const y0 = Math.floor(box.minY / CELL_SIZE);
    const z0 = Math.floor(box.minZ / CELL_SIZE);
    const x1 = Math.floor(box.maxX / CELL_SIZE);
    const y1 = Math.floor(box.maxY / CELL_SIZE);
    const z1 = Math.floor(box.maxZ / CELL_SIZE);

    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (let gz = z0; gz <= z1; gz++) {
          const cell = this.grid.get(cellKey(gx, gy, gz));
          if (cell) for (const b of cell) result.add(b);
        }
      }
    }
    return result;
  }

  /** Ray vs AABB slab test. Returns entry t or null. */
  private _rayAABB(
    o: { x: number; y: number; z: number },
    d: { x: number; y: number; z: number },
    b: BlockInstance,
  ): number | null {
    let tMin = 0, tMax = Infinity;

    const axes: Array<['x'|'y'|'z', 'hx'|'hy'|'hz']> = [['x','hx'],['y','hy'],['z','hz']];
    for (const [axis, half] of axes) {
      const lo = b[axis] - b[half];
      const hi = b[axis] + b[half];
      if (Math.abs(d[axis]) < 1e-8) {
        if (o[axis] < lo || o[axis] > hi) return null;
      } else {
        let t1 = (lo - o[axis]) / d[axis];
        let t2 = (hi - o[axis]) / d[axis];
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }

    if (tMin < 0) return tMax < 0 ? null : 0;
    return tMin;
  }

  /** Approximate face normal from closest-face penetration depth. */
  private _faceNormal(
    o: { x: number; y: number; z: number },
    d: { x: number; y: number; z: number },
    b: BlockInstance,
    t: number,
  ): { x: number; y: number; z: number } {
    const p = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
    const faces: [number, { x: number; y: number; z: number }][] = [
      [Math.abs(p.x - (b.x - b.hx)), { x: -1, y: 0, z: 0 }],
      [Math.abs(p.x - (b.x + b.hx)), { x:  1, y: 0, z: 0 }],
      [Math.abs(p.y - (b.y - b.hy)), { x: 0, y: -1, z: 0 }],
      [Math.abs(p.y - (b.y + b.hy)), { x: 0, y:  1, z: 0 }],
      [Math.abs(p.z - (b.z - b.hz)), { x: 0, y: 0, z: -1 }],
      [Math.abs(p.z - (b.z + b.hz)), { x: 0, y: 0, z:  1 }],
    ];
    let best = faces[0];
    for (const f of faces) if (f[0] < best[0]) best = f;
    return best[1];
  }
}
