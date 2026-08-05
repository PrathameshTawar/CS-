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
 * Default cascade configuration
 */
const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
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
 * A single shadow cascade level
 */
interface ShadowCascade {
  lightCamera: THREE.OrthographicCamera;
  renderTarget: THREE.WebGLRenderTarget;
  splitNear: number;
  splitFar: number;
  viewProjectionMatrix: THREE.Matrix4;
  frustumCorners: THREE.Vector3[];
}

/**
 * Cascaded Shadow Map manager
 * 
 * Splits the camera frustum into multiple cascades, each
 * with its own shadow map at increasing distance from the camera.
 * This provides high-quality shadows both near and far.
 */
export class CascadedShadowMap {
  private readonly cascades: ShadowCascade[] = [];
  private readonly config: CascadeConfig;
  private readonly lightDirection: THREE.Vector3;
  private readonly splitPositions: number[] = [];
  private renderer: THREE.WebGLRenderer | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<CascadeConfig>) {
    this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
    this.lightDirection = new THREE.Vector3(-1, -1, -1).normalize();

    // Calculate split positions
    this.calculateSplitPositions();
  }

  /**
   * Calculate split positions using practical split scheme
   */
  private calculateSplitPositions(): void {
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
  initialize(renderer: THREE.WebGLRenderer): void {
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

      const cascade: ShadowCascade = {
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
  update(camera: THREE.PerspectiveCamera, lightDir: THREE.Vector3): void {
    if (!this.initialized) return;

    this.lightDirection.copy(lightDir).normalize();
    this.updateCascades(camera);
  }

  /**
   * Update all shadow cascades
   */
  private updateCascades(camera: THREE.PerspectiveCamera): void {
    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];

      // Calculate frustum corners for this cascade
      const corners = this.calculateFrustumCorners(
        camera,
        cascade.splitNear,
        cascade.splitFar
      );
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
      cascade.viewProjectionMatrix.copy(
        cascade.lightCamera.projectionMatrix
      ).multiply(cascade.lightCamera.matrixWorldInverse);
    }
  }

  /**
   * Calculate the 8 corners of a frustum slice
   */
  private calculateFrustumCorners(
    camera: THREE.PerspectiveCamera,
    near: number,
    far: number
  ): THREE.Vector3[] {
    const corners: THREE.Vector3[] = [];
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
    corners.push(
      nearCenter.clone()
        .add(cameraRight.clone().multiplyScalar(-nearW))
        .add(cameraUp.clone().multiplyScalar(-nearH))
    );
    corners.push(
      nearCenter.clone()
        .add(cameraRight.clone().multiplyScalar(nearW))
        .add(cameraUp.clone().multiplyScalar(-nearH))
    );
    corners.push(
      nearCenter.clone()
        .add(cameraRight.clone().multiplyScalar(nearW))
        .add(cameraUp.clone().multiplyScalar(nearH))
    );
    corners.push(
      nearCenter.clone()
        .add(cameraRight.clone().multiplyScalar(-nearW))
        .add(cameraUp.clone().multiplyScalar(nearH))
    );

    // Far plane corners
    const farCenter = cameraPos.clone().add(cameraDir.clone().multiplyScalar(far));
    corners.push(
      farCenter.clone()
        .add(cameraRight.clone().multiplyScalar(-farW))
        .add(cameraUp.clone().multiplyScalar(-farH))
    );
    corners.push(
      farCenter.clone()
        .add(cameraRight.clone().multiplyScalar(farW))
        .add(cameraUp.clone().multiplyScalar(-farH))
    );
    corners.push(
      farCenter.clone()
        .add(cameraRight.clone().multiplyScalar(farW))
        .add(cameraUp.clone().multiplyScalar(farH))
    );
    corners.push(
      farCenter.clone()
        .add(cameraRight.clone().multiplyScalar(-farW))
        .add(cameraUp.clone().multiplyScalar(farH))
    );

    return corners;
  }

  /**
   * Render shadow maps for all cascades
   * 
   * @param scene - The scene to render shadows for
   * @param renderList - Objects that cast shadows
   */
  renderShadows(
    scene: THREE.Scene,
    shadowCasters: THREE.Object3D[]
  ): void {
    if (!this.renderer || !this.initialized) return;

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
  getShadowTexture(cascadeIndex: number): THREE.Texture | null {
    if (cascadeIndex < 0 || cascadeIndex >= this.cascades.length) {
      return null;
    }
    return this.cascades[cascadeIndex].renderTarget.texture;
  }

  /**
   * Get all cascade data for the shadow shader
   */
  getCascadeData(): {
    splitPositions: Float32Array;
    viewProjectionMatrices: Float32Array;
    shadowTextures: THREE.Texture[];
    cascadeCount: number;
  } {
    const count = this.cascades.length;
    const splitPositions = new Float32Array(count + 1);
    const viewProjectionMatrices = new Float32Array(count * 16);
    const shadowTextures: THREE.Texture[] = [];

    for (let i = 0; i < count; i++) {
      splitPositions[i] = this.cascades[i].splitNear;
      this.cascades[i].viewProjectionMatrix.toArray(
        viewProjectionMatrices,
        i * 16
      );
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
  getCascadeCount(): number {
    return this.cascades.length;
  }

  /**
   * Resize shadow maps
   */
  setSize(size: number): void {
    this.config.shadowMapSize = size;
    for (const cascade of this.cascades) {
      cascade.renderTarget.setSize(size, size);
    }
  }

  /**
   * Dispose CSM resources
   */
  dispose(): void {
    for (const cascade of this.cascades) {
      cascade.renderTarget.dispose();
    }
    this.cascades.length = 0;
    this.initialized = false;
  }
}

