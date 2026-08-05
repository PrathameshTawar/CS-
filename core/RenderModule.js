/**
 * RenderModule.ts
 *
 * Engine module that owns and orchestrates the complete rendering pipeline.
 * Plugs into the engine's variable-rate update — rendering never runs in fixedUpdate.
 *
 * @module Rendering
 */
import { ModuleState } from '../../engine/core/Engine';
import { Renderer } from './Renderer';
import { RenderPipeline } from './RenderPipeline';
/**
 * The render module — the sole owner of all GPU resources.
 * It does NOT implement fixedUpdate because rendering is variable-rate.
 */
export class RenderModule {
    name = 'RenderModule';
    state = ModuleState.UNINITIALIZED;
    renderer;
    pipeline;
    moduleConfig;
    /** Scene objects that cast shadows — populated by gameplay/level code. */
    shadowCasters = [];
    constructor(config) {
        this.moduleConfig = config ?? {};
    }
    async init() {
        this.state = ModuleState.INITIALIZING;
        try {
            this.renderer = new Renderer(this.moduleConfig.renderer);
            await this.renderer.initialize();
            this.pipeline = new RenderPipeline(this.renderer, this.moduleConfig.pipeline);
            this.pipeline.initialize();
            this.state = ModuleState.ACTIVE;
        }
        catch (error) {
            this.state = ModuleState.ERROR;
            throw error;
        }
    }
    /** Variable-rate update — renders one frame. */
    update(_deltaTime) {
        if (this.state !== ModuleState.ACTIVE)
            return;
        this.pipeline.renderFrame(this.shadowCasters);
    }
    // No fixedUpdate — rendering is not deterministic-rate work.
    pause() {
        if (this.state === ModuleState.ACTIVE) {
            this.state = ModuleState.PAUSED;
        }
    }
    resume() {
        if (this.state === ModuleState.PAUSED) {
            this.state = ModuleState.ACTIVE;
        }
    }
    /**
     * Register objects that should cast shadows in the CSM pass.
     */
    setShadowCasters(casters) {
        this.shadowCasters = casters;
    }
    getRenderer() {
        return this.renderer;
    }
    getPipeline() {
        return this.pipeline;
    }
    async dispose() {
        this.state = ModuleState.DISPOSED;
        this.pipeline.dispose();
        this.renderer.dispose();
    }
}
//# sourceMappingURL=RenderModule.js.map