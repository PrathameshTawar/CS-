/**
 * GameMode.ts
 *
 * Two-mode abstraction for the AI-native engine (Requirements 26-27, design §2.1).
 * Both modes share the engine core; a GameMode owns only the *content authority* —
 * what the world contains and which missions are active.
 *
 *  - Classic mode: fixed, deterministic, offline (classic/ClassicMode)
 *  - AI mode: generated, adaptive (ai/AIMode — agents arrive in Phases 1-3)
 *
 * @module Modes
 */

import type { Biome } from '../gameplay/maps/MapGenerator';
import type { EnemyClassId } from '../ai/classes/EnemyClasses';
import type { MissionContentPayload } from '../engine/content/ContentSchemas';

/** Re-exported so modes can implement GameMode without importing ContentSchemas directly. */
export type { MissionContentPayload } from '../engine/content/ContentSchemas';

/** Difficulty presets shared by both modes. */
export type Difficulty = 'easy' | 'normal' | 'hard';

export type GameModeId = 'classic' | 'ai' | 'creator';

/**
 * Structured world request (superset of MapContentPayload, design §6.2).
 * The LLM never sends meshes — it sends instructions the engine can build.
 */
export interface WorldConfig {
  seed: number; // 0..2^32-1
  biome: Biome;
  density: number; // 0..1
  weather: 'clear' | 'storm' | 'fog' | 'snow' | 'ash';
  timeOfDay: 'day' | 'dusk' | 'night';
  /** Free-text flavor used by HUD/briefings ("abandoned", "festive"). */
  mood: string;
  buildings: number;
  roads: number;
  enemyCamps: number;
  difficulty: Difficulty;
  coverZones: number;
  elevatedPositions: number;
}

/** In-place world changes applied without a rebuild (design §6.3). */
export interface WorldMutation {
  weather?: WorldConfig['weather'];
  timeOfDay?: WorldConfig['timeOfDay'];
  sunColor?: string;
  fogDensity?: number;
  ambientColor?: string;
  rainIntensity?: number; // 0..1
}

/** Live play-state snapshot fed to the Director once per second (R28.2). */
export interface TelemetryFrame {
  timestamp: number;
  health: number;
  maxHealth: number;
  armor: number;
  kills: number;
  killStreak: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  missionProgress: number;
  missionTarget: number;
  moving: boolean;
  firing: boolean;
  secondsIdle: number;
  /** Consecutive seconds the player's health ratio has been below 25%. */
  lowHealthSeconds: number;
}

/** Typed commands the Director emits (design §4.3.4). */
export type AdaptationCommand =
  | { kind: 'spawn_enemies'; count: number; classes: EnemyClassId[]; urgency: number }
  | { kind: 'adjust_difficulty'; difficulty: Difficulty; ramp: 'ease' | 'jump' }
  | { kind: 'set_mission'; mission: MissionContentPayload }
  | { kind: 'world_mutation'; mutation: WorldMutation }
  | { kind: 'event_trigger'; event: 'explosion' | 'ambush' | 'airdrop' | 'power_outage' }
  | { kind: 'grant_content'; content: 'weapon' | 'medkit' | 'ammo' };

/** Per-session context passed to the mode when a world/mission is requested. */
export interface SessionContext {
  difficulty: Difficulty;
  biome?: Biome;
  seed?: number;
  /** Free-text world request (AI mode, R30.1): "snowy abandoned military base". */
  prompt?: string;
  /**
   * Bounded summary of prior sessions, injected into World/Mission prompts
   * (R32.2) so the campaign feels continuous. Optional — omit when empty.
   */
  memorySummary?: string;
}

/**
 * GameMode — the content authority of a session (design §2.1).
 * The engine core never branches on mode; it calls these methods.
 */
export interface GameMode {
  readonly id: GameModeId;
  readonly label: string;
  /** Produce the next world config (Classic: rotation entry; AI: generated). */
  nextWorldConfig(context: SessionContext): Promise<WorldConfig>;
  /** Produce the active mission, or null to keep the engine default objective. */
  nextMission(config: WorldConfig): Promise<MissionContentPayload | null>;
  /** Per-frame adaptation hook (Director). Classic returns no commands. */
  update(deltaTime: number, telemetry: TelemetryFrame): AdaptationCommand[];
  /** Mode teardown. */
  dispose(): void;
  /** Reset per-session state (e.g. Classic rotation index). Optional. */
  reset?(): void;
}
