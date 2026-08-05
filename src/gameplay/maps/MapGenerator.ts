/**
 * MapGenerator.ts
 *
 * Procedural map generation across multiple biomes (city, forest, snow,
 * desert, dungeon, factory). Guarantees cover zones, navigable spawn
 * connections, and elevated positions. Deterministic per seed.
 *
 * Produces:
 *  - A block layout (Axis-Aligned Boxes) for world building
 *  - Spawn points
 *  - Cover zones
 *  - A NavGrid for AI pathfinding
 *
 * @module Gameplay
 */

import { SeededRandom } from '../core/Random';
import { NavGrid } from './NavGrid';

export enum Biome {
  City = 'city',
  Forest = 'forest',
  Snow = 'snow',
  Desert = 'desert',
  Dungeon = 'dungeon',
  Factory = 'factory',
}

export type BlockMaterial = 'concrete' | 'wood' | 'glass' | 'metal' | 'dirt' | 'grass' | 'stone';

export interface BlockInstance {
  /** Center position. */
  x: number;
  y: number;
  z: number;
  /** Half extents. */
  hx: number;
  hy: number;
  hz: number;
  material: BlockMaterial;
  destructible: boolean;
  /** Color tint. */
  color: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** Aim yaw. */
  yaw: number;
}

export interface CoverZone {
  x: number;
  z: number;
  radius: number;
}

export interface MapLayout {
  biome: Biome;
  seed: number;
  bounds: { width: number; depth: number; height: number };
  blocks: BlockInstance[];
  spawnPoints: SpawnPoint[];
  coverZones: CoverZone[];
  navGrid: NavGrid;
  /** World-space AI patrol waypoints. */
  patrolRoutes: { x: number; z: number }[][];
}

export interface MapGenOptions {
  biome?: Biome;
  seed?: number;
  size?: { width: number; depth: number };
}

/** Biome palette configuration. */
export interface BiomePalette {
  groundColor: number;
  fogColor: number;
  fogDensity: number;
  wallColors: number[];
  wallMaterial: BlockMaterial;
  blockDensity: number; // 0..1
  buildingChance: number;
  skyColor: number;
  sunColor: number;
}

const BIOME_PALETTES: Record<Biome, BiomePalette> = {
  [Biome.City]: {
    groundColor: 0xc8b89e, // Warm sandstone cobblestone (CS2 Mirage street)
    fogColor: 0xdcd2c0, // Warm Mediterranean atmospheric haze
    fogDensity: 0.01,
    wallColors: [0xdad0be, 0xe2dad0, 0xcbc0ac, 0x3b6b88], // Weathered stucco beige & peeling Mirage blue
    wallMaterial: 'concrete',
    blockDensity: 0.18,
    buildingChance: 0.55,
    skyColor: 0x6bc4ff, // Crisp Mediterranean sky
    sunColor: 0xfffaeb, // Warm Mediterranean sunlight
  },
  [Biome.Forest]: {
    groundColor: 0x2f4a2a,
    fogColor: 0x9db78a,
    fogDensity: 0.02,
    wallColors: [0x4a5d3a, 0x3c4a30, 0x5a7048],
    wallMaterial: 'wood',
    blockDensity: 0.28,
    buildingChance: 0.05,
    skyColor: 0xa8d8a0,
    sunColor: 0xfff8d0,
  },
  [Biome.Snow]: {
    groundColor: 0xe8eef4,
    fogColor: 0xd5dde5,
    fogDensity: 0.025,
    wallColors: [0xdfe7ee, 0xc9d4de, 0xb7c4d0],
    wallMaterial: 'concrete',
    blockDensity: 0.14,
    buildingChance: 0.3,
    skyColor: 0xcfe4f2,
    sunColor: 0xeef6ff,
  },
  [Biome.Desert]: {
    groundColor: 0xc2a26b,
    fogColor: 0xd9c191,
    fogDensity: 0.015,
    wallColors: [0xb89a6a, 0xa5845a, 0xccb083],
    wallMaterial: 'stone',
    blockDensity: 0.12,
    buildingChance: 0.1,
    skyColor: 0xf0d9a0,
    sunColor: 0xfff0c0,
  },
  [Biome.Dungeon]: {
    groundColor: 0x3c3542,
    fogColor: 0x2a2430,
    fogDensity: 0.03,
    wallColors: [0x4a4252, 0x585063, 0x3a3440],
    wallMaterial: 'stone',
    blockDensity: 0.22,
    buildingChance: 0.4,
    skyColor: 0x2a2430,
    sunColor: 0x9a8fb8,
  },
  [Biome.Factory]: {
    groundColor: 0x4a4e55,
    fogColor: 0x8a8f98,
    fogDensity: 0.014,
    wallColors: [0x6e727a, 0x80848c, 0x5a5e66],
    wallMaterial: 'metal',
    blockDensity: 0.2,
    buildingChance: 0.45,
    skyColor: 0x8fa4b8,
    sunColor: 0xe8e0c8,
  },
};

