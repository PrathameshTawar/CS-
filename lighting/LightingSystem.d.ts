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
import { IBLConfig, LightConfig, LightingStats } from './types';
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
export declare class LightingSystem {
    private readonly lights;
    private readonly shadowLights;
    private iblConfig;
    private scene;
    constructor(scene: THREE.Scene);
    /**
     * Create a directional light
     */
    createDirectionalLight(id: string, color?: THREE.Color, intensity?: number, position?: THREE.Vector3): void;
    /**
     * Create a point light
     */
    createPointLight(id: string, color?: THREE.Color, intensity?: number, position?: THREE.Vector3, range?: number, decay?: number): void;
    /**
     * Create a spot light
     */
    createSpotLight(id: string, color?: THREE.Color, intensity?: number, position?: THREE.Vector3, direction?: THREE.Vector3, angle?: number, penumbra?: number, range?: number, decay?: number): void;
    /**
     * Create an ambient light
     */
    createAmbientLight(id: string, color?: THREE.Color, intensity?: number): void;
    /**
     * Create a hemisphere light
     */
    createHemisphereLight(id: string, skyColor?: THREE.Color, groundColor?: THREE.Color, intensity?: number): void;
    /**
     * Create a rectangular area light (R2.2)
     */
    createAreaLight(id: string, color?: THREE.Color, intensity?: number, width?: number, height?: number, position?: THREE.Vector3, lookAt?: THREE.Vector3): void;
    /**
     * Remove a light by ID
     */
    removeLight(id: string): void;
    /**
     * Get a light by ID
     */
    getLight(id: string): (LightConfig & {
        object: THREE.Light;
    }) | undefined;
    /**
     * Set IBL (Image-Based Lighting)
     */
    setIBL(config: Partial<IBLConfig>): void;
    /**
     * Get the IBL configuration
     */
    getIBLConfig(): IBLConfig;
    /**
     * Update all shadow maps
     */
    updateShadows(): void;
    /**
     * Update light positions/directions (call each frame)
     */
    update(_deltaTime: number): void;
    /**
     * Get lighting statistics
     */
    getStats(): LightingStats;
    /**
     * Enable/disable volumetric lighting for a specific light
     */
    setVolumetricLighting(lightId: string, enabled: boolean, intensity?: number): void;
    /**
     * Set global ambient intensity
     */
    setAmbientIntensity(intensity: number): void;
    /**
     * Get the number of active lights
     */
    getLightCount(): number;
    /**
     * Get all shadow-casting lights
     */
    getShadowLights(): (LightConfig & {
        object: THREE.Light;
    })[];
    /**
     * Dispose the lighting system
     */
    dispose(): void;
}
//# sourceMappingURL=LightingSystem.d.ts.map