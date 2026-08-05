/**
 * index.ts
 * 
 * Main entry point for the FPS Game Engine.
 * Initializes the engine core and bootstraps all systems.
 * 
 * @module FPS-Engine
 */

import { Engine, EngineConfig } from './engine/core/Engine';

/**
 * Engine initialization options
 */
export interface EngineInitOptions {
  targetFPS?: number;
  enableProfiler?: boolean;
  debugMode?: boolean;
  editorMode?: boolean;
  container?: HTMLElement;
}

/**
 * The main engine bootstrap function.
 * Creates and initializes the engine with all core systems.
 * 
 * @example
 * ```typescript
 * import { createEngine } from './index';
 * 
 * const engine = await createEngine({
 *   targetFPS: 144,
 *   container: document.getElementById('game-container')
 * });
 * 
 * engine.start();
 * ```
 */
export async function createEngine(options: EngineInitOptions = {}): Promise<Engine> {
  const config: Partial<EngineConfig> = {
    targetFPS: options.targetFPS ?? 144,
    enableProfiler: options.enableProfiler ?? false,
    debugMode: options.debugMode ?? false,
    editorMode: options.editorMode ?? false,
  };

  const engine = new Engine(config);

  console.log('[FPS-Engine] Engine created. Version 0.1.0');
  console.log(`[FPS-Engine] Target FPS: ${config.targetFPS}`);
  console.log(`[FPS-Engine] Debug Mode: ${config.debugMode}`);
  console.log(`[FPS-Engine] Editor Mode: ${config.editorMode}`);

  return engine;
}

/**
 * Engine version information
 */
export const VERSION = {
  major: 0,
  minor: 1,
  patch: 0,
  toString: () => '0.1.0',
};

// Export core engine types
export { Engine, EngineConfig, IEngineModule, ModuleState } from './engine/core/Engine';
export { EventBus, ListenerPriority } from './engine/events/EventBus';
export { ECSWorld, EntityId, IComponent, ISystem } from './engine/ecs/ECSWorld';
export { ConfigManager } from './engine/config/ConfigManager';
export { Profiler, ProfilerStats, PerformanceBudget } from './engine/profiler/Profiler';
export { StateManager } from './engine/state/StateManager';
export { Serializer } from './engine/serialization/Serializer';
export { SaveManager } from './engine/serialization/SaveManager';

// Export rendering types
export { RenderModule } from './rendering/core/RenderModule';
export { Renderer } from './rendering/core/Renderer';

// Export gameplay types
export { InputManager, Action } from './gameplay/core/InputManager';
export { SeededRandom } from './gameplay/core/Random';
export { PlayerController, MoveState } from './gameplay/player/PlayerController';
export {
  WeaponSystem,
  WeaponState,
  ShotResult,
} from './gameplay/weapons/WeaponSystem';
export { WEAPON_CATALOG, WeaponDefinition, WeaponCategory } from './gameplay/weapons/WeaponCatalog';
export {
  PENETRATION_TABLE,
  canPenetrate,
  attenuateDamage,
} from './gameplay/weapons/PenetrationTable';
export { ATTACHMENT_CATALOG, AttachmentLoadout, AttachmentId } from './gameplay/weapons/Attachments';
export { GrenadeSystem, GrenadeType } from './gameplay/abilities/GrenadeSystem';
export { AbilitySystem, AbilityDef, GhostTrailSegment } from './gameplay/abilities/AbilitySystem';
export { MapGenerator, Biome, MapLayout, BlockInstance } from './gameplay/maps/MapGenerator';
export { NavGrid, NavCell } from './gameplay/maps/NavGrid';

// Export physics
export { PhysicsWorld, RayHit, AABB } from './physics/core/PhysicsWorld';

