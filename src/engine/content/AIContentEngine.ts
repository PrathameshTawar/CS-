/**
 * AIContentEngine.ts
 *
 * AI Content Engine (Requirements 21, 22).
 * Exposes a typed API that gameplay systems call to request generated
 * content (maps, weapons, missions, enemy balance). Requests go to a
 * configurable LLM provider, are validated against schemas, retried up
 * to 3 times, and fall back to procedural generation. All generated
 * content is logged with timestamp + content hash for reproducibility.
 *
 * @module Content
 */

import {
  ContentPayload,
  validatePayload,
} from './ContentSchemas';
import { LLMProvider, GeneratedContent } from './LLMProvider';

export interface ContentLogEntry {
  timestamp: number;
  type: string;
  hash: string;
  provider: string;
  payload: ContentPayload;
}

export interface ContentEngineStats {
  generated: number;
  validated: number;
  retried: number;
  fallbacks: number;
  rejected: number;
}

export interface PersistedContentState {
  log: ContentLogEntry[];
  stats: ContentEngineStats;
}

/**
 * Persistence layer for the content log + cumulative stats. The engine
 * restores state on construction and saves after each logged generation.
 * Implementations must be environment-safe (e.g. localStorage in the
 * browser); the engine never throws on storage failures.
 */
export interface ContentPersistence {
  load(): PersistedContentState | null;
  save(state: PersistedContentState): void;
}

export interface AIContentEngineConfig {
  /** Max LLM attempts before falling back. */
  maxRetries: number;
  /** Whether to log generated content. */
  enableLogging: boolean;
  /** Optional persistence for the content log + stats (e.g. localStorage). */
  storage?: ContentPersistence;
}

const DEFAULT_CONFIG: AIContentEngineConfig = {
  maxRetries: 3,
  enableLogging: true,
};

export const EMPTY_STATS: ContentEngineStats = { generated: 0, validated: 0, retried: 0, fallbacks: 0, rejected: 0 };

export class AIContentEngine {
  private readonly config: AIContentEngineConfig;
  private providers: LLMProvider[] = [];
  private fallback: LLMProvider | null = null;
  private readonly log: ContentLogEntry[] = [];
  private readonly maxLogSize = 500;
  private stats: ContentEngineStats = { ...EMPTY_STATS };

  constructor(provider?: LLMProvider, fallback?: LLMProvider, config?: Partial<AIContentEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (provider) this.providers.push(provider);
    this.fallback = fallback ?? null;

    // Restore persisted log + cumulative stats, trimming to the log cap.
    // Defensively merge partial stats with zero-defaults so counters never
    // become undefined even if a storage layer returns a partial object.
    const saved = this.config.storage?.load();
    if (saved) {
      this.log.push(...saved.log);
      if (this.log.length > this.maxLogSize) {
        this.log.splice(0, this.log.length - this.maxLogSize);
      }
      this.stats = { ...EMPTY_STATS, ...saved.stats };
    }
  }

  /**
   * Set the primary LLM provider (replaces existing).
   */
  setProvider(provider: LLMProvider): void {
    this.providers = [provider];
  }

  /**
   * Add another provider (tried in order).
   */
  addProvider(provider: LLMProvider): void {
    this.providers.push(provider);
  }

  setFallback(fallback: LLMProvider): void {
    this.fallback = fallback;
  }

  getStats() {
    return { ...this.stats };
  }

  getLog(): readonly ContentLogEntry[] {
    return this.log;
  }

  /**
   * Generate content of the given type with the given context.
   * Returns the validated payload, or null if all attempts failed
   * (including fallback).
   */
  async generate(type: string, context: Record<string, unknown>): Promise<GeneratedContent | null> {
    this.stats.generated++;

    // Try LLM providers with validation + retries
    let attempts = 0;
    const maxAttempts = this.config.maxRetries;
    while (attempts < maxAttempts) {
      attempts++;
      for (const provider of this.providers) {
        const result = await provider.generate({ type, context });
        if (!result) continue;

        const error = validatePayload(type, result);
        if (error) {
          this.stats.rejected++;
          console.warn(`[AIContentEngine] Provider '${provider.name}' returned invalid content: ${error}`);
          continue;
        }

        this.stats.validated++;
        this.logContent(type, provider.name, result);
        return result;
      }
      this.stats.retried++;
    }

    // Fallback to procedural generation
    if (this.fallback) {
      const result = await this.fallback.generate({ type, context });
      if (result) {
        const error = validatePayload(type, result);
        if (!error) {
          this.stats.fallbacks++;
          this.logContent(type, this.fallback.name, result);
          return result;
        }
      }
    }

    // Persist failure stats (rejections/retries) even when nothing valid was produced.
    this.persist();
    console.warn(`[AIContentEngine] Failed to generate valid content for type '${type}'.`);
    return null;
  }

  private logContent(type: string, provider: string, payload: ContentPayload): void {
    if (this.config.enableLogging) {
      this.log.push({
        timestamp: Date.now(),
        type,
        hash: this.contentHash(payload),
        provider,
        payload,
      });
      if (this.log.length > this.maxLogSize) {
        this.log.shift();
      }
    }
    // Persist stats even when logging is disabled so generated/validated
    // counters survive reloads regardless of the logging config.
    this.persist();
  }

  /** Simple deterministic content hash for audit/reproducibility. */
  contentHash(payload: ContentPayload): string {
    const json = JSON.stringify(payload);
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  clearLog(): void {
    this.log.length = 0;
    this.persist();
  }

  /** Persist the current log + stats snapshot if a storage layer is configured. */
  private persist(): void {
    this.config.storage?.save({ log: this.log, stats: this.stats });
  }
}
