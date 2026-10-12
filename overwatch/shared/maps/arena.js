// shared/maps/arena.js — compact competitive 3-lane arena map data.
//
// Pure data: no Three.js, no DOM, no RNG. Both client and server load this
// directly. Every wall, crate, ledge and spawn point is defined here.
//
// Layout:
// - A-Lane (West, x < -8): Long open sniper lane with perimeter ledges.
// - Mid Lane (Center, -6 < x < 6): Fast CQB crate fights with central cover.
// - B-Lane (East, x > 8): Tight corridor chicanes and interior partitions.
// - Connectors link A<->Mid and Mid<->B at z = ±12.
// - Spawns: ALPHA (+Z) vs BRAVO (-Z), 5v5 spawn points with zero sightlines.

export const ARENA = {
  id: 'arena',
  name: 'Arena',
  bounds: [-20, 20, -32, 32], // [minX, maxX, minZ, maxZ]

  spawns: [
    // ALPHA (team 0, +Z)
    [
      [-15, 28],
      [-7, 29],
      [0, 29],
      [7, 29],
      [15, 28],
    ],
    // BRAVO (team 1, -Z)
    [
      [-15, -28],
      [-7, -29],
      [0, -29],
      [7, -29],
      [15, -28],
    ],
  ],

  boxes: [
    // --- Floor ---
    { min: [-30, -1, -42], max: [30, 0, 42], surface: 'concrete', style: 'floor' },

    // --- Perimeter Edge Walls (height 8m, thick outer boundary) ---
    { min: [-30, 0, -42], max: [-20, 8, 42], surface: 'brick', style: 'edge' }, // West wall (inner face at x = -20)
    { min: [20, 0, -42], max: [30, 8, 42], surface: 'brick', style: 'edge' },  // East wall (inner face at x = 20)
    { min: [-30, 0, 32], max: [30, 8, 42], surface: 'brick', style: 'edge' },  // South wall (inner face at z = 32)
    { min: [-30, 0, -42], max: [30, 8, -32], surface: 'brick', style: 'edge' }, // North wall (inner face at z = -32)

    // --- Lane Dividers: A-Lane <-> Mid (x: -8 to -6, height 5m) ---
    { min: [-8, 0, 14], max: [-6, 5, 28], surface: 'brick', style: 'wall' },  // South segment
    { min: [-8, 0, -10], max: [-6, 5, 10], surface: 'brick', style: 'wall' }, // Center segment
    { min: [-8, 0, -28], max: [-6, 5, -14], surface: 'brick', style: 'wall' }, // North segment
    // Connectors open at z = 10..14 and z = -14..-10

    // --- Lane Dividers: Mid <-> B-Lane (x: 6 to 8, height 5m) ---
    { min: [6, 0, 14], max: [8, 5, 28], surface: 'brick', style: 'wall' },   // South segment
    { min: [6, 0, -10], max: [8, 5, 10], surface: 'brick', style: 'wall' },  // Center segment
    { min: [6, 0, -28], max: [8, 5, -14], surface: 'brick', style: 'wall' }, // North segment
    // Connectors open at z = 10..14 and z = -14..-10

    // --- Spawn Baffles (Block direct sightlines from spawn areas into lanes) ---
    // ALPHA spawn baffles (z = 24..25)
    { min: [-16, 0, 24], max: [-11, 4, 25], surface: 'concrete', style: 'wall' }, // A-lane baffle
    { min: [-3.5, 0, 24], max: [3.5, 4, 25], surface: 'concrete', style: 'wall' }, // Mid baffle
    { min: [9, 0, 24], max: [15, 4, 25], surface: 'concrete', style: 'wall' },   // B-lane baffle
    // BRAVO spawn baffles (z = -25..-24)
    { min: [-16, 0, -25], max: [-11, 4, -24], surface: 'concrete', style: 'wall' }, // A-lane baffle
    { min: [-3.5, 0, -25], max: [3.5, 4, -24], surface: 'concrete', style: 'wall' }, // Mid baffle
    { min: [9, 0, -25], max: [15, 4, -24], surface: 'concrete', style: 'wall' },   // B-lane baffle

    // --- A-Lane (Long Sniper Lane, x: -20 to -8) ---
    // Sniper ledges (height 0.42m - step-up without jumping)
    { min: [-19.5, 0, 16], max: [-16.5, 0.42, 19], surface: 'concrete', style: 'ledge' },
    { min: [-19.5, 0, -19], max: [-16.5, 0.42, -16], surface: 'concrete', style: 'ledge' },
    // A-lane cover crates
    { min: [-19.5, 0, 11], max: [-17, 1.8, 14], surface: 'wood', style: 'crate' },
    { min: [-19.5, 0, -14], max: [-17, 1.8, -11], surface: 'wood', style: 'crate' },
    { min: [-11.5, 0, 3], max: [-9, 1.2, 6], surface: 'wood', style: 'crate' },
    { min: [-11.5, 0, -6], max: [-9, 1.2, -3], surface: 'wood', style: 'crate' },

    // --- Mid Lane (Crates & Fast Fights, x: -6 to 6) ---
    // Central container blocking dead-center line of sight
    { min: [-2.5, 0, -2], max: [2.5, 2.5, 2], surface: 'metal', style: 'crate' },
    // Step-up ledges on central container (height 0.42m)
    { min: [-1.5, 0, 2], max: [1.5, 0.42, 3], surface: 'wood', style: 'ledge' },
    { min: [-1.5, 0, -3], max: [1.5, 0.42, -2], surface: 'wood', style: 'ledge' },
    // Staggered mid crates
    { min: [-5.5, 0, 5], max: [-3, 2.0, 8], surface: 'wood', style: 'crate' },
    { min: [3, 0, -8], max: [5.5, 2.0, -5], surface: 'wood', style: 'crate' },
    { min: [3, 0, 5], max: [5.5, 2.0, 8], surface: 'wood', style: 'crate' },
    { min: [-5.5, 0, -8], max: [-3, 2.0, -5], surface: 'wood', style: 'crate' },

    // --- B-Lane (Tight Corridor / Interior, x: 8 to 20) ---
    // Center chicane wall
    { min: [13, 0, -1], max: [20, 4, 1], surface: 'brick', style: 'wall' },
    // South chicane partition
    { min: [8, 0, 9], max: [15, 4, 10], surface: 'brick', style: 'wall' },
    // North chicane partition
    { min: [8, 0, -10], max: [15, 4, -9], surface: 'brick', style: 'wall' },
    // B-lane cover crates
    { min: [16, 0, 4], max: [18.5, 1.4, 6], surface: 'metal', style: 'crate' },
    { min: [16, 0, -6], max: [18.5, 1.4, -4], surface: 'metal', style: 'crate' },
    { min: [9.5, 0, 16], max: [12, 1.4, 18], surface: 'wood', style: 'crate' },
    { min: [9.5, 0, -18], max: [12, 1.4, -16], surface: 'wood', style: 'crate' },
  ],
};
