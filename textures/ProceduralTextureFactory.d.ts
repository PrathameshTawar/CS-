/**
 * ProceduralTextureFactory.ts
 *
 * Canvas-generated PBR texture sets (diffuse + bump + roughness) for every
 * procedural surface in the demo. No external assets — every texture is
 * painted at runtime from seeded value noise so the world has detail at a
 * AAA-ish fidelity level instead of flat colors.
 *
 * All methods are safe to call in node (jest) — if `document` is missing
 * they return plain colored materials so unit tests never crash.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { Biome } from '../../gameplay/maps/MapGenerator';
import { BlockMaterial } from '../../gameplay/maps/MapGenerator';
/**
 * Ground materials keyed by biome — tiled across the map so detail reads at
 * range (asphalt/concrete seams in city, grass blades in forest, etc).
 */
export declare function createGroundMaterial(biome: Biome, baseColor: number, seed?: number): THREE.MeshStandardMaterial;
/** Block materials by BlockMaterial type. */
export declare function createBlockMaterial(material: BlockMaterial, baseColor: number, seed?: number): THREE.MeshStandardMaterial;
/** Dispose procedural textures attached to a material created by this factory. */
export declare function disposeProceduralMaterial(mat: THREE.Material | null | undefined): void;
//# sourceMappingURL=ProceduralTextureFactory.d.ts.map