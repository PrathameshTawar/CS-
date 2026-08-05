/**
 * CinematicFXEffect.ts
 *
 * Cheap but high-impact cinematic post pass: subtle vignette, animated film
 * grain, and a color grade (contrast / saturation / temperature). Sits at the
 * END of the post chain (after TAA resolve) so it grades the final image.
 *
 * @module Rendering
 */
import * as THREE from 'three';
import { IPostEffect } from '../PostProcessingPipeline';
export interface CinematicFXConfig {
    vignette: number;
    grain: number;
    contrast: number;
    saturation: number;
    temperature: number;
}
export declare class CinematicFXEffect implements IPostEffect {
    readonly name = "CinematicFX";
    enabled: boolean;
    private readonly config;
    private material;
    private renderer;
    constructor(config?: Partial<CinematicFXConfig>);
    initialize(renderer: THREE.WebGLRenderer): void;
    render(input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget, _camera: THREE.PerspectiveCamera): void;
    setSize(width: number, height: number): void;
    setIntensity(intensity: number): void;
    dispose(): void;
}
//# sourceMappingURL=CinematicFXEffect.d.ts.map