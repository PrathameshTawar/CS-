/**
 * Water.ts
 *
 * Implements Requirement 1.1 — AAA Procedural Water System.
 *
 * Features:
 * - Sum-of-Sines / Gerstner wave displacement in vertex & normal evaluation (R1.1)
 * - Planar reflections via mirrored render target & Schlick Fresnel (R1.1)
 * - Depth-based color absorption (shallow turquoise → deep oceanic navy) (R1.1)
 * - Submerged caustic pattern projection onto underwater surfaces (R1.1)
 *
 * @module Rendering
 */

import * as THREE from 'three';

export interface WaterOptions {
  width?: number;
  depth?: number;
  waterHeight?: number;
  shallowColor?: THREE.Color;
  deepColor?: THREE.Color;
}

const WATER_VERTEX_SHADER = `
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vClipPos;

  // 4-component Gerstner wave parameters (dirX, dirY, steepness, wavelength)
  const vec4 wave1 = vec4(1.0, 0.4, 0.25, 12.0);
  const vec4 wave2 = vec4(-0.7, 0.7, 0.20, 8.0);
  const vec4 wave3 = vec4(0.3, -0.9, 0.15, 5.0);
  const vec4 wave4 = vec4(-0.5, -0.5, 0.10, 3.0);

  vec3 gerstnerWave(vec4 params, vec3 pos, inout vec3 tangent, inout vec3 binormal) {
    float steepness = params.z;
    float wavelength = params.w;
    float k = 2.0 * 3.14159265 / wavelength;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(params.xy);
    float f = k * (dot(d, pos.xz) - c * uTime * 1.5);
    float a = steepness / k;

    tangent += vec3(-d.x * d.x * (steepness * sin(f)), d.x * (steepness * cos(f)), -d.x * d.y * (steepness * sin(f)));
    binormal += vec3(-d.x * d.y * (steepness * sin(f)), d.y * (steepness * cos(f)), -d.y * d.y * (steepness * sin(f)));

    return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));
  }

  void main() {
    vUv = uv * 16.0;
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);

    vec3 offset = vec3(0.0);
    offset += gerstnerWave(wave1, worldPos, tangent, binormal);
    offset += gerstnerWave(wave2, worldPos, tangent, binormal);
    offset += gerstnerWave(wave3, worldPos, tangent, binormal);
    offset += gerstnerWave(wave4, worldPos, tangent, binormal);

    worldPos += offset;
    vWorldPosition = worldPos;

    vec3 normal = normalize(cross(binormal, tangent));
    vNormal = normalMatrix * normal;

    vClipPos = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    gl_Position = vClipPos;
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform sampler2D uReflectionMap;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;

  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vClipPos;

  // Procedural underwater caustics Voronoi pattern (R1.1)
  float voronoiCaustic(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 5.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = 0.5 + 0.5 * sin(uTime * 2.0 + 6.2831 * (n + g));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) md = d;
      }
    }
    return pow(clamp(1.0 - md, 0.0, 1.0), 3.0);
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(L + V);

    // Fresnel Schlick approximation
    float F0 = 0.02;
    float fresnel = F0 + (1.0 - F0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);

    // Depth absorption (approximate view distance & height)
    float depthFactor = clamp((cameraPosition.y - vWorldPosition.y) * 0.08, 0.0, 1.0);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);

    // Specular Sun Highlight
    float spec = pow(max(0.0, dot(N, H)), 256.0);
    vec3 specularColor = uSunColor * spec * 3.0;

    // Submerged Caustic overlay (R1.1)
    float caustic = voronoiCaustic(vWorldPosition.xz * 0.4 + vec2(uTime * 0.2));
    waterColor += vec3(caustic * 0.18);

    // Planar reflection sample
    vec2 ndc = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;
    vec2 refUv = clamp(ndc + N.xz * 0.08, 0.001, 0.999);
    vec3 reflectionColor = texture2D(uReflectionMap, refUv).rgb;

    vec3 finalColor = mix(waterColor, reflectionColor, fresnel) + specularColor;
    gl_FragColor = vec4(finalColor, 0.88);
  }
`;

export class Water extends THREE.Mesh {
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly reflectionTarget: THREE.WebGLRenderTarget;
  private readonly mirrorCamera = new THREE.PerspectiveCamera();
  private waterHeight: number;

  constructor(scene: THREE.Scene, options: WaterOptions = {}) {
    const width = options.width ?? 300;
    const depth = options.depth ?? 300;
    const waterHeight = options.waterHeight ?? 0;

    const geometry = new THREE.PlaneGeometry(width, depth, 128, 128);
    geometry.rotateX(-Math.PI / 2);

    const reflectionTarget = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    const material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uShallowColor: { value: options.shallowColor ?? new THREE.Color(0x1a8c9e) },
        uDeepColor: { value: options.deepColor ?? new THREE.Color(0x041c30) },
        uReflectionMap: { value: reflectionTarget.texture },
        uSunDirection: { value: new THREE.Vector3(0.6, 0.8, 0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfffaed) },
      },
      transparent: true,
      side: THREE.DoubleSide,
    });

    super(geometry, material);
    this.waterMaterial = material;
    this.reflectionTarget = reflectionTarget;
    this.waterHeight = waterHeight;
    this.position.y = waterHeight;
    this.receiveShadow = true;

    scene.add(this);
  }

  /**
   * Evaluates Gerstner wave height at world position (x, z) for physics / buoyancy.
   */
  getWaterHeightAt(x: number, z: number): number {
    const time = this.waterMaterial.uniforms.uTime.value;
    const evaluateWave = (steepness: number, wavelength: number, dx: number, dz: number) => {
      const k = (2.0 * Math.PI) / wavelength;
      const c = Math.sqrt(9.8 / k);
      const f = k * (dx * x + dz * z - c * time * 1.5);
      return (steepness / k) * Math.sin(f);
    };

    let height = this.waterHeight;
    height += evaluateWave(0.25, 12.0, 1.0, 0.4);
    height += evaluateWave(0.20, 8.0, -0.7, 0.7);
    height += evaluateWave(0.15, 5.0, 0.3, -0.9);
    height += evaluateWave(0.10, 3.0, -0.5, -0.5);

    return height;
  }

  update(deltaTime: number, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera): void {
    this.waterMaterial.uniforms.uTime.value += deltaTime;

    // Optional planar reflection pass
    if (renderer && scene && camera instanceof THREE.PerspectiveCamera) {
      const originalTarget = renderer.getRenderTarget();
      this.visible = false;

      // Position mirror camera below water plane
      this.mirrorCamera.copy(camera);
      const dist = camera.position.y - this.waterHeight;
      this.mirrorCamera.position.y = this.waterHeight - dist;
      this.mirrorCamera.scale.y = -1;
      this.mirrorCamera.updateMatrixWorld(true);

      renderer.setRenderTarget(this.reflectionTarget);
      renderer.clear();
      renderer.render(scene, this.mirrorCamera);

      renderer.setRenderTarget(originalTarget);
      this.visible = true;
    }
  }

  dispose(): void {
    this.removeFromParent();
    this.geometry.dispose();
    this.waterMaterial.dispose();
    this.reflectionTarget.dispose();
  }
}
