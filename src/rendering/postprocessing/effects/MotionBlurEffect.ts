/**
 * MotionBlurEffect.ts
 *
 * High-quality camera-space motion blur using depth reprojection.
 * Each pixel's world position is reconstructed from the depth buffer,
 * reprojected through the PREVIOUS frame's view-projection matrix, and the
 * resulting UV delta becomes the blur direction. Supports only camera/object
 * parallax motion (the scene itself must be static between frames), which is
 * the dominant motion source in an FPS camera — the CoD-style look.
 *
 * @module Rendering
 */

import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
import { FullScreenTriangle } from '../../core/FullScreenTriangle';

/**
 * Motion blur configuration
 */
export interface MotionBlurConfig {
  intensity: number;
  samples: number;
  maxVelocity: number;
  jitter: boolean;
}

/**
 * Default motion blur configuration — tuned for a moody cinematic streak:
 * moderate intensity with a soft, jittered sweep.
 */
const DEFAULT_MOTION_BLUR: MotionBlurConfig = {
  intensity: 0.7,
  samples: 12,
  maxVelocity: 48.0,
  jitter: true,
};

/**
 * Motion blur post-processing effect
 *
 * Uses depth reprojection (previous frame UV - current frame UV) to compute
 * per-pixel velocity, then applies a directional blur along that velocity.
 */
export class MotionBlurEffect implements IPostEffect {
  readonly name = 'MotionBlur';
  enabled: boolean = true;

  private config: MotionBlurConfig;
  private material!: THREE.ShaderMaterial;
  private renderer: THREE.WebGLRenderer | null = null;
  private depthTexture: THREE.Texture | null = null;

  // Scratch matrices — reused every frame to avoid GC pressure
  private readonly invViewProjection: THREE.Matrix4 = new THREE.Matrix4();
  private previousViewProjection: THREE.Matrix4 = new THREE.Matrix4();

  constructor(config?: Partial<MotionBlurConfig>) {
    this.config = { ...DEFAULT_MOTION_BLUR, ...config };
  }

  /**
   * Provide the scene depth texture directly (the post chain's intermediate
   * targets don't carry a depth attachment — the HDR target's depth does).
   */
  setDepthTexture(texture: THREE.Texture): void {
    this.depthTexture = texture;
  }

  /**
   * Initialize motion blur resources
   */
  initialize(renderer: THREE.WebGLRenderer, _width: number, _height: number): void {
    this.renderer = renderer;

    // Motion blur material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        invViewProjection: { value: new THREE.Matrix4() },
        prevViewProjection: { value: new THREE.Matrix4() },
        intensity: { value: this.config.intensity },
        samples: { value: this.config.samples },
        maxVelocity: { value: this.config.maxVelocity },
        jitter: { value: this.config.jitter ? 1.0 : 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform mat4 invViewProjection;
        uniform mat4 prevViewProjection;
        uniform float intensity;
        uniform int samples;
        uniform float maxVelocity;
        uniform float jitter;
        varying vec2 vUv;

        // Reconstruct world-space position from non-linear depth
        vec3 reconstructWorld(vec2 uv, float depth) {
          vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 world = invViewProjection * clip;
          return world.xyz / world.w;
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).r;

          // Reconstruct world position, reproject through the previous frame
          vec3 worldPos = reconstructWorld(vUv, depth);
          vec4 prevClip = prevViewProjection * vec4(worldPos, 1.0);
          prevClip.xy /= prevClip.w;
          vec2 prevUv = prevClip.xy * 0.5 + 0.5;

          // Velocity = previous UV delta (skip sky/far plane depth=1.0)
          vec2 velocity = (vUv - prevUv) * intensity;
          if (depth >= 0.9999) velocity = vec2(0.0);

          float speed = length(velocity);
          if (speed > maxVelocity) {
            velocity *= maxVelocity / speed;
          }

          int numSamples = int(clamp(float(samples), 1.0, 32.0));
          float scale = 1.0 / float(numSamples);

          // Use jittering to reduce banding
          float jitterOffset = jitter * (fract(sin(dot(vUv, vec2(12.9898, 78.233)) * 43758.5453)) - 0.5) * scale;

          for (int i = 1; i < 32; i++) {
            if (i >= numSamples) break;
            float t = float(i) * scale + jitterOffset;
            vec2 uv = vUv + velocity * t;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            color += texture2D(tDiffuse, uv);
          }

          gl_FragColor = color * scale;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * Set the current view-projection matrix and its inverse, plus the previous
   * frame's view-projection for reprojection.
   */
  setMatrices(viewProjection: THREE.Matrix4, previousViewProjection: THREE.Matrix4): void {
    if (this.material) {
      this.invViewProjection.copy(viewProjection).invert();
      this.previousViewProjection.copy(previousViewProjection);
      this.material.uniforms.invViewProjection.value.copy(this.invViewProjection);
      this.material.uniforms.prevViewProjection.value.copy(this.previousViewProjection);
    }
  }

  /**
   * Render the motion blur effect
   */
  render(
    input: THREE.WebGLRenderTarget,
    output: THREE.WebGLRenderTarget,
    _camera: THREE.PerspectiveCamera
  ): void {
    if (!this.renderer) return;
    const tri = FullScreenTriangle.getInstance();

    this.material.uniforms.tDiffuse.value = input.texture;
    this.material.uniforms.tDepth.value = this.depthTexture ?? input.depthTexture ?? input.texture;

    tri.render(this.renderer, this.material, output);
  }

  /**
   * Resize
   */
  setSize(_width: number, _height: number): void {
    // No size-dependent render targets for this effect
  }

  /**
   * Dispose
   */
  dispose(): void {
    if (this.material) this.material.dispose();
  }
}
