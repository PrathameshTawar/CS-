/**
 * AudioEngine.ts
 *
 * Procedural audio engine (Requirement 19) built on the Web Audio API.
 * Synthesizes material-specific footsteps, gunshots, impacts, kill cues,
 * and UI sounds at runtime — no audio files required.
 *
 * @module Audio
 */

import { SurfaceMaterial } from '../../gameplay/core/GameTypes';

export interface AudioEngineConfig {
  /** Master volume 0..1. */
  masterVolume: number;
  /** Max simultaneous channels (with priority management). */
  maxChannels: number;
}

const DEFAULT_CONFIG: AudioEngineConfig = {
  masterVolume: 0.8,
  maxChannels: 32,
};

export class AudioEngine {
  private readonly config: AudioEngineConfig;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private listener: AudioListener | null = null;
  private activeChannels = 0;
  private enabled = false;
  private stormNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  constructor(config?: Partial<AudioEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Initialize (must be called after a user gesture). */
  init(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.listener = this.ctx.listener;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.config.masterVolume;
    this.masterGain.connect(this.ctx.destination);
    this.enabled = true;
  }

  /** The underlying AudioContext (may be null before init). */
  getContext(): AudioContext | null {
    return this.ctx;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => { /* autoplay policy denied — non-fatal */ });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Update listener position/orientation for 3D audio. */
  setListenerPosition(x: number, y: number, z: number): void {
    if (!this.listener || !this.ctx) return;
    this.listener.positionX.value = x;
    this.listener.positionY.value = y;
    this.listener.positionZ.value = z;
  }

  setListenerOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    if (!this.listener || !this.ctx) return;
    this.listener.forwardX.value = fx;
    this.listener.forwardY.value = fy;
    this.listener.forwardZ.value = fz;
    this.listener.upX.value = ux;
    this.listener.upY.value = uy;
    this.listener.upZ.value = uz;
  }

  private acquireChannel(): boolean {
    if (this.activeChannels >= this.config.maxChannels) return false;
    this.activeChannels++;
    return true;
  }

  private releaseChannel(): void {
    this.activeChannels = Math.max(0, this.activeChannels - 1);
  }

