import { MissionAgent } from '../../src/modes/ai/MissionAgent';
import { EventBus } from '../../src/engine/events/EventBus';
import { GAME_EVENTS, KillEvent, HealthStateEvent, ObjectiveEvent } from '../../src/gameplay/core/GameTypes';
import { MissionContentPayload } from '../../src/engine/content/ContentSchemas';

describe('MissionAgent', () => {
  let bus: EventBus;
  let agent: MissionAgent;

  beforeEach(() => {
    bus = new EventBus();
    agent = new MissionAgent(bus);
  });

  afterEach(() => {
    agent.dispose();
  });

  it('should initialize and hold no mission by default', () => {
    expect(agent.getMission()).toBeNull();
  });

  it('should evaluate elimination mission on kills', () => {
    const mission: MissionContentPayload = {
      objectiveType: 'elimination',
      title: 'Clear',
      briefing: 'Eliminate hostiles',
      successCondition: 'none',
      failureCondition: 'none',
      targetCount: 2
    };

    let completeFired = false;
    let outcome = '';
    bus.on('ai.mission.complete', (e: any) => {
      completeFired = true;
      outcome = e.outcome;
    });

    agent.setMission(mission);
    
    bus.emit<KillEvent>(GAME_EVENTS.KILL, {
      victimId: 2,
      killerId: -1,
      victimName: 'Enemy',
      killerName: 'Player',
      headshot: false,
      worldPosition: { x: 0, y: 0, z: 0 }
    });
    expect(completeFired).toBe(false);

    bus.emit<KillEvent>(GAME_EVENTS.KILL, {
      victimId: 3,
      killerId: -1,
      victimName: 'Enemy',
      killerName: 'Player',
      headshot: false,
      worldPosition: { x: 0, y: 0, z: 0 }
    });
    
    expect(completeFired).toBe(true);
    expect(outcome).toBe('success');
  });

  it('should evaluate extraction mission on time elapsed', () => {
    const mission: MissionContentPayload = {
      objectiveType: 'extraction',
      title: 'Extract',
      briefing: 'Survive until extraction',
      successCondition: 'none',
      failureCondition: 'none',
      targetCount: 10
    };

    let completeFired = false;
    let outcome = '';
    bus.on('ai.mission.complete', (e: any) => {
      completeFired = true;
      outcome = e.outcome;
    });

    agent.setMission(mission);
    agent.update(5);
    expect(completeFired).toBe(false);
    agent.update(5);
    expect(completeFired).toBe(true);
    expect(outcome).toBe('success');
  });

  it('should emit failure outcome when player dies', () => {
    const mission: MissionContentPayload = {
      objectiveType: 'defense',
      title: 'Defend',
      briefing: 'Hold line',
      successCondition: 'none',
      failureCondition: 'none',
      targetCount: 5
    };

    let completeFired = false;
    let outcome = '';
    let reason = '';
    bus.on('ai.mission.complete', (e: any) => {
      completeFired = true;
      outcome = e.outcome;
      reason = e.reason;
    });

    agent.setMission(mission);

    bus.emit<HealthStateEvent>(GAME_EVENTS.HEALTH, {
      health: 0,
      maxHealth: 100,
      armor: 0,
      maxArmor: 100
    });

    expect(completeFired).toBe(true);
    expect(outcome).toBe('failure');
    expect(reason).toContain('Player eliminated');
  });

  it('should support mid-session mission swaps without losing bus connection', () => {
    const m1: MissionContentPayload = {
      objectiveType: 'elimination',
      title: 'Clear',
      briefing: 'First objective',
      successCondition: 'none',
      failureCondition: 'none',
      targetCount: 5
    };
    const m2: MissionContentPayload = {
      objectiveType: 'capture',
      title: 'Secure',
      briefing: 'Swapped objective',
      successCondition: 'none',
      failureCondition: 'none',
      targetCount: 2
    };

    let objectiveText = '';
    bus.on<ObjectiveEvent>(GAME_EVENTS.OBJECTIVE, (e) => {
      objectiveText = e.text;
    });

    agent.setMission(m1);
    expect(objectiveText).toBe('First objective');

    agent.setMission(m2);
    expect(agent.getMission()?.title).toBe('Secure');
    expect(objectiveText).toBe('Swapped objective');
  });

  it('should generate flavored missions based on player context (low health -> stealth, explosion loadout -> convoy)', () => {
    const stealthMission = agent.generateFlavoredMission({
      health: 20,
      maxHealth: 100,
      objectiveType: 'elimination'
    });
    expect(stealthMission.objectiveType).toBe('extraction');
    expect(stealthMission.title).toBe('Silent Extraction');

    const convoyMission = agent.generateFlavoredMission({
      health: 100,
      maxHealth: 100,
      loadout: ['rifle', 'rpg_launcher', 'grenade']
    });
    expect(convoyMission.objectiveType).toBe('elimination');
    expect(convoyMission.title).toBe('Convoy Destruction');
  });
});
