/**
 * AINavigator.ts
 *
 * Navigation helper for AI enemies. Wraps the NavGrid pathfinding with
 * waypoint following and simple obstacle avoidance.
 *
 * @module AI
 */

import * as THREE from 'three';
import { NavGrid } from '../../gameplay/maps/NavGrid';

export class AINavigator {
  private readonly navGrid: NavGrid;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private recalcTimer = 0;
  private readonly recalcInterval = 0.6;

  constructor(navGrid: NavGrid) {
    this.navGrid = navGrid;
  }

  get hasPath(): boolean {
    return this.path.length > 0 && this.pathIndex < this.path.length;
  }

  /**
   * Set a target to navigate toward. Recomputes the path immediately.
   */
  setTarget(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const path = this.navGrid.findPath(from.x, from.z, to.x, to.z);
    if (!path) return false;
    this.path = path;
    this.pathIndex = 1; // skip start (we're already there)
    return true;
  }

  /**
   * Periodic re-plan toward the target (cheap, prevents walking into new obstacles).
   */
  update(from: THREE.Vector3, to: THREE.Vector3, deltaTime: number): void {
    this.recalcTimer += deltaTime;
    if (this.recalcTimer >= this.recalcInterval) {
      this.recalcTimer = 0;
      const path = this.navGrid.findPath(from.x, from.z, to.x, to.z);
      if (path) {
        this.path = path;
        this.pathIndex = 1;
      }
    }
  }

  /**
   * Get the next waypoint. Returns null if no path or path complete.
   * Advances the path when the waypoint is reached.
   */
  getNextWaypoint(position: THREE.Vector3, arrivalRadius = 1.2): THREE.Vector3 | null {
    if (this.pathIndex >= this.path.length) return null;
    const wp = this.path[this.pathIndex];
    const target = new THREE.Vector3(wp.x, position.y, wp.z);

    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < arrivalRadius * arrivalRadius) {
      this.pathIndex++;
      return this.getNextWaypoint(position, arrivalRadius);
    }
    return target;
  }

  /**
   * Steering direction toward the current waypoint (unit vector) or null.
   */
  steer(position: THREE.Vector3): THREE.Vector3 | null {
    const wp = this.getNextWaypoint(position);
    if (!wp) return null;
    const dir = new THREE.Vector3(wp.x - position.x, 0, wp.z - position.z);
    if (dir.lengthSq() < 1e-4) return null;
    return dir.normalize();
  }

  clear(): void {
    this.path.length = 0;
    this.pathIndex = 0;
  }

  getPathLength(): number {
    return this.path.length;
  }
}
