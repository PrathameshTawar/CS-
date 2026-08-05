/**
 * SSAOEffect.ts
 *
 * Screen Space Ambient Occlusion using a depth-derived normal + hemisphere
 * sampling approach. Normals are reconstructed from the depth buffer, so no
 * G-buffer normal pass is required. The occlusion result is blurred with a
 * separable blur and then composited onto the scene as `scene * AO`.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { FullScreenTriangle } from '../../core/FullScreenTriangle';
/**
 * Default SSAO configuration — tuned for a soft, moody CoD-style ambient
 * occlusion: wide-ish contact radius, deep falloff, and a half-res buffer
 * that is upscaled through the blur for a smooth cinematic result.
 */
const DEFAULT_SSAO_CONFIG = {
    radius: 0.55,
    bias: 0.02,
    intensity: 1.35,
    power: 1.0,
    samples: 16,
    blurPasses: 2,
    downscale: 2,
};
/**
 * Generate a kernel of random sample points in a hemisphere
 */
function generateHemisphereSamples(count) {
    const samples = [];
    for (let i = 0; i < count; i++) {
        const sample = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()).normalize();
        // Scale for better distribution
        const scale = i / count;
        sample.multiplyScalar(0.1 + 0.9 * scale * scale);
        samples.push(sample);
    }
    return samples;
}
/**
 * SSAO (Screen Space Ambient Occlusion) effect
 *
 * Approximates ambient occlusion in screen space by sampling the depth buffer
 * around each pixel and computing the occlusion factor, then multiplies the
 * scene colour by the blurred occlusion.
 */
