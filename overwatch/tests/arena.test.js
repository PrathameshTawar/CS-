// tests/arena.test.js — competitive arena fairness and integrity tests.
//
// Verifies:
// 1. No spawn sightlines: no ALPHA spawn can see any BRAVO spawn at eye or chest height.
// 2. Full reachability: flood-fill with character dimensions proves all spawns can reach each other.
// 3. Three real routes: spawns remain connected when ANY single lane is blocked.
// 4. Equal timing: distances and walk times from spawns to center line match between teams.
// 5. Perimeter containment: edge walls stop players from leaving the bounds or falling off.
// 6. Server Room integration: match starts on arena with correct team spawns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA } from '../shared/maps/arena.js';
import { CollisionWorld } from '../shared/collision.js';
import { traceShot } from '../shared/combat.js';
import { HALF, STEP_H, WALK, EYE_STAND, EYE_CROUCH, createMoveState, stepMove } from '../shared/movement.js';
import { Room } from '../server/room.js';
import { PHASE_FREEZE, PHASE_LIVE, PHASE_WARMUP } from '../shared/protocol.js';

const world = new CollisionWorld(ARENA.boxes);

test('no spawn sightline: no ALPHA spawn can see any BRAVO spawn', () => {
  const [alphaSpawns, bravoSpawns] = ARENA.spawns;

  for (let a = 0; a < alphaSpawns.length; a++) {
    const [ax, az] = alphaSpawns[a];
    for (let b = 0; b < bravoSpawns.length; b++) {
      const [bx, bz] = bravoSpawns[b];
      const dx = bx - ax;
      const dz = bz - az;
      const dist = Math.hypot(dx, dz);
      const dir = { x: dx / dist, y: 0, z: dz / dist };

      // Eye height check (standing eye height 1.7m)
      const eyeOrigin = { x: ax, y: EYE_STAND, z: az };
      const eyeHit = traceShot(world, eyeOrigin, dir);
      assert.ok(
        eyeHit && eyeHit.hit && eyeHit.distance < dist - 0.1,
        `Line of sight exists between ALPHA spawn ${a} [${ax}, ${az}] and BRAVO spawn ${b} [${bx}, ${bz}] at eye height!`,
      );

      // Chest height check (1.2m)
      const chestOrigin = { x: ax, y: EYE_CROUCH, z: az };
      const chestHit = traceShot(world, chestOrigin, dir);
      assert.ok(
        chestHit && chestHit.hit && chestHit.distance < dist - 0.1,
        `Line of sight exists between ALPHA spawn ${a} [${ax}, ${az}] and BRAVO spawn ${b} [${bx}, ${bz}] at chest height!`,
      );
    }
  }
});

// Helper to build a navigation graph over the arena
function buildNavGrid(step = 0.5) {
  const [minX, maxX, minZ, maxZ] = ARENA.bounds;
  const nodes = new Map(); // "x,z" -> { x, z, key, neighbors: [] }

  for (let x = minX + 0.5; x <= maxX - 0.5; x += step) {
    for (let z = minZ + 0.5; z <= maxZ - 0.5; z += step) {
      const rx = Math.round(x * 10) / 10;
      const rz = Math.round(z * 10) / 10;
      // Check if standing player fits at feet y = 0 (center y = 0.9)
      if (!world.overlaps({ x: rx, y: HALF.y, z: rz }, HALF)) {
        const key = `${rx},${rz}`;
        nodes.set(key, { x: rx, z: rz, key, neighbors: [] });
      }
    }
  }

  // Connect adjacent nodes
  for (const node of nodes.values()) {
    const offsets = [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ];
    for (const [dx, dz] of offsets) {
      const nx = Math.round((node.x + dx) * 10) / 10;
      const nz = Math.round((node.z + dz) * 10) / 10;
      const neighbor = nodes.get(`${nx},${nz}`);
      if (neighbor) {
        node.neighbors.push(neighbor);
      }
    }
  }

  return nodes;
}

