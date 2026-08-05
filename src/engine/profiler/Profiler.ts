/**
 * Profiler.ts
 * 
 * High-performance hierarchical profiler for tracking engine performance.
 * Supports nested timings, frame history, and performance budgets.
 * 
 * @module Profiler
 */

/**
 * A single profiling sample
 */
export interface ProfilerSample {
  name: string;
  duration: number; // milliseconds
  startTime: number;
  depth: number;
  children: ProfilerSample[];
}

/**
 * Performance statistics for a profiled zone
 */
export interface ProfilerStats {
  name: string;
  min: number;
  max: number;
  average: number;
  median: number;
  p95: number;
  p99: number;
  sampleCount: number;
  totalTime: number;
  percentage: number;
}

/**
 * Performance budget for monitoring
 */
export interface PerformanceBudget {
  name: string;
  warning: number; // ms threshold for warning
  critical: number; // ms threshold for critical
  action: 'log' | 'warn' | 'error';
}

/**
 * Hierarchical profiler with frame tracking
 */
export class Profiler {
  private readonly enabled: boolean;
  private readonly sampleStack: ProfilerSample[] = [];
  private readonly rootSamples: ProfilerSample[] = [];
  private readonly history: Map<string, number[]> = new Map();
  private readonly budgets: Map<string, PerformanceBudget> = new Map();
  private currentDepth: number = 0;
  private frameStartTime: number = 0;
  private readonly maxHistoryLength: number = 500;
  private frameCount: number = 0;
  private readonly totalFrameTime: number[] = [];

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  /**
   * Begin profiling a named zone
   */
  begin(name: string): void {
    if (!this.enabled) return;

    const sample: ProfilerSample = {
      name,
      duration: 0,
      startTime: performance.now(),
      depth: this.currentDepth,
      children: [],
    };

    if (this.sampleStack.length > 0) {
      const parent = this.sampleStack[this.sampleStack.length - 1];
      parent.children.push(sample);
    } else {
      this.rootSamples.push(sample);
    }

    this.sampleStack.push(sample);
    this.currentDepth++;
  }

  /**
   * End profiling the current zone
   */
  end(name: string): void {
    if (!this.enabled) return;

    const sample = this.sampleStack.pop();
    if (!sample) {
      console.warn(`[Profiler] Mismatched end('${name}') - no sample to end.`);
      return;
    }

    if (sample.name !== name) {
      console.warn(
        `[Profiler] Mismatched zone: expected '${sample.name}', got '${name}'.`
      );
    }

    sample.duration = performance.now() - sample.startTime;
    this.currentDepth--;

    // Record in history
    if (!this.history.has(name)) {
      this.history.set(name, []);
    }
    const history = this.history.get(name)!;
    history.push(sample.duration);

    // Trim history if needed
    if (history.length > this.maxHistoryLength) {
      history.shift();
    }

    // Check budgets
    this.checkBudget(name, sample.duration);
  }

  /**
   * Mark the start of a frame
   */
  beginFrame(): void {
    if (!this.enabled) return;
    this.frameStartTime = performance.now();
    this.rootSamples.length = 0;
  }

  /**
   * Mark the end of a frame
   */
  endFrame(): void {
    if (!this.enabled) return;
    this.frameCount++;

    const frameTime = performance.now() - this.frameStartTime;
    this.totalFrameTime.push(frameTime);

    if (this.totalFrameTime.length > this.maxHistoryLength) {
      this.totalFrameTime.shift();
    }

    // Emit frame stats
    this.reportFrameStats(frameTime);
  }

