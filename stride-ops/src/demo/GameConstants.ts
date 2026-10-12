/**
 * GameConstants.ts
 *
 * Shared constants for the demo game orchestrator.
 * Extracted from Game.ts to reduce its size and improve discoverability.
 *
 * @module Demo
 */

import { Biome } from '../gameplay/maps/MapGenerator';
import type { Difficulty } from '../modes/GameMode';

/** Weapon order in the player's inventory. */
export const WEAPON_ORDER = ['assault_rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'skuller'];

/** Difficulty tuning: enemy health/speed/accuracy multipliers + spawn count. */
export const DIFFICULTY_TUNING: Record<Difficulty, { health: number; speed: number; accuracy: number; count: number }> = {
  easy: { health: 0.75, speed: 0.9, accuracy: 0.45, count: 5 },
  normal: { health: 1.0, speed: 1.0, accuracy: 0.6, count: 8 },
  hard: { health: 1.4, speed: 1.15, accuracy: 0.8, count: 12 },
};

/** Per-biome difficulty ceiling for Director escalations (R28.7). */
export const DIFFICULTY_CEILING: Record<Biome, Difficulty> = {
  [Biome.City]: 'hard',
  [Biome.Forest]: 'hard',
  [Biome.Snow]: 'normal',
  [Biome.Desert]: 'hard',
  [Biome.Dungeon]: 'normal',
  [Biome.Factory]: 'hard',
};

/** Hard cap on live enemies so Director spawns can never overload the scene. */
export const MAX_LIVE_ENEMIES = 40;

/** LLM provider presets (OpenRouter is OpenAI-compatible). */
export const PROVIDER_PRESETS = {
  // google/gemma-4-26b-a4b-it:free — free tier, supports response_format json_object
  // (required by OpenAICompatibleProvider), fast, and returned clean structured
  // world configs in live testing (verified 2026-07-31).
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-26b-a4b-it:free' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
} as const;

export type ProviderId = keyof typeof PROVIDER_PRESETS;

export const LLM_KEY_STORAGE = 'strideops_llm_key';