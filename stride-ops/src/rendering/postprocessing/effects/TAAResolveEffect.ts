/**
 * TAAResolveEffect.ts
 * 
 * Temporal Anti-Aliasing (TAA) resolve effect.
 * Uses sub-pixel jittering across frames and resolves
 * using a history buffer with neighborhood clamping.
 * 
 * @module Rendering
 */

import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
import { FullScreenTriangle } from '../../core/FullScreenTriangle';

/**
 * TAA configuration
 */
export interface TAAConfig {
  jitterScale: number;
  historyBlendFactor: number;
  sharpness: number;
  useVelocity: boolean;
}

/**
 * Default TAA configuration
 */
const DEFAULT_TAA_CONFIG: TAAConfig = {
  jitterScale: 0.5,
  historyBlendFactor: 0.9,
  sharpness: 0.25,
  useVelocity: true,
};

/**
 * Halton sequence for sub-pixel jittering
 */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * TAA (Temporal Anti-Aliasing) effect
 * 
 * Accumulates samples over multiple frames using
 * sub-pixel jitter and a history buffer with
 * neighborhood clamping to reduce ghosting.
 */
export class TAAResolveEffect implements IPostEffect {
  readonly name = 'TAA';
  enabled: boolean = true;

  private config: TAAConfig;
  private readonly historyTarget: THREE.WebGLRenderTarget;
  private material!: THREE.ShaderMaterial;
  private renderer: THREE.WebGLRenderer | null = null;
  private width: number = 0;
  private height: number = 0;
  private frameIndex: number = 0;
  private currentJitter: THREE.Vector2 = new THREE.Vector2();

  constructor(config?: Partial<TAAConfig>) {
    this.config = { ...DEFAULT_TAA_CONFIG, ...config };

    this.historyTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
  }

  /**
   * Initialize TAA resources
   */
  initialize(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    this.renderer = renderer;
    this.width = width;
    this.height = height;

    this.historyTarget.setSize(width, height);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tHistory: { value: null },
        tVelocity: { value: null },
        blendFactor: { value: this.config.historyBlendFactor },
        sharpness: { value: this.config.sharpness },
        texelSize: { value: new THREE.Vector2(1 / width, 1 / height) },
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
        uniform sampler2D tHistory;
        uniform sampler2D tVelocity;
        uniform float blendFactor;
        uniform float sharpness;
        uniform vec2 texelSize;
        varying vec2 vUv;

        // Neighborhood clamping to reduce ghosting
        vec4 clampNeighborhood(sampler2D history, vec2 uv, vec4 current) {
          vec4 topLeft     = texture2D(history, uv + vec2(-1.0, -1.0) * texelSize);
          vec4 topCenter   = texture2D(history, uv + vec2( 0.0, -1.0) * texelSize);
          vec4 topRight    = texture2D(history, uv + vec2( 1.0, -1.0) * texelSize);
          vec4 centerLeft  = texture2D(history, uv + vec2(-1.0,  0.0) * texelSize);
          vec4 centerRight = texture2D(history, uv + vec2( 1.0,  0.0) * texelSize);
          vec4 bottomLeft  = texture2D(history, uv + vec2(-1.0,  1.0) * texelSize);
          vec4 bottomCenter= texture2D(history, uv + vec2( 0.0,  1.0) * texelSize);
          vec4 bottomRight = texture2D(history, uv + vec2( 1.0,  1.0) * texelSize);

          vec4 minColor = min(min(min(topLeft, topCenter), min(topRight, centerLeft)),
                              min(min(centerRight, bottomLeft), min(bottomCenter, bottomRight)));
          vec4 maxColor = max(max(max(topLeft, topCenter), max(topRight, centerLeft)),
                              max(max(centerRight, bottomLeft), max(bottomCenter, bottomRight)));

          // Expand the min/max slightly to avoid flickering
          vec4 range = maxColor - minColor;
          minColor -= range * sharpness;
          maxColor += range * sharpness;

          return clamp(current, minColor, maxColor);
        }

        void main() {
          vec4 current = texture2D(tDiffuse, vUv);
          vec4 history = texture2D(tHistory, vUv);
          vec2 velocity = texture2D(tVelocity, vUv).rg;

          // Reproject history using velocity
          vec2 historyUv = vUv - velocity;
          if (historyUv.x < 0.0 || historyUv.x > 1.0 || historyUv.y < 0.0 || historyUv.y > 1.0) {
            gl_FragColor = current;
            return;
          }
          vec4 reprojectedHistory = texture2D(tHistory, historyUv);

          // Neighborhood clamp to reduce ghosting
          vec4 clampedHistory = clampNeighborhood(tHistory, historyUv, reprojectedHistory);

          // Blend
          float blend = clamp(blendFactor, 0.0, 0.95);
          gl_FragColor = mix(current, clampedHistory, blend);
        }
      `,
    });
  }

  /**
   * Get the current sub-pixel jitter offset
   */
  getJitter(): THREE.Vector2 {
    return this.currentJitter.clone();
  }

  /**
   * Advance to the next frame (updates jitter)
   */
  nextFrame(): void {
    this.frameIndex++;
    this.currentJitter.set(
      (halton(this.frameIndex, 2) - 0.5) * this.config.jitterScale,
      (halton(this.frameIndex, 3) - 0.5) * this.config.jitterScale
    );
  }

  /**
   * Apply jitter to a projection matrix
   */
  applyJitterToProjection(projection: THREE.Matrix4): void {
    const elements = projection.elements;
    elements[8] += this.currentJitter.x / this.width;
    elements[9] += this.currentJitter.y / this.height;
  }

  /**
   * Render the TAA resolve
   */
  render(
    input: THREE.WebGLRenderTarget,
    output: THREE.WebGLRenderTarget,
    _camera: THREE.PerspectiveCamera
  ): void {
    if (!this.renderer) return;
    const tri = FullScreenTriangle.getInstance();

    this.material.uniforms.tDiffuse.value = input.texture;
    this.material.uniforms.tHistory.value = this.historyTarget.texture;

    // Resolve into output
    tri.render(this.renderer, this.material, output);

    // Copy output into history for next frame
    // (We swap by rendering output → history using a plain blit material)
    const blitMat = new THREE.RawShaderMaterial({
      uniforms: { tDiffuse: { value: output.texture } },
      vertexShader: `precision highp float;
        attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `precision highp float;
        uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
      depthTest: false, depthWrite: false,
    });
    tri.render(this.renderer, blitMat, this.historyTarget);
    blitMat.dispose();
  }

  /**
   * Resize
   */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.historyTarget.setSize(width, height);

    if (this.material) {
      this.material.uniforms.texelSize.value.set(1 / width, 1 / height);
    }
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.historyTarget.dispose();
    if (this.material) this.material.dispose();
  }
}

