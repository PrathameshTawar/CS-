/**
 * Engine.ts
 * 
 * Core engine class for the FPS game engine.
 * Manages the game loop, module lifecycle, and top-level orchestration.
 * 
 * @module Engine
 */

import { EventBus } from '../events/EventBus';
import { ConfigManager } from '../config/ConfigManager';
import { Profiler } from '../profiler/Profiler';
import { StateManager } from '../state/StateManager';
import { ECSWorld } from '../ecs/ECSWorld';

/**
 * Module lifecycle states
 */
export enum ModuleState {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ERROR = 'error',
  DISPOSED = 'disposed',
}

/**
 * Interface that all engine modules must implement
 */
export interface IEngineModule {
  readonly name: string;
  readonly state: ModuleState;
  init(): Promise<void>;
  /** Variable-rate update — called once per rendered frame (render, UI, audio). */
  update(deltaTime: number): void;
  /**
   * Fixed-rate update — called at a deterministic timestep (physics, game logic).
   * Optional: only implement if the module requires deterministic stepping.
   */
  fixedUpdate?(fixedDeltaTime: number): void;
  pause(): void;
  resume(): void;
  dispose(): Promise<void>;
}

/**
 * Engine configuration interface
 */
export interface EngineConfig {
  targetFPS: number;
  fixedTimeStep: number;
  maxSubSteps: number;
  enableProfiler: boolean;
  debugMode: boolean;
  editorMode: boolean;
}

/**
 * Default engine configuration
 */
const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  targetFPS: 144,
  fixedTimeStep: 1 / 60,
  maxSubSteps: 4,
  enableProfiler: false,
  debugMode: false,
  editorMode: false,
};

/**
 * Core Engine class
 * 
 * The Engine is the top-level orchestrator that manages:
 * - Game loop with fixed and variable time steps
 * - Module registration and lifecycle
 * - System-wide event bus
 * - Global configuration
 * - Performance profiling
 * - State management
 * 
 * @example
 * ```typescript
 * const engine = new Engine();
 * await engine.addModule(new RenderModule());
 * await engine.start();
 * ```
 */
export class Engine {
  private readonly modules: Map<string, IEngineModule> = new Map();
  private readonly eventBus: EventBus;
  private readonly configManager: ConfigManager;
  private readonly profiler: Profiler;
  private readonly stateManager: StateManager;
  private readonly ecsWorld: ECSWorld;

  private running: boolean = false;
  private paused: boolean = false;
  private lastFrameTime: number = 0;
  private accumulator: number = 0;
  private frameCount: number = 0;
  private fpsTimer: number = 0;
  private currentFPS: number = 0;

  private animationFrameId: number = 0;

  constructor(config?: Partial<EngineConfig>) {
    const resolvedConfig = { ...DEFAULT_ENGINE_CONFIG, ...config };

    this.eventBus = new EventBus();
    this.configManager = new ConfigManager(resolvedConfig);
    this.profiler = new Profiler(resolvedConfig.enableProfiler);
    this.stateManager = new StateManager(this.eventBus);
    this.ecsWorld = new ECSWorld(this.eventBus);
  }

  /**
   * Returns the global event bus for inter-module communication
   */
  get events(): EventBus {
    return this.eventBus;
  }

  /**
   * Returns the configuration manager
   */
  get config(): ConfigManager {
    return this.configManager;
  }

  /**
   * Returns the performance profiler
   */
  get profilerInstance(): Profiler {
    return this.profiler;
  }

  /**
   * Returns the state manager
   */
  get states(): StateManager {
    return this.stateManager;
  }

  /**
   * Returns the ECS world
   */
  get world(): ECSWorld {
    return this.ecsWorld;
  }

  /**
   * Returns current FPS
   */
  get fps(): number {
    return this.currentFPS;
  }

  /**
   * Returns whether the engine is currently running
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns whether the engine is paused
   */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Registers a new module with the engine
   * Throws if a module with the same name already exists
   */
  async addModule(module: IEngineModule): Promise<void> {
    if (this.modules.has(module.name)) {
      throw new Error(`Module '${module.name}' is already registered.`);
    }

    this.modules.set(module.name, module);
    this.eventBus.emit('engine.module.registered', { name: module.name });
  }

