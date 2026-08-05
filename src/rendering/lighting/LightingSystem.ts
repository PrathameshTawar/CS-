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
import {
  createAmbientLightEntry,
  createDirectionalLightEntry,
  createHemisphereLightEntry,
  createPointLightEntry,
  createSpotLightEntry,
  createAreaLightEntry,
} from './lightFactory';
import { IBLConfig, LightConfig, LightType, LightingStats } from './types';

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
  private readonly lights: Map<string, LightConfig & { object: THREE.Light }> = new Map();
  private readonly shadowLights: Map<string, LightConfig & { object: THREE.Light }> = new Map();
  private iblConfig: IBLConfig = {
    enabled: false,
    intensity: 1.0,
    rotation: 0,
  };
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Create a directional light
   */
  createDirectionalLight(
    id: string,
    color: THREE.Color = new THREE.Color(0xffffff),
    intensity: number = 1.0,
    position: THREE.Vector3 = new THREE.Vector3(0, 50, 0)
  ): void {
    const entry = createDirectionalLightEntry(color, intensity, position);
    this.scene.add(entry.object);
    this.lights.set(id, entry);
    this.shadowLights.set(id, entry);
  }

  /**
   * Create a point light
   */
  createPointLight(
    id: string,
    color: THREE.Color = new THREE.Color(0xffffff),
    intensity: number = 1.0,
    position: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
    range: number = 10,
    decay: number = 2
  ): void {
    const entry = createPointLightEntry(color, intensity, position, range, decay);
    this.scene.add(entry.object);
    this.lights.set(id, entry);
    this.shadowLights.set(id, entry);
  }

  /**
   * Create a spot light
   */
  createSpotLight(
    id: string,
    color: THREE.Color = new THREE.Color(0xffffff),
    intensity: number = 1.0,
    position: THREE.Vector3 = new THREE.Vector3(0, 10, 0),
    direction: THREE.Vector3 = new THREE.Vector3(0, -1, 0),
    angle: number = Math.PI / 4,
    penumbra: number = 0.1,
    range: number = 50,
    decay: number = 2
  ): void {
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
  createAmbientLight(
    id: string,
    color: THREE.Color = new THREE.Color(0x404060),
    intensity: number = 0.5
  ): void {
    const entry = createAmbientLightEntry(color, intensity);
    this.scene.add(entry.object);
    this.lights.set(id, entry);
  }

  /**
   * Create a hemisphere light
   */
  createHemisphereLight(
    id: string,
    skyColor: THREE.Color = new THREE.Color(0x87ceeb),
    groundColor: THREE.Color = new THREE.Color(0x3a3a3a),
    intensity: number = 0.6
  ): void {
    const entry = createHemisphereLightEntry(skyColor, groundColor, intensity);
    this.scene.add(entry.object);
    this.lights.set(id, entry);
  }

  /**
   * Create a rectangular area light (R2.2)
   */
  createAreaLight(
    id: string,
    color: THREE.Color = new THREE.Color(0xffffff),
    intensity: number = 5.0,
    width: number = 4.0,
    height: number = 2.0,
    position: THREE.Vector3 = new THREE.Vector3(0, 5, 0),
    lookAt: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  ): void {
    const entry = createAreaLightEntry(color, intensity, width, height, position, lookAt);
    this.scene.add(entry.object);
    this.lights.set(id, entry);
  }

  /**
   * Remove a light by ID
   */
  removeLight(id: string): void {
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
  getLight(id: string): (LightConfig & { object: THREE.Light }) | undefined {
    return this.lights.get(id);
  }

  /**
   * Set IBL (Image-Based Lighting)
   */
  setIBL(config: Partial<IBLConfig>): void {
    this.iblConfig = { ...this.iblConfig, ...config };

    if (this.iblConfig.enabled && this.iblConfig.environmentMap) {
      this.scene.environment = this.iblConfig.environmentMap;
    } else {
      this.scene.environment = null;
    }

    // Note: Full IBL with irradiance/specular convolution
    // would require custom shader integration
  }

  /**
   * Get the IBL configuration
   */
  getIBLConfig(): IBLConfig {
    return { ...this.iblConfig };
  }

  /**
   * Update all shadow maps
   */
  updateShadows(): void {
    // Shadow map updates are handled per-frame by the render pipeline
    // This is a hook for any pre-shadow rendering logic
  }

  /**
   * Update light positions/directions (call each frame)
   */
  update(_deltaTime: number): void {
    // Animate lights if needed
    // Time-of-day cycle, flickering, etc.
  }

  /**
   * Get lighting statistics
   */
  getStats(): LightingStats {
    let directional = 0;
    let point = 0;
    let spot = 0;
    let area = 0;

    for (const [, entry] of this.lights) {
      switch (entry.type) {
        case LightType.Directional: directional++; break;
        case LightType.Point: point++; break;
        case LightType.Spot: spot++; break;
        case LightType.Area: area++; break;
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
  setVolumetricLighting(lightId: string, enabled: boolean, intensity: number = 1.0): void {
    const entry = this.lights.get(lightId);
    if (entry) {
      entry.volumetricEnabled = enabled;
      entry.volumetricIntensity = intensity;
    }
  }

  /**
   * Set global ambient intensity
   */
  setAmbientIntensity(intensity: number): void {
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
  getLightCount(): number {
    return this.lights.size;
  }

  /**
   * Get all shadow-casting lights
   */
  getShadowLights(): (LightConfig & { object: THREE.Light })[] {
    return Array.from(this.shadowLights.values());
  }

  /**
   * Dispose the lighting system
   */
  dispose(): void {
    for (const id of this.lights.keys()) {
      this.removeLight(id);
    }
    this.lights.clear();
    this.shadowLights.clear();
    this.scene.environment = null;
  }
}

