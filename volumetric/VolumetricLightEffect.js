/**
 * VolumetricLightEffect.ts
 *
 * Volumetric fog & light shafts (Requirement 1).
 * Screen-space ray-marched god rays from a directional light (sun),
 * combined with an exponential fog density pass. Rays are rendered by
 * marching toward the light screen position, sampling an occlusion
 * approximation, and accumulating scattered light.
 *
 * This is a lightweight approximation suitable for 60 FPS on WebGL.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { FullScreenTriangle } from '../core/FullScreenTriangle';
const DEFAULT_CONFIG = {
    // Moody volumetric shafts: a few more march steps, denser scattering,
    // stronger intensity and weight so light cuts through the fog.
    steps: 32,
    density: 0.16,
    fogColor: 0xdfe8f2,
    fogDensity: 0.016,
    intensity: 1.35,
    decay: 0.95,
    weight: 0.7,
    exposure: 0.55,
};
/**
 * Post-processing effect that adds volumetric light shafts and
 * screen-space fog.
 */
export class VolumetricLightEffect {
    name = 'VolumetricLight';
    enabled = true;
    config;
    material;
    renderer = null;
    depthTexture = null;
    lightScreenPos = new THREE.Vector2(0.5, 0.7);
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Set the screen-space position of the light source (e.g. sun).
     * Computed by the demo by projecting the sun direction.
     */
    setLightScreenPosition(x, y) {
        this.lightScreenPos.set(x, y);
        if (this.material) {
            this.material.uniforms.lightPos.value.copy(this.lightScreenPos);
        }
    }
    getFogDensity() {
        return this.config.fogDensity;
    }
    setFogDensity(density) {
        this.config.fogDensity = density;
        if (this.material) {
            this.material.uniforms.fogDensity.value = density;
        }
    }
    getFogColor() {
        return new THREE.Color(this.config.fogColor);
    }
    setFogColor(color) {
        this.config.fogColor = color;
        if (this.material) {
            this.material.uniforms.fogColor.value.set(color);
        }
    }
    /** Ray-march scattering density (0..1). Exposed for WorldMutator (R30.4). */
    setDensity(density) {
        this.config.density = density;
        if (this.material) {
            this.material.uniforms.density.value = density;
        }
    }
    /** Global god-ray intensity. Exposed for WorldMutator (R30.4/R30.5). */
    setIntensity(intensity) {
        this.config.intensity = intensity;
        if (this.material) {
            this.material.uniforms.intensity.value = intensity;
        }
    }
    initialize(renderer, width, height) {
        this.renderer = renderer;
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                lightPos: { value: this.lightScreenPos.clone() },
                density: { value: this.config.density },
                fogColor: { value: new THREE.Color(this.config.fogColor) },
                fogDensity: { value: this.config.fogDensity },
                intensity: { value: this.config.intensity },
                decay: { value: this.config.decay },
                weight: { value: this.config.weight },
                exposure: { value: this.config.exposure },
                steps: { value: this.config.steps },
                resolution: { value: new THREE.Vector2(width, height) },
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
        uniform sampler2D tDepth;
        uniform vec2 lightPos;
        uniform float density;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform float intensity;
        uniform float decay;
        uniform float weight;
        uniform float exposure;
        uniform int steps;
        uniform vec2 resolution;
        varying vec2 vUv;

        // Depth-based occlusion approximation
        float sampleOcclusion(vec2 uv) {
          float depth = texture2D(tDepth, uv).r;
          // Map depth to occlusion: far = less blocked
          return clamp(1.0 - depth * 0.98, 0.0, 1.0);
        }

        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          // Loop bound is a compile-time constant; guard with uniform compare
          vec2 delta = (vUv - lightPos) * (1.0 / 32.0) * density;

          vec2 uv = vUv;
          float illumination = 0.0;
          float decayAcc = 1.0;

          for (int i = 0; i < 32; i++) {
            uv -= delta;
            if (i < steps) {
              float occ = sampleOcclusion(uv);
              illumination += occ * decayAcc;
              decayAcc *= decay;
            }
          }

          float shafts = illumination * weight * exposure;
          shafts = clamp(shafts * intensity, 0.0, 1.0);

          // Exponential fog blending — stable over time (previously the
          // time-decaying term made the fog fade to zero after ~10s, which
          // silently killed the moody volumetric atmosphere).
          float fogFactor = 1.0 - exp(-fogDensity * 120.0);
          vec3 finalColor = base.rgb;
          finalColor += fogColor * shafts * intensity * 0.35;
          finalColor = mix(finalColor, fogColor, fogFactor * 0.12);

          gl_FragColor = vec4(finalColor, base.a);
        }
      `,
            depthTest: false,
            depthWrite: false,
        });
    }
    render(input, output, _camera) {
        if (!this.renderer)
            return;
        const tri = FullScreenTriangle.getInstance();
        this.material.uniforms.tDiffuse.value = input.texture;
        this.material.uniforms.tDepth.value = this.depthTexture ?? input.depthTexture ?? input.texture;
        tri.render(this.renderer, this.material, output);
    }
    setDepthTexture(texture) {
        this.depthTexture = texture;
    }
    setSize(width, height) {
        if (this.material) {
            this.material.uniforms.resolution.value.set(width, height);
        }
    }
    dispose() {
        if (this.material)
            this.material.dispose();
        this.renderer = null;
    }
}
//# sourceMappingURL=VolumetricLightEffect.js.map