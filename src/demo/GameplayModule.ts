/**
 * GameplayModule.ts
 *
 * Engine module that drives the DemoGame's variable-rate update.
 * Registered BEFORE the render module so gameplay runs before rendering
 * each frame (no one-frame input lag).
 *
 * @module Demo
 */

import { IEngineModule, ModuleState } from '../engine/core/Engine';
import { DemoGame } from './Game';

export class GameplayModule implements IEngineModule {
  readonly name = 'GameplayModule';
  state: ModuleState = ModuleState.UNINITIALIZED;
  constructor(private readonly game: DemoGame) {}

  async init(): Promise<void> {
    this.state = ModuleState.ACTIVE;
  }

  update(deltaTime: number): void {
    this.game.update(deltaTime);
  }

  pause(): void {
    this.state = ModuleState.PAUSED;
  }

  resume(): void {
    this.state = ModuleState.ACTIVE;
  }

  async dispose(): Promise<void> {
    this.state = ModuleState.DISPOSED;
  }
}