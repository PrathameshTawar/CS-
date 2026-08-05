/**
 * LLMProvider.ts
 *
 * LLM provider abstraction for the AI Content Engine (Level 10).
 * Two implementations:
 *  - OpenAICompatibleProvider: calls a configured LLM API endpoint
 *  - ProceduralFallbackProvider: deterministic local generation
 *
 * @module Content
 */

import {
  WeaponContentPayload,
  MapContentPayload,
  MissionContentPayload,
  BalanceContentPayload,
  WorldContentPayload,
  interpretWorldPrompt,
} from './ContentSchemas';

export interface LLMRequest {
  /** Structured content request. */
  type: string;
  context: Record<string, unknown>;
}

export type GeneratedContent =
  | WeaponContentPayload
  | MapContentPayload
  | MissionContentPayload
  | BalanceContentPayload
  | WorldContentPayload;

export interface LLMProvider {
  readonly name: string;
  /** Generate structured content. Returns null on failure. */
  generate(request: LLMRequest): Promise<GeneratedContent | null>;
}

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Extra headers (e.g. OpenRouter app attribution: HTTP-Referer, X-Title). */
  extraHeaders?: Record<string, string>;
  /** Ask the API for a strict JSON object response. Disable for providers that reject it. */
  useJsonMode?: boolean;
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint and parses the
 * response as strict JSON matching the requested content type.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';

  private readonly config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
  }

  async generate(request: LLMRequest): Promise<GeneratedContent | null> {
    try {
      const system = this.buildSystemPrompt(request.type);
      const user = JSON.stringify(request.context);

      const body: Record<string, unknown> = {
        model: this.config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
      };
      if (this.config.useJsonMode !== false) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.warn(`[LLMProvider] HTTP ${res.status}: ${await res.text()}`);
        return null;
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;

      return JSON.parse(content) as GeneratedContent;
    } catch (error) {
      console.warn('[LLMProvider] Request failed:', error);
      return null;
    }
  }

  private buildSystemPrompt(type: string): string {
    const base =
      'You are an expert game designer generating JSON content for an FPS game. ' +
      'Respond with ONLY a valid JSON object, no markdown, no explanation.';
    switch (type) {
      case 'weapon':
        return (
          base +
          ' Generate a weapon with fields: name (string), category (rifle|smg|shotgun|sniper|pistol), ' +
          'baseDamage (5-150), fireRate (60-1200 rpm), magazineSize (5-100), reloadTime (0.5-5), ' +
          'recoil {vertical: number[], horizontal: number[]}, baseSpread (0.001-0.12), color (number hex).'
        );
      case 'map':
        return (
          base +
          ' Generate a map config with fields: seed (0-4294967295), biome (string), density (0-1), ' +
          'coverZones (>=3), elevatedPositions (>=1).'
        );
      case 'mission':
        return (
          base +
          ' Generate a mission with fields: objectiveType (elimination|extraction|defense|capture), ' +
          'title (string), briefing (string), successCondition (string), failureCondition (string), targetCount (1-50).'
        );
      case 'balance':
        return (
          base +
          ' Generate enemy balance overrides with fields: difficulty (easy|normal|hard), enemyClass (string), ' +
          'healthMultiplier, speedMultiplier, accuracyMultiplier, reactionTimeMultiplier. ' +
          'Values must respect the difficulty envelope.'
        );
      case 'world':
        return (
          base +
          ' Generate a world config with fields: seed (0-4294967295), biome (city|forest|snow|desert|dungeon|factory), ' +
          'density (0-1), weather (clear|storm|fog|snow|ash), timeOfDay (day|dusk|night), mood (short string), ' +
          'buildings (0-200), roads (0-100), enemyCamps (0-50), difficulty (easy|normal|hard), ' +
          'coverZones (>=3), elevatedPositions (>=1). The user prompt describes the desired world; ' +
          'infer the biome, weather, time of day, mood, difficulty and density from it. ' +
          'The context may include a memory field summarizing previous sessions; use it to inform ' +
          'the mood and continuity of the generated world.'
        );
      default:
        return base + ' Return a JSON object matching the requested type.';
    }
  }
}

/**
 * Deterministic local generation used when no LLM is configured or when
 * the LLM request fails after retries (Requirement 21.2 fallback).
 */
export class ProceduralFallbackProvider implements LLMProvider {
  readonly name = 'procedural-fallback';

