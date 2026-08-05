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
export class FullScreenTriangle {
    mesh;
    camera;
    /** Cached scene — avoids allocating a new Scene every render call. */
    _scene;
    static _instance = null;
    constructor() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
        const material = new THREE.RawShaderMaterial();
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        // Pre-add the mesh; we just swap the material before each render
        this._scene = new THREE.Scene();
        this._scene.add(this.mesh);
    }
    /**
     * Global singleton — one instance shared across all post-processing effects
     */
    static getInstance() {
        if (!FullScreenTriangle._instance) {
            FullScreenTriangle._instance = new FullScreenTriangle();
        }
        return FullScreenTriangle._instance;
    }
    /**
     * Render the triangle using the given material.
     * Zero allocations per call — the scene and mesh are cached on the instance.
     */
    render(renderer, material, target) {
        this.mesh.material = material;
        renderer.setRenderTarget(target);
        renderer.render(this._scene, this.camera);
        // Do NOT reset render target here — caller may chain further calls
    }
    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this._scene.clear();
        FullScreenTriangle._instance = null;
    }
}
//# sourceMappingURL=FullScreenTriangle.js.map