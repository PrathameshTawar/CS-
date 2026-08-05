/**
 * TracerSystem.ts
 *
 * Renders glowing bullet tracers (Requirement 6.2). Tracers are short-lived
 * line segments with a gradient glow effect, rendered additively.
 *
 * @module Rendering
 */
import * as THREE from 'three';
export declare class TracerSystem {
    private readonly tracers;
    private readonly group;
    private readonly material;
    private readonly geometry;
    private readonly line;
    private readonly positions;
    private readonly colors;
    private readonly tempColor;
    constructor(scene: THREE.Scene);
    /**
     * Spawn a tracer from start toward end.
     */
    spawnTracer(start: {
        x: number;
        y: number;
        z: number;
    }, end: {
        x: number;
        y: number;
        z: number;
    }, color: number, life?: number): void;
    update(deltaTime: number): void;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=TracerSystem.d.ts.map