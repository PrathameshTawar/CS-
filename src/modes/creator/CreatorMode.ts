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
import { Biome } from '../../gameplay/maps/MapGenerator';
import { EnemyClassId } from '../../ai/classes/EnemyClasses';
import type {
  AdaptationCommand,
  Difficulty,
  GameMode,
  MissionContentPayload,
  SessionContext,
  TelemetryFrame,
  WorldConfig,
} from '../GameMode';

export interface CreatorMutation {
  id: string;
  timestamp: number;
  rawCommand: string;
  action: 'add_entity' | 'remove_entity' | 'mutate_world' | 'set_difficulty' | 'restyle';
  details: string;
  applied: boolean;
}

const DEFAULT_OBJECTIVE: MissionContentPayload = {
  objectiveType: 'defense',
  title: 'Creator Playground',
  briefing: 'Edit the world live using natural language commands.',
  successCondition: 'none',
  failureCondition: 'Player is eliminated.',
  targetCount: 999,
};

export class CreatorMode implements GameMode {
  readonly id = 'creator' as const;
  readonly label = 'Creator';

  difficulty: Difficulty = 'normal';
  private mutations: CreatorMutation[] = [];
  private readonly bus: EventBus;
  private idCounter = 1;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  async nextWorldConfig(context: SessionContext): Promise<WorldConfig> {
    this.difficulty = context.difficulty || 'normal';
    const biome: Biome = context.biome ?? Biome.City;
    const seed: number = context.seed ?? 12345;
    return {
      seed,
      biome,
      density: 0.5,
      weather: 'clear',
      timeOfDay: 'day',
      mood: 'creator playground',
      buildings: 0,
      roads: 0,
      enemyCamps: 0,
      difficulty: this.difficulty,
      coverZones: 0,
      elevatedPositions: 0,
    };
  }

  async nextMission(_config: WorldConfig): Promise<MissionContentPayload | null> {
    return DEFAULT_OBJECTIVE;
  }

  /**
   * Parse a natural-language creator command and emit the incremental mutation
   * event on the bus so the live engine applies it without restarting the session.
   */
  parseAndExecuteCommand(promptText: string): CreatorMutation {
    const rawCommand = promptText.trim();
    const lower = rawCommand.toLowerCase();
    const timestamp = Date.now();
    const id = `mut-${this.idCounter++}`;

    let mutation: CreatorMutation;

    // 1. Add entity commands ("add enemy", "add sniper", "add cover", "add castle")
    if (/add|spawn|create/i.test(lower)) {
      if (/sniper|scout|heavy|medic|engineer/i.test(lower)) {
        const match = lower.match(/sniper|scout|heavy|medic|engineer/i);
        const classId = (match ? match[0].toLowerCase() : 'scout') as EnemyClassId;
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'add_entity',
          details: `Spawned enemy (${classId})`,
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'add_entity',
          entityType: 'enemy',
          enemyClass: classId,
        });
      } else if (/enemy|enemies|hostile|guard/i.test(lower)) {
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'add_entity',
          details: 'Spawned enemy (scout)',
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'add_entity',
          entityType: 'enemy',
          enemyClass: 'scout',
        });
      } else if (/cover|block|wall|obstacle|castle|building/i.test(lower)) {
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'add_entity',
          details: 'Added cover block',
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'add_entity',
          entityType: 'cover',
        });
      } else {
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'add_entity',
          details: 'Spawned generic entity',
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'add_entity',
          entityType: 'cover',
        });
      }
    }
    // 2. Remove commands ("remove enemies", "clear enemies")
    else if (/remove|clear|delete|destroy/i.test(lower)) {
      if (/enemy|enemies|hostiles|all/i.test(lower)) {
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'remove_entity',
          details: 'Cleared all enemies',
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'remove_entity',
          target: 'enemies',
        });
      } else {
        mutation = {
          id,
          timestamp,
          rawCommand,
          action: 'remove_entity',
          details: 'Cleared targets',
          applied: true,
        };
        this.bus.emit('creator.mutation', {
          type: 'remove_entity',
          target: 'enemies',
        });
      }
    }
    // 3. Time of day mutations ("make it night", "make it dusk", "daytime")
    else if (/night|dusk|day|dark|darker|bright/i.test(lower)) {
      let timeOfDay: 'day' | 'dusk' | 'night' = 'day';
      if (/night|dark/i.test(lower)) timeOfDay = 'night';
      else if (/dusk/i.test(lower)) timeOfDay = 'dusk';
      mutation = {
        id,
        timestamp,
        rawCommand,
        action: 'mutate_world',
        details: `Time of day changed to ${timeOfDay}`,
        applied: true,
      };
      this.bus.emit('creator.mutation', {
        type: 'mutate_world',
        mutation: { timeOfDay },
      });
    }
    // 4. Weather mutations ("storm", "rain", "snow", "fog", "clear")
    else if (/storm|rain|snow|fog|clear|weather/i.test(lower)) {
      let weather: 'clear' | 'storm' | 'fog' | 'snow' | 'ash' = 'clear';
      if (/storm|rain/i.test(lower)) weather = 'storm';
      else if (/snow/i.test(lower)) weather = 'snow';
      else if (/fog/i.test(lower)) weather = 'fog';
      else if (/ash/i.test(lower)) weather = 'ash';
      mutation = {
        id,
        timestamp,
        rawCommand,
        action: 'mutate_world',
        details: `Weather changed to ${weather}`,
        applied: true,
      };
      this.bus.emit('creator.mutation', {
        type: 'mutate_world',
        mutation: { weather },
      });
    }
    // 5. Difficulty ("make it harder", "set difficulty hard")
    else if (/easy|normal|hard|harder|easier/i.test(lower)) {
      let difficulty: Difficulty = 'normal';
      if (/hard/i.test(lower)) difficulty = 'hard';
      else if (/easy/i.test(lower)) difficulty = 'easy';
      this.difficulty = difficulty;
      mutation = {
        id,
        timestamp,
        rawCommand,
        action: 'set_difficulty',
        details: `Difficulty set to ${difficulty}`,
        applied: true,
      };
      this.bus.emit('creator.mutation', {
        type: 'set_difficulty',
        difficulty,
      });
    }
    // 6. Restyle / replace ("replace zombies with robots", "restyle as cyberpunk")
    else if (/replace|restyle|change.*(zombie|robot|cyborg|soldier|theme)/i.test(lower)) {
      mutation = {
        id,
        timestamp,
        rawCommand,
        action: 'restyle',
        details: `Applied styling theme: ${rawCommand}`,
        applied: true,
      };
      this.bus.emit('creator.mutation', {
        type: 'restyle',
        theme: rawCommand,
      });
    }
    // 7. General fallback mutation
    else {
      mutation = {
        id,
        timestamp,
        rawCommand,
        action: 'mutate_world',
        details: `Applied mutation: ${rawCommand}`,
        applied: true,
      };
      this.bus.emit('creator.mutation', {
        type: 'mutate_world',
        mutation: { mood: rawCommand },
      });
    }

    this.mutations.push(mutation);
    this.bus.emit('creator.log.update', this.mutations);
    return mutation;
  }

  getMutationLog(): CreatorMutation[] {
    return this.mutations;
  }

  clearMutationLog(): void {
    this.mutations = [];
    this.bus.emit('creator.log.update', this.mutations);
  }

  update(_deltaTime: number, _telemetry: TelemetryFrame): AdaptationCommand[] {
    return [];
  }

  dispose(): void {
    this.mutations = [];
  }
}
