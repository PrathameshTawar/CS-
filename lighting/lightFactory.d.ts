import * as THREE from 'three';
import { LightConfig } from './types';
export declare function createDirectionalLightEntry(color?: THREE.Color, intensity?: number, position?: THREE.Vector3): LightConfig & {
    object: THREE.Light;
};
export declare function createPointLightEntry(color?: THREE.Color, intensity?: number, position?: THREE.Vector3, range?: number, decay?: number): LightConfig & {
    object: THREE.Light;
};
export declare function createSpotLightEntry(color?: THREE.Color, intensity?: number, position?: THREE.Vector3, direction?: THREE.Vector3, angle?: number, penumbra?: number, range?: number, decay?: number): LightConfig & {
    object: THREE.Light;
};
export declare function createAmbientLightEntry(color?: THREE.Color, intensity?: number): LightConfig & {
    object: THREE.Light;
};
export declare function createHemisphereLightEntry(skyColor?: THREE.Color, groundColor?: THREE.Color, intensity?: number): LightConfig & {
    object: THREE.Light;
};
export declare function createAreaLightEntry(color?: THREE.Color, intensity?: number, width?: number, height?: number, position?: THREE.Vector3, lookAt?: THREE.Vector3): LightConfig & {
    object: THREE.Light;
};
//# sourceMappingURL=lightFactory.d.ts.map