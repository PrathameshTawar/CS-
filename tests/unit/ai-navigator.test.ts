/**
 * ai-navigator.test.ts
 *
 * Unit tests for the AINavigator (pathfinding wrapper, Requirement 9):
 * A* pathfinding around obstacles, blocked-start rejection, and
 * waypoint following.
 */

import * as THREE from 'three';
import { NavGrid } from '../../src/gameplay/maps/NavGrid';
import { AINavigator } from '../../src/ai/navigation/AINavigator';

/** 20x20 walkable grid with a solid vertical wall at x=10 (gap at z=15). */
function makeObstacleGrid(): NavGrid {
  const grid = new NavGrid({ width: 20, depth: 20, cellSize: 1.5 });
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 20; z++) {
      grid.setCell(x, z, true, 0.1);
    }
  }
  // Wall at x=10, z=0..19 except a gap at z=15
  for (let z = 0; z < 20; z++) {
    if (z !== 15) {
      grid.setCell(10, z, false);
    }
  }
  return grid;
}

describe('AINavigator', () => {
  it('finds a path around an obstacle wall', () => {
    const grid = makeObstacleGrid();
    const nav = new AINavigator(grid);
    // Start west of the wall (x=10), goal east of it — must detour via the
    // gap at z=15 because cell (10,1) is inside the wall.
    const from = new THREE.Vector3(2, 0, 2);
    const to = new THREE.Vector3(24, 0, 2);

    expect(nav.setTarget(from, to)).toBe(true);
    expect(nav.getPathLength()).toBeGreaterThan(2);

    // Steering exists and moves toward the goal
    const steer = nav.steer(from);
    expect(steer).not.toBeNull();
    expect(steer!.length()).toBeCloseTo(1, 5);
  });

  it('returns false when the start is not walkable', () => {
    const grid = makeObstacleGrid();
    const nav = new AINavigator(grid);
    // Start inside the wall (x=10 is blocked except z=15)
    const from = new THREE.Vector3(15, 0, 3);
    const to = new THREE.Vector3(16, 0, 2);
    expect(nav.setTarget(from, to)).toBe(false);
    expect(nav.hasPath).toBe(false);
  });

  it('advances through waypoints and completes the path', () => {
    const grid = new NavGrid({ width: 10, depth: 10, cellSize: 1.5 });
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setCell(x, z, true, 0.1);
      }
    }
    const nav = new AINavigator(grid);
    const from = new THREE.Vector3(1.5, 0, 1.5);
    const to = new THREE.Vector3(12, 0, 12);
    expect(nav.setTarget(from, to)).toBe(true);

    // Follow waypoints until null
    let steps = 0;
    let pos = from.clone();
    let wp = nav.steer(pos);
    while (wp && steps < 50) {
      // Move toward the waypoint
      pos.add(wp.multiplyScalar(1.4));
      pos.y = 0;
      wp = nav.steer(pos);
      steps++;
    }
    expect(steps).toBeGreaterThan(0);
    expect(pos.distanceTo(to)).toBeLessThan(3);
  });

  it('re-plans periodically toward a moving target', () => {
    const grid = makeObstacleGrid();
    const nav = new AINavigator(grid);
    const from = new THREE.Vector3(2, 0, 2);
    const to = new THREE.Vector3(24, 0, 2);
    expect(nav.setTarget(from, to)).toBe(true);

    // update() with >0.6s of time triggers a re-plan
    nav.update(from, to, 0.7);
    expect(nav.hasPath).toBe(true);
  });
});
