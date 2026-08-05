/**
 * NavGrid.ts
 *
 * Grid-based navigation mesh for AI pathfinding.
 * Built alongside procedural map geometry so enemies can navigate
 * immediately after generation.
 *
 * @module Gameplay
 */

export interface NavGridConfig {
  width: number;
  depth: number;
  cellSize: number;
}

export interface NavCell {
  x: number;
  z: number;
  walkable: boolean;
  /** Cost modifier (0..1). Lower is easier to traverse. */
  cost: number;
  /** World-space ground height at this cell. */
  height: number;
}

/**
 * A lightweight uniform navigation grid with A* pathfinding.
 */
export class NavGrid {
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;
  private readonly cells: Uint8Array; // 1 = walkable
  private readonly costs: Float32Array;
  private readonly heights: Float32Array;

  constructor(config: NavGridConfig) {
    this.width = config.width;
    this.depth = config.depth;
    this.cellSize = config.cellSize;
    this.cells = new Uint8Array(this.width * this.depth);
    this.costs = new Float32Array(this.width * this.depth);
    this.heights = new Float32Array(this.width * this.depth);
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && x < this.width && z >= 0 && z < this.depth;
  }

  isWalkable(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.cells[this.index(x, z)] === 1;
  }

  getCost(x: number, z: number): number {
    return this.inBounds(x, z) ? this.costs[this.index(x, z)] : 1;
  }

  getHeight(x: number, z: number): number {
    return this.inBounds(x, z) ? this.heights[this.index(x, z)] : 0;
  }

  setCell(x: number, z: number, walkable: boolean, cost = 1, height = 0): void {
    if (!this.inBounds(x, z)) return;
    const i = this.index(x, z);
    this.cells[i] = walkable ? 1 : 0;
    this.costs[i] = cost;
    this.heights[i] = height;
  }

  /** World position → grid coords. */
  worldToCell(wx: number, wz: number): { x: number; z: number } {
    return {
      x: Math.floor(wx / this.cellSize),
      z: Math.floor(wz / this.cellSize),
    };
  }

  /** Grid coords → world center position. */
  cellToWorld(x: number, z: number): { x: number; z: number } {
    return {
      x: (x + 0.5) * this.cellSize,
      z: (z + 0.5) * this.cellSize,
    };
  }

  /**
   * A* pathfinding from one cell to another. Returns a list of
   * world-space waypoints (including start and goal) or null.
   */
  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number
  ): { x: number; z: number }[] | null {
    const s = this.worldToCell(startX, startZ);
    const g = this.worldToCell(goalX, goalZ);

    if (!this.isWalkable(s.x, s.z)) return null;
    if (!this.isWalkable(g.x, g.z)) return null;

    const open = new PriorityQueue<{ x: number; z: number }>();
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();

    const key = (x: number, z: number): number => z * this.width + x;
    const startKey = key(s.x, s.z);
    const goalKey = key(g.x, g.z);

    gScore.set(startKey, 0);
    fScore.set(startKey, this.heuristic(s.x, s.z, g.x, g.z));
    open.push({ x: s.x, z: s.z }, fScore.get(startKey)!);

    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    let iterations = 0;
    while (!open.isEmpty() && iterations < 20000) {
      const current = open.pop()!;
      const currentKey = key(current.x, current.z);
      iterations++;

      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, startKey, goalKey, s.x, s.z);
      }

      for (const [dx, dz] of dirs) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        if (!this.isWalkable(nx, nz)) continue;

        // Prevent corner cutting through diagonals
        if (dx !== 0 && dz !== 0) {
          if (!this.isWalkable(current.x + dx, current.z) || !this.isWalkable(current.x, current.z + dz)) {
            continue;
          }
        }

        const moveCost = (Math.abs(dx) + Math.abs(dz) === 2 ? 1.41421 : 1) * this.getCost(nx, nz);
        const nKey = key(nx, nz);
        const tentative = (gScore.get(currentKey) ?? Infinity) + moveCost;

        if (tentative < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, currentKey);
          gScore.set(nKey, tentative);
          const f = tentative + this.heuristic(nx, nz, g.x, g.z);
          fScore.set(nKey, f);
          open.push({ x: nx, z: nz }, f);
        }
      }
    }

    return null;
  }

  private heuristic(x: number, z: number, gx: number, gz: number): number {
    return Math.abs(x - gx) + Math.abs(z - gz);
  }

  private reconstructPath(
    cameFrom: Map<number, number>,
    startKey: number,
    goalKey: number,
    sx: number,
    sz: number
  ): { x: number; z: number }[] {
    const path: { x: number; z: number }[] = [];
    let current = goalKey;

    while (current !== startKey) {
      const x = current % this.width;
      const z = Math.floor(current / this.width);
      path.unshift({ x, z });
      const next = cameFrom.get(current);
      if (next === undefined) break;
      current = next;
    }

    const start = { x: sx, z: sz };
    path.unshift(start);
    return path.map((c) => this.cellToWorld(c.x, c.z));
  }
}

/** Minimal binary-heap priority queue for A*. */
class PriorityQueue<T> {
  private items: { item: T; priority: number }[] = [];

  push(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  pop(): T | undefined {
    return this.items.shift()?.item;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}
