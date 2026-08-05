/**
 * CreatorMode.ts
 *
 * Mode 3 — Creator (Requirement 34, T5.1-T5.3).
 * Natural-language level editor mode where creator commands apply incremental
 * mutations to the live world (add/remove/restyle entities, lighting/weather changes)
 * without restarting the session (R34.2). Exposes a visible mutation log (R34.3).
 *
 * @module Modes
 */
import { EventBus } from '../../engine/events/EventBus';
import type { AdaptationCommand, Difficulty, GameMode, MissionContentPayload, SessionContext, TelemetryFrame, WorldConfig } from '../GameMode';
export interface CreatorMutation {
    id: string;
    timestamp: number;
    rawCommand: string;
    action: 'add_entity' | 'remove_entity' | 'mutate_world' | 'set_difficulty' | 'restyle';
    details: string;
    applied: boolean;
}
export declare class CreatorMode implements GameMode {
    readonly id: "creator";
    readonly label = "Creator";
    difficulty: Difficulty;
    private mutations;
    private readonly bus;
    private idCounter;
    constructor(bus: EventBus);
    nextWorldConfig(context: SessionContext): Promise<WorldConfig>;
    nextMission(_config: WorldConfig): Promise<MissionContentPayload | null>;
    /**
     * Parse a natural-language creator command and emit the incremental mutation
     * event on the bus so the live engine applies it without restarting the session.
     */
    parseAndExecuteCommand(promptText: string): CreatorMutation;
    getMutationLog(): CreatorMutation[];
    clearMutationLog(): void;
    update(_deltaTime: number, _telemetry: TelemetryFrame): AdaptationCommand[];
    dispose(): void;
}
//# sourceMappingURL=CreatorMode.d.ts.map