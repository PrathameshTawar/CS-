import { BalanceContentPayload } from '../../engine/content/ContentSchemas';
import { EnemyClassId } from '../../ai/classes/EnemyClasses';
export declare class BalanceAgent {
    private currentMultiplierSet;
    private fromMultiplierSet;
    private targetMultiplierSet;
    private currentDifficulty;
    private transitioning;
    private transitionTime;
    private readonly transitionDuration;
    constructor();
    private generateDefaultMultipliers;
    setDifficulty(difficulty: 'easy' | 'normal' | 'hard', immediate?: boolean): void;
    update(deltaTime: number): void;
    isTransitioning(): boolean;
    applyBalancePayload(payload: BalanceContentPayload): boolean;
    getMultiplier(classId: EnemyClassId): BalanceContentPayload | null;
}
//# sourceMappingURL=BalanceAgent.d.ts.map