/**
 * LightingSystem.ts
 *
 * Centralized lighting system that manages all light types:
 * - Directional lights with CSM
 * - Point lights with IES profiles
 * - Spot lights with cookies
 * - Area lights
 * - Volumetric lighting
 * - IBL (Image-Based Lighting)
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { createAmbientLightEntry, createDirectionalLightEntry, createHemisphereLightEntry, createPointLightEntry, createSpotLightEntry, createAreaLightEntry, } from './lightFactory';
import { LightType } from './types';
/**
 * Centralized lighting system
 *
 * Manages all light sources in the scene and handles:
 * - Light creation/destruction
 * - Shadow map management
 * - IBL setup
 * - Light culling and clustering
 * - Volumetric lighting
 */
export class LightingSystem {
    lights = new Map();
    shadowLights = new Map();
    iblConfig = {
        enabled: false,
        intensity: 1.0,
        rotation: 0,
    };
    scene;
    constructor(scene) {
        this.scene = scene;
    }
    /**
     * Create a directional light
     */
    createDirectionalLight(id, color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 50, 0)) {
        const entry = createDirectionalLightEntry(color, intensity, position);
        this.scene.add(entry.object);
        this.lights.set(id, entry);
        this.shadowLights.set(id, entry);
    }
    /**
     * Create a point light
     */
    createPointLight(id, color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 0, 0), range = 10, decay = 2) {
        const entry = createPointLightEntry(color, intensity, position, range, decay);
        this.scene.add(entry.object);
        this.lights.set(id, entry);
        this.shadowLights.set(id, entry);
    }
    /**
     * Create a spot light
     */
    createSpotLight(id, color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 10, 0), direction = new THREE.Vector3(0, -1, 0), angle = Math.PI / 4, penumbra = 0.1, range = 50, decay = 2) {
        const entry = createSpotLightEntry(color, intensity, position, direction, angle, penumbra, range, decay);
        this.scene.add(entry.object);
        if (entry.object instanceof THREE.SpotLight) {
            this.scene.add(entry.object.target);
        }
        this.lights.set(id, entry);
        this.shadowLights.set(id, entry);
    }
    /**
     * Create an ambient light
     */
    createAmbientLight(id, color = new THREE.Color(0x404060), intensity = 0.5) {
        const entry = createAmbientLightEntry(color, intensity);
        this.scene.add(entry.object);
        this.lights.set(id, entry);
    }
    /**
     * Create a hemisphere light
     */
    createHemisphereLight(id, skyColor = new THREE.Color(0x87ceeb), groundColor = new THREE.Color(0x3a3a3a), intensity = 0.6) {
        const entry = createHemisphereLightEntry(skyColor, groundColor, intensity);
        this.scene.add(entry.object);
        this.lights.set(id, entry);
    }
    /**
     * Create a rectangular area light (R2.2)
     */
    createAreaLight(id, color = new THREE.Color(0xffffff), intensity = 5.0, width = 4.0, height = 2.0, position = new THREE.Vector3(0, 5, 0), lookAt = new THREE.Vector3(0, 0, 0)) {
        const entry = createAreaLightEntry(color, intensity, width, height, position, lookAt);
        this.scene.add(entry.object);
        this.lights.set(id, entry);
    }
    /**
     * Remove a light by ID
     */
    removeLight(id) {
        const entry = this.lights.get(id);
        if (entry) {
            this.scene.remove(entry.object);
            if (entry.type === LightType.Spot && entry.object instanceof THREE.SpotLight) {
                this.scene.remove(entry.object.target);
            }
            this.lights.delete(id);
            this.shadowLights.delete(id);
        }
    }
    /**
     * Get a light by ID
     */
    getLight(id) {
        return this.lights.get(id);
    }
    /**
     * Set IBL (Image-Based Lighting)
     */
    setIBL(config) {
        this.iblConfig = { ...this.iblConfig, ...config };
        if (this.iblConfig.enabled && this.iblConfig.environmentMap) {
            this.scene.environment = this.iblConfig.environmentMap;
        }
        else {
            this.scene.environment = null;
        }
        // Note: Full IBL with irradiance/specular convolution
        // would require custom shader integration
    }
    /**
     * Get the IBL configuration
     */
    getIBLConfig() {
        return { ...this.iblConfig };
    }
    /**
     * Update all shadow maps
     */
    updateShadows() {
        // Shadow map updates are handled per-frame by the render pipeline
        // This is a hook for any pre-shadow rendering logic
    }
    /**
     * Update light positions/directions (call each frame)
     */
    update(_deltaTime) {
        // Animate lights if needed
        // Time-of-day cycle, flickering, etc.
    }
    /**
     * Get lighting statistics
     */
    getStats() {
        let directional = 0;
        let point = 0;
        let spot = 0;
        let area = 0;
        for (const [, entry] of this.lights) {
            switch (entry.type) {
                case LightType.Directional:
                    directional++;
                    break;
                case LightType.Point:
                    point++;
                    break;
                case LightType.Spot:
                    spot++;
                    break;
                case LightType.Area:
                    area++;
                    break;
            }
        }
        return {
            totalLights: this.lights.size,
            directionalLights: directional,
            pointLights: point,
            spotLights: spot,
            areaLights: area,
            shadowCastingLights: this.shadowLights.size,
        };
    }
    /**
     * Enable/disable volumetric lighting for a specific light
     */
    setVolumetricLighting(lightId, enabled, intensity = 1.0) {
        const entry = this.lights.get(lightId);
        if (entry) {
            entry.volumetricEnabled = enabled;
            entry.volumetricIntensity = intensity;
        }
    }
    /**
     * Set global ambient intensity
     */
    setAmbientIntensity(intensity) {
        for (const [, entry] of this.lights) {
            if (entry.type === LightType.Ambient) {
                entry.object.intensity = intensity;
                entry.intensity = intensity;
            }
        }
    }
    /**
     * Get the number of active lights
     */
    getLightCount() {
        return this.lights.size;
    }
    /**
     * Get all shadow-casting lights
     */
    getShadowLights() {
        return Array.from(this.shadowLights.values());
    }
    /**
     * Dispose the lighting system
     */
    dispose() {
        for (const id of this.lights.keys()) {
            this.removeLight(id);
        }
        this.lights.clear();
        this.shadowLights.clear();
        this.scene.environment = null;
    }
}
//# sourceMappingURL=LightingSystem.js.map