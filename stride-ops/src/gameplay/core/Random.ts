/**
 * Random.ts
 *
 * Deterministic seeded pseudo-random number generator (mulberry32).
 * Used by the procedural map generator so the same seed always
 * produces the same map.
 *
 * @module Gameplay
 */

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Chance of true. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Random angle in radians. */
  angle(): number {
    return this.range(0, Math.PI * 2);
  }

  /** Gaussian-ish distribution via Box-Muller. */
  gaussian(mean = 0, stddev = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
