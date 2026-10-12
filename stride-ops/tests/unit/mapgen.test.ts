/**
 * mapgen.test.ts
 *
 * Unit tests for the procedural map generator (Requirement 18):
 * deterministic seeds, biome variety, cover zones, and spawn points.
 */

import { MapGenerator, Biome } from '../../src/gameplay/maps/MapGenerator';

describe('MapGenerator', () => {
  it('is deterministic for the same seed', () => {
    const gen = new MapGenerator();
    const a = gen.generate({ seed: 12345, biome: Biome.City });
    const b = gen.generate({ seed: 12345, biome: Biome.City });
    expect(a.seed).toBe(12345);
    expect(a.blocks.length).toBe(b.blocks.length);
    // Spot-check block positions match
    for (let i = 0; i < Math.min(a.blocks.length, 20); i++) {
      expect(a.blocks[i].x).toBe(b.blocks[i].x);
      expect(a.blocks[i].z).toBe(b.blocks[i].z);
    }
  });

  it('produces different layouts for different seeds', () => {
    const gen = new MapGenerator();
    const a = gen.generate({ seed: 1, biome: Biome.City });
    const b = gen.generate({ seed: 2, biome: Biome.City });
    // Extremely unlikely to be identical
    expect(`${a.blocks.length}`).not.toBe(`${b.blocks.length}`);
    // Or at least, block centers differ somewhere
    const differ = a.blocks.some((blk, i) => {
      const other = b.blocks[i];
      return other && (blk.x !== other.x || blk.z !== other.z);
    });
    expect(differ || a.blocks.length !== b.blocks.length).toBe(true);
  });

  it('supports all six biomes', () => {
    const gen = new MapGenerator();
    for (const biome of Object.values(Biome)) {
      const layout = gen.generate({ seed: 42, biome });
      expect(layout.biome).toBe(biome);
      expect(layout.blocks.length).toBeGreaterThan(0);
    }
  });

  it('generates spawn points and a navigable nav grid', () => {
    const gen = new MapGenerator();
    const layout = gen.generate({ seed: 7, biome: Biome.City });
    expect(layout.spawnPoints.length).toBeGreaterThan(0);
    // Spawn cells should be walkable on the nav grid
    for (const sp of layout.spawnPoints) {
      const cell = layout.navGrid.worldToCell(sp.x, sp.z);
      expect(layout.navGrid.isWalkable(cell.x, cell.z)).toBe(true);
    }
  });

  it('guarantees at least 3 cover zones', () => {
    const gen = new MapGenerator();
    for (const seed of [1, 2, 3]) {
      const layout = gen.generate({ seed, biome: Biome.City });
      expect(layout.coverZones.length).toBeGreaterThanOrEqual(3);
    }
  });
});
