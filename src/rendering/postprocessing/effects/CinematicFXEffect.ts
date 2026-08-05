/**
 * CinematicFXEffect.ts
 *
 * Cheap but high-impact cinematic post pass: subtle vignette, animated film
 * grain, and a color grade (contrast / saturation / temperature). Sits at the
 * END of the post chain (after TAA resolve) so it grades the final image.
 *
 * @module Rendering
 */

import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
import { FullScreenTriangle } from '../../core/FullScreenTriangle';

export interface CinematicFXConfig {
  vignette: number;
  grain: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

const DEFAULT_CONFIG: CinematicFXConfig = {
  // Film-grain + vignette only. Contrast / saturation / temperature are
  // neutral here because this pass runs in LINEAR HDR space (pre-tone-map),
  // where a 0.5 pivot is meaningless — the actual color grade lives in the
  // present-pass blit (RenderPipeline) after ACES tone mapping, in display
  // space. Clamping is intentionally avoided so HDR highlights survive for
  // the tonemapper.
  vignette: 0.42,
  grain: 0.08,
  contrast: 1.0,
  saturation: 1.0,
  temperature: 0.0,
};

export class CinematicFXEffect implements IPostEffect {
  readonly name = 'CinematicFX';
  enabled = true;

  private readonly config: CinematicFXConfig;
  private material!: THREE.ShaderMaterial;
  private renderer: THREE.WebGLRenderer | null = null;

  constructor(config?: Partial<CinematicFXConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uVignette: { value: this.config.vignette },
        uGrain: { value: this.config.grain },
        uContrast: { value: this.config.contrast },
        uSaturation: { value: this.config.saturation },
        uTemperature: { value: this.config.temperature },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uTemperature;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec2 uv = vUv;
          vec3 col = texture2D(tDiffuse, uv).rgb;

          // Contrast (around 0.5)
          col = (col - 0.5) * uContrast + 0.5;

          // Saturation
          float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(luma), col, uSaturation);

          // Temperature: warm shadows / cool highlights
          col.r += uTemperature * (1.0 - luma) * 0.35;
          col.b -= uTemperature * luma * 0.35;

          // Vignette
          vec2 d = uv - 0.5;
          float dist = length(d) * 1.414;
          float vig = 1.0 - smoothstep(0.45, 1.05, dist) * uVignette;
          col *= vig;

          // Film grain (animated, luminance-scaled)
          float g = (hash(uv * uResolution + fract(uTime) * 13.7) - 0.5) * uGrain;
          col += g * (0.3 + luma);

          // NOTE: deliberately no clamp — this pass runs in linear HDR
          // space and the ACES tonemapper in the present pass needs values
          // above 1.0 to roll off highlights correctly. Clamping here was
          // flattening the whole frame.
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  render(
    input: THREE.WebGLRenderTarget,
    output: THREE.WebGLRenderTarget,
    _camera: THREE.PerspectiveCamera
  ): void {
    if (!this.renderer) return;
    const tri = FullScreenTriangle.getInstance();
    this.material.uniforms.tDiffuse.value = input.texture;
    this.material.uniforms.uTime.value = performance.now() / 1000;
    tri.render(this.renderer, this.material, output);
  }

  setSize(width: number, height: number): void {
    if (this.material) {
      (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    }
  }

  setIntensity(intensity: number): void {
    if (this.material) {
      (this.material.uniforms.uVignette.value as number) = intensity;
    }
  }

  dispose(): void {
    this.material?.dispose();
  }
}
