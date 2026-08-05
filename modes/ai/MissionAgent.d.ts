import { EventBus } from '../../engine/events/EventBus';
import { MissionContentPayload } from '../../engine/content/ContentSchemas';
export interface MissionFlavorContext {
    health?: number;
    maxHealth?: number;
    kills?: number;
    loadout?: string[];
    difficulty?: string;
    objectiveType?: 'elimination' | 'extraction' | 'defense' | 'capture';
}
export declare class MissionAgent {
    private readonly bus;
    private currentMission;
    private progress;
    private timeElapsed;
    private isComplete;
    private targetCount;
    private updateTimer;
    private disposers;
    constructor(bus: EventBus);
    private registerEvents;
    setMission(mission: MissionContentPayload): void;
    getMission(): MissionContentPayload | null;
    /**
     * T2.4: Player-context mission flavoring (R29.5).
     * Generates a mission tailored to low health (stealth/extraction)
     * or explosion-heavy loadout / high kills (convoy destruction).
     */
    generateFlavoredMission(context: MissionFlavorContext): MissionContentPayload;
    update(deltaTime: number): void;
    private evaluateMission;
    private succeedMission;
    private failMission;
    private emitObjectiveUpdate;
    dispose(): void;
}
//# sourceMappingURL=MissionAgent.d.ts.map