/**
 * PBRMaterialManager.ts
 *
 * Physically-Based Rendering material manager.
 * Manages material creation, caching, and parameter updates.
 * Supports standard PBR workflow with metallic-roughness model.
 *
 * @module Rendering
 */
import * as THREE from 'three';
/**
 * PBR material parameters
 */
export interface PBRMaterialParams {
    baseColor: THREE.Color;
    metallic: number;
    roughness: number;
    normalScale: number;
    occlusionStrength: number;
    emissiveColor: THREE.Color;
    emissiveIntensity: number;
    clearcoat: number;
    clearcoatRoughness: number;
    sheen: number;
    sheenRoughness: number;
    sheenColor: THREE.Color;
    anisotropy: number;
    anisotropyRotation: number;
    alphaTest: number;
    alphaCutoff: number;
    transparency: number;
    thickness: number;
    ior: number;
    specularIntensity: number;
    specularColor: THREE.Color;
    transmission: number;
}
/**
 * Texture set for PBR materials
 */
export interface PBRTextureSet {
    albedoMap?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    metallicRoughnessMap?: THREE.Texture | null;
    occlusionMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
    displacementMap?: THREE.Texture | null;
    clearcoatMap?: THREE.Texture | null;
    clearcoatNormalMap?: THREE.Texture | null;
    sheenColorMap?: THREE.Texture | null;
    sheenRoughnessMap?: THREE.Texture | null;
    anisotropyMap?: THREE.Texture | null;
    transmissionMap?: THREE.Texture | null;
    thicknessMap?: THREE.Texture | null;
    specularMap?: THREE.Texture | null;
    specularColorMap?: THREE.Texture | null;
}
/**
 * PBR Material Manager
 *
 * Handles creation, caching, and optimization of PBR materials.
 * Uses a material cache to avoid duplicate materials and
 * tracks usage for garbage collection.
 */
export declare class PBRMaterialManager {
    private readonly materialCache;
    private readonly maxCacheSize;
    private accessCounter;
    private defaultMaterial;
    constructor();
    /**
     * Create the default fallback material
     */
    private createDefaultMaterial;
    /**
     * Generate a cache key from material parameters and textures
     */
    private generateCacheKey;
    /**
     * Create or retrieve a PBR material
     */
    getMaterial(params?: Partial<PBRMaterialParams>, textures?: PBRTextureSet): THREE.MeshStandardMaterial;
    /**
     * Update an existing material's parameters
     */
    updateMaterial(material: THREE.MeshStandardMaterial, params: Partial<PBRMaterialParams>): void;
    /**
     * Apply PBR textures to an existing material
     */
    applyTextures(material: THREE.MeshStandardMaterial, textures: PBRTextureSet): void;
    /**
     * Get the default material
     */
    getDefaultMaterial(): THREE.MeshStandardMaterial;
    /**
     * Evict the least recently used material from cache
     */
    private evictOldest;
    /**
     * Get the cache size
     */
    getCacheSize(): number;
    /**
     * Clear the material cache completely
     */
    clearCache(): void;
    /**
     * Create a wireframe version of a material
     */
    createWireframeMaterial(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial;
    /**
     * Dispose the material manager
     */
    dispose(): void;
}
//# sourceMappingURL=PBRMaterialManager.d.ts.map