  async generate(request: LLMRequest): Promise<GeneratedContent | null> {
    switch (request.type) {
      case 'weapon': return this.generateWeapon(request.context);
      case 'map': return this.generateMap(request.context);
      case 'mission': return this.generateMission(request.context);
      case 'balance': return this.generateBalance(request.context);
      case 'world': return this.generateWorld(request.context);
      default: return null;
    }
  }

  /**
   * Keyword interpretation of the free-text prompt (R30.3): no LLM needed,
   * deterministic per prompt, always schema-valid.
   */
  private generateWorld(context: Record<string, unknown>): WorldContentPayload {
    const prompt = (context.prompt as string) ?? '';
    const biome = (context.biome as string) ?? undefined;
    const difficulty = (context.difficulty as string) ?? undefined;
    return interpretWorldPrompt(prompt, { biome, difficulty });
  }

  private generateWeapon(context: Record<string, unknown>): WeaponContentPayload {
    const category = (context.category as string) ?? 'rifle';
    const power = ((context.powerLevel as number) ?? 0.5);
    const names: Record<string, string[]> = {
      rifle: ['Vanguard AR', 'Striker Rifle', 'Reaper-7'],
      smg: ['Hornet SMG', 'Wasp PDW', 'Tempest'],
      shotgun: ['Breacher 12G', 'Doomhammer', 'Widowmaker'],
      sniper: ['Longshot M40', 'Spectral Rail', 'Ghostline'],
      pistol: ['Sidearm P9', 'Viper 9mm', 'Echo Pistol'],
    };
    const pool = names[category] ?? names.rifle;
    return {
      name: pool[Math.floor(Math.random() * pool.length)],
      category: category as WeaponContentPayload['category'],
      baseDamage: Math.round(10 + power * 90),
      fireRate: Math.round(120 + power * 600),
      magazineSize: Math.round(10 + power * 40),
      reloadTime: 1 + Math.random() * 2,
      recoil: {
        vertical: Array.from({ length: 4 }, () => 0.5 + Math.random() * 2),
        horizontal: Array.from({ length: 4 }, () => (Math.random() - 0.5) * 1.2),
      },
      baseSpread: 0.01 + Math.random() * 0.06,
      color: Math.floor(Math.random() * 0xffffff),
    };
  }

  private generateMap(context: Record<string, unknown>): MapContentPayload {
    const biome = (context.biome as string) ?? 'city';
    const density = (context.density as number) ?? 0.5;
    return {
      seed: Math.floor(Math.random() * 0xffffffff),
      biome,
      density,
      coverZones: Math.max(3, Math.round(density * 12)),
      elevatedPositions: Math.max(1, Math.round(density * 5)),
    };
  }

  private generateMission(context: Record<string, unknown>): MissionContentPayload {
    const type = (context.objectiveType as string) ?? 'elimination';
    const difficulty = (context.difficulty as number) ?? 0.5;
    const titles: Record<string, string> = {
      elimination: 'Clean Sweep',
      extraction: 'Secure Extraction',
      defense: 'Hold the Line',
      capture: 'Take the Objective',
    };
    return {
      objectiveType: type,
      title: titles[type] ?? 'Operation',
      briefing: `Eliminate hostiles and secure the area. Difficulty ${Math.round(difficulty * 100)}%.`,
      successCondition: `Neutralize ${Math.max(1, Math.round(difficulty * 10))} hostiles.`,
      failureCondition: 'Player is eliminated.',
      targetCount: Math.max(1, Math.round(difficulty * 10)),
    };
  }

  private generateBalance(context: Record<string, unknown>): BalanceContentPayload {
    const difficulty = (context.difficulty as string) ?? 'normal';
    const enemyClass = (context.enemyClass as string) ?? 'scout';
    const env =
      difficulty === 'easy'
        ? { health: 0.75, speed: 0.9, accuracy: 0.4 }
        : difficulty === 'hard'
          ? { health: 1.5, speed: 1.1, accuracy: 0.8 }
          : { health: 1.0, speed: 1.0, accuracy: 0.6 };
    return {
      difficulty: difficulty as BalanceContentPayload['difficulty'],
      enemyClass,
      healthMultiplier: env.health + (Math.random() - 0.5) * 0.1,
      speedMultiplier: env.speed,
      accuracyMultiplier: env.accuracy,
      reactionTimeMultiplier: 0.8 + Math.random() * 0.4,
    };
  }
}
