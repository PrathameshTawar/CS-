/**
 * MusicSystem.ts
 *
 * Dynamic music system (Requirement 19.3): calm / alert / combat /
 * boss_encounter states with 2-second cross-fade transitions.
 * Music is synthesized procedurally (drone pads + percussion).
 *
 * @module Audio
 */

export enum MusicState {
  Calm = 'calm',
  Alert = 'alert',
  Combat = 'combat',
  Boss = 'boss',
}

export interface MusicSystemConfig {
  calmVolume: number;
  alertVolume: number;
  combatVolume: number;
  bossVolume: number;
  fadeTime: number; // seconds
  combatCooldown: number; // seconds before calm after combat ends
}

const DEFAULT_CONFIG: MusicSystemConfig = {
  calmVolume: 0.12,
  alertVolume: 0.16,
  combatVolume: 0.22,
  bossVolume: 0.26,
  fadeTime: 2.0,
  combatCooldown: 5,
};

export class MusicSystem {
  private readonly config: MusicSystemConfig;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private state: MusicState = MusicState.Calm;
  private targetState: MusicState = MusicState.Calm;
  private combatEndTimer: number = 0;
  private padGains: GainNode[] = [];
  private percussionTimer = 0;

  constructor(config?: Partial<MusicSystemConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  init(ctx: AudioContext): void {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.config.calmVolume;
    this.masterGain.connect(ctx.destination);
    this.startPads();
  }

  getState(): MusicState {
    return this.state;
  }

  /** Transition to a music state (cross-fades via gain automation). */
  setState(state: MusicState): void {
    if (state === this.targetState) return;
    this.targetState = state;
  }

  /**
   * Notify game events: enemy alert / combat / all clear.
   */
  onCombat(enemiesActive: boolean): void {
    if (enemiesActive) {
      this.combatEndTimer = 0;
      this.setState(MusicState.Combat);
    } else if (this.targetState === MusicState.Combat || this.targetState === MusicState.Alert) {
      this.combatEndTimer = this.config.combatCooldown;
      this.setState(MusicState.Alert);
    }
  }

  update(deltaTime: number): void {
    if (!this.ctx || !this.masterGain) return;

    // Transition combat → alert → calm after cooldown
    if (this.combatEndTimer > 0) {
      this.combatEndTimer -= deltaTime;
      if (this.combatEndTimer <= 0 && this.targetState === MusicState.Alert) {
        this.setState(MusicState.Calm);
      }
    }

    // Cross-fade gains
    const targetVolume = this.getStateVolume(this.targetState);
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(targetVolume, now + this.config.fadeTime);

    this.state = this.targetState;

    // Heartbeat percussion in combat
    this.percussionTimer += deltaTime;
    const interval = this.state === MusicState.Combat ? 0.5 : this.state === MusicState.Alert ? 0.9 : 2.4;
    if (this.percussionTimer >= interval) {
      this.percussionTimer = 0;
      this.playHeartbeat(this.state === MusicState.Combat ? 90 : 50);
    }
  }

  private getStateVolume(state: MusicState): number {
    switch (state) {
      case MusicState.Calm: return this.config.calmVolume;
      case MusicState.Alert: return this.config.alertVolume;
      case MusicState.Combat: return this.config.combatVolume;
      case MusicState.Boss: return this.config.bossVolume;
    }
  }

  /** Start ambient drone pads (three detuned oscillators). */
  private startPads(): void {
    if (!this.ctx || !this.masterGain) return;
    const baseFreqs = [55, 82.5, 110];
    const types: OscillatorType[] = ['sine', 'triangle', 'sine'];
    for (let i = 0; i < baseFreqs.length; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = baseFreqs[i];
      const gain = this.ctx.createGain();
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      this.padGains.push(gain);
    }
  }

  private playHeartbeat(freq: number): void {
    if (!this.ctx || !this.masterGain) return;
    for (let beat = 0; beat < 2; beat++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = this.ctx.currentTime + beat * 0.18;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
  }

  dispose(): void {
    for (const g of this.padGains) {
      g.disconnect();
    }
    this.padGains = [];
    if (this.ctx) {
      // Don't close the shared context — the AudioEngine owns it.
    }
    this.masterGain?.disconnect();
    this.masterGain = null;
  }
}
