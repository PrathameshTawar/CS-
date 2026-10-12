import { EventBus } from '../../engine/events/EventBus';
import { GAME_EVENTS, KillEvent, ObjectiveEvent, HealthStateEvent } from '../../gameplay/core/GameTypes';
import { MissionContentPayload } from '../../engine/content/ContentSchemas';

export interface MissionFlavorContext {
  health?: number;
  maxHealth?: number;
  kills?: number;
  loadout?: string[];
  difficulty?: string;
  objectiveType?: 'elimination' | 'extraction' | 'defense' | 'capture';
}

export class MissionAgent {
  private readonly bus: EventBus;
  private currentMission: MissionContentPayload | null = null;
  private progress = 0;
  private timeElapsed = 0;
  private isComplete = false;
  private targetCount = 1;
  private updateTimer = 0;
  
  private disposers: (() => void)[] = [];

  constructor(bus: EventBus) {
    this.bus = bus;
    this.registerEvents();
  }

  private registerEvents(): void {
    this.disposers.push(
      this.bus.on<KillEvent>(GAME_EVENTS.KILL, (e) => {
        if (e.killerId === -1 && this.currentMission && !this.isComplete) {
          if (
            this.currentMission.objectiveType === 'elimination' ||
            this.currentMission.objectiveType === 'defense'
          ) {
            this.progress++;
            this.evaluateMission();
          }
        }
      }),
      this.bus.on<HealthStateEvent>(GAME_EVENTS.HEALTH, (e) => {
        if (e.health <= 0 && this.currentMission && !this.isComplete) {
          this.failMission('Player eliminated.');
        }
      })
    );
  }

  setMission(mission: MissionContentPayload): void {
    this.currentMission = mission;
    this.progress = 0;
    this.timeElapsed = 0;
    this.isComplete = false;
    this.targetCount = mission.targetCount || 10;
    this.updateTimer = 0;
    
    this.emitObjectiveUpdate();
  }

  getMission(): MissionContentPayload | null {
    return this.currentMission;
  }

  /**
   * T2.4: Player-context mission flavoring (R29.5).
   * Generates a mission tailored to low health (stealth/extraction)
   * or explosion-heavy loadout / high kills (convoy destruction).
   */
  generateFlavoredMission(context: MissionFlavorContext): MissionContentPayload {
    const isLowHealth =
      context.health !== undefined &&
      ((context.maxHealth !== undefined && context.health / context.maxHealth < 0.35) ||
        context.health < 35);

    if (isLowHealth) {
      return {
        objectiveType: 'extraction',
        title: 'Silent Extraction',
        briefing: 'Low health detected — avoid direct contact and reach extraction without alerting guards.',
        successCondition: 'Survive extraction timer.',
        failureCondition: 'Player is eliminated.',
        targetCount: 10,
      };
    }

    const isExplosiveLoadout =
      (context.loadout && context.loadout.some((item) => /rocket|grenade|explosive|c4|rpg/i.test(item))) ||
      (context.kills ?? 0) >= 15;

    if (isExplosiveLoadout) {
      return {
        objectiveType: 'elimination',
        title: 'Convoy Destruction',
        briefing: 'Heavy ordnance equipped — destroy the armored patrol convoy.',
        successCondition: 'Eliminate convoy targets.',
        failureCondition: 'Player is eliminated.',
        targetCount: 5,
      };
    }

    const type = context.objectiveType ?? 'defense';
    switch (type) {
      case 'elimination':
        return {
          objectiveType: 'elimination',
          title: 'Clear the Area',
          briefing: 'Eliminate all hostile forces in the sector.',
          successCondition: 'Eliminate target count of hostiles.',
          failureCondition: 'Player is eliminated.',
          targetCount: 10,
        };
      case 'extraction':
        return {
          objectiveType: 'extraction',
          title: 'Evacuate Sector',
          briefing: 'Survive and hold position until extraction arrives.',
          successCondition: 'Survive extraction timer.',
          failureCondition: 'Player is eliminated.',
          targetCount: 15,
        };
      case 'capture':
        return {
          objectiveType: 'capture',
          title: 'Secure Uplink',
          briefing: 'Hold and capture the tactical uplink zone.',
          successCondition: 'Capture target control points.',
          failureCondition: 'Player is eliminated.',
          targetCount: 10,
        };
      case 'defense':
      default:
        return {
          objectiveType: 'defense',
          title: 'Defend the Zone',
          briefing: 'Hold the line against incoming waves.',
          successCondition: 'Survive all waves.',
          failureCondition: 'Player is eliminated.',
          targetCount: 5,
        };
    }
  }

  update(deltaTime: number): void {
    if (!this.currentMission || this.isComplete) return;

    this.timeElapsed += deltaTime;
    this.updateTimer += deltaTime;
    
    if (this.currentMission.objectiveType === 'defense' || this.currentMission.objectiveType === 'extraction') {
      if (this.updateTimer >= 5) {
        this.updateTimer = 0;
        this.progress++;
      }
    } else if (this.currentMission.objectiveType === 'capture') {
      if (this.updateTimer >= 2) {
        this.updateTimer = 0;
        this.progress++;
      }
    }

    this.evaluateMission();
  }

  private evaluateMission(): void {
    if (!this.currentMission || this.isComplete) return;

    this.emitObjectiveUpdate();

    if (this.progress >= this.targetCount || (this.currentMission.objectiveType === 'extraction' && this.timeElapsed >= this.targetCount)) {
      this.succeedMission();
    }
  }

  private succeedMission(): void {
    if (!this.currentMission || this.isComplete) return;
    this.isComplete = true;
    this.bus.emit('ai.mission.complete', {
      outcome: 'success',
      elapsedTime: this.timeElapsed,
      mission: this.currentMission,
    });
  }

  private failMission(reason: string): void {
    if (!this.currentMission || this.isComplete) return;
    this.isComplete = true;
    this.bus.emit('ai.mission.complete', {
      outcome: 'failure',
      elapsedTime: this.timeElapsed,
      mission: this.currentMission,
      reason,
    });
  }

  private emitObjectiveUpdate(): void {
    if (!this.currentMission) return;
    
    const isWave = this.currentMission.objectiveType === 'defense';
    const current = Math.min(this.progress, this.targetCount);
    
    this.bus.emit<ObjectiveEvent>(GAME_EVENTS.OBJECTIVE, {
      text: this.currentMission.briefing || this.currentMission.title,
      progress: {
        current: isWave ? current + 1 : current,
        target: this.targetCount
      },
      isWave
    } as ObjectiveEvent & { isWave: boolean });
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}

