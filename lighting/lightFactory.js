import * as THREE from 'three';
import { LightType } from './types';
export function createDirectionalLightEntry(color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 50, 0)) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.copy(position);
    light.castShadow = true;
    light.shadow.mapSize.width = 4096;
    light.shadow.mapSize.height = 4096;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 200;
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    light.shadow.bias = -0.001;
    return {
        type: LightType.Directional,
        color: color.clone(),
        intensity,
        position: position.clone(),
        shadowEnabled: true,
        shadowMapSize: 4096,
        bias: -0.001,
        normalBias: 0,
        castShadows: true,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
export function createPointLightEntry(color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 0, 0), range = 10, decay = 2) {
    const light = new THREE.PointLight(color, intensity, range, decay);
    light.position.copy(position);
    light.castShadow = true;
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    return {
        type: LightType.Point,
        color: color.clone(),
        intensity,
        position: position.clone(),
        range,
        decay,
        shadowEnabled: true,
        shadowMapSize: 1024,
        bias: 0.001,
        normalBias: 0,
        castShadows: true,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
export function createSpotLightEntry(color = new THREE.Color(0xffffff), intensity = 1.0, position = new THREE.Vector3(0, 10, 0), direction = new THREE.Vector3(0, -1, 0), angle = Math.PI / 4, penumbra = 0.1, range = 50, decay = 2) {
    const light = new THREE.SpotLight(color, intensity, range, angle, penumbra, decay);
    light.position.copy(position);
    light.target.position.copy(position.clone().add(direction));
    light.target.updateMatrixWorld();
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    return {
        type: LightType.Spot,
        color: color.clone(),
        intensity,
        position: position.clone(),
        direction: direction.clone(),
        angle,
        penumbra,
        range,
        decay,
        shadowEnabled: true,
        shadowMapSize: 2048,
        bias: 0.001,
        normalBias: 0,
        castShadows: true,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
export function createAmbientLightEntry(color = new THREE.Color(0x404060), intensity = 0.5) {
    const light = new THREE.AmbientLight(color, intensity);
    return {
        type: LightType.Ambient,
        color: color.clone(),
        intensity,
        shadowEnabled: false,
        shadowMapSize: 0,
        bias: 0,
        normalBias: 0,
        castShadows: false,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
export function createHemisphereLightEntry(skyColor = new THREE.Color(0x87ceeb), groundColor = new THREE.Color(0x3a3a3a), intensity = 0.6) {
    const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
    return {
        type: LightType.Hemisphere,
        color: skyColor.clone(),
        intensity,
        shadowEnabled: false,
        shadowMapSize: 0,
        bias: 0,
        normalBias: 0,
        castShadows: false,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
export function createAreaLightEntry(color = new THREE.Color(0xffffff), intensity = 5.0, width = 4.0, height = 2.0, position = new THREE.Vector3(0, 5, 0), lookAt = new THREE.Vector3(0, 0, 0)) {
    const light = new THREE.RectAreaLight(color, intensity, width, height);
    light.position.copy(position);
    light.lookAt(lookAt);
    return {
        type: LightType.Area,
        color: color.clone(),
        intensity,
        position: position.clone(),
        shadowEnabled: false,
        shadowMapSize: 0,
        bias: 0,
        normalBias: 0,
        castShadows: false,
        volumetricEnabled: false,
        volumetricIntensity: 0,
        object: light,
    };
}
//# sourceMappingURL=lightFactory.js.map