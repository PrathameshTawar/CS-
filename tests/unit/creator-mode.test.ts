import { CreatorMode } from '../../src/modes/creator/CreatorMode';
import { EventBus } from '../../src/engine/events/EventBus';

describe('CreatorMode', () => {
  let bus: EventBus;
  let mode: CreatorMode;

  beforeEach(() => {
    bus = new EventBus();
    mode = new CreatorMode(bus);
  });

  afterEach(() => {
    mode.dispose();
  });

  it('should initialize with id = "creator" and label = "Creator"', () => {
    expect(mode.id).toBe('creator');
    expect(mode.label).toBe('Creator');
  });

  it('should generate default world config and objective', async () => {
    const wc = await mode.nextWorldConfig({ difficulty: 'normal' });
    expect(wc.biome).toBe('city');
    expect(wc.difficulty).toBe('normal');

    const mission = await mode.nextMission(wc);
    expect(mission?.title).toBe('Creator Playground');
  });

  it('should parse and execute add entity commands', () => {
    let firedEvent: any = null;
    bus.on('creator.mutation', (e: any) => {
      firedEvent = e;
    });

    const mut = mode.parseAndExecuteCommand('add enemy sniper');
    expect(mut.action).toBe('add_entity');
    expect(mut.details).toContain('sniper');
    expect(firedEvent).toEqual({
      type: 'add_entity',
      entityType: 'enemy',
      enemyClass: 'sniper',
    });
    expect(mode.getMutationLog()).toHaveLength(1);
  });

  it('should parse and execute remove entity commands', () => {
    let firedEvent: any = null;
    bus.on('creator.mutation', (e: any) => {
      firedEvent = e;
    });

    const mut = mode.parseAndExecuteCommand('clear all enemies');
    expect(mut.action).toBe('remove_entity');
    expect(firedEvent).toEqual({
      type: 'remove_entity',
      target: 'enemies',
    });
  });

  it('should parse and execute time of day and weather world mutations', () => {
    let firedEvent: any = null;
    bus.on('creator.mutation', (e: any) => {
      firedEvent = e;
    });

    mode.parseAndExecuteCommand('make it night');
    expect(firedEvent).toEqual({
      type: 'mutate_world',
      mutation: { timeOfDay: 'night' },
    });

    mode.parseAndExecuteCommand('set weather storm');
    expect(firedEvent).toEqual({
      type: 'mutate_world',
      mutation: { weather: 'storm' },
    });
  });

  it('should parse difficulty and restyle commands', () => {
    let firedEvent: any = null;
    bus.on('creator.mutation', (e: any) => {
      firedEvent = e;
    });

    mode.parseAndExecuteCommand('make it harder hard');
    expect(firedEvent).toEqual({
      type: 'set_difficulty',
      difficulty: 'hard',
    });
    expect(mode.difficulty).toBe('hard');

    mode.parseAndExecuteCommand('replace zombies with robots');
    expect(firedEvent).toEqual({
      type: 'restyle',
      theme: 'replace zombies with robots',
    });
  });

  it('should track and clear mutation log', () => {
    mode.parseAndExecuteCommand('add enemy');
    mode.parseAndExecuteCommand('make it night');
    expect(mode.getMutationLog()).toHaveLength(2);

    mode.clearMutationLog();
    expect(mode.getMutationLog()).toHaveLength(0);
  });
});
