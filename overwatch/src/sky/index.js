// sky/index.js — the sky system.
//
// Owns: physical sky dome (gradient + sun/moon disc), the sun directional
// light, a hemisphere fill, PMREM environment map for IBL reflections, and the
// exponential fog. Time of day is a preset; every value is physically
// plausible (real albedo, candela-ish intensities, exposure-driven).

import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
varying vec3 vWorldPos;

void main() {
  vec3 dir = normalize(vWorldPos);
  float h = clamp(dir.y, -1.0, 1.0);
  float sunAmt = pow(max(dot(dir, sunDir), 0.0), 2400.0);
  float sunHalo = pow(max(dot(dir, sunDir), 0.0), 22.0);
  // Rayleigh-ish gradient: blue zenith, pale horizon
  vec3 sky = mix(horizonColor, zenithColor, pow(clamp(h, 0.0, 1.0), 0.58));
  // warm scattering near the sun
  float sunWarm = pow(max(dot(dir, sunDir), 0.0), 6.0);
  sky += sunColor * sunWarm * 0.1;
  // sun disc + halo
  sky += sunColor * sunAmt * 40.0;
  sky += sunColor * sunHalo * 0.16;
  // below the horizon: ground haze falloff
  if (h < 0.0) {
    sky = mix(horizonColor * 0.5, groundColor, clamp(-h * 2.4, 0.0, 1.0));
  }
  gl_FragColor = vec4(sky, 1.0);
}`;

const TIMES = {
  day: {
    sunElev: 0.62,
    sunAz: 2.5,
    sunColor: 0xfff2dc,
    sunIntensity: 3.4,
    zenith: 0x3a5b9d,
    horizon: 0xcfe0ee,
    ground: 0x4a3f38,
    fog: 0xcfe0ee,
    fogDensity: 0.0042,
    hemiSky: 0xbcd0e8,
    hemiGround: 0x5c5148,
    hemiIntensity: 0.55,
    fillIntensity: 0.3,
    exposure: 1.0,
  },
  golden: {
    sunElev: 0.24,
    sunAz: 2.9,
    sunColor: 0xff9e4a,
    sunIntensity: 2.7,
    zenith: 0x2e4a86,
    horizon: 0xf7a45c,
    ground: 0x574a3a,
    fog: 0xf7a45c,
    fogDensity: 0.005,
    hemiSky: 0xffb36b,
    hemiGround: 0x4a4238,
    hemiIntensity: 0.45,
    fillIntensity: 0.22,
    exposure: 1.05,
  },
  dusk: {
    sunElev: -0.06,
    sunAz: 3.2,
    sunColor: 0xff7a3c,
    sunIntensity: 1.5,
    zenith: 0x141c3a,
    horizon: 0xd85c3a,
    ground: 0x2c2526,
    fog: 0xd85c3a,
    fogDensity: 0.0065,
    hemiSky: 0x4a4a7a,
    hemiGround: 0x241f22,
    hemiIntensity: 0.32,
    fillIntensity: 0.12,
    exposure: 1.25,
  },
  night: {
    sunElev: -0.42,
    sunAz: 1.2,
    sunColor: 0x7fa4cc,
    sunIntensity: 0.55,
    zenith: 0x05070f,
    horizon: 0x0c1220,
    ground: 0x0a0a10,
    fog: 0x0c1220,
    fogDensity: 0.008,
    hemiSky: 0x1c2740,
    hemiGround: 0x0c0e14,
    hemiIntensity: 0.24,
    fillIntensity: 0.05,
    exposure: 1.45,
  },
};

export class SkySystem {
  static id = 'sky';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    this.r = ctx.get('render');
    const t = TIMES[ctx.config.timeOfDay] || TIMES.golden;
    this.time = t;

    const elev = t.sunElev;
    const az = t.sunAz;
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();

    // --- sun directional light (shadow caster) ---
    this.sun = new THREE.DirectionalLight(new THREE.Color(t.sunColor), t.sunIntensity);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(ctx.config.q.shadowMapSize, ctx.config.q.shadowMapSize);
    shadow.camera.near = 5;
    shadow.camera.far = 320;
    shadow.camera.left = -55;
    shadow.camera.right = 55;
    shadow.camera.top = 55;
    shadow.camera.bottom = -55;
    shadow.bias = -0.00045;
    shadow.normalBias = 0.035;
    ctx.scene.add(this.sun);
    ctx.scene.add(this.sun.target);

    // --- fill + hemisphere (key / fill / rim separation) ---
    this.fill = new THREE.DirectionalLight(new THREE.Color(t.horizon), t.fillIntensity);
    this.fill.position.copy(this.sunDir).multiplyScalar(-1).multiplyScalar(60);
    this.fill.position.y = Math.max(6, this.fill.position.y);
    this.fill.target.position.set(0, 0, 0);
    ctx.scene.add(this.fill);
    ctx.scene.add(this.fill.target);

    this.hemi = new THREE.HemisphereLight(new THREE.Color(t.hemiSky), new THREE.Color(t.hemiGround), t.hemiIntensity);
    ctx.scene.add(this.hemi);

    // --- sky dome ---
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        sunDir: { value: this.sunDir.clone() },
        sunColor: { value: new THREE.Color(t.sunColor) },
        zenithColor: { value: new THREE.Color(t.zenith) },
        horizonColor: { value: new THREE.Color(t.horizon) },
        groundColor: { value: new THREE.Color(t.ground) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(880, 40, 20), skyMat);
    this.dome.userData.owNoShadow = true;
    this.dome.userData.owNoPrepass = true;
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    ctx.scene.add(this.dome);
    this._skyMat = skyMat;

    // --- PMREM environment map for IBL ---
    this._buildEnv();

    // --- fog ---
    this.fog = new THREE.FogExp2(new THREE.Color(t.fog), t.fogDensity);
    ctx.scene.fog = this.fog;

    // exposure is part of the shared config the composite reads each frame
    ctx.config.exposure = t.exposure;
  }

  _buildEnv() {
    const envScene = new THREE.Scene();
    const envMat = this._skyMat.clone();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), envMat));
    // a bright sun for specular highlights
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.time.sunColor).multiplyScalar(6) }),
    );
    sunMesh.position.copy(this.sunDir).multiplyScalar(95);
    envScene.add(sunMesh);

    const pmrem = new THREE.PMREMGenerator(this.r.renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(envScene, 0.04, 0.1, 200);
    this.envRT = envRT;
    this.r.setEnvMap(envRT.texture);
    pmrem.dispose();
    envMat.dispose();
    sunMesh.material.dispose();
  }

  update(dt, ctx) {
    // static per time-of-day preset for now; animation lands with the player system.
  }

  dispose() {
    this._skyMat.dispose();
    this.dome.geometry.dispose();
    if (this.envRT) this.envRT.dispose();
    this.sun.dispose();
    this.fill.dispose();
    this.hemi.dispose();
  }
}
