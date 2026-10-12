/**
 * SkyDome.ts
 *
 * Procedural sky dome rendered with a single shader: gradient sky, sun disc
 * with glow, drifting procedural clouds, and a star field at night. The dome
 * follows the camera so the horizon always sits at the fog line. Weather and
 * time-of-day are driven by the WorldMutator through setAtmosphere().
 *
 * Fully procedural — no textures or external assets.
 *
 * @module Rendering
 */

import * as THREE from 'three';

export interface SkyAtmosphere {
  /** Zenith sky color (RGB hex). */
  zenith: number;
  /** Horizon sky color (RGB hex). */
  horizon: number;
  /** Sun disc + glow color. */
  sunColor: number;
  /** Sun direction (normalized, world space). */
  sunDirection?: THREE.Vector3;
  /** 0..1 — how much cloud cover. */
  cloudCover: number;
  /** Sun brightness multiplier. */
  sunIntensity: number;
  /** 0..1 — star visibility (night). */
  starIntensity: number;
}

const DEFAULT_ATMOSPHERE: SkyAtmosphere = {
  zenith: 0x2e6fb8,
  horizon: 0xbcd8ee,
  sunColor: 0xfff2cc,
  sunDirection: new THREE.Vector3(0.6, 0.8, 0.3).normalize(),
  cloudCover: 0.25,
  sunIntensity: 1.0,
  starIntensity: 0,
};

/**
 * A skydome that keeps itself centered on the camera.
 */
export class SkyDome {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly sunDir: THREE.Vector3 = new THREE.Vector3(0.6, 0.8, 0.3).normalize();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(DEFAULT_ATMOSPHERE.zenith) },
        uHorizon: { value: new THREE.Color(DEFAULT_ATMOSPHERE.horizon) },
        uSunColor: { value: new THREE.Color(DEFAULT_ATMOSPHERE.sunColor) },
        uSunDir: { value: this.sunDir },
        uTime: { value: 0 },
        uCloudCover: { value: DEFAULT_ATMOSPHERE.cloudCover },
        uSunIntensity: { value: 1 },
        uStarIntensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform float uCloudCover;
        uniform float uSunIntensity;
        uniform float uStarIntensity;

        float hash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(vec3(i, 0.0));
          float b = hash(vec3(i + vec2(1.0, 0.0), 0.0));
          float c = hash(vec3(i + vec2(0.0, 1.0), 0.0));
          float d = hash(vec3(i + vec2(1.0, 1.0), 0.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.03;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorld);
          float h = clamp(dir.y, -0.05, 1.0);
          vec3 sky = mix(uHorizon, uZenith, pow(h, 0.62));

          // Sun disc + layered warm halo (wide soft glow feeds bloom)
          float s = max(dot(dir, normalize(uSunDir)), 0.0);
          float disc = smoothstep(0.9993, 1.0, s);
          float glow = pow(s, 320.0) * 1.4 + pow(s, 14.0) * 0.42 + pow(s, 3.5) * 0.15;
          vec3 sun = uSunColor * (disc * 2.6 + glow) * uSunIntensity;

          // Clouds — layered fbm around the horizon band, drifting with time
          vec2 cp = dir.xz / (dir.y + 0.12);
          cp *= 0.35;
          cp += vec2(uTime * 0.004, uTime * 0.0016);
          float cloudH = clamp(1.0 - abs(dir.y) * 2.6, 0.0, 1.0);
          float cloudDensity = fbm(cp * 2.2 + vec2(3.0));
          float cloud2 = fbm(cp * 5.0 + vec2(17.0, 5.0));
          float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.35, cloudDensity * 0.6 + cloud2 * 0.5);
          c *= cloudH;
          // Cloud bases sit in shade, crowns catch the sun — volumetric-ish
          float baseShade = mix(0.5, 1.0, smoothstep(-0.06, 0.18, dir.y));
          vec3 cloudCol = mix(uHorizon * 1.2, vec3(1.0, 0.98, 0.95), 0.25) * baseShade;
          sky = mix(sky, cloudCol, c * 0.6);
          // Sun rim-lights the cloud crowns
          sun += uSunColor * c * s * 0.45 * uSunIntensity;

          // Warm haze band just above the horizon, blending toward the fog line
          float horizonF = pow(1.0 - clamp(dir.y, 0.0, 0.5) * 2.0, 1.8);
          sky = mix(sky, uHorizon * 1.24, horizonF * 0.3);

          // Stars at night — high-frequency hash in upper hemisphere only
          float starField = 0.0;
          if (dir.y > 0.02) {
            vec3 sp = dir * 320.0;
            vec3 cell = floor(sp);
            float star = hash(cell);
            star = step(0.9986, star);
            float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + star * 40.0);
            starField = star * twinkle * smoothstep(0.02, 0.25, dir.y);
          }
          sky += vec3(0.85, 0.9, 1.0) * starField * uStarIntensity;

          gl_FragColor = vec4(sky + sun, 1.0);
        }
      `,
    });

    const geo = new THREE.SphereGeometry(600, 32, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * Apply weather / time-of-day. Called by the WorldMutator on every mutation.
   */
  setAtmosphere(atmo: SkyAtmosphere): void {
    (this.material.uniforms.uZenith.value as THREE.Color).setHex(atmo.zenith);
    (this.material.uniforms.uHorizon.value as THREE.Color).setHex(atmo.horizon);
    (this.material.uniforms.uSunColor.value as THREE.Color).setHex(atmo.sunColor);
    (this.material.uniforms.uSunIntensity.value as number) = atmo.sunIntensity;
    (this.material.uniforms.uStarIntensity.value as number) = atmo.starIntensity;
    (this.material.uniforms.uCloudCover.value as number) = atmo.cloudCover;
    if (atmo.sunDirection) {
      this.sunDir.copy(atmo.sunDirection).normalize();
      this.material.uniforms.uSunDir.value = this.sunDir;
    }
  }

  /** Keep the dome centered on the camera (x/z) so the horizon never moves. */
  update(deltaTime: number, camera: THREE.PerspectiveCamera): void {
    this.time += deltaTime;
    this.material.uniforms.uTime.value = this.time;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
