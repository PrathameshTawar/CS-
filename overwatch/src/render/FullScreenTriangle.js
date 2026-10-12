// render/FullScreenTriangle.js — a fullscreen quad with a ShaderMaterial.
// Reused by every post pass so we never allocate in the hot path.

import * as THREE from 'three';

export class FullScreenTriangle {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, null);
    this.mesh.frustumCulled = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.updateMatrix();
    this.scene.add(this.mesh);
  }

  setMaterial(material) {
    this.mesh.material = material;
  }

  get material() {
    return this.mesh.material;
  }

  render(renderer, target) {
    const prev = renderer.getRenderTarget();
    if (target) renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    if (target) renderer.setRenderTarget(prev);
  }

  dispose() {
    this.mesh.geometry.dispose();
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
