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
 * Default PBR material parameters
 */
const DEFAULT_PBR_PARAMS = {
    baseColor: new THREE.Color(0xffffff),
    metallic: 0.0,
    roughness: 0.5,
    normalScale: 1.0,
    occlusionStrength: 1.0,
    emissiveColor: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 0.0,
    sheenRoughness: 0.0,
    sheenColor: new THREE.Color(0xffffff),
    anisotropy: 0.0,
    anisotropyRotation: 0.0,
    alphaTest: 0.0,
    alphaCutoff: 0.5,
    transparency: 1.0,
    thickness: 1.0,
    ior: 1.5,
    specularIntensity: 1.0,
    specularColor: new THREE.Color(0xffffff),
    transmission: 0.0,
};
/**
 * Returns true when the params require MeshPhysicalMaterial
 * (clearcoat, sheen, anisotropy, transmission, IOR, specular).
 */
function requiresPhysicalMaterial(params) {
    return (params.clearcoat > 0 ||
        params.sheen > 0 ||
        params.anisotropy > 0 ||
        params.transmission > 0 ||
        params.ior !== 1.5 ||
        params.specularIntensity !== 1.0);
}
/**
 * PBR Material Manager
 *
 * Handles creation, caching, and optimization of PBR materials.
 * Uses a material cache to avoid duplicate materials and
 * tracks usage for garbage collection.
 */
