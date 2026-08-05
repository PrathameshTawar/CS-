/**
 * WorldAgent.ts
 *
 * Prompt-to-world generation (Requirement 30, tasks T3.1-T3.3).
 *
 * Pipeline: free-text prompt → LLM (`WorldContentPayload`) → schema
 * validation with retry ×3 → keyword interpretation fallback. When no LLM
 * key is configured, the keyword interpreter produces the config directly
 * (R30.3) — so AI mode works fully offline.
 *
 * The LLM never sends meshes; it sends a validated config the engine
 * already knows how to build (MapGenerator + atmosphere).
 *
 * @module Modes
 */
import { AIContentEngine } from '../../engine/content/AIContentEngine';
import { WorldContentPayload } from '../../engine/content/ContentSchemas';
import type { SessionContext, WorldConfig } from '../GameMode';
/** Coerce a validated loose payload into the strict WorldConfig shape. */
export declare function coerceWorldConfig(p: WorldContentPayload, context: SessionContext): WorldConfig;
/**
 * World Agent — the content authority for AI-mode worlds.
 * Wraps the shared AIContentEngine so retry/validation/history semantics
 * match every other generated content type (R21.2).
 */
export declare class WorldAgent {
    private readonly engine;
    constructor(engine: AIContentEngine);
    /**
     * Turn a free-text world prompt into a validated WorldConfig.
     * The engine tries the LLM up to 3 times; on persistent failure or when
     * no provider is configured, the procedural fallback interprets the
     * prompt by keyword (R30.2/R30.3).
     */
    generateWorld(prompt: string, context: SessionContext): Promise<WorldConfig>;
}
//# sourceMappingURL=WorldAgent.d.ts.map