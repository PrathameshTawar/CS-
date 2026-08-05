/**
 * CascadedShadowMap.ts
 *
 * Cascaded Shadow Mapping (CSM) implementation for high-quality
 * directional light shadows at multiple distance levels.
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * Shadow cascade configuration
 */
export interface CascadeConfig {
    count: number;
    lambda: number;
    splitDistribution: number;
    nearBound: number;
    farBound: number;
    shadowMapSize: number;
    bias: number;
    normalBias: number;
    pcssSamples: number;
    blurRadius: number;
}
/**
 * Cascaded Shadow Map manager
 *
 * Splits the camera frustum into multiple cascades, each
 * with its own shadow map at increasing distance from the camera.
 * This provides high-quality shadows both near and far.
 */
export declare class CascadedShadowMap {
    private readonly cascades;
    private readonly config;
    private readonly lightDirection;
    private readonly splitPositions;
    private renderer;
    private initialized;
    constructor(config?: Partial<CascadeConfig>);
    /**
     * Calculate split positions using practical split scheme
     */
    private calculateSplitPositions;
    /**
     * Initialize CSM resources
     */
    initialize(renderer: THREE.WebGLRenderer): void;
    /**
     * Update cascades for the current frame
     *
     * @param camera - The main scene camera
     * @param lightDir - Direction of the directional light
     */
    update(camera: THREE.PerspectiveCamera, lightDir: THREE.Vector3): void;
    /**
     * Update all shadow cascades
     */
    private updateCascades;
    /**
     * Calculate the 8 corners of a frustum slice
     */
    private calculateFrustumCorners;
    /**
     * Render shadow maps for all cascades
     *
     * @param scene - The scene to render shadows for
     * @param renderList - Objects that cast shadows
     */
    renderShadows(scene: THREE.Scene, shadowCasters: THREE.Object3D[]): void;
    /**
     * Get the shadow texture for a specific cascade
     */
    getShadowTexture(cascadeIndex: number): THREE.Texture | null;
    /**
     * Get all cascade data for the shadow shader
     */
    getCascadeData(): {
        splitPositions: Float32Array;
        viewProjectionMatrices: Float32Array;
        shadowTextures: THREE.Texture[];
        cascadeCount: number;
    };
    /**
     * Get cascade count
     */
    getCascadeCount(): number;
    /**
     * Resize shadow maps
     */
    setSize(size: number): void;
    /**
     * Dispose CSM resources
     */
    dispose(): void;
}
//# sourceMappingURL=CascadedShadowMap.d.ts.map