export class SSAOEffect {
    name = 'SSAO';
    enabled = true;
    config;
    samples;
    ssaoMaterial;
    blurMaterial;
    compositeMaterial;
    ssaoRenderTarget;
    blurRenderTarget;
    renderer = null;
    noiseTexture;
    depthTexture = null;
    constructor(config) {
        // The shader hardcodes `samples[16]` / `numSamples = 16`, so pin the
        // config to 16 regardless of what a caller passes.
        this.config = { ...DEFAULT_SSAO_CONFIG, ...config, samples: 16 };
        this.samples = generateHemisphereSamples(this.config.samples);
        // HalfFloat (not Float) internal targets: identical quality for 0-1 AO
        // values, and HalfFloat render targets are the format proven to work
        // across GL implementations (TAA's history target uses the same).
        // FloatType targets silently fail to draw on some drivers/software GL,
        // which previously left the AO buffer at the clear color and blackened
        // the whole post chain.
        const rtParams = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
        };
        this.ssaoRenderTarget = new THREE.WebGLRenderTarget(1, 1, rtParams);
        this.blurRenderTarget = new THREE.WebGLRenderTarget(1, 1, rtParams);
    }
    /**
     * Generate a random noise texture for sample rotation
     */
    generateNoiseTexture() {
        const size = 4;
        // Plain 8-bit RGBA noise — no float-texture dependency, works everywhere.
        const data = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            data[i * 4] = Math.floor(Math.random() * 256);
            data[i * 4 + 1] = Math.floor(Math.random() * 256);
            data[i * 4 + 2] = 128; // z = 0.5 so tangent is mostly in the xy plane
            data[i * 4 + 3] = 255;
        }
        const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        return texture;
    }
    /**
     * Provide the scene depth texture directly (the post chain's intermediate
     * targets don't carry a depth attachment — the HDR target's depth does).
     */
    setDepthTexture(texture) {
        this.depthTexture = texture;
    }
    /**
     * Initialize SSAO resources
     */
    initialize(renderer, width, height) {
        this.renderer = renderer;
        const ssaoWidth = Math.max(1, Math.floor(width / this.config.downscale));
        const ssaoHeight = Math.max(1, Math.floor(height / this.config.downscale));
        this.ssaoRenderTarget.setSize(ssaoWidth, ssaoHeight);
        this.blurRenderTarget.setSize(ssaoWidth, ssaoHeight);
        this.noiseTexture = this.generateNoiseTexture();
        // Build samples array for shader
        const sampleArray = new Float32Array(this.samples.length * 3);
        for (let i = 0; i < this.samples.length; i++) {
            sampleArray[i * 3] = this.samples[i].x;
            sampleArray[i * 3 + 1] = this.samples[i].y;
            sampleArray[i * 3 + 2] = this.samples[i].z;
        }
        // SSAO material
        this.ssaoMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDepth: { value: null },
                tNoise: { value: this.noiseTexture },
                samples: { value: sampleArray },
                // NOTE: never name fragment uniforms after THREE's reserved built-ins
                // (projectionMatrix / modelViewMatrix / viewMatrix / cameraPosition
                // / ...). Declaring e.g. `uniform mat4 projectionMatrix;` in a
                // FRAGMENT shader silently kills the whole draw on some stacks.
                uProjMatrix: { value: new THREE.Matrix4() },
                uInvProjMatrix: { value: new THREE.Matrix4() },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 },
                radius: { value: this.config.radius },
                bias: { value: this.config.bias },
                power: { value: this.config.power },
                texelSize: { value: new THREE.Vector2(1 / ssaoWidth, 1 / ssaoHeight) },
                noiseTexelSize: { value: new THREE.Vector2(1 / 4, 1 / 4) },
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
        uniform sampler2D tDepth;
        uniform sampler2D tNoise;
        uniform vec3 samples[16];
        uniform mat4 uProjMatrix;
        uniform mat4 uInvProjMatrix;
        uniform float radius;
        uniform float bias;
        uniform float power;
        uniform vec2 texelSize;
        uniform vec2 noiseTexelSize;
        varying vec2 vUv;

        uniform float cameraNear;
        uniform float cameraFar;

        // Reconstruct view-space position from depth
        vec3 reconstructPosition(vec2 uv, float depth) {
          vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 view = uInvProjMatrix * clip;
          return view.xyz / view.w;
        }

        // Convert non-linear depth [0,1] to linear view-space distance (positive).
        float linearDepth(float depth) {
          float z = depth * 2.0 - 1.0;
          return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
        }

        void main() {
          float depth = texture2D(tDepth, vUv).r;
          vec3 position = reconstructPosition(vUv, depth);
          float linDepth = linearDepth(depth);

          // Robust tangent frame: the camera-facing normal rotated by the
          // noise tile. Depth-gradient normal reconstruction is numerically
          // hopeless when the scene's window-space depth is compressed into a
          // tiny band (large near/far ratio), producing garbage/flipped
          // normals that blacken the frame. A camera-facing basis still yields
          // correct contact occlusion on every surface orientation.
          vec3 normal = vec3(0.0, 0.0, 1.0);
          vec3 randomVec = texture2D(tNoise, vUv * noiseTexelSize / texelSize).xyz * 2.0 - 1.0;
          vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
          vec3 bitangent = cross(normal, tangent);
          mat3 TBN = mat3(tangent, bitangent, normal);

          float occlusion = 0.0;
          const int numSamples = 16;

          for (int i = 0; i < numSamples; i++) {
            vec3 samplePos = TBN * samples[i];
            samplePos = position + samplePos * radius;

            vec4 offset = uProjMatrix * vec4(samplePos, 1.0);
            if (offset.w <= 0.0) continue;
            offset.xy /= offset.w;
            offset.xy = offset.xy * 0.5 + 0.5;
            // Skip samples that leave the screen
            if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0) continue;

            float sampleDepth = texture2D(tDepth, offset.xy).r;
            vec3 samplePosition = reconstructPosition(offset.xy, sampleDepth);

            // Linear distance comparison with an epsilon guard — nonlinear
            // depth makes far pixels look equal and wrecks the range check.
            float rangeCheck = smoothstep(0.0, 1.0, radius / (abs(linDepth - linearDepth(sampleDepth)) + 0.0001));
            occlusion += (samplePosition.z >= samplePos.z + bias ? 1.0 : 0.0) * rangeCheck;
          }

          occlusion = 1.0 - (occlusion / float(numSamples));
          occlusion = pow(occlusion, power);
          gl_FragColor = vec4(vec3(occlusion), 1.0);
        }
      `,
            depthTest: false,
            depthWrite: false,
        });
        // Blur material for SSAO denoising
        this.blurMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                texelSize: { value: new THREE.Vector2(1 / ssaoWidth, 1 / ssaoHeight) },
                direction: { value: new THREE.Vector2(1.0, 0.0) },
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
        uniform vec2 texelSize;
        uniform vec2 direction;
        varying vec2 vUv;

        void main() {
          vec4 color = vec4(0.0);
          vec2 off = direction * texelSize;
          color += texture2D(tDiffuse, vUv - 4.0 * off) * 0.05;
          color += texture2D(tDiffuse, vUv - 3.0 * off) * 0.09;
          color += texture2D(tDiffuse, vUv - 2.0 * off) * 0.12;
          color += texture2D(tDiffuse, vUv - 1.0 * off) * 0.15;
          color += texture2D(tDiffuse, vUv) * 0.16;
          color += texture2D(tDiffuse, vUv + 1.0 * off) * 0.15;
          color += texture2D(tDiffuse, vUv + 2.0 * off) * 0.12;
          color += texture2D(tDiffuse, vUv + 3.0 * off) * 0.09;
          color += texture2D(tDiffuse, vUv + 4.0 * off) * 0.05;
          gl_FragColor = color;
        }
      `,
            depthTest: false,
            depthWrite: false,
        });
        // Composite material — multiplies the scene by the blurred AO
        this.compositeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tScene: { value: null },
                tAO: { value: null },
                intensity: { value: this.config.intensity },
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
        uniform sampler2D tScene;
        uniform sampler2D tAO;
        uniform float intensity;
        varying vec2 vUv;

        void main() {
          vec3 scene = texture2D(tScene, vUv).rgb;
          float ao = texture2D(tAO, vUv).r;
          // intensity > 1 deepens the AO. The 0.35 floor is a safety net: a
          // degenerate AO buffer (e.g. NaN on unsupported hardware) can never
          // blacken the whole frame — it degrades to a mild darkening instead.
          float factor = clamp(mix(1.0, ao, intensity), 0.35, 1.0);
          if (!(factor > 0.0)) factor = 1.0; // NaN guard
          gl_FragColor = vec4(scene * factor, 1.0);
        }
      `,
            depthTest: false,
            depthWrite: false,
        });
    }
    /**
     * Set the projection matrix for reconstruction (near/far are extracted
     * from the matrix so depth can be linearized in the shader).
     */
    setProjectionMatrices(projection) {
        if (this.ssaoMaterial) {
            this.ssaoMaterial.uniforms.uProjMatrix.value.copy(projection);
            this.ssaoMaterial.uniforms.uInvProjMatrix.value.copy(projection).invert();
            // Perspective projection elements: e[10] = -(f+n)/(f-n), e[14] = -2fn/(f-n)
            // => near = e[14]/(e[10]-1), far = e[14]/(e[10]+1).
            const e = projection.elements;
            const near = e[14] / (e[10] - 1);
            const far = e[14] / (e[10] + 1);
            if (Number.isFinite(near) && Number.isFinite(far) && near > 0 && far > near) {
                this.ssaoMaterial.uniforms.cameraNear.value = near;
                this.ssaoMaterial.uniforms.cameraFar.value = far;
            }
        }
    }
    /**
     * Render the SSAO effect
     */
    render(input, output, _camera) {
        if (!this.renderer)
            return;
        const tri = FullScreenTriangle.getInstance();
        // 1. AO pass → internal target
        this.ssaoMaterial.uniforms.tDepth.value = this.depthTexture ?? input.depthTexture ?? input.texture;
        tri.render(this.renderer, this.ssaoMaterial, this.ssaoRenderTarget);
        // 2. Separable blur, ping-ponging between the two internal targets
        const src = this.ssaoRenderTarget;
        for (let i = 0; i < this.config.blurPasses; i++) {
            this.blurMaterial.uniforms.tDiffuse.value = src.texture;
            this.blurMaterial.uniforms.direction.value.set(1.0, 0.0);
            tri.render(this.renderer, this.blurMaterial, this.blurRenderTarget);
            this.blurMaterial.uniforms.tDiffuse.value = this.blurRenderTarget.texture;
            this.blurMaterial.uniforms.direction.value.set(0.0, 1.0);
            tri.render(this.renderer, this.blurMaterial, src);
        }
        // 3. Composite scene × AO → output
        this.compositeMaterial.uniforms.tScene.value = input.texture;
        this.compositeMaterial.uniforms.tAO.value = src.texture;
        this.compositeMaterial.uniforms.intensity.value = this.config.intensity;
        tri.render(this.renderer, this.compositeMaterial, output);
    }
    /**
     * Resize
     */
    setSize(width, height) {
        const ssaoWidth = Math.max(1, Math.floor(width / this.config.downscale));
        const ssaoHeight = Math.max(1, Math.floor(height / this.config.downscale));
        this.ssaoRenderTarget.setSize(ssaoWidth, ssaoHeight);
        this.blurRenderTarget.setSize(ssaoWidth, ssaoHeight);
        if (this.ssaoMaterial) {
            this.ssaoMaterial.uniforms.texelSize.value.set(1 / ssaoWidth, 1 / ssaoHeight);
        }
        if (this.blurMaterial) {
            this.blurMaterial.uniforms.texelSize.value.set(1 / ssaoWidth, 1 / ssaoHeight);
        }
    }
    /**
     * Dispose
     */
    dispose() {
        this.ssaoRenderTarget.dispose();
        this.blurRenderTarget.dispose();
        this.ssaoMaterial.dispose();
        this.blurMaterial.dispose();
        this.compositeMaterial.dispose();
        this.noiseTexture.dispose();
    }
}
//# sourceMappingURL=SSAOEffect.js.map