import * as THREE from 'three';
/**
 * Light types supported by the engine
 */
export declare enum LightType {
    Directional = "directional",
    Point = "point",
    Spot = "spot",
    Area = "area",
    Ambient = "ambient",
    Hemisphere = "hemisphere"
}
/**
 * Light configuration interface
 */
export interface LightConfig {
    type: LightType;
    color: THREE.Color;
    intensity: number;
    position?: THREE.Vector3;
    direction?: THREE.Vector3;
    range?: number;
    angle?: number;
    penumbra?: number;
    decay?: number;
    shadowEnabled: boolean;
    shadowMapSize: number;
    bias: number;
    normalBias: number;
    castShadows: boolean;
    iesProfileUrl?: string;
    cookieTextureUrl?: string;
    volumetricEnabled: boolean;
    volumetricIntensity: number;
    object: THREE.Light;
}
/**
 * IBL (Image-Based Lighting) configuration
 */
export interface IBLConfig {
    enabled: boolean;
    environmentMap?: THREE.CubeTexture;
    irradianceMap?: THREE.CubeTexture;
    specularMap?: THREE.CubeTexture;
    brdfLUT?: THREE.Texture;
    intensity: number;
    rotation: number;
}
/**
 * Lighting statistics
 */
export interface LightingStats {
    totalLights: number;
    directionalLights: number;
    pointLights: number;
    spotLights: number;
    areaLights: number;
    shadowCastingLights: number;
}
//# sourceMappingURL=types.d.ts.map