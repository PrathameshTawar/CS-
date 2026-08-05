/**
 * FullScreenTriangle.ts
 *
 * A single oversized screen-filling triangle used for all post-processing passes.
 * Using one triangle instead of a quad avoids the diagonal seam from two triangles
 * and is standard practice in production renderers (UE5, Unity HDRP, etc.).
 *
 * UV coordinates naturally cover [0,1] across the screen.
 * The triangle extends to [-1, 3] in NDC so it always covers the viewport.
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * Shared full-screen triangle geometry and camera.
 * Construct once; reuse across every pass.
 */
export declare class FullScreenTriangle {
    readonly mesh: THREE.Mesh;
    readonly camera: THREE.OrthographicCamera;
    /** Cached scene — avoids allocating a new Scene every render call. */
    private readonly _scene;
    private static _instance;
    constructor();
    /**
     * Global singleton — one instance shared across all post-processing effects
     */
    static getInstance(): FullScreenTriangle;
    /**
     * Render the triangle using the given material.
     * Zero allocations per call — the scene and mesh are cached on the instance.
     */
    render(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial | THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget | null): void;
    dispose(): void;
}
//# sourceMappingURL=FullScreenTriangle.d.ts.map