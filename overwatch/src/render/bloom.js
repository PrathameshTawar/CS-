// render/bloom.js — Karis bloom.
//
// 1. Thresholded downsampling: only pixels above `threshold` enter the pyramid
//    (firefly-safe Karis average), so the sun disc, emissive signs and specular
//    peaks glow while mid-tones stay crisp instead of hazing the whole frame.
// 2. Progressive upsample + accumulate with scratch/accumulator targets — the
//    accumulation never samples the target it writes (no GL feedback loops).

import * as THREE from 'three';
import { FullScreenTriangle, POST_VERT } from './FullScreenTriangle.js';

const DOWNSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 texelSize;
uniform float threshold;
varying vec2 vUv;

// renamed to avoid colliding with the luminance() three injects into the
// shader prefix in r180
float owLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 uv = vUv;
  vec3 c0 = max(texture2D(tDiffuse, uv).rgb - threshold, 0.0);
  vec3 c1 = max(texture2D(tDiffuse, uv + vec2(texelSize.x, 0.0)).rgb - threshold, 0.0);
  vec3 c2 = max(texture2D(tDiffuse, uv + vec2(0.0, texelSize.y)).rgb - threshold, 0.0);
  vec3 c3 = max(texture2D(tDiffuse, uv + texelSize).rgb - threshold, 0.0);
  // Karis average — weights 1/(1+L) so fireflies don't dominate.
  float w0 = 1.0 / (1.0 + owLuma(c0));
  float w1 = 1.0 / (1.0 + owLuma(c1));
  float w2 = 1.0 / (1.0 + owLuma(c2));
  float w3 = 1.0 / (1.0 + owLuma(c3));
  float sw = w0 + w1 + w2 + w3;
  gl_FragColor = vec4((c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / sw, 1.0);
}`;

const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tUp;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
  vec2 ts = texelSize;
  vec3 up = vec3(0.0);
  up += texture2D(tUp, vUv + vec2(-ts.x, -ts.y)).rgb * 0.0625;
  up += texture2D(tUp, vUv + vec2(0.0, -ts.y)).rgb * 0.125;
  up += texture2D(tUp, vUv + vec2(ts.x, -ts.y)).rgb * 0.0625;
  up += texture2D(tUp, vUv + vec2(-ts.x, 0.0)).rgb * 0.125;
  up += texture2D(tUp, vUv).rgb * 0.25;
  up += texture2D(tUp, vUv + vec2(ts.x, 0.0)).rgb * 0.125;
  up += texture2D(tUp, vUv + vec2(-ts.x, ts.y)).rgb * 0.0625;
  up += texture2D(tUp, vUv + vec2(0.0, ts.y)).rgb * 0.125;
  up += texture2D(tUp, vUv + vec2(ts.x, ts.y)).rgb * 0.0625;
  gl_FragColor = vec4(up, 1.0);
}`;

const ADD_FRAG = /* glsl */ `
uniform sampler2D tBase;
uniform sampler2D tUp;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + texture2D(tUp, vUv).rgb, 1.0);
}`;

function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

export class Bloom {
  constructor(renderer, width, height, levels = 4, threshold = 0.65) {
    this.renderer = renderer;
    this.levels = levels;
    this.threshold = threshold;
    this._levels = [];
    this._ups = [];
    this._accs = [];
    this._resultTex = null;
    this._fst = new FullScreenTriangle();
    this._downMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        texelSize: { value: new THREE.Vector2() },
        threshold: { value: threshold },
      },
      vertexShader: POST_VERT,
      fragmentShader: DOWNSAMPLE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this._upMat = new THREE.ShaderMaterial({
      uniforms: { tUp: { value: null }, texelSize: { value: new THREE.Vector2() } },
      vertexShader: POST_VERT,
      fragmentShader: UPSAMPLE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this._addMat = new THREE.ShaderMaterial({
      uniforms: { tBase: { value: null }, tUp: { value: null } },
      vertexShader: POST_VERT,
      fragmentShader: ADD_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.setSize(width, height);
  }

  setSize(width, height) {
    for (const arr of [this._levels, this._ups, this._accs]) {
      for (const rt of arr) rt.dispose();
    }
    this._levels = [];
    this._ups = [];
    this._accs = [];
    let w = Math.max(2, width >> 1);
    let h = Math.max(2, height >> 1);
    for (let i = 0; i < this.levels; i++) {
      this._levels.push(makeRT(w, h));
      this._ups.push(makeRT(w, h));
      this._accs.push(makeRT(w, h));
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
    }
    this._resultTex = this._levels[0].texture;
  }

  render(src) {
    const fst = this._fst;
    const down = this._downMat;

    // thresholded downsample
    fst.setMaterial(down);
    for (let i = 0; i < this._levels.length; i++) {
      const lvl = this._levels[i];
      down.uniforms.tDiffuse.value = i === 0 ? src : this._levels[i - 1].texture;
      down.uniforms.texelSize.value.set(1 / lvl.width, 1 / lvl.height);
      down.uniforms.threshold.value = i === 0 ? this.threshold : 0;
      fst.render(this.renderer, lvl);
    }

    // upsample + accumulate — reads levels/accs, writes ups/accs, never itself.
    // Runs down to level 0 so the finest octave (thresholded bright pixels at
    // half-res) is included in the final result.
    let prevTex = this._levels[this._levels.length - 1].texture;
    fst.setMaterial(this._upMat);
    for (let i = this._levels.length - 1; i >= 0; i--) {
      const up = this._ups[i];
      this._upMat.uniforms.tUp.value = prevTex;
      this._upMat.uniforms.texelSize.value.set(1 / up.width, 1 / up.height);
      fst.render(this.renderer, up);

      const acc = this._accs[i];
      this._addMat.uniforms.tBase.value = this._levels[i].texture;
      this._addMat.uniforms.tUp.value = up.texture;
      fst.setMaterial(this._addMat);
      fst.render(this.renderer, acc);
      fst.setMaterial(this._upMat);
      prevTex = acc.texture;
    }
    this._resultTex = prevTex;
  }

  get texture() {
    return this._resultTex;
  }

  dispose() {
    for (const arr of [this._levels, this._ups, this._accs]) {
      for (const rt of arr) rt.dispose();
    }
    this._downMat.dispose();
    this._upMat.dispose();
    this._addMat.dispose();
    this._fst.dispose();
  }
}
