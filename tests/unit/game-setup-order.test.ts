/**
 * game-setup-order.test.ts
 *
 * Regression test for a live-browser crash caught in verification:
 *
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'getSquads')
 *
 * Root cause: DemoGame.start() → showModeFlow() → enterMode() called
 * setupDirector() BEFORE initSystems() ran (initSystems is lazy — it only
 * runs on the first engine frame). setupDirector() constructed a
 * SquadCommander with an undefined `this.squads`, so every frame the
 * commander's update() → manager.getSquads() threw.
 *
 * Fix (locked in here): setupDirector() guards the squad-dependent creation
 * with `if (!this.squads) return;` and ensureSystemsInitialized() re-runs
 * setupDirector() right after initSystems() assigns this.squads. These tests
 * drive that exact ordering white-box against DemoGame to prevent regression.
 */

const docMock = (globalThis as any).document = {
  body: {},
  createElement: (tag: string) => ({
    tagName: tag.toUpperCase(),
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {},
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => {},
    getAttribute: () => null,
    isConnected: false,
    textContent: '',
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  exitPointerLock: () => {},
};
(globalThis as any).window = { devicePixelRatio: 1, location: { search: '' } };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

import * as THREE from 'three';
import { DemoGame } from '../../src/demo/Game';
import { EventBus } from '../../src/engine/events/EventBus';
import { SquadManager } from '../../src/ai/core/SquadManager';
import type { SquadCommander } from '../../src/modes/ai/SquadCommander';
import type { ReinforcementScheduler } from '../../src/modes/ai/ReinforcementScheduler';
import { GAME_EVENTS } from '../../src/gameplay/core/GameTypes';
import type { Difficulty, GameModeId } from '../../src/modes/GameMode';

/** White-box view of the private members the test drives. */
interface GameInternals {
  bus: EventBus;
  modeId: GameModeId | null;
  squads: SquadManager | undefined;
  difficulty: Difficulty;
  squadCommander: SquadCommander | null;
  reinforcementScheduler: ReinforcementScheduler | null;
  setupDirector(): void;
}

function makeGame(): GameInternals {
  // The constructor only stores config/container; all field initializers are
  // inert in Node (no WebGL/audio/localStorage at construction time).
  const game = new DemoGame({ container: {} as unknown as HTMLElement });
  return game as unknown as GameInternals;
}

describe('DemoGame setupDirector ordering (getSquads crash regression)', () => {
  it('does not build the SquadCommander when this.squads does not exist yet', () => {
    const g = makeGame();
    g.modeId = 'ai'; // enterMode('ai') happens before initSystems()

    // This is the exact crash site: pre-fix, setupDirector() captured an
    // undefined manager here and update() threw on getSquads() every frame.
    g.setupDirector();

    expect(g.squadCommander).toBeNull();
    expect(g.reinforcementScheduler).toBeNull();
  });

  it('builds the commander only after this.squads exists (the re-run path)', () => {
    const g = makeGame();
    g.modeId = 'ai';

    // First pass at mode entry: squads not yet assigned → guard returns.
    g.setupDirector();
    expect(g.squadCommander).toBeNull();

    // ensureSystemsInitialized() assigns squads, then re-runs setupDirector().
    g.squads = new SquadManager(g.bus);
    g.setupDirector();

    expect(g.squadCommander).not.toBeNull();
    expect(g.reinforcementScheduler).not.toBeNull();

    // The exact crash path: driving the commander's update must NOT throw —
    // getSquads() resolves against the real squad manager now.
    const playerPos = new THREE.Vector3(10, 1.5, 10);
    expect(() => g.squadCommander!.update(1.0, playerPos)).not.toThrow();
  });

  it('keeps Classic mode commander-free even after squads exist (R26.2)', () => {
    const g = makeGame();
    g.modeId = 'classic';
    g.squads = new SquadManager(g.bus); // squads DO exist here

    g.setupDirector();

    expect(g.squadCommander).toBeNull();
    expect(g.reinforcementScheduler).toBeNull();
  });

  it('registers the reinforce listener only once squads exist', () => {
    const g = makeGame();
    g.modeId = 'ai';

    // Before squads: setupDirector returns at the guard → no SQUAD listener.
    g.setupDirector();
    g.bus.emit(GAME_EVENTS.SQUAD, { type: 'reinforce', squadId: 1 });
    expect(g.reinforcementScheduler).toBeNull();

    // After squads + re-run: a reinforce order schedules a support squad.
    g.squads = new SquadManager(g.bus);
    g.setupDirector();
    g.bus.emit(GAME_EVENTS.SQUAD, { type: 'reinforce', squadId: 1 });
    expect(g.reinforcementScheduler!.length).toBe(1);
  });
});
