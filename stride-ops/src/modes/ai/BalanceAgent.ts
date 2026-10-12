import { BalanceContentPayload, BALANCE_ENVELOPE, validateBalancePayload } from '../../engine/content/ContentSchemas';
import { EnemyClassId, ENEMY_CLASSES } from '../../ai/classes/EnemyClasses';

export class BalanceAgent {
  private currentMultiplierSet: Record<EnemyClassId, BalanceContentPayload> | null = null;
  private fromMultiplierSet: Record<EnemyClassId, BalanceContentPayload> | null = null;
  private targetMultiplierSet: Record<EnemyClassId, BalanceContentPayload> | null = null;
  private currentDifficulty: string = 'normal';

  private transitioning = false;
  private transitionTime = 0;
  private readonly transitionDuration = 10; // ≥10 s ramp (R31.4)

  constructor() {
    this.currentMultiplierSet = this.generateDefaultMultipliers('normal');
  }

  private generateDefaultMultipliers(difficulty: string): Record<EnemyClassId, BalanceContentPayload> {
    const env = BALANCE_ENVELOPE[difficulty] || BALANCE_ENVELOPE['normal'];
    const multipliers: any = {};
    
    const baseHealth = (env.health[0] + env.health[1]) / 2;
    const baseSpeed = (env.speed[0] + env.speed[1]) / 2;
    const baseAccuracy = (env.accuracy[0] + env.accuracy[1]) / 2;

    const classIds = Object.keys(ENEMY_CLASSES) as EnemyClassId[];
    for (const id of classIds) {
      multipliers[id] = {
        difficulty,
        enemyClass: id,
        healthMultiplier: baseHealth,
        speedMultiplier: baseSpeed,
        accuracyMultiplier: baseAccuracy,
        reactionTimeMultiplier: 1.0,
      };
    }
    
    return multipliers;
  }

  setDifficulty(difficulty: 'easy' | 'normal' | 'hard', immediate = true): void {
    if (this.currentDifficulty === difficulty && !this.transitioning) return;

    if (immediate || !this.currentMultiplierSet) {
      this.currentDifficulty = difficulty;
      this.currentMultiplierSet = this.generateDefaultMultipliers(difficulty);
      this.targetMultiplierSet = null;
      this.fromMultiplierSet = null;
      this.transitioning = false;
      return;
    }

    this.fromMultiplierSet = JSON.parse(JSON.stringify(this.currentMultiplierSet));
    this.targetMultiplierSet = this.generateDefaultMultipliers(difficulty);
    this.currentDifficulty = difficulty;
    this.transitionTime = 0;
    this.transitioning = true;
  }

  update(deltaTime: number): void {
    if (!this.transitioning || !this.targetMultiplierSet || !this.fromMultiplierSet || !this.currentMultiplierSet) {
      return;
    }

    this.transitionTime += deltaTime;
    const alpha = Math.min(1, this.transitionTime / this.transitionDuration);

    const classIds = Object.keys(ENEMY_CLASSES) as EnemyClassId[];
    for (const id of classIds) {
      const from = this.fromMultiplierSet[id];
      const target = this.targetMultiplierSet[id];
      const current = this.currentMultiplierSet[id];
      if (!from || !target || !current) continue;

      current.healthMultiplier = from.healthMultiplier + (target.healthMultiplier - from.healthMultiplier) * alpha;
      current.speedMultiplier = from.speedMultiplier + (target.speedMultiplier - from.speedMultiplier) * alpha;
      current.accuracyMultiplier = from.accuracyMultiplier + (target.accuracyMultiplier - from.accuracyMultiplier) * alpha;
      current.reactionTimeMultiplier = from.reactionTimeMultiplier + (target.reactionTimeMultiplier - from.reactionTimeMultiplier) * alpha;
      current.difficulty = this.currentDifficulty;
    }

    if (alpha >= 1) {
      this.transitioning = false;
      this.currentMultiplierSet = this.targetMultiplierSet;
      this.targetMultiplierSet = null;
      this.fromMultiplierSet = null;
    }
  }

  isTransitioning(): boolean {
    return this.transitioning;
  }

  applyBalancePayload(payload: BalanceContentPayload): boolean {
    const validationError = validateBalancePayload(payload);
    if (validationError) {
      console.warn(`[BalanceAgent] Invalid balance payload: ${validationError}`);
      return false;
    }

    if (!this.currentMultiplierSet) {
      this.currentMultiplierSet = this.generateDefaultMultipliers(this.currentDifficulty);
    }
    
    if (this.currentMultiplierSet[payload.enemyClass as EnemyClassId]) {
      this.currentMultiplierSet[payload.enemyClass as EnemyClassId] = { ...payload };
      return true;
    }
    
    return false;
  }

  getMultiplier(classId: EnemyClassId): BalanceContentPayload | null {
    if (!this.currentMultiplierSet) return null;
    return this.currentMultiplierSet[classId] || null;
  }
}

