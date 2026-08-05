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
 * Default cascade configuration
 */
const DEFAULT_CASCADE_CONFIG = {
    count: 4,
    lambda: 0.5,
    splitDistribution: 0.95,
    nearBound: 0.1,
    farBound: 100,
    shadowMapSize: 2048,
    bias: 0.005,
    normalBias: 0.02,
    pcssSamples: 16,
    blurRadius: 1.0,
};
/**
 * Cascaded Shadow Map manager
 *
 * Splits the camera frustum into multiple cascades, each
 * with its own shadow map at increasing distance from the camera.
 * This provides high-quality shadows both near and far.
 */
export class CascadedShadowMap {
    cascades = [];
    config;
    lightDirection;
    splitPositions = [];
    renderer = null;
    initialized = false;
    constructor(config) {
        this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
        this.lightDirection = new THREE.Vector3(-1, -1, -1).normalize();
        // Calculate split positions
        this.calculateSplitPositions();
    }
    /**
     * Calculate split positions using practical split scheme
     */
    calculateSplitPositions() {
        const near = this.config.nearBound;
        const far = this.config.farBound;
        const lambda = this.config.lambda;
        const count = this.config.count;
        this.splitPositions.length = 0;
        this.splitPositions.push(near);
        for (let i = 1; i < count; i++) {
            const fraction = i / count;
            const logSplit = near * Math.pow(far / near, fraction);
            const uniformSplit = near + (far - near) * fraction;
            const split = lambda * logSplit + (1 - lambda) * uniformSplit;
            this.splitPositions.push(split);
        }
        this.splitPositions.push(far);
    }
    /**
     * Initialize CSM resources
     */
    initialize(renderer) {
        this.renderer = renderer;
        for (let i = 0; i < this.config.count; i++) {
            const size = this.config.shadowMapSize;
            const renderTarget = new THREE.WebGLRenderTarget(size, size, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.FloatType,
                depthBuffer: true,
                stencilBuffer: false,
            });
            const lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
            const cascade = {
                lightCamera,
                renderTarget,
                splitNear: this.splitPositions[i],
                splitFar: this.splitPositions[i + 1],
                viewProjectionMatrix: new THREE.Matrix4(),
                frustumCorners: [],
            };
            this.cascades.push(cascade);
        }
        this.initialized = true;
    }
    /**
     * Update cascades for the current frame
     *
     * @param camera - The main scene camera
     * @param lightDir - Direction of the directional light
     */
    update(camera, lightDir) {
        if (!this.initialized)
            return;
        this.lightDirection.copy(lightDir).normalize();
        this.updateCascades(camera);
    }
    /**
     * Update all shadow cascades
     */
    updateCascades(camera) {
        for (let i = 0; i < this.cascades.length; i++) {
            const cascade = this.cascades[i];
            // Calculate frustum corners for this cascade
            const corners = this.calculateFrustumCorners(camera, cascade.splitNear, cascade.splitFar);
            cascade.frustumCorners = corners;
            // Calculate bounding sphere of the frustum
            const center = new THREE.Vector3();
            let radius = 0;
            for (const corner of corners) {
                center.add(corner);
            }
            center.divideScalar(corners.length);
            for (const corner of corners) {
                const distance = center.distanceTo(corner);
                radius = Math.max(radius, distance);
            }
            // Round up to nearest texel to avoid shimmering
            const worldUnitsPerTexel = (radius * 2) / this.config.shadowMapSize;
            center.x = Math.round(center.x / worldUnitsPerTexel) * worldUnitsPerTexel;
            center.y = Math.round(center.y / worldUnitsPerTexel) * worldUnitsPerTexel;
            center.z = Math.round(center.z / worldUnitsPerTexel) * worldUnitsPerTexel;
            // Set light camera
            const lightPos = center.clone().add(this.lightDirection.clone().multiplyScalar(radius * 2));
            cascade.lightCamera.position.copy(lightPos);
            cascade.lightCamera.lookAt(center);
            cascade.lightCamera.left = -radius;
            cascade.lightCamera.right = radius;
            cascade.lightCamera.top = radius;
            cascade.lightCamera.bottom = -radius;
            cascade.lightCamera.near = 0.1;
            cascade.lightCamera.far = radius * 4;
            cascade.lightCamera.updateProjectionMatrix();
            cascade.lightCamera.updateMatrixWorld();
            // Compute view-projection matrix
            cascade.viewProjectionMatrix.copy(cascade.lightCamera.projectionMatrix).multiply(cascade.lightCamera.matrixWorldInverse);
        }
    }
    /**
     * Calculate the 8 corners of a frustum slice
     */
    calculateFrustumCorners(camera, near, far) {
        const corners = [];
        const fov = camera.fov * Math.PI / 180;
        const aspect = camera.aspect;
        const tanFov = Math.tan(fov / 2);
        // Near plane
        const nearH = tanFov * near;
        const nearW = nearH * aspect;
        // Far plane
        const farH = tanFov * far;
        const farW = farH * aspect;
        const cameraPos = camera.position;
        const cameraDir = new THREE.Vector3();
        const cameraRight = new THREE.Vector3();
        const cameraUp = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
        cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
        // Near plane corners
        const nearCenter = cameraPos.clone().add(cameraDir.clone().multiplyScalar(near));
        corners.push(nearCenter.clone()
            .add(cameraRight.clone().multiplyScalar(-nearW))
            .add(cameraUp.clone().multiplyScalar(-nearH)));
        corners.push(nearCenter.clone()
            .add(cameraRight.clone().multiplyScalar(nearW))
            .add(cameraUp.clone().multiplyScalar(-nearH)));
        corners.push(nearCenter.clone()
            .add(cameraRight.clone().multiplyScalar(nearW))
            .add(cameraUp.clone().multiplyScalar(nearH)));
        corners.push(nearCenter.clone()
            .add(cameraRight.clone().multiplyScalar(-nearW))
            .add(cameraUp.clone().multiplyScalar(nearH)));
        // Far plane corners
        const farCenter = cameraPos.clone().add(cameraDir.clone().multiplyScalar(far));
        corners.push(farCenter.clone()
            .add(cameraRight.clone().multiplyScalar(-farW))
            .add(cameraUp.clone().multiplyScalar(-farH)));
        corners.push(farCenter.clone()
            .add(cameraRight.clone().multiplyScalar(farW))
            .add(cameraUp.clone().multiplyScalar(-farH)));
        corners.push(farCenter.clone()
            .add(cameraRight.clone().multiplyScalar(farW))
            .add(cameraUp.clone().multiplyScalar(farH)));
        corners.push(farCenter.clone()
            .add(cameraRight.clone().multiplyScalar(-farW))
            .add(cameraUp.clone().multiplyScalar(farH)));
        return corners;
    }
    /**
     * Render shadow maps for all cascades
     *
     * @param scene - The scene to render shadows for
     * @param renderList - Objects that cast shadows
     */
    renderShadows(scene, shadowCasters) {
        if (!this.renderer || !this.initialized)
            return;
        for (let i = 0; i < this.cascades.length; i++) {
            const cascade = this.cascades[i];
            this.renderer.setRenderTarget(cascade.renderTarget);
            this.renderer.clear(true, true, false);
            // Render shadow casters from light's perspective
            for (const object of shadowCasters) {
                object.layers.set(1); // Shadow layer
            }
            // Render scene from light camera
            this.renderer.render(scene, cascade.lightCamera);
            // Restore layers
            for (const object of shadowCasters) {
                object.layers.set(0);
            }
        }
    }
    /**
     * Get the shadow texture for a specific cascade
     */
    getShadowTexture(cascadeIndex) {
        if (cascadeIndex < 0 || cascadeIndex >= this.cascades.length) {
            return null;
        }
        return this.cascades[cascadeIndex].renderTarget.texture;
    }
    /**
     * Get all cascade data for the shadow shader
     */
    getCascadeData() {
        const count = this.cascades.length;
        const splitPositions = new Float32Array(count + 1);
        const viewProjectionMatrices = new Float32Array(count * 16);
        const shadowTextures = [];
        for (let i = 0; i < count; i++) {
            splitPositions[i] = this.cascades[i].splitNear;
            this.cascades[i].viewProjectionMatrix.toArray(viewProjectionMatrices, i * 16);
            shadowTextures.push(this.cascades[i].renderTarget.texture);
        }
        splitPositions[count] = this.cascades[count - 1].splitFar;
        return {
            splitPositions,
            viewProjectionMatrices,
            shadowTextures,
            cascadeCount: count,
        };
    }
    /**
     * Get cascade count
     */
    getCascadeCount() {
        return this.cascades.length;
    }
    /**
     * Resize shadow maps
     */
    setSize(size) {
        this.config.shadowMapSize = size;
        for (const cascade of this.cascades) {
            cascade.renderTarget.setSize(size, size);
        }
    }
    /**
     * Dispose CSM resources
     */
    dispose() {
        for (const cascade of this.cascades) {
            cascade.renderTarget.dispose();
        }
        this.cascades.length = 0;
        this.initialized = false;
    }
}
//# sourceMappingURL=CascadedShadowMap.js.map