  /**
   * Get statistics for a profiled zone
   */
  getStats(name: string): ProfilerStats | null {
    const history = this.history.get(name);
    if (!history || history.length === 0) return null;

    const sorted = [...history].sort((a, b) => a - b);
    const len = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const totalFrameSum = this.totalFrameTime.reduce((a, b) => a + b, 0);
    const totalFrameAvg = totalFrameSum / Math.max(this.totalFrameTime.length, 1);

    return {
      name,
      min: sorted[0],
      max: sorted[len - 1],
      average: sum / len,
      median: sorted[Math.floor(len / 2)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      sampleCount: len,
      totalTime: sum,
      percentage: totalFrameAvg > 0 ? (sum / len / totalFrameAvg) * 100 : 0,
    };
  }

  /**
   * Get all profiler statistics
   */
  getAllStats(): Map<string, ProfilerStats> {
    const stats = new Map<string, ProfilerStats>();
    for (const name of this.history.keys()) {
      const stat = this.getStats(name);
      if (stat) {
        stats.set(name, stat);
      }
    }
    return stats;
  }

  /**
   * Get frame time statistics
   */
  getFrameStats(): ProfilerStats | null {
    if (this.totalFrameTime.length === 0) return null;

    const sorted = [...this.totalFrameTime].sort((a, b) => a - b);
    const len = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      name: 'frame',
      min: sorted[0],
      max: sorted[len - 1],
      average: sum / len,
      median: sorted[Math.floor(len / 2)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      sampleCount: len,
      totalTime: sum,
      percentage: 100,
    };
  }

  /**
   * Define a performance budget
   */
  setBudget(budget: PerformanceBudget): void {
    this.budgets.set(budget.name, budget);
  }

  /**
   * Check if a zone exceeds its budget
   */
  private checkBudget(name: string, duration: number): void {
    const budget = this.budgets.get(name);
    if (!budget) return;

    if (duration >= budget.critical) {
      const msg = `[Profiler] CRITICAL: '${name}' took ${duration.toFixed(2)}ms (budget: ${budget.critical}ms)`;
      if (budget.action === 'error') console.error(msg);
      else if (budget.action === 'warn') console.warn(msg);
      else console.log(msg);
    } else if (duration >= budget.warning) {
      const msg = `[Profiler] WARNING: '${name}' took ${duration.toFixed(2)}ms (budget: ${budget.warning}ms)`;
      if (budget.action === 'warn') console.warn(msg);
      else console.log(msg);
    }
  }

  /**
   * Report frame statistics
   */
  private reportFrameStats(frameTime: number): void {
    // In a full implementation, this would emit to the event bus
    if (frameTime > 33.33) {
      // < 30 FPS
      console.warn(`[Profiler] Low frame rate: ${(1000 / frameTime).toFixed(1)} FPS`);
    }
  }

  /**
   * Get the current FPS estimate
   */
  getCurrentFPS(): number {
    if (this.totalFrameTime.length < 10) return 0;
    const recent = this.totalFrameTime.slice(-10);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  /**
   * Reset all profiling data
   */
  reset(): void {
    this.history.clear();
    this.totalFrameTime.length = 0;
    this.rootSamples.length = 0;
    this.sampleStack.length = 0;
    this.frameCount = 0;
    this.currentDepth = 0;
  }

  /**
   * Generate a profiling report
   */
  generateReport(): string {
    const lines: string[] = ['=== Profiler Report ===', ''];

    const frameStats = this.getFrameStats();
    if (frameStats) {
      lines.push(`Frame Time: ${frameStats.average.toFixed(2)}ms avg (${(1000 / frameStats.average).toFixed(1)} FPS)`);
      lines.push(`  Min: ${frameStats.min.toFixed(2)}ms | Max: ${frameStats.max.toFixed(2)}ms | P95: ${frameStats.p95.toFixed(2)}ms`);
      lines.push('');
    }

    lines.push('Zone Statistics:');
    lines.push('-'.repeat(80));
    lines.push(
      'Zone'.padEnd(30) +
      'Avg(ms)'.padEnd(10) +
      'Min'.padEnd(10) +
      'Max'.padEnd(10) +
      'P95'.padEnd(10) +
      '%Frame'.padEnd(10)
    );
    lines.push('-'.repeat(80));

    const allStats = this.getAllStats();
    const sorted = Array.from(allStats.entries()).sort(
      (a, b) => b[1].average - a[1].average
    );

    for (const [name, stats] of sorted) {
      lines.push(
        name.padEnd(30) +
        stats.average.toFixed(2).padEnd(10) +
        stats.min.toFixed(2).padEnd(10) +
        stats.max.toFixed(2).padEnd(10) +
        stats.p95.toFixed(2).padEnd(10) +
        stats.percentage.toFixed(1).padEnd(10)
      );
    }

    lines.push('');
    lines.push(`Total samples: ${Array.from(this.history.values()).reduce((a, b) => a + b.length, 0)}`);
    lines.push('=== End Report ===');

    return lines.join('\n');
  }

  /**
   * Dispose the profiler
   */
  dispose(): void {
    this.reset();
    this.budgets.clear();
  }
}
