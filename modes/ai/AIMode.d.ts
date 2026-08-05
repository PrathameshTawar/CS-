/**
 * AIMode.ts
 *
 * Mode 2 — AI (Requirements 26, 28-33; design §4).
 *
 * PHASE 0 SCAFFOLD: this mode currently wraps the existing demo behavior
 * (biome/difficulty selection + the AI content panel). The World Agent (P3),
 * Mission Agent (P2), Balance Agent (P2) and Director (P1) slot in behind
 * this interface in later phases without touching the engine core.
 *
 * @module Modes
 */
import type { WorldAgent } from './WorldAgent';
import type { AdaptationCommand, Difficulty, GameMode, MissionContentPayload, SessionContext, TelemetryFrame, WorldConfig } from '../GameMode';
export declare class AIMode implements GameMode {
    readonly id: "ai";
    readonly label = "AI";
    difficulty: Difficulty;
    /** Injected by the orchestrator; null → structured-biome selection only. */
    private worldAgent;
    /** Inject the World Agent (prompt-to-world, R30.1-R30.3). */
    setWorldAgent(agent: WorldAgent | null): void;
    nextWorldConfig(context: SessionContext): Promise<WorldConfig>;
    nextMission(_config: WorldConfig): Promise<MissionContentPayload | null>;
    update(_deltaTime: number, _telemetry: TelemetryFrame): AdaptationCommand[];
    dispose(): void;
}
//# sourceMappingURL=AIMode.d.ts.map