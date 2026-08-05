/**
 * WorldMutator.ts
 *
 * In-place world mutation (Requirement 30.4-30.6, task T3.4).
 *
 * Applies weather / time-of-day changes to the LIVE scene by updating fog
 * color/density, sun + hemisphere light colors and intensities, the renderer
 * clear color, volumetric god-ray parameters, rain particles and storm
 * ambience — WITHOUT rebuilding the world or reloading the page.
 *
 * All targets are accessor functions so the mutator survives world rebuilds
 * (Game.ts recreates lights per map; the closures always read the current
 * handles).
 *
 * @module Modes
 */
import * as THREE from 'three';
import { Biome } from '../../gameplay/maps/MapGenerator';
import type { VolumetricLightEffect } from '../../rendering/volumetric/VolumetricLightEffect';
import type { WorldConfig, WorldMutation } from '../GameMode';
import type { SkyDome } from '../../rendering/environment/SkyDome';
export type Weather = WorldConfig['weather'];
export type TimeOfDay = WorldConfig['timeOfDay'];
/** Minimal clear-color surface the mutator needs (satisfied by the app Renderer). */
export interface ClearColorTarget {
    setClearColor(color: number): void;
}
/** Live handles the mutator writes to (accessors survive rebuilds). */
export interface WorldMutatorTargets {
    sun: () => THREE.DirectionalLight | null;
    hemi: () => THREE.HemisphereLight | null;
    fog: () => THREE.FogExp2 | null;
    volumetric: () => VolumetricLightEffect | null;
    renderer: () => ClearColorTarget | null;
    setRain: (active: boolean, intensity: number) => void;
    setStorm: (active: boolean) => void;
    /** Optional procedural sky dome driven by the combined atmosphere. */
    sky?: () => SkyDome | null;
}
/**
 * Applies weather + time-of-day to the live scene, in place.
 */
export declare class WorldMutator {
    private readonly biome;
    private readonly targets;
    private weather;
    private timeOfDay;
    constructor(targets: WorldMutatorTargets, biome: Biome, initial?: {
        weather?: Weather;
        timeOfDay?: TimeOfDay;
    });
    getState(): {
        weather: Weather;
        timeOfDay: TimeOfDay;
    };
    /** Apply a partial mutation (weather and/or timeOfDay and/or tunings). */
    apply(mutation: WorldMutation): void;
    /** Apply a full weather + timeOfDay pair (e.g. from a generated WorldConfig). */
    applyConfig(config: {
        weather: Weather;
        timeOfDay: TimeOfDay;
    }): void;
    /** Compute the combined atmosphere and write it into the live scene. */
    private write;
}
//# sourceMappingURL=WorldMutator.d.ts.map