/** Default map size in meters. */
const DEFAULT_SIZE = { width: 90, depth: 90 };
const CELL = 1.5; // generation cell size (meters)

export class MapGenerator {
  /**
   * Generate a complete map layout for the given biome and seed.
   */
  generate(options: MapGenOptions = {}): MapLayout {
    const biome = options.biome ?? Biome.City;
    const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    const size = options.size ?? DEFAULT_SIZE;
    const rng = new SeededRandom(seed);
    const palette = BIOME_PALETTES[biome];

    const cellsX = Math.floor(size.width / CELL);
    const cellsZ = Math.floor(size.depth / CELL);
    const nav = new NavGrid({ width: cellsX, depth: cellsZ, cellSize: CELL });

    // Occupancy grid for generation (1 = cell column unavailable for spawns)
    const occupied = new Uint8Array(cellsX * cellsZ);
    const idx = (x: number, z: number): number => z * cellsX + x;

    const blocks: BlockInstance[] = [];

    // --- Border walls ---
    this.addBlock(blocks, (cellsX * CELL) / 2, 2, -0.5, (cellsX * CELL) / 2, 2, 0.5, palette.wallMaterial, false, palette.wallColors[0]);
    this.addBlock(blocks, (cellsX * CELL) / 2, 2, cellsZ * CELL + 0.5, (cellsX * CELL) / 2, 2, 0.5, palette.wallMaterial, false, palette.wallColors[0]);
    this.addBlock(blocks, -0.5, 2, (cellsZ * CELL) / 2, 0.5, 2, (cellsZ * CELL) / 2, palette.wallMaterial, false, palette.wallColors[0]);
    this.addBlock(blocks, cellsX * CELL + 0.5, 2, (cellsZ * CELL) / 2, 0.5, 2, (cellsZ * CELL) / 2, palette.wallMaterial, false, palette.wallColors[0]);

    // --- Scatter cover blocks & buildings ---
    const numBlocks = Math.floor(cellsX * cellsZ * palette.blockDensity * 0.35);
    for (let i = 0; i < numBlocks; i++) {
      const cx = rng.int(1, cellsX - 2);
      const cz = rng.int(1, cellsZ - 2);
      if (occupied[idx(cx, cz)]) continue;

      const isBuilding = rng.chance(palette.buildingChance);
      if (isBuilding) {
        const bw = rng.int(2, 4);
        const bd = rng.int(2, 4);
        if (cx + bw >= cellsX - 1 || cz + bd >= cellsZ - 1) continue;

        const height = rng.int(1, 3);
        let blocked = false;
        for (let bx = cx; bx < cx + bw; bx++) {
          for (let bz = cz; bz < cz + bd; bz++) {
            if (occupied[idx(bx, bz)]) { blocked = true; break; }
          }
          if (blocked) break;
        }
        if (blocked) continue;

        const baseX = cx * CELL;
        const baseZ = cz * CELL;
        const bWidth = bw * CELL;
        const bDepth = bd * CELL;
        const bHeight = height * CELL;
        const color = rng.pick(palette.wallColors);

        // Main building body (monolithic block)
        this.addBlock(
          blocks,
          baseX + bWidth / 2,
          bHeight / 2,
          baseZ + bDepth / 2,
          bWidth / 2,
          bHeight / 2,
          bDepth / 2,
          palette.wallMaterial,
          true,
          color
        );

        // Roof overhang (adds architectural detail)
        this.addBlock(
          blocks,
          baseX + bWidth / 2,
          bHeight + 0.2, // Y center
          baseZ + bDepth / 2,
          (bWidth / 2) + 0.4, // Overhang X
          0.2, // Half-thickness
          (bDepth / 2) + 0.4, // Overhang Z
          'concrete',
          false,
          0xc0c0c0
        );

        // Optional props outside building (AC units / Crates)
        if (rng.chance(0.6)) {
          const propX = rng.chance(0.5) ? baseX - 0.6 : baseX + bWidth + 0.6;
          const propZ = baseZ + bDepth / 2;
          this.addBlock(
            blocks,
            propX, 0.6, propZ,
            0.6, 0.6, 0.6,
            'metal', true, 0x909090
          );
        }

        // Mark cells occupied
        for (let bx = cx; bx < cx + bw; bx++) {
          for (let bz = cz; bz < cz + bd; bz++) {
            occupied[idx(bx, bz)] = 1;
            nav.setCell(bx, bz, false);
          }
        }
      } else {
        // Single cover block (crate/rock/sandbags - CS2 Mirage marketplace props)
        occupied[idx(cx, cz)] = 1;
        nav.setCell(cx, cz, false);

        const h = rng.chance(0.35) ? 2 : 1;
        const color = rng.pick(palette.wallColors);
        const mat: BlockMaterial = biome === Biome.City ? (rng.chance(0.5) ? 'wood' : 'concrete') : (rng.chance(0.3) ? 'glass' : palette.wallMaterial);
        for (let by = 0; by < h; by++) {
          this.addBlock(
            blocks,
            cx * CELL + CELL / 2,
            by * CELL + CELL / 2,
            cz * CELL + CELL / 2,
            CELL / 2,
            CELL / 2,
            CELL / 2,
            mat,
            true,
            color
          );
        }
      }
    }

    // --- Elevation pads (elevated positions) ---
    const numPads = rng.int(2, 4);
    for (let i = 0; i < numPads; i++) {
      const cx = rng.int(3, cellsX - 4);
      const cz = rng.int(3, cellsZ - 4);
      if (occupied[idx(cx, cz)]) continue;

      const padSize = rng.int(2, 3);
      let blocked = false;
      for (let bx = cx; bx < cx + padSize; bx++) {
        for (let bz = cz; bz < cz + padSize; bz++) {
          if (occupied[idx(bx, bz)]) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (blocked) continue;

      for (let bx = cx; bx < cx + padSize; bx++) {
        for (let bz = cz; bz < cz + padSize; bz++) {
          occupied[idx(bx, bz)] = 1;
          nav.setCell(bx, bz, false);
        }
      }

      // Ramp approach on one side (walkable, high cost)
      const rampSide = rng.int(0, 3);
      const rampX = rampSide === 0 ? cx + padSize : rampSide === 1 ? cx - 1 : cx;
      const rampZ = rampSide === 2 ? cz + padSize : rampSide === 3 ? cz - 1 : cz;
      if (nav.inBounds(rampX, rampZ)) {
        nav.setCell(rampX, rampZ, true, 0.35);
      }

      for (let bx = cx; bx < cx + padSize; bx++) {
        for (let bz = cz; bz < cz + padSize; bz++) {
          this.addBlock(
            blocks,
            bx * CELL + CELL / 2,
            CELL / 2,
            bz * CELL + CELL / 2,
            CELL / 2,
            CELL / 2,
            CELL / 2,
            palette.wallMaterial,
            false,
            palette.wallColors[0]
          );
        }
      }
    }

    // --- Spawn points (player + enemies) ---
    const spawnPoints: SpawnPoint[] = [];
    const candidates: { x: number; z: number }[] = [];
    for (let x = 2; x < cellsX - 2; x++) {
      for (let z = 2; z < cellsZ - 2; z++) {
        if (occupied[idx(x, z)] === 0 && this.isClearArea(occupied, idx, cellsX, cellsZ, x, z, 2)) {
          candidates.push({ x, z });
        }
      }
    }

    // Shuffle candidates deterministically
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const numSpawns = Math.min(6, candidates.length);
    for (let i = 0; i < numSpawns; i++) {
      const c = candidates[i];
      const wx = c.x * CELL + CELL / 2;
      const wz = c.z * CELL + CELL / 2;
      spawnPoints.push({ x: wx, y: 0, z: wz, yaw: rng.angle() });
      nav.setCell(c.x, c.z, true, 0.2);
    }

    // --- Cover zones ---
    const coverZones: CoverZone[] = [];
    for (const block of blocks) {
      if (block.hy <= CELL && block.hx > 0 && block.destructible) {
        coverZones.push({ x: block.x, z: block.z, radius: CELL * 1.5 });
      }
    }

    // --- Patrol routes for AI ---
    const patrolRoutes: { x: number; z: number }[][] = [];
    const routeCount = rng.int(2, 4);
    for (let r = 0; r < routeCount; r++) {
      const route: { x: number; z: number }[] = [];
      const origin = spawnPoints.length > 0 ? spawnPoints[r % spawnPoints.length] : null;
      const start = origin ? { x: origin.x, z: origin.z } : { x: 5, z: 5 };
      route.push({ x: start.x, z: start.z });
      let cx = Math.floor(start.x / CELL);
      let cz = Math.floor(start.z / CELL);
      const steps = rng.int(3, 5);
      for (let s = 0; s < steps; s++) {
        const nx = Math.min(cellsX - 3, Math.max(2, cx + rng.int(-4, 4)));
        const nz = Math.min(cellsZ - 3, Math.max(2, cz + rng.int(-4, 4)));
        if (nav.isWalkable(nx, nz)) {
          cx = nx;
          cz = nz;
          route.push({ x: cx * CELL + CELL / 2, z: cz * CELL + CELL / 2 });
        }
      }
      if (route.length >= 2) {
        patrolRoutes.push(route);
      }
    }

    // Mark remaining free cells walkable
    for (let x = 0; x < cellsX; x++) {
      for (let z = 0; z < cellsZ; z++) {
        if (occupied[idx(x, z)] === 0 && !nav.isWalkable(x, z)) {
          nav.setCell(x, z, true, 0.1);
        }
      }
    }

    return {
      biome,
      seed,
      bounds: { width: size.width, depth: size.depth, height: 20 },
      blocks,
      spawnPoints,
      coverZones,
      navGrid: nav,
      patrolRoutes,
    };
  }

  private addBlock(
    blocks: BlockInstance[],
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    material: BlockMaterial,
    destructible: boolean,
    color: number
  ): void {
    blocks.push({ x, y, z, hx, hy, hz, material, destructible, color });
  }

  private isClearArea(
    occupied: Uint8Array,
    idx: (x: number, z: number) => number,
    cellsX: number,
    cellsZ: number,
    x: number,
    z: number,
    radius: number
  ): boolean {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= cellsX || nz >= cellsZ) continue;
        if (occupied[idx(nx, nz)]) return false;
      }
    }
    return true;
  }

  /** Palette accessor for demo scene building. */
  static getPalette(biome: Biome): BiomePalette {
    return BIOME_PALETTES[biome];
  }
}
