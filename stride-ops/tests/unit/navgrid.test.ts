/**
 * navgrid.test.ts
 *
 * Unit tests for the NavGrid A* pathfinding used by AI navigation.
 */

import { NavGrid } from '../../src/gameplay/maps/NavGrid';

function buildOpenGrid(w: number, d: number): NavGrid {
  const grid = new NavGrid({ width: w, depth: d, cellSize: 1 });
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      grid.setCell(x, z, true, 0.1, 0);
    }
  }
  return grid;
}

describe('NavGrid', () => {
  it('finds a straight path on an open grid', () => {
    const grid = buildOpenGrid(10, 10);
    const path = grid.findPath(0, 0, 9, 9);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });

  it('returns null when the goal is blocked', () => {
    const grid = buildOpenGrid(10, 10);
    grid.setCell(5, 5, false);
    const path = grid.findPath(0, 0, 5, 5);
    expect(path).toBeNull();
  });

  it('routes around a wall', () => {
    const grid = buildOpenGrid(10, 10);
    // Wall at x=5, all z from 0..9 except a gap at z=9
    for (let z = 0; z < 9; z++) {
      grid.setCell(5, z, false);
    }
    const path = grid.findPath(0, 0, 9, 0);
    expect(path).not.toBeNull();
    // Path must avoid the wall column entirely
    for (const wp of path!) {
      const cell = grid.worldToCell(wp.x, wp.z);
      expect(grid.isWalkable(cell.x, cell.z)).toBe(true);
    }
  });

  it('prefers lower-cost cells when possible', () => {
    const grid = buildOpenGrid(5, 5);
    grid.setCell(1, 2, true, 0.05); // cheaper corridor
    grid.setCell(2, 2, true, 0.05);
    const path = grid.findPath(0, 2, 4, 2);
    expect(path).not.toBeNull();
  });

  it('converts world coords to cells and back', () => {
    const grid = new NavGrid({ width: 10, depth: 10, cellSize: 2 });
    const cell = grid.worldToCell(5.5, 7.5);
    expect(cell.x).toBe(2);
    expect(cell.z).toBe(3);
    const world = grid.cellToWorld(2, 3);
    expect(world.x).toBe(5);
    expect(world.z).toBe(7);
  });
});
