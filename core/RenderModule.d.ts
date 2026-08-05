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
export declare class RenderModule implements IEngineModule {
    readonly name = "RenderModule";
    state: ModuleState;
    private renderer;
    private pipeline;
    private readonly moduleConfig;
    /** Scene objects that cast shadows — populated by gameplay/level code. */
    private shadowCasters;
    constructor(config?: RenderModuleConfig);
    init(): Promise<void>;
    /** Variable-rate update — renders one frame. */
    update(_deltaTime: number): void;
    pause(): void;
    resume(): void;
    /**
     * Register objects that should cast shadows in the CSM pass.
     */
    setShadowCasters(casters: THREE.Object3D[]): void;
    getRenderer(): Renderer;
    getPipeline(): RenderPipeline;
    dispose(): Promise<void>;
}
//# sourceMappingURL=RenderModule.d.ts.map