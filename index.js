/**
 * index.ts
 *
 * Main entry point for the FPS Game Engine.
 * Initializes the engine core and bootstraps all systems.
 *
 * @module FPS-Engine
 */
import { Engine } from './engine/core/Engine';
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
export async function createEngine(options = {}) {
    const config = {
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
export { Engine, ModuleState } from './engine/core/Engine';
export { EventBus, ListenerPriority } from './engine/events/EventBus';
export { ECSWorld } from './engine/ecs/ECSWorld';
export { ConfigManager } from './engine/config/ConfigManager';
export { Profiler } from './engine/profiler/Profiler';
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
export { WeaponSystem, } from './gameplay/weapons/WeaponSystem';
export { WEAPON_CATALOG, WeaponCategory } from './gameplay/weapons/WeaponCatalog';
export { PENETRATION_TABLE, canPenetrate, attenuateDamage, } from './gameplay/weapons/PenetrationTable';
export { ATTACHMENT_CATALOG, AttachmentLoadout } from './gameplay/weapons/Attachments';
export { GrenadeSystem } from './gameplay/abilities/GrenadeSystem';
export { AbilitySystem } from './gameplay/abilities/AbilitySystem';
export { MapGenerator, Biome } from './gameplay/maps/MapGenerator';
export { NavGrid } from './gameplay/maps/NavGrid';
// Export physics
export { PhysicsWorld } from './physics/core/PhysicsWorld';
// Export AI
export { EnemyController, AIState } from './ai/core/EnemyController';
export { SquadManager, Squad } from './ai/core/SquadManager';
export { ENEMY_CLASSES } from './ai/classes/EnemyClasses';
export { PerceptionSystem } from './ai/perception/PerceptionSystem';
export { AINavigator } from './ai/navigation/AINavigator';
// Export audio
export { AudioEngine } from './audio/core/AudioEngine';
export { MusicSystem, MusicState } from './audio/mixer/MusicSystem';
// Export UI
export { HUD } from './ui/hud/HUD';
// Export networking
export { NetworkManager } from './networking/core/NetworkManager';
export { ClassicMode, CLASSIC_ROTATION } from './modes/classic/ClassicMode';
export { AIMode } from './modes/ai/AIMode';
export { WorldAgent } from './modes/ai/WorldAgent';
export { WorldMutator } from './modes/ai/WorldMutator';
export { SquadCommander, SQUAD_REINFORCE_DELAY, SQUAD_COMMANDER_TUNING, } from './modes/ai/SquadCommander';
export { ReinforcementScheduler, REINFORCEMENT_TUNING } from './modes/ai/ReinforcementScheduler';
export { MemorySystem, MEMORY_STORAGE_KEY, MEMORY_BYTE_CAP, DEFAULT_SLOT, } from './modes/ai/MemorySystem';
export { DirectorAgent, DIRECTOR_COMMAND_EVENT, DIRECTOR_TELEMETRY_EVENT, DEFAULT_DIRECTOR_RULES, } from './modes/ai/DirectorAgent';
export { ModeSelect } from './ui/modes/ModeSelect';
export { PickupSystem } from './gameplay/pickups/PickupSystem';
// Export AI content engine
export { AIContentEngine } from './engine/content/AIContentEngine';
export { OpenAICompatibleProvider, ProceduralFallbackProvider } from './engine/content/LLMProvider';
export { validatePayload, validateWeaponPayload, WEAPON_BOUNDS, BALANCE_ENVELOPE, validateWorldConfig, interpretWorldPrompt, hashPrompt, } from './engine/content/ContentSchemas';
// Export rendering effects
export { ParticleSystem, ParticleKind } from './rendering/particles/ParticleSystem';
export { TracerSystem } from './rendering/effects/TracerSystem';
export { MuzzleFlash } from './rendering/effects/MuzzleFlash';
export { CameraShake } from './rendering/effects/CameraShake';
export { VolumetricLightEffect } from './rendering/volumetric/VolumetricLightEffect';
//# sourceMappingURL=index.js.map