// Export AI
export { EnemyController, AIState, EnemySnapshot } from './ai/core/EnemyController';
export { SquadManager, Squad } from './ai/core/SquadManager';
export { ENEMY_CLASSES, EnemyClassDef, EnemyClassId } from './ai/classes/EnemyClasses';
export { PerceptionSystem, PerceptionMemory } from './ai/perception/PerceptionSystem';
export { AINavigator } from './ai/navigation/AINavigator';

// Export audio
export { AudioEngine } from './audio/core/AudioEngine';
export { MusicSystem, MusicState } from './audio/mixer/MusicSystem';

// Export UI
export { HUD } from './ui/hud/HUD';

// Export networking
export { NetworkManager, Snapshot, EntityState, InputCommand, NetworkTransport } from './networking/core/NetworkManager';

// Export modes (two-mode architecture: CLASSIC / AI)
export type {
  Difficulty,
  GameModeId,
  WorldConfig,
  WorldMutation,
  TelemetryFrame,
  AdaptationCommand,
  SessionContext,
  GameMode,
} from './modes/GameMode';
export { ClassicMode, CLASSIC_ROTATION } from './modes/classic/ClassicMode';
export type { ClassicRotationEntry } from './modes/classic/ClassicMode';
export { AIMode } from './modes/ai/AIMode';
export { WorldAgent } from './modes/ai/WorldAgent';
export { WorldMutator } from './modes/ai/WorldMutator';
export {
  SquadCommander,
  SQUAD_REINFORCE_DELAY,
  SQUAD_COMMANDER_TUNING,
} from './modes/ai/SquadCommander';
export type {
  SquadOrderType,
  SquadOrder,
  SquadCommanderOptions,
  SquadCommanderTuning,
} from './modes/ai/SquadCommander';
export { ReinforcementScheduler, REINFORCEMENT_TUNING } from './modes/ai/ReinforcementScheduler';
export type {
  ReinforcementRequest,
  ReinforcementSchedulerOptions,
  ReinforcementLoadout,
} from './modes/ai/ReinforcementScheduler';
export {
  MemorySystem,
  MEMORY_STORAGE_KEY,
  MEMORY_BYTE_CAP,
  DEFAULT_SLOT,
} from './modes/ai/MemorySystem';
export type {
  MemoryStorageLike,
  MemoryEvent,
  WorldMemory,
  SessionMemory,
  PersistedMemoryState,
  MemorySystemOptions,
} from './modes/ai/MemorySystem';
export type { WorldMutatorTargets, Weather, TimeOfDay } from './modes/ai/WorldMutator';
export {
  DirectorAgent,
  DIRECTOR_COMMAND_EVENT,
  DIRECTOR_TELEMETRY_EVENT,
  DEFAULT_DIRECTOR_RULES,
} from './modes/ai/DirectorAgent';
export type { DirectorRule, DirectorRuleContext, DirectorOptions } from './modes/ai/DirectorAgent';
export { ModeSelect } from './ui/modes/ModeSelect';
export { PickupSystem } from './gameplay/pickups/PickupSystem';
export type { PickupKind } from './gameplay/pickups/PickupSystem';

// Export AI content engine
export { AIContentEngine, ContentLogEntry } from './engine/content/AIContentEngine';
export { LLMProvider, OpenAICompatibleProvider, ProceduralFallbackProvider } from './engine/content/LLMProvider';
export {
  validatePayload,
  validateWeaponPayload,
  WEAPON_BOUNDS,
  BALANCE_ENVELOPE,
  ContentPayload,
  WorldContentPayload,
  validateWorldConfig,
  interpretWorldPrompt,
  hashPrompt,
} from './engine/content/ContentSchemas';

// Export rendering effects
export { ParticleSystem, ParticleKind } from './rendering/particles/ParticleSystem';
export { TracerSystem } from './rendering/effects/TracerSystem';
export { MuzzleFlash } from './rendering/effects/MuzzleFlash';
export { CameraShake } from './rendering/effects/CameraShake';
export { VolumetricLightEffect } from './rendering/volumetric/VolumetricLightEffect';