function findNearestNode(nodes, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const n of nodes.values()) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function bfsPath(nodes, startNode, endNode, filterFn = null) {
  if (!startNode || !endNode) return null;
  const visited = new Set([startNode.key]);
  const queue = [{ node: startNode, dist: 0 }];

  while (queue.length > 0) {
    const { node, dist } = queue.shift();
    if (node.key === endNode.key) return dist;

    for (const nb of node.neighbors) {
      if (visited.has(nb.key)) continue;
      if (filterFn && !filterFn(nb)) continue;
      visited.add(nb.key);
      queue.push({ node: nb, dist: dist + 1 });
    }
  }
  return null;
}

test('everything is reachable: flood fill connects all spawns', () => {
  const nodes = buildNavGrid(0.5);
  const [alphaSpawns, bravoSpawns] = ARENA.spawns;

  const alphaNodes = alphaSpawns.map(([x, z]) => findNearestNode(nodes, x, z));
  const bravoNodes = bravoSpawns.map(([x, z]) => findNearestNode(nodes, x, z));

  // Verify all spawn points are walkable
  for (let i = 0; i < alphaNodes.length; i++) {
    assert.ok(alphaNodes[i], `ALPHA spawn ${i} is not in walkable area`);
  }
  for (let i = 0; i < bravoNodes.length; i++) {
    assert.ok(bravoNodes[i], `BRAVO spawn ${i} is not in walkable area`);
  }

  // Every ALPHA spawn must reach every BRAVO spawn
  for (let a = 0; a < alphaNodes.length; a++) {
    for (let b = 0; b < bravoNodes.length; b++) {
      const dist = bfsPath(nodes, alphaNodes[a], bravoNodes[b]);
      assert.ok(
        dist !== null && dist > 0,
        `ALPHA spawn ${a} cannot reach BRAVO spawn ${b} through the map!`,
      );
    }
  }
});

test('three real routes: spawns remain connected when any one lane is blocked', () => {
  const nodes = buildNavGrid(0.5);
  const [alphaSpawns, bravoSpawns] = ARENA.spawns;
  const start = findNearestNode(nodes, alphaSpawns[2][0], alphaSpawns[2][1]); // Center Alpha
  const target = findNearestNode(nodes, bravoSpawns[2][0], bravoSpawns[2][1]); // Center Bravo

  // Lanes span the engagement area (z between -24 and 24).
  // 1. Block A-Lane (x < -6 in engagement zone): should still connect via Mid or B
  const noALane = bfsPath(nodes, start, target, (n) => !(Math.abs(n.z) <= 24 && n.x < -6));
  assert.ok(noALane !== null, 'Blocking A-Lane disconnected the spawns!');

  // 2. Block Mid Lane (-6 <= x <= 6 in engagement zone): should still connect via A or B
  const noMid = bfsPath(nodes, start, target, (n) => !(Math.abs(n.z) <= 24 && n.x >= -6 && n.x <= 6));
  assert.ok(noMid !== null, 'Blocking Mid disconnected the spawns!');

  // 3. Block B-Lane (x > 6 in engagement zone): should still connect via A or Mid
  const noBLane = bfsPath(nodes, start, target, (n) => !(Math.abs(n.z) <= 24 && n.x > 6));
  assert.ok(noBLane !== null, 'Blocking B-Lane disconnected the spawns!');
});

test('equal timing: walk distance and time from mirrored spawns to center line match', () => {
  const nodes = buildNavGrid(0.5);
  const [alphaSpawns, bravoSpawns] = ARENA.spawns;
  const centerNode = findNearestNode(nodes, 0, 0);

  for (let i = 0; i < alphaSpawns.length; i++) {
    const aNode = findNearestNode(nodes, alphaSpawns[i][0], alphaSpawns[i][1]);
    const bNode = findNearestNode(nodes, bravoSpawns[i][0], bravoSpawns[i][1]);

    const distA = bfsPath(nodes, aNode, centerNode);
    const distB = bfsPath(nodes, bNode, centerNode);

    assert.ok(distA !== null, `ALPHA spawn ${i} cannot reach center`);
    assert.ok(distB !== null, `BRAVO spawn ${i} cannot reach center`);

    // Mirrored distances on grid should match (within 2 grid cells of discretization slack)
    const diff = Math.abs(distA - distB);
    assert.ok(
      diff <= 2,
      `Timing mismatch between ALPHA ${i} (steps: ${distA}) and BRAVO ${i} (steps: ${distB})! Diff: ${diff}`,
    );
  }
});

