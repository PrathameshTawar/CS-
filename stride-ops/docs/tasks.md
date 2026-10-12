# Tasks — Two-Mode AI-Native Engine

Build plan for the two-mode architecture (Classic / AI). Each task references the
relevant requirements (R# = `requirements.md` Part 2 unless noted) and the
architecture in `design.md`.

Legend: `[ ]` = not started · `[~]` = in progress · `[x]` = done

---

## Phase 0 — Two-Mode Shell (R26, R27)

**Goal: player picks CLASSIC or AI at launch; Classic becomes a fully deterministic, offline, fixed-content mode.**

- [x] **T0.1** Create `src/modes/GameMode.ts` — `GameMode` interface + shared types
      (`WorldConfig`, `TelemetryFrame`, `AdaptationCommand`, `WorldMutation`) per design §2.1/§6.
- [x] **T0.2** Create `src/modes/classic/ClassicMode.ts` —
      curated `{biome, seed}` rotation (6 biomes × 2 seeds), fixed weapon
      catalog, fixed difficulty, fixed "Eliminate all hostiles" objective, no LLM construction.
- [x] **T0.3** Create `src/ui/modes/ModeSelect.ts` — full-screen CLASSIC / AI boot screen
      with keyboard + click selection; supports `?mode=classic|ai` query-param fast boot (R26.5).
- [x] **T0.4** Refactor `DemoGame` so engine/module construction is mode-agnostic and the
      mode owns only world-config + objective orchestration (R26.4). No mode branches in
      renderer/physics/weapons/AI/audio/HUD.
- [x] **T0.5** Gate the AI content panel (provider, API key, generate buttons, history) behind
      AI mode only; Classic mode renders no AI UI (R26.2, R27.5).
- [x] **T0.6** Round-clear in Classic advances the rotation (R27.4). Same `{biome, seed}`
      produces identical world (already guaranteed by `MapGenerator` determinism — verified in tests).

**Definition of done (P0):** boot → mode select → play in either mode; Classic makes zero
network calls; `npm test` green.

---

## Phase 1 — AI Director (R28)

**Goal: AI watches play and adapts live. Runs entirely on the existing `EventBus`.**

- [x] **T1.1** `src/modes/ai/DirectorAgent.ts` — subscribes to existing events
      (`GAME_EVENTS.HEALTH`, `KILL`, `WEAPON_FIRED`, `HIT_MARKER`, `SOUND`, `OBJECTIVE`),
      aggregates into a `TelemetryFrame` at 1 Hz (R28.2).
- [x] **T1.2** Rule table engine — interpretable rows (condition → command + probability),
      evaluated once per second, local + deterministic; decision latency ≤ 1 frame (R28.3).
- [x] **T1.3** Adaptation commands: `spawn_enemies`, `adjust_difficulty`, `set_mission`,
      `world_mutation`, `event_trigger`, `grant_content` — typed + validated (R28.3).
- [x] **T1.4** Baseline rules: low-health medkit (R28.4), kill-streak ramp (R28.5),
      idle flush-out (R28.6), per-biome caps (R28.7).
- [x] **T1.5** Wire commands into gameplay: spawn enemies at map spawn points, apply
      difficulty tuning, swap missions, trigger nearby explosion events.
- [x] **T1.6** NEW `src/gameplay/pickups/PickupSystem.ts` — simple medkit/ammo pickup
      entities (spawn point + pickup radius + HUD hint) so `grant_content(medkit|ammo)`
      from the Director has something to spawn (R28.4).

**Definition of done (P1):** playing AI mode long enough triggers each baseline rule at
least once; rules never spam commands (rate-limited); Classic mode unaffected.

---

## Phase 2 — Missions & Balance Applied (R29, R31)

**Goal: generated missions and balance actually change gameplay, not just display.**

- [x] **T2.1** `src/modes/ai/MissionAgent.ts` — objective state machine for
      elimination/extraction/defense/capture (R29.2); success/failure evaluated each frame.
- [x] **T2.2** Apply mission briefing to HUD objective banner + audio callout (R29.1);
      emit `ai.mission.complete` with outcome + elapsed time (R29.3).
- [x] **T2.3** Mid-session `set_mission` swaps the objective without rebuilding the world (R29.4).
- [x] **T2.4** Player-context mission flavoring — low health → stealth-flavored objective;
      explosion-heavy loadout → convoy/destruction objective (R29.5).
- [x] **T2.5** `src/modes/ai/BalanceAgent.ts` — produce `BalanceContentPayload` validated
      against `BALANCE_ENVELOPE` (R31.1).
- [x] **T2.6** Live application: per-session multiplier set consulted at spawn time + applied
      to living enemies; base `ENEMY_CLASSES` never mutated (R31.2–R31.3).
- [x] **T2.7** Difficulty-change re-balance within 2 s, ramped over ≥10 s (R31.4).

**Definition of done (P2):** a generated "defense" mission can be failed/succeeded with
correct HUD state; difficulty change visibly re-scales enemies mid-session.

---

## Phase 3 — Prompt-to-World & World Mutation (R30)

**Goal: "snowy abandoned military base" builds the world; "make it night" mutates it live.**

- [x] **T3.1** Extend `ContentSchemas` with `WorldConfig` (seed, biome, density, weather,
      timeOfDay, mood, buildings, roads, enemyCamps, difficulty) + `validateWorldConfig`
      (R30.1–R30.2); keep backward compatibility with `MapContentPayload`.
- [x] **T3.2** `src/modes/ai/WorldAgent.ts` — free-text prompt → LLM (`WorldConfig`) with
      retry ×3 → `ProceduralFallbackProvider` (R30.2).
- [x] **T3.3** Keyword fallback when no API key: map "snow"/"desert"/"night"/difficulty words
      to nearest config (R30.3).
- [x] **T3.4** `src/modes/ai/WorldMutator.ts` — in-place fog/sun/hemisphere/ambient/volumetric
      updates for weather + time-of-day; no world rebuild, no reload (R30.4–R30.5). Reuse the
      light/fog handles `Game.ts` already maintains (`worldLights`, `volumetric`).
- [x] **T3.5** Storm weather: add a NEW `rain` emitter to `ParticleSystem` (no rain
      `ParticleKind` exists today — smoke/dust/blood/sparks/explosions only) + storm
      ambience (`AudioEngine`) (R30.6).
- [x] **T3.6** AI-mode start screen gains the "Describe your adventure" prompt input with
      visible "Generating world…" progress (design §11 risk mitigation).

**Definition of done (P3):** typing a snow/desert prompt produces a matching world; issuing
"make it night" changes lighting/fog/volumetrics in-place while playing.

---

## Phase 4 — Memory & Squad Commander (R32, R33)

**Goal: the world remembers sessions; squads act on commander orders.**

- [x] **T4.1** `src/modes/ai/MemorySystem.ts` — structured per-slot session log
      (kills, deaths, missions, world state, key events) via localStorage, 64 KB cap,
      oldest-first eviction (R32.1).
- [x] **T4.2** Session-start summary (bounded tokens) injected into World/Mission prompts (R32.2).
- [x] **T4.3** Link memory to existing content history log — recalled maps/weapons re-appliable (R32.3).
- [x] **T4.4** Graceful degradation when localStorage unavailable (R32.4).
- [x] **T4.5** `src/modes/ai/SquadCommander.ts` — commander brain per squad issuing
      flank/retreat/ambush/hold/search/reinforce through `SquadManager` (R33.1–R33.2),
      order refresh ≤1 s (R33.4).
- [x] **T4.6** Call-reinforcements → Director spawns support squad after 8 s delay,
      respecting the spawn cap (R33.3).

**Definition of done (P4):** killing the "warlord" in session 1 changes session 2's briefing;
squads visibly flank/retreat and can call reinforcements.

---

## Phase 5 — Creator Mode (R34, COMPLETE)

- [x] **T5.1** Third mode: natural-language level editor (chat-style panel + mutation log).
- [x] **T5.2** Incremental mutations (add/remove/restyle entities) without session restart.
- [x] **T5.3** Only start once P1–P3 are done (R34.1).

---

## Cross-cutting

- [x] **Tests** — one test file per new module under `tests/unit/`:
      `mode-select` (routing), `classic-rotation` (determinism), `director-rules`
      (each baseline rule fires given synthetic telemetry), `mission-fsm`
      (each objective type success/failure), `balance-live` (multipliers applied,
      base classes unmutated), `world-config-validation`, `world-mutator`,
      `world-agent`, `memory-cap`.
- [x] **Regression gate** — Classic-mode tests + demo smoke test must pass after every phase.
- [x] **Docs** — update this file's checkboxes as phases complete.

---

## Suggested build order note

P0 → P1 → P2 → P3 → P4 gives the best "wow per line": the shell makes modes real,
the Director makes the game feel alive, and missions/balance/world-mutation make the
generated content *matter*. Creator Mode (P5) becomes cheap afterward because it reuses
the World Agent + WorldMutator pipeline.