  /**
   * Play a sound at a 3D position with attenuation. The `source` is the
   * scheduled node (BufferSource/Oscillator) whose `onended` we hook for
   * channel cleanup; `effect` is an optional filter chain node to connect
   * between the source and the panner.
   */
  private playAt(
    position: { x: number; y: number; z: number },
    source: AudioScheduledSourceNode,
    effect: AudioNode | null,
    maxDistance: number,
    volume = 1
  ): void {
    if (!this.ctx || !this.masterGain || !this.acquireChannel()) return;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = maxDistance;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    if (effect) {
      source.connect(effect);
      effect.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(panner);
    panner.connect(this.masterGain);

    source.onended = () => {
      try {
        source.disconnect();
      } catch { /* already disconnected */ }
      try {
        effect?.disconnect();
      } catch { /* already disconnected */ }
      try {
        gain.disconnect();
        panner.disconnect();
      } catch { /* already disconnected */ }
      this.releaseChannel();
    };
  }

  /** Play a non-positional UI sound (through master gain). */
  private playUI(source: AudioScheduledSourceNode, volume = 1): void {
    if (!this.ctx || !this.masterGain || !this.acquireChannel()) return;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.masterGain);
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch { /* already disconnected */ }
      this.releaseChannel();
    };
  }

  // --- Synthesizers ---

  private noiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Footstep sound per surface material (Requirement 19.1). */
  playFootstep(surface: SurfaceMaterial, position: { x: number; y: number; z: number }, volume = 0.5): void {
    if (!this.ctx || !this.enabled) return;
    const duration = 0.09;
    const buffer = this.noiseBuffer(duration);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    const freq: Record<SurfaceMaterial, number> = {
      [SurfaceMaterial.Wood]: 600,
      [SurfaceMaterial.Grass]: 300,
      [SurfaceMaterial.Concrete]: 250,
      [SurfaceMaterial.Metal]: 1800,
      [SurfaceMaterial.Dirt]: 200,
      [SurfaceMaterial.Water]: 900,
      [SurfaceMaterial.Glass]: 2200,
    };
    filter.type = 'lowpass';
    filter.frequency.value = freq[surface] ?? 400;
    filter.Q.value = 1;

    const maxDist: Record<SurfaceMaterial, number> = {
      [SurfaceMaterial.Wood]: 15,
      [SurfaceMaterial.Grass]: 8,
      [SurfaceMaterial.Concrete]: 20,
      [SurfaceMaterial.Metal]: 25,
      [SurfaceMaterial.Dirt]: 12,
      [SurfaceMaterial.Water]: 12,
      [SurfaceMaterial.Glass]: 15,
    };

    this.playAt(position, src, filter, maxDist[surface] ?? 12, volume * 0.5);
    src.start();
  }

  /** Gunshot sound (intensity by weapon size). */
  playGunshot(position: { x: number; y: number; z: number }, suppressed: boolean, volume = 1): void {
    if (!this.ctx || !this.enabled) return;
    const duration = suppressed ? 0.18 : 0.3;
    const buffer = this.noiseBuffer(duration);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = suppressed ? 'lowpass' : 'bandpass';
    filter.frequency.value = suppressed ? 500 : 900;
    filter.Q.value = suppressed ? 2 : 0.8;

    const maxDist = suppressed ? 12 : 60;
    this.playAt(position, src, filter, maxDist, volume * (suppressed ? 0.25 : 1));
    src.start();
  }

  /** Impact / hit sound. */
  playImpact(position: { x: number; y: number; z: number }, surface: SurfaceMaterial, force: number): void {
    if (!this.ctx || !this.enabled) return;
    const duration = 0.06;
    const buffer = this.noiseBuffer(duration);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    const freq: Record<SurfaceMaterial, number> = {
      [SurfaceMaterial.Wood]: 700,
      [SurfaceMaterial.Grass]: 350,
      [SurfaceMaterial.Concrete]: 280,
      [SurfaceMaterial.Metal]: 1500,
      [SurfaceMaterial.Dirt]: 220,
      [SurfaceMaterial.Water]: 800,
      [SurfaceMaterial.Glass]: 2000,
    };
    filter.type = 'lowpass';
    filter.frequency.value = (freq[surface] ?? 400) * (0.8 + force * 0.4);
    this.playAt(position, src, filter, 20, Math.min(1, force) * 0.6);
    src.start();
  }

  /** Kill confirmation cue (distinct from impacts). */
  playKillCue(): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    this.playUI(osc, 0.8);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  /** Headshot cue (higher pitch). */
  playHeadshotCue(): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    this.playUI(osc, 0.9);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  }

  /** Player damaged cue. */
  playPlayerHit(): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    this.playUI(osc, 0.8);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  }

  /** Grenade throw whistle. */
  playGrenadeThrow(): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 0.6);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.7);
    osc.connect(gain);
    this.playUI(osc, 0.5);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.8);
  }

  /** Mission briefing/update UI chime (Requirement 29.1). */
  playMissionCallout(): void {
    if (!this.ctx || !this.enabled) return;
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440 + i * 220, this.ctx.currentTime + i * 0.15);
      osc.frequency.exponentialRampToValueAtTime(880 + i * 220, this.ctx.currentTime + i * 0.15 + 0.1);
      gain.gain.setValueAtTime(0.3, this.ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + i * 0.15 + 0.3);
      osc.connect(gain);
      this.playUI(osc, 0.7);
      osc.start(this.ctx.currentTime + i * 0.15);
      osc.stop(this.ctx.currentTime + i * 0.15 + 0.35);
    }
  }

  /** Explosion (flash/shock detonation). */
  playExplosion(position: { x: number; y: number; z: number }, volume = 1): void {
    if (!this.ctx || !this.enabled) return;
    const buffer = this.noiseBuffer(0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 120;
    this.playAt(position, src, filter, 80, volume);
    src.start();
  }

  /** Reload sound. */
  playReload(): void {
    if (!this.ctx || !this.enabled) return;
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 220;
      const t0 = this.ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.15, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(gain);
      this.playUI(osc, 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    }
  }

  /** Dash whoosh. */
  playDash(): void {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    if (!this.acquireChannel()) return;
    const buffer = this.noiseBuffer(0.3);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2000, this.ctx.currentTime + 0.25);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.onended = () => {
      try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch { /* noop */ }
      this.releaseChannel();
    };
    src.start();
  }

  /**
   * Loop storm ambience (rain + low rumble) until deactivated (R30.6, T3.5).
   * Uses a looping noise buffer through a lowpass; ramps gain in/out so the
   * transition is audible but not jarring.
   */
  setStormActive(active: boolean): void {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    if (active && !this.stormNodes) {
      const buffer = this.noiseBuffer(2);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 1.5);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start();
      this.stormNodes = { src, gain };
    } else if (!active && this.stormNodes) {
      const { src, gain } = this.stormNodes;
      this.stormNodes = null;
      try {
        gain.gain.cancelScheduledValues(this.ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 1.0);
        const s = src;
        setTimeout(() => {
          try {
            s.stop();
            s.disconnect();
            gain.disconnect();
          } catch { /* already stopped */ }
        }, 1100);
      } catch { /* already stopped */ }
    }
  }

  /** UI click. */
  playUIClick(): void {
    if (!this.ctx || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 600;
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    this.playUI(osc, 0.5);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.06);
  }

  setMasterVolume(volume: number): void {
    this.config.masterVolume = volume;
    if (this.masterGain) {
      this.masterGain.gain.value = volume;
    }
  }

  dispose(): void {
    this.setStormActive(false);
    this.stormNodes = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => { /* already closed */ });
    }
    this.ctx = null;
    this.masterGain = null;
    this.listener = null;
    this.enabled = false;
  }
}
