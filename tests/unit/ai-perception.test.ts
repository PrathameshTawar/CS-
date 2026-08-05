/**
 * ai-perception.test.ts
 *
 * Unit tests for the AI PerceptionSystem (Requirements 9, 10):
 * hearing gating (silent/zero-radius sounds), FOV + line-of-sight
 * checks, smoke occlusion, and search sweeps.
 */

import * as THREE from 'three';
import { PerceptionSystem } from '../../src/ai/perception/PerceptionSystem';
import { PhysicsWorld } from '../../src/physics/core/PhysicsWorld';
import { SoundEvent } from '../../src/gameplay/core/GameTypes';

function makePhysics(): PhysicsWorld {
  return new PhysicsWorld([], { width: 90, depth: 90, height: 20 });
}

describe('PerceptionSystem.hear', () => {
  it('never hears silent or zero-radius sounds (Requirement 9.4)', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 20, 60, 120);
    const listener = new THREE.Vector3(0, 0, 0);

    const silent: SoundEvent = { type: 'gunshot', position: { x: 2, y: 0, z: 0 }, radius: 0, volume: 1 };
    expect(p.hear(silent, listener, 0)).toBe(false);

    const quiet: SoundEvent = { type: 'footstep', position: { x: 2, y: 0, z: 0 }, radius: 10, volume: 0 };
    expect(p.hear(quiet, listener, 0)).toBe(false);
  });

  it('hears loud sounds within range and records position', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 20, 60, 120);
    const listener = new THREE.Vector3(0, 0, 0);

    const loud: SoundEvent = { type: 'gunshot', position: { x: 5, y: 0, z: 0 }, radius: 50, volume: 1 };
    expect(p.hear(loud, listener, 10)).toBe(true);
    expect(p.getMemory().lastSoundPosition?.x).toBeCloseTo(5, 5);
    expect(p.getMemory().lastSoundTime).toBe(10);
    expect(p.getMemory().lastSoundType).toBe('gunshot');
  });

  it('ignores sounds beyond effective hearing radius', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 60, 120);
    const listener = new THREE.Vector3(0, 0, 0);

    const far: SoundEvent = { type: 'explosion', position: { x: 100, y: 0, z: 0 }, radius: 200, volume: 1 };
    expect(p.hear(far, listener, 0)).toBe(false);
  });
});

describe('PerceptionSystem.canSee', () => {
  it('returns false when the target is beyond sight range', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 30, 120);
    const eye = new THREE.Vector3(0, 1.5, 0);
    const facing = new THREE.Vector3(0, 0, -1);
    const far = new THREE.Vector3(0, 1.5, -100);
    expect(p.canSee(eye, facing, far, 0).visible).toBe(false);
  });

  it('respects the FOV cone', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 30, 90);
    const eye = new THREE.Vector3(0, 1.5, 0);
    const facing = new THREE.Vector3(0, 0, -1);
    // Directly behind the observer (180°) — outside a 90° FOV
    const behind = new THREE.Vector3(0, 1.5, 5);
    expect(p.canSee(eye, facing, behind, 0).visible).toBe(false);
    // Directly in front — inside FOV
    const front = new THREE.Vector3(0, 1.5, -5);
    expect(p.canSee(eye, facing, front, 0).visible).toBe(true);
  });

  it('is blocked by smoke occlusion (Requirement 8.1)', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 30, 120);
    p.setOcclusionChecker(() => true);
    const eye = new THREE.Vector3(0, 1.5, 0);
    const facing = new THREE.Vector3(0, 0, -1);
    const target = new THREE.Vector3(0, 1.5, -10);
    expect(p.canSee(eye, facing, target, 0).visible).toBe(false);
    expect(p.getMemory().seesPlayer).toBe(false);
  });

  it('is blocked by solid blocks (line of sight raycast)', () => {
    const wall = { x: 0, y: 2, z: -4, hx: 2, hy: 2, hz: 0.5, material: 'concrete' as const, destructible: false, color: 0x888888 };
    const physics = new PhysicsWorld([wall], { width: 90, depth: 90, height: 20 });
    const p = new PerceptionSystem(physics, 10, 40, 120);
    const eye = new THREE.Vector3(0, 1.5, 0);
    const facing = new THREE.Vector3(0, 0, -1);
    const target = new THREE.Vector3(0, 1.5, -10);
    expect(p.canSee(eye, facing, target, 0).visible).toBe(false);
  });
});

describe('PerceptionSystem search', () => {
  it('sweeps around the search center then finishes', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 30, 120);
    const center = new THREE.Vector3(10, 0, 10);
    p.startSearch(center, 0);

    const point = p.updateSearch(1, 5);
    expect(point).not.toBeNull();
    expect(point!.x).toBeGreaterThan(9);

    // Past the duration → done
    expect(p.updateSearch(10, 5)).toBeNull();
    expect(p.getMemory().searching).toBe(false);
  });

  it('returns null when no search is active', () => {
    const physics = makePhysics();
    const p = new PerceptionSystem(physics, 10, 30, 120);
    expect(p.updateSearch(0, 5)).toBeNull();
  });
});