test('perimeter containment: edge walls prevent falling off or escaping bounds', () => {
  const [minX, maxX, minZ, maxZ] = ARENA.bounds;
  const pos = { x: minX + 1.0, y: 0.9, z: 0 };

  // Attempt to walk outward past West wall across 50 steps
  for (let i = 0; i < 50; i++) {
    world.moveCharacter(pos, HALF, { x: -0.15, y: -0.1, z: 0 }, STEP_H);
  }
  assert.ok(pos.x >= minX, `Player pushed past West edge wall: x=${pos.x}, minX=${minX}`);
  assert.ok(pos.y >= 0.8, 'Player fell below ground level');

  // Attempt to walk outward past East wall across 50 steps
  pos.x = maxX - 1.0;
  for (let i = 0; i < 50; i++) {
    world.moveCharacter(pos, HALF, { x: 0.15, y: -0.1, z: 0 }, STEP_H);
  }
  assert.ok(pos.x <= maxX, `Player pushed past East edge wall: x=${pos.x}, maxX=${maxX}`);
  assert.ok(pos.y >= 0.8, 'Player fell below ground level');

  // Attempt to walk outward past South wall across 50 steps
  pos.z = maxZ - 1.0;
  for (let i = 0; i < 50; i++) {
    world.moveCharacter(pos, HALF, { x: 0, y: -0.1, z: 0.15 }, STEP_H);
  }
  assert.ok(pos.z <= maxZ, `Player pushed past South edge wall: z=${pos.z}, maxZ=${maxZ}`);
  assert.ok(pos.y >= 0.8, 'Player fell below ground level');

  // Attempt to walk outward past North wall across 50 steps
  pos.z = minZ + 1.0;
  for (let i = 0; i < 50; i++) {
    world.moveCharacter(pos, HALF, { x: 0, y: -0.1, z: -0.15 }, STEP_H);
  }
  assert.ok(pos.z >= minZ, `Player pushed past North edge wall: z=${pos.z}, minZ=${minZ}`);
  assert.ok(pos.y >= 0.8, 'Player fell below ground level');
});

test('Room integration: matches start with arena team spawns', () => {
  const r = new Room('arena_test', ARENA.boxes, { map: 'arena', mapData: ARENA });
  assert.equal(r.map, 'arena');
  assert.equal(r.teamSpawns.length, 2);
  assert.equal(r.teamSpawns[0].length, 5);
  assert.equal(r.teamSpawns[1].length, 5);

  const p1 = r.join('AlphaPlayer');
  const p2 = r.join('BravoPlayer');

  assert.equal(p1.team, 0); // ALPHA
  assert.equal(p2.team, 1); // BRAVO

  // ALPHA player should be placed on +Z side
  assert.ok(p1.move.pos.z > 20, `p1 on ALPHA team spawned at z=${p1.move.pos.z}, expected z > 20`);
  // BRAVO player should be placed on -Z side
  assert.ok(p2.move.pos.z < -20, `p2 on BRAVO team spawned at z=${p2.move.pos.z}, expected z < -20`);

  // Both land grounded on street level
  assert.ok(p1.move.grounded, 'p1 should be grounded');
  assert.ok(p2.move.grounded, 'p2 should be grounded');
  assert.ok(Math.abs(p1.move.pos.y) < 0.1, `p1 feet should be near 0, got ${p1.move.pos.y}`);
  assert.ok(Math.abs(p2.move.pos.y) < 0.1, `p2 feet should be near 0, got ${p2.move.pos.y}`);
});

test('the arena can be drawn: every box surface maps to a real material', async () => {
  // Regression: crates used surface 'paintedWood', which no material system
  // knows, so `?map=arena` failed to boot ("unknown surface") in the browser.
  const { ARENA } = await import('../shared/maps/arena.js');
  const { ARENA_MATERIAL } = await import('../src/world/index.js');
  const { MATERIAL_NAMES } = await import('../src/materials/index.js');
  for (const [surface, material] of Object.entries(ARENA_MATERIAL)) {
    assert.ok(MATERIAL_NAMES.includes(material), `${surface} -> ${material} is a real material`);
  }
  for (const b of ARENA.boxes) {
    if (b.style === 'floor') continue;
    assert.ok(b.surface in ARENA_MATERIAL, `box surface '${b.surface}' has a material`);
  }
});