export class PBRMaterialManager {
    materialCache = new Map();
    maxCacheSize = 500;
    accessCounter = 0;
    defaultMaterial;
    constructor() {
        this.createDefaultMaterial();
    }
    /**
     * Create the default fallback material
     */
    createDefaultMaterial() {
        this.defaultMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.5,
            metalness: 0.0,
        });
    }
    /**
     * Generate a cache key from material parameters and textures
     */
    generateCacheKey(params, textures) {
        const parts = [];
        // Add parameter values
        if (params.baseColor)
            parts.push(`c_${params.baseColor.getHex()}`);
        if (params.metallic !== undefined)
            parts.push(`m_${params.metallic.toFixed(3)}`);
        if (params.roughness !== undefined)
            parts.push(`r_${params.roughness.toFixed(3)}`);
        if (params.alphaTest !== undefined)
            parts.push(`at_${params.alphaTest.toFixed(3)}`);
        if (params.transparency !== undefined)
            parts.push(`tr_${params.transparency.toFixed(3)}`);
        if (params.clearcoat !== undefined)
            parts.push(`cc_${params.clearcoat.toFixed(3)}`);
        if (params.sheen !== undefined)
            parts.push(`sh_${params.sheen.toFixed(3)}`);
        if (params.anisotropy !== undefined)
            parts.push(`an_${params.anisotropy.toFixed(3)}`);
        if (params.transmission !== undefined)
            parts.push(`tx_${params.transmission.toFixed(3)}`);
        // Add texture IDs (using texture UUID or name)
        const textureKeys = [
            'albedoMap', 'normalMap', 'metallicRoughnessMap', 'occlusionMap',
            'emissiveMap', 'displacementMap', 'clearcoatMap', 'clearcoatNormalMap',
            'sheenColorMap', 'sheenRoughnessMap', 'anisotropyMap',
            'transmissionMap', 'thicknessMap', 'specularMap', 'specularColorMap',
        ];
        for (const key of textureKeys) {
            const tex = textures[key];
            if (tex) {
                parts.push(`${key}_${tex.uuid || tex.name}`);
            }
        }
        return parts.sort().join('|');
    }
    /**
     * Create or retrieve a PBR material
     */
    getMaterial(params = {}, textures = {}) {
        const cacheKey = this.generateCacheKey(params, textures);
        // Check cache
        const cached = this.materialCache.get(cacheKey);
        if (cached) {
            cached.lastUsed = ++this.accessCounter;
            return cached.material;
        }
        // Create new material
        const mergedParams = {
            ...DEFAULT_PBR_PARAMS,
            ...params,
        };
        // Use MeshPhysicalMaterial when advanced PBR features are required.
        // MeshStandardMaterial otherwise — it has lower GPU overhead.
        let material;
        if (requiresPhysicalMaterial(mergedParams)) {
            const physMat = new THREE.MeshPhysicalMaterial({
                color: mergedParams.baseColor,
                roughness: mergedParams.roughness,
                metalness: mergedParams.metallic,
                emissive: mergedParams.emissiveColor,
                emissiveIntensity: mergedParams.emissiveIntensity,
                normalScale: new THREE.Vector2(mergedParams.normalScale, mergedParams.normalScale),
                aoMapIntensity: mergedParams.occlusionStrength,
                alphaTest: mergedParams.alphaTest,
                transparent: mergedParams.transparency < 1.0 || mergedParams.transmission > 0,
                opacity: mergedParams.transparency,
                wireframe: false,
                side: THREE.FrontSide,
                // Advanced PBR features
                clearcoat: mergedParams.clearcoat,
                clearcoatRoughness: mergedParams.clearcoatRoughness,
                sheen: mergedParams.sheen,
                sheenRoughness: mergedParams.sheenRoughness,
                sheenColor: mergedParams.sheenColor,
                anisotropy: mergedParams.anisotropy,
                anisotropyRotation: mergedParams.anisotropyRotation,
                ior: mergedParams.ior,
                specularIntensity: mergedParams.specularIntensity,
                specularColor: mergedParams.specularColor,
                transmission: mergedParams.transmission,
                thickness: mergedParams.thickness,
            });
            material = physMat;
        }
        else {
            material = new THREE.MeshStandardMaterial({
                color: mergedParams.baseColor,
                roughness: mergedParams.roughness,
                metalness: mergedParams.metallic,
                emissive: mergedParams.emissiveColor,
                emissiveIntensity: mergedParams.emissiveIntensity,
                normalScale: new THREE.Vector2(mergedParams.normalScale, mergedParams.normalScale),
                aoMapIntensity: mergedParams.occlusionStrength,
                alphaTest: mergedParams.alphaTest,
                transparent: mergedParams.transparency < 1.0,
                opacity: mergedParams.transparency,
                wireframe: false,
                side: THREE.FrontSide,
            });
        }
        // Assign textures
        if (textures.albedoMap) {
            material.map = textures.albedoMap;
        }
        if (textures.normalMap) {
            material.normalMap = textures.normalMap;
            material.normalScale.set(mergedParams.normalScale, mergedParams.normalScale);
        }
        if (textures.metallicRoughnessMap) {
            material.metalnessMap = textures.metallicRoughnessMap;
            material.roughnessMap = textures.metallicRoughnessMap;
        }
        if (textures.occlusionMap) {
            material.aoMap = textures.occlusionMap;
        }
        if (textures.emissiveMap) {
            material.emissiveMap = textures.emissiveMap;
        }
        if (textures.displacementMap) {
            material.displacementMap = textures.displacementMap;
        }
        material.needsUpdate = true;
        // Cache the material
        if (this.materialCache.size >= this.maxCacheSize) {
            this.evictOldest();
        }
        this.materialCache.set(cacheKey, {
            material,
            params: mergedParams,
            textures,
            lastUsed: ++this.accessCounter,
        });
        return material;
    }
    /**
     * Update an existing material's parameters
     */
    updateMaterial(material, params) {
        if (params.baseColor !== undefined)
            material.color.copy(params.baseColor);
        if (params.metallic !== undefined)
            material.metalness = params.metallic;
        if (params.roughness !== undefined)
            material.roughness = params.roughness;
        if (params.emissiveColor !== undefined)
            material.emissive.copy(params.emissiveColor);
        if (params.emissiveIntensity !== undefined)
            material.emissiveIntensity = params.emissiveIntensity;
        if (params.normalScale !== undefined) {
            material.normalScale.set(params.normalScale, params.normalScale);
        }
        if (params.occlusionStrength !== undefined)
            material.aoMapIntensity = params.occlusionStrength;
        if (params.alphaTest !== undefined)
            material.alphaTest = params.alphaTest;
        if (params.transparency !== undefined) {
            material.transparent = params.transparency < 1.0;
            material.opacity = params.transparency;
        }
        material.needsUpdate = true;
    }
    /**
     * Apply PBR textures to an existing material
     */
    applyTextures(material, textures) {
        if (textures.albedoMap)
            material.map = textures.albedoMap;
        if (textures.normalMap)
            material.normalMap = textures.normalMap;
        if (textures.metallicRoughnessMap) {
            material.metalnessMap = textures.metallicRoughnessMap;
            material.roughnessMap = textures.metallicRoughnessMap;
        }
        if (textures.occlusionMap)
            material.aoMap = textures.occlusionMap;
        if (textures.emissiveMap)
            material.emissiveMap = textures.emissiveMap;
        if (textures.displacementMap)
            material.displacementMap = textures.displacementMap;
        material.needsUpdate = true;
    }
    /**
     * Get the default material
     */
    getDefaultMaterial() {
        return this.defaultMaterial;
    }
    /**
     * Evict the least recently used material from cache
     */
    evictOldest() {
        let oldestKey = '';
        let oldestAccess = Infinity;
        for (const [key, instance] of this.materialCache) {
            if (instance.lastUsed < oldestAccess) {
                oldestAccess = instance.lastUsed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            const instance = this.materialCache.get(oldestKey);
            if (instance) {
                instance.material.dispose();
            }
            this.materialCache.delete(oldestKey);
        }
    }
    /**
     * Get the cache size
     */
    getCacheSize() {
        return this.materialCache.size;
    }
    /**
     * Clear the material cache completely
     */
    clearCache() {
        for (const [, instance] of this.materialCache) {
            instance.material.dispose();
        }
        this.materialCache.clear();
    }
    /**
     * Create a wireframe version of a material
     */
    createWireframeMaterial(material) {
        const wireframe = material.clone();
        wireframe.wireframe = true;
        wireframe.color.setHex(0x00ff00);
        wireframe.emissive.setHex(0x000000);
        wireframe.opacity = 0.5;
        wireframe.transparent = true;
        return wireframe;
    }
    /**
     * Dispose the material manager
     */
    dispose() {
        this.clearCache();
        this.defaultMaterial.dispose();
    }
}
//# sourceMappingURL=PBRMaterialManager.js.map