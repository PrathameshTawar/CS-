/**
 * RenderModule.ts
 *
 * Engine module that owns and orchestrates the complete rendering pipeline.
 * Plugs into the engine's variable-rate update — rendering never runs in fixedUpdate.
 *
 * @module Rendering
 */

import * as THREE from 'three';
import { IEngineModule, ModuleState } from '../../engine/core/Engine';
import { Renderer, RendererConfig } from './Renderer';
import { RenderPipeline, RenderPipelineConfig } from './RenderPipeline';

export interface RenderModuleConfig {
  renderer?: Partial<RendererConfig>;
  pipeline?: Partial<RenderPipelineConfig>;
}

/**
 * The render module — the sole owner of all GPU resources.
 * It does NOT implement fixedUpdate because rendering is variable-rate.
 */
export class RenderModule implements IEngineModule {
  public readonly name = 'RenderModule';
  public state: ModuleState = ModuleState.UNINITIALIZED;

  private renderer!: Renderer;
  private pipeline!: RenderPipeline;
  private readonly moduleConfig: RenderModuleConfig;

  /** Scene objects that cast shadows — populated by gameplay/level code. */
  private shadowCasters: THREE.Object3D[] = [];

  constructor(config?: RenderModuleConfig) {
    this.moduleConfig = config ?? {};
  }

  async init(): Promise<void> {
    this.state = ModuleState.INITIALIZING;

    try {
      this.renderer = new Renderer(this.moduleConfig.renderer);
      await this.renderer.initialize();

      this.pipeline = new RenderPipeline(this.renderer, this.moduleConfig.pipeline);
      this.pipeline.initialize();

      this.state = ModuleState.ACTIVE;
    } catch (error) {
      this.state = ModuleState.ERROR;
      throw error;
    }
  }

  /** Variable-rate update — renders one frame. */
  update(_deltaTime: number): void {
    if (this.state !== ModuleState.ACTIVE) return;
    this.pipeline.renderFrame(this.shadowCasters);
  }

  // No fixedUpdate — rendering is not deterministic-rate work.

  pause(): void {
    if (this.state === ModuleState.ACTIVE) {
      this.state = ModuleState.PAUSED;
    }
  }

  resume(): void {
    if (this.state === ModuleState.PAUSED) {
      this.state = ModuleState.ACTIVE;
    }
  }

  /**
   * Register objects that should cast shadows in the CSM pass.
   */
  setShadowCasters(casters: THREE.Object3D[]): void {
    this.shadowCasters = casters;
  }

  getRenderer(): Renderer {
    return this.renderer;
  }

  getPipeline(): RenderPipeline {
    return this.pipeline;
  }

  async dispose(): Promise<void> {
    this.state = ModuleState.DISPOSED;
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}
