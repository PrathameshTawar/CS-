/**
 * AIMode.ts
 *
 * Mode 2 — AI (Requirements 26, 28-33; design §4).
 *
 * PHASE 0 SCAFFOLD: this mode currently wraps the existing demo behavior
 * (biome/difficulty selection + the AI content panel). The World Agent (P3),
 * Mission Agent (P2), Balance Agent (P2) and Director (P1) slot in behind
 * this interface in later phases without touching the engine core.
 *
 * @module Modes
 */

import { Biome } from '../../gameplay/maps/MapGenerator';
import type { WorldAgent } from './WorldAgent';
import type {
  AdaptationCommand,
  Difficulty,
  GameMode,
  MissionContentPayload,
  SessionContext,
  TelemetryFrame,
  WorldConfig,
} from '../GameMode';

const DEFAULT_OBJECTIVE: MissionContentPayload = {
  objectiveType: 'defense',
  title: 'Defend the Zone',
  briefing: 'Hold the line against incoming waves.',
  successCondition: 'Survive all waves.',
  failureCondition: 'Player is eliminated.',
  targetCount: 5,
};

export class AIMode implements GameMode {
  readonly id = 'ai' as const;
  readonly label = 'AI';

  difficulty: Difficulty = 'normal';

  /** Injected by the orchestrator; null → structured-biome selection only. */
  private worldAgent: WorldAgent | null = null;

  /** Inject the World Agent (prompt-to-world, R30.1-R30.3). */
  setWorldAgent(agent: WorldAgent | null): void {
    this.worldAgent = agent;
  }

  async nextWorldConfig(context: SessionContext): Promise<WorldConfig> {
    this.difficulty = context.difficulty;
    // R30.1-R30.3: a free-text prompt overrides the structured selection.
    // The World Agent validates the LLM output and falls back to keyword
    // interpretation when no key is configured.
    const prompt = context.prompt?.trim();
    if (prompt && this.worldAgent) {
      return this.worldAgent.generateWorld(prompt, context);
    }
    const biome: Biome = context.biome ?? Biome.City;
    const seed: number = context.seed ?? Math.floor(Math.random() * 0xffffffff);
    return {
      seed,
      biome,
      density: 0.55,
      weather: 'clear',
      timeOfDay: 'day',
      mood: 'generated',
      buildings: 0,
      roads: 0,
      enemyCamps: 0,
      difficulty: this.difficulty,
      coverZones: 0,
      elevatedPositions: 0,
    };
  }

  async nextMission(_config: WorldConfig): Promise<MissionContentPayload | null> {
    return DEFAULT_OBJECTIVE;
  }

  update(_deltaTime: number, _telemetry: TelemetryFrame): AdaptationCommand[] {
    return []; // live adaptation runs via the separate DirectorAgent system (Phase 1)
  }

  dispose(): void {
    // nothing to release yet
  }
}
