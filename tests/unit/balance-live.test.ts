import { BalanceAgent } from '../../src/modes/ai/BalanceAgent';
import { BalanceContentPayload } from '../../src/engine/content/ContentSchemas';

describe('BalanceAgent', () => {
  it('should generate default multipliers', () => {
    const agent = new BalanceAgent();
    agent.setDifficulty('normal');
    const mult = agent.getMultiplier('scout');
    expect(mult).not.toBeNull();
    expect(mult?.difficulty).toBe('normal');
  });

  it('should reject invalid payloads', () => {
    const agent = new BalanceAgent();
    const invalid: BalanceContentPayload = {
      difficulty: 'normal',
      enemyClass: 'scout',
      healthMultiplier: 999, // out of bounds
      speedMultiplier: 1,
      accuracyMultiplier: 1,
      reactionTimeMultiplier: 1
    };
    
    const result = agent.applyBalancePayload(invalid);
    expect(result).toBe(false);
  });

  it('should accept valid payloads', () => {
    const agent = new BalanceAgent();
    const valid: BalanceContentPayload = {
      difficulty: 'normal',
      enemyClass: 'scout',
      healthMultiplier: 1.05,
      speedMultiplier: 1.05,
      accuracyMultiplier: 0.6,
      reactionTimeMultiplier: 1.0
    };
    
    const result = agent.applyBalancePayload(valid);
    expect(result).toBe(true);
    expect(agent.getMultiplier('scout')?.healthMultiplier).toBe(1.05);
  });

  it('should interpolate balance multipliers over a 10s ramp when difficulty transitions non-immediately (R31.4)', () => {
    const agent = new BalanceAgent();
    agent.setDifficulty('normal', true);
    const initialHealth = agent.getMultiplier('scout')?.healthMultiplier ?? 1.0;

    agent.setDifficulty('hard', false);
    expect(agent.isTransitioning()).toBe(true);

    agent.update(5); // 5 seconds elapsed (half of 10s duration)
    const midHealth = agent.getMultiplier('scout')?.healthMultiplier ?? 1.0;
    expect(midHealth).toBeGreaterThan(initialHealth);

    agent.update(5); // 10 seconds total elapsed
    expect(agent.isTransitioning()).toBe(false);
    const finalHealth = agent.getMultiplier('scout')?.healthMultiplier ?? 1.0;
    expect(finalHealth).toBeGreaterThanOrEqual(midHealth);
    expect(agent.getMultiplier('scout')?.difficulty).toBe('hard');
  });
});