  /**
   * Removes and disposes a module from the engine
   */
  async removeModule(moduleName: string): Promise<void> {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module '${moduleName}' not found.`);
    }

    await module.dispose();
    this.modules.delete(moduleName);
    this.eventBus.emit('engine.module.removed', { name: moduleName });
  }

  /**
   * Retrieves a registered module by name
   */
  getModule<T extends IEngineModule>(name: string): T | undefined {
    return this.modules.get(name) as T | undefined;
  }

  /**
   * Initializes all registered modules in dependency order
   */
  async initialize(): Promise<void> {
    this.profiler.begin('engine.initialize');

    this.eventBus.emit('engine.initializing', {});

    for (const [name, module] of this.modules) {
      try {
        this.eventBus.emit('engine.module.initializing', { name });
        await module.init();
        this.eventBus.emit('engine.module.initialized', { name });
      } catch (error) {
        this.eventBus.emit('engine.module.error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Failed to initialize module '${name}': ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.eventBus.emit('engine.initialized', {});
    this.profiler.end('engine.initialize');
  }

  /**
   * Starts the main game loop
   */
  start(): void {
    if (this.running) {
      console.warn('[Engine] Engine is already running.');
      return;
    }

    this.running = true;
    this.paused = false;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
    this.frameCount = 0;
    this.fpsTimer = this.lastFrameTime;

    this.eventBus.emit('engine.started', {});
    this.eventBus.emit('engine.fps.changed', { fps: this.config.get<number>('targetFPS') });

    this.gameLoop(this.lastFrameTime);
  }

  /**
   * Stops the main game loop
   */
  stop(): void {
    this.running = false;
    this.paused = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }

    this.eventBus.emit('engine.stopped', {});
  }

  /**
   * Pauses the game loop (maintains state)
   */
  pause(): void {
    if (!this.running || this.paused) return;

    this.paused = true;
    this.eventBus.emit('engine.paused', {});

    for (const [, module] of this.modules) {
      module.pause();
    }
  }

  /**
   * Resumes the game loop
   */
  resume(): void {
    if (!this.running || !this.paused) return;

    this.paused = false;
    this.lastFrameTime = performance.now();
    this.eventBus.emit('engine.resumed', {});

    for (const [, module] of this.modules) {
      module.resume();
    }
  }

  /**
   * Main update tick - called once per frame
   * @param deltaTime Time since last frame in seconds
   */
  update(deltaTime: number): void {
    this.profiler.begin('engine.update');

    // Update ECS systems
    this.profiler.begin('engine.ecs.update');
    this.ecsWorld.update(deltaTime);
    this.profiler.end('engine.ecs.update');

    // Update all modules
    for (const [, module] of this.modules) {
      if (module.state === ModuleState.ACTIVE) {
        this.profiler.begin(`module.${module.name}.update`);
        module.update(deltaTime);
        this.profiler.end(`module.${module.name}.update`);
      }
    }

    // Update state manager
    this.stateManager.update(deltaTime);

    this.profiler.end('engine.update');
  }

  /**
   * The game loop with fixed timestep accumulation
   * Uses a semi-fixed timestep approach for stability
   */
  private gameLoop = (timestamp: number): void => {
    if (!this.running) return;

    if (this.paused) {
      this.animationFrameId = requestAnimationFrame(this.gameLoop);
      return;
    }

    const deltaTime = Math.min((timestamp - this.lastFrameTime) / 1000, 0.1); // Cap at 100ms
    this.lastFrameTime = timestamp;

    // FPS calculation
    this.frameCount++;
    if (timestamp - this.fpsTimer >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = timestamp;
      this.eventBus.emit('engine.fps.updated', { fps: this.currentFPS });
    }

    // Fixed timestep accumulation
    const fixedTimeStep = this.config.get<number>('fixedTimeStep');
    const maxSubSteps = this.config.get<number>('maxSubSteps');

    this.accumulator += deltaTime;
    let steps = 0;

    while (this.accumulator >= fixedTimeStep && steps < maxSubSteps) {
      this.profiler.begin('engine.fixedUpdate');
      this.fixedUpdate(fixedTimeStep);
      this.profiler.end('engine.fixedUpdate');
      this.accumulator -= fixedTimeStep;
      steps++;
    }

    // Variable update with remaining time
    // alpha is computed for future interpolation (render state lerp)
    const _alpha = this.accumulator / fixedTimeStep;
    void _alpha;
    this.update(deltaTime);

    // Render pass (handled by render module listening to events)

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Fixed timestep update — only dispatches to modules that implement fixedUpdate().
   * Physics and game-logic systems live here; rendering does NOT.
   */
  private fixedUpdate(deltaTime: number): void {
    this.eventBus.emit('engine.fixedUpdate', { deltaTime });

    for (const [, module] of this.modules) {
      if (module.state === ModuleState.ACTIVE && typeof module.fixedUpdate === 'function') {
        module.fixedUpdate(deltaTime);
      }
    }
  }

  /**
   * Disposes all modules and cleans up the engine
   */
  async dispose(): Promise<void> {
    this.stop();

    this.eventBus.emit('engine.disposing', {});

    for (const [name, module] of this.modules) {
      try {
        await module.dispose();
        this.eventBus.emit('engine.module.disposed', { name });
      } catch (error) {
        console.error(`[Engine] Error disposing module '${name}':`, error);
      }
    }

    this.modules.clear();
    this.ecsWorld.dispose();
    this.eventBus.dispose();
    this.profiler.dispose();

    this.eventBus.emit('engine.disposed', {});
  }
}

