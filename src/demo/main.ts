/**
 * main.ts
 *
 * Demo entry point. Creates the game container and boots the DemoGame.
 * Supports query-string map configuration:
 *   ?biome=city|forest|snow|desert|dungeon|factory
 *   ?seed=12345
 *
 * @module Demo
 */

import { DemoGame } from './Game';
import { Biome } from '../gameplay/maps/MapGenerator';
import type { GameModeId } from '../modes/GameMode';

function getQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function boot(): void {
  const container = document.getElementById('game-container');
  if (!container) {
    throw new Error('#game-container not found');
  }

  const modeParam = getQueryParam('mode');
  const biomeParam = getQueryParam('biome');
  const seedParam = getQueryParam('seed');
  const difficultyParam = getQueryParam('difficulty');
  const llmKeyParam = getQueryParam('llmKey');

  // ?mode=classic|ai fast-boots straight into a mode (R26.5)
  const mode: GameModeId | undefined =
    modeParam === 'classic' || modeParam === 'ai' ? modeParam : undefined;

  const biome = biomeParam && (biomeParam in Biome)
    ? (biomeParam as Biome)
    : Biome.City;

  const seed = seedParam ? parseInt(seedParam, 10) : undefined;
  const difficulty = difficultyParam === 'easy' || difficultyParam === 'normal' || difficultyParam === 'hard'
    ? difficultyParam
    : undefined;

  const game = new DemoGame({
    container,
    mode,
    biome,
    seed: Number.isFinite(seed) ? seed : undefined,
    difficulty,
    llmKey: llmKeyParam ?? undefined,
  });

  window.addEventListener('error', (e) => {
    console.error('[Demo] Uncaught error:', e.message);
  });

  void game.start();

  // Expose for debugging
  (window as unknown as { __game: DemoGame }).__game = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
