// shared/map.js — the map's layout stream and its collision boxes, from the
// seed alone.
//
// src/world/index.js stays the single source of truth for the map. The server
// rebuilds the exact same static colliders by running that code against stub
// materials/renderer (three.js runs fine in Node; only meshes are thrown away).

import { createRng } from './rng.js';

const MATERIALS_FORK = 0x0bad5eed;
const WORLD_FORK = 0x70a1d;

// The PRNG stream the world lays the map out with. The world used to fork it
// off the shared ctx.rng, so the layout silently depended on boot order (the
// materials system forks first). This reproduces that exact stream from the
// seed, keeping every existing seed's layout while letting the server build
// the map without replaying the client's boot.
export function layoutRng(seed) {
  const rng = createRng(seed >>> 0);
  rng.fork(MATERIALS_FORK);
  return rng.fork(WORLD_FORK);
}

// Builds the map headlessly and returns its static colliders
// ([{min:[x,y,z], max:[x,y,z], surface}]). For 'arena', loads pure data directly
// without Three.js or headless world.
export async function buildColliders(seed, map = 'plaza') {
  if (map === 'arena') {
    const { ARENA } = await import('./maps/arena.js');
    return ARENA.boxes;
  }
  const THREE = await import('three');
  const { WorldSystem } = await import('../src/world/index.js');
  const stubMaterial = () => new THREE.MeshBasicMaterial();
  const services = {
    materials: { make: stubMaterial, makeGlass: stubMaterial },
    render: { addLight: (light) => light },
  };
  const scene = new THREE.Scene();
  const world = new WorldSystem();
  world.init({
    config: { seed, map: 'plaza' },
    rng: createRng(seed >>> 0), // only advanced by the world; layout uses layoutRng
    scene,
    get: (id) => services[id],
  });
  const colliders = world.staticColliders;
  world.dispose();
  return colliders;
}

export async function getMap(name = 'plaza', seed = 0x5eed1234) {
  if (name === 'arena') {
    const { ARENA } = await import('./maps/arena.js');
    return ARENA;
  }
  const colliders = await buildColliders(seed, 'plaza');
  return {
    id: 'plaza',
    name: 'Plaza',
    boxes: colliders,
  };
}
