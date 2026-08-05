/**
 * WorldAgent.ts
 *
 * Prompt-to-world generation (Requirement 30, tasks T3.1-T3.3).
 *
 * Pipeline: free-text prompt → LLM (`WorldContentPayload`) → schema
 * validation with retry ×3 → keyword interpretation fallback. When no LLM
 * key is configured, the keyword interpreter produces the config directly
 * (R30.3) — so AI mode works fully offline.
 *
 * The LLM never sends meshes; it sends a validated config the engine
 * already knows how to build (MapGenerator + atmosphere).
 *
 * @module Modes
 */

import { AIContentEngine } from '../../engine/content/AIContentEngine';
import {
  WorldContentPayload,
  interpretWorldPrompt,
  validateWorldConfig,
} from '../../engine/content/ContentSchemas';
import { Biome } from '../../gameplay/maps/MapGenerator';
import type { SessionContext, WorldConfig } from '../GameMode';

const WEATHERS = ['clear', 'storm', 'fog', 'snow', 'ash'] as const;
const TIMES = ['day', 'dusk', 'night'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

/** Coerce a validated loose payload into the strict WorldConfig shape. */
export function coerceWorldConfig(p: WorldContentPayload, context: SessionContext): WorldConfig {
  const biome = Object.values(Biome).includes(p.biome as Biome)
    ? (p.biome as Biome)
    : (context.biome ?? Biome.City);
  const weather = WEATHERS.includes(p.weather as (typeof WEATHERS)[number])
    ? (p.weather as WorldConfig['weather'])
    : 'clear';
  const timeOfDay = TIMES.includes(p.timeOfDay as (typeof TIMES)[number])
    ? (p.timeOfDay as WorldConfig['timeOfDay'])
    : 'day';
  const difficulty = DIFFICULTIES.includes(p.difficulty as (typeof DIFFICULTIES)[number])
    ? (p.difficulty as WorldConfig['difficulty'])
    : (context.difficulty ?? 'normal');

  return {
    seed: p.seed,
    biome,
    density: p.density,
    weather,
    timeOfDay,
    mood: p.mood,
    buildings: p.buildings,
    roads: p.roads,
    enemyCamps: p.enemyCamps,
    difficulty,
    coverZones: p.coverZones,
    elevatedPositions: p.elevatedPositions,
  };
}

/**
 * World Agent — the content authority for AI-mode worlds.
 * Wraps the shared AIContentEngine so retry/validation/history semantics
 * match every other generated content type (R21.2).
 */
export class WorldAgent {
  private readonly engine: AIContentEngine;

  constructor(engine: AIContentEngine) {
    this.engine = engine;
  }

  /**
   * Turn a free-text world prompt into a validated WorldConfig.
   * The engine tries the LLM up to 3 times; on persistent failure or when
   * no provider is configured, the procedural fallback interprets the
   * prompt by keyword (R30.2/R30.3).
   */
  async generateWorld(prompt: string, context: SessionContext): Promise<WorldConfig> {
    const result = await this.engine.generate('world', {
      prompt,
      biome: context.biome,
      difficulty: context.difficulty,
      // R32.2: prior-session memory summary informs mood/continuity.
      ...(context.memorySummary ? { memory: context.memorySummary } : {}),
    });
    if (result && validateWorldConfig(result as WorldContentPayload) === null) {
      return coerceWorldConfig(result as WorldContentPayload, context);
    }
    // Unreachable in practice (fallback always yields a valid payload),
    // but keeps the return type honest if a provider is misconfigured.
    const fallback = interpretWorldPrompt(prompt, {
      biome: context.biome,
      difficulty: context.difficulty,
    });
    return coerceWorldConfig(fallback, context);
  }
}
