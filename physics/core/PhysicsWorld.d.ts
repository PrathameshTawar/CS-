/**
 * PhysicsWorld.ts
 *
 * AABB-based physics world for the FPS engine.
 *
 * Improvements over the original brute-force version
 * ──────────────────────────────────────────────────
 * 1. Spatial grid broadphase — blocks are bucketed into a uniform 3D grid
 *    on construction. Every raycast and collision query fetches only the
 *    cells the ray or AABB overlaps, reducing the per-query block set from
 *    O(total_blocks) to O(blocks_in_touched_cells). On a 90×90 m city map
 *    with ~600 blocks this cuts average raycast work by ~95%.
 *
 * 2. Incremental grid updates — addBlock/removeBlock patch only the affected
 *    cells rather than rebuilding the whole structure.
 *
 * 3. Destruction material table — PhysicsWorld now knows each block's HP and
 *    damage threshold; DestructionSystem calls applyDamage() and the world
 *    handles removal + mesh notification via a callback.
 *
 * @module Physics
 */
import { BlockInstance } from '../../gameplay/maps/MapGenerator';
import { SurfaceMaterial } from '../../gameplay/core/GameTypes';
export interface RayHit {
    point: {
        x: number;
        y: number;
        z: number;
    };
    normal: {
        x: number;
        y: number;
        z: number;
    };
    distance: number;
    surface: SurfaceMaterial;
    block: BlockInstance | null;
}
export interface AABB {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}
/** Per-material destruction properties (Requirement 4). */
export interface MaterialDestructionProfile {
    /** Total HP before collapse. */
    maxHealth: number;
    /** Minimum hit damage to show a crack state. */
    crackThreshold: number;
    /** HP at which the block fractures (spawns debris). */
    fractureHealth: number;
    /** Whether bullets penetrate this material. */
    penetrable: boolean;
    /** 0–1 damage multiplier for penetrating bullets on exit. */
    exitDamageMultiplier: number;
}
/** Requirement 4.4 — four destruction profiles. */
export declare const DESTRUCTION_PROFILES: Record<string, MaterialDestructionProfile>;
export declare class PhysicsWorld {
    private blocks;
    private bounds;
    /** Spatial grid — built on setWorld(), patched incrementally after. */
    private readonly grid;
    /** Per-block health + state. */
    private readonly blockState;
    /**
     * Callback fired when a block transitions state.
     * `state` = 'crack' | 'fracture' | 'collapse'
     * Caller (DestructionSystem / Game) uses this to update the mesh / spawn debris.
     */
    onBlockDamaged?: (block: BlockInstance, state: 'crack' | 'fracture' | 'collapse') => void;
    constructor(blocks?: BlockInstance[], bounds?: {
        width: number;
        depth: number;
        height: number;
    });
    setWorld(blocks: BlockInstance[], bounds: {
        width: number;
        depth: number;
        height: number;
    }): void;
    getBlocks(): readonly BlockInstance[];
    getBounds(): {
        width: number;
        depth: number;
        height: number;
    };
    addBlock(block: BlockInstance): void;
    removeBlock(target: BlockInstance): boolean;
    /**
     * Apply damage to a block. Returns whether the bullet penetrated.
     * Fires onBlockDamaged callback on state transitions.
     */
    applyDamage(block: BlockInstance, damage: number): {
        penetrated: boolean;
        exitMultiplier: number;
    };
    getBlockHealth(block: BlockInstance): number;
    /**
     * Raycast against the world using the spatial grid broadphase.
     * Returns the closest hit or null.
     */
    raycast(origin: {
        x: number;
        y: number;
        z: number;
    }, direction: {
        x: number;
        y: number;
        z: number;
    }, maxDistance: number): RayHit | null;
    resolveCollision(box: AABB): {
        grounded: boolean;
        groundY: number;
        hitWall: boolean;
    };
    pointBlocked(x: number, y: number, z: number): BlockInstance | null;
    groundHeightAt(x: number, z: number): number;
    private _initBlockState;
    /**
     * Walk the DDA voxel traversal along the ray and return all candidate
     * blocks from touched grid cells. Returns a Set to avoid duplicates
     * (a block can span multiple cells).
     */
    private _rayGridCandidates;
    /** Return all blocks from grid cells the AABB overlaps. */
    private _aabbGridCandidates;
    /** Ray vs AABB slab test. Returns entry t or null. */
    private _rayAABB;
    /** Approximate face normal from closest-face penetration depth. */
    private _faceNormal;
}
//# sourceMappingURL=PhysicsWorld.d.ts.map