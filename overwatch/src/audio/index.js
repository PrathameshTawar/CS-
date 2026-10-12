// audio/index.js — fully synthesized game audio via the Web Audio API.
//
// No sound files: weapon fire, reloads, impacts, footsteps and shell ticks are
// all generated from oscillators + noise buffers. A single master chain feeds a
// simple stereo panner, so every cue gets cheap positional panning from the
// camera. Deterministic-ish: everything is derived from ctx events; no state
// here is captured by the pixel gate (audio never touches pixels).

import * as THREE from 'three';

// shared scratch (no per-frame allocation)
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

export class AudioSystem {
  static id = 'audio';
  static deps = ['render'];

  init(ctx) {
    this.ctx = ctx;
    this.ac = null;
    this.master = null;
    this._noiseBuf = null;
    this._subs = [];

    // build the audio context lazily on first user gesture (autoplay policy)
    const kick = () => this._ensure();
    document.addEventListener('pointerdown', kick, { once: true });
    document.addEventListener('keydown', kick, { once: true });

    this._wire();
  }

  _ensure() {
    if (this.ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ac.destination);
      // 1-second shared white-noise buffer
      const len = this.ac.sampleRate;
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let i = 0; i < len; i++) {
        // xorshift-ish so noise is deterministic (no Math.random)
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
      }
      this._noiseBuf = buf;
      if (this.ac.state === 'suspended') this.ac.resume();
    } catch {
      this.ac = null;
    }
  }

  _wire() {
    const e = this.ctx.events;
    this._subs.push(
      e.on('weapon:fire', (p) => this.gunshot(p && p.origin ? p.origin : null)),
      e.on('weapon:reload', (p) => this.reload(p.phase)),
      e.on('weapon:shell', (p) => this.shell(p.position)),
      e.on('bullet:impact', (p) => this.impact(p.surface, p.point)),
      e.on('bullet:tracer', (p) => this.tracer(p.from, p.to)),
      e.on('player:footstep', (p) => this.footstep(p.running, p.position)),
      e.on('player:land', (p) => this.land(p.velocity)),
      e.on('damage:taken', () => this.hurt()),
      e.on('actor:death', (p) => this.death(p.point)),
    );
  }

  // --- helpers ---

  // Returns { gain, pan } for a world position relative to the camera.
  _spatial(pos) {
    if (!this.ac) return { gain: 1, pan: 0 };
    const cam = this.ctx.camera;
    cam.getWorldPosition(_pos);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _to.copy(pos || _pos).sub(_pos);
    const dist = _to.length();
    _to.normalize();
    const side = _to.dot(new THREE.Vector3(_fwd.z, 0, -_fwd.x)); // right vector
    const gain = Math.max(0, 1 - dist / 60);
    const pan = THREE.MathUtils.clamp(side * 0.9, -0.8, 0.8);
    return { gain, pan };
  }

  _tone(freq, dur, type = 'sine', vol = 0.3, when = 0) {
    if (!this.ac) return;
    const t = this.ac.currentTime + when;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.3, filterFreq = 1200, q = 1, when = 0, pan = 0) {
    if (!this.ac || !this._noiseBuf) return;
    const t = this.ac.currentTime + when;
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    if (pan) {
      const p = this.ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    src.start(t, Math.random() * 0.5); // offset into the noise buffer
    src.stop(t + dur + 0.02);
  }

  // --- cues ---

  gunshot(origin) {
    if (!this.ac) return;
    const s = this._spatial(origin || this.ctx.camera.getWorldPosition(new THREE.Vector3()));
    // close/self shot is loud and centered; distant shots are panned + faint
    const dist = origin ? this._spatial(origin).gain : 1;
    const vol = Math.max(0.35, dist);
    this._noise(0.09, vol * 0.5, 900, 0.8, 0, s.pan);
    this._tone(110, 0.12, 'sine', vol * 0.4);
    this._noise(0.03, vol * 0.3, 3200, 2, 0, s.pan);
    this._tone(180, 0.06, 'triangle', vol * 0.2);
  }

  reload(phase) {
    if (!this.ac) return;
    if (phase === 'magout') {
      this._noise(0.04, 0.3, 2400, 2);
      this._tone(600, 0.05, 'square', 0.12);
    } else if (phase === 'magin') {
      this._noise(0.05, 0.35, 1800, 1.5);
      this._tone(400, 0.07, 'square', 0.15, 0.02);
    } else if (phase === 'end') {
      this._noise(0.03, 0.25, 3500, 2);
    }
  }

  shell(pos) {
    if (!this.ac) return;
    const s = this._spatial(pos);
    for (let i = 0; i < 2; i++) this._tone(2200 + i * 800, 0.03, 'triangle', 0.08 * s.gain, i * 0.02);
  }

  impact(surface, point) {
    if (!this.ac) return;
    const s = this._spatial(point);
    const g = Math.max(0.2, s.gain);
    const freq = { metal: 2600, concrete: 500, wood: 900, glass: 4200, dirt: 300, sand: 250, flesh: 350, fabric: 600, rubber: 300, plaster: 700 }[surface] || 600;
    this._noise(0.06, g * 0.4, freq, surface === 'metal' ? 4 : 1, 0, s.pan);
    if (surface === 'metal') this._tone(1800, 0.08, 'triangle', g * 0.25);
    if (surface === 'glass') this._tone(5200, 0.1, 'sine', g * 0.15);
    if (surface === 'flesh') this._noise(0.1, g * 0.35, 220, 1);
  }

  tracer(from, to) {
    if (!this.ac) return;
    const s = this._spatial(from);
    if (s.gain < 0.05) return;
    this._noise(0.04, s.gain * 0.08, 2500, 3, 0, s.pan);
  }

  footstep(running, pos) {
    if (!this.ac) return;
    const s = this._spatial(pos);
    this._noise(0.05, (running ? 0.16 : 0.1) * s.gain, 220, 0.8, 0, s.pan);
  }

  land(velocity) {
    if (!this.ac) return;
    const k = Math.min(1, velocity / 10);
    this._noise(0.12, 0.25 * k, 180, 0.7);
    this._tone(70, 0.15, 'sine', 0.3 * k);
  }

  hurt() {
    if (!this.ac) return;
    this._noise(0.12, 0.3, 300, 1);
    this._tone(140, 0.12, 'sawtooth', 0.12);
  }

  death(point) {
    if (!this.ac) return;
    const s = this._spatial(point);
    this._noise(0.25, 0.4 * s.gain, 250, 0.8, 0, s.pan);
    this._tone(90, 0.3, 'sine', 0.3 * s.gain);
    this._noise(0.08, 0.2 * s.gain, 4000, 2, 0.05, s.pan);
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    if (this.ac) {
      try {
        this.ac.close();
      } catch {
        /* ignore */
      }
      this.ac = null;
    }
  }
}
