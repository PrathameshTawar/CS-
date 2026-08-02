# Design — AI-Native FPS Engine: Two-Mode Architecture

Status: Draft v0.1
Date: 2026-07-31
Scope: This document defines the architecture for the "STRIDE OPS" FPS engine prototype, structured as **two player-facing modes** (Classic / AI) built on **one shared engine core**. It is the design companion to `requirements.md` and `tasks.md`.

---

## 1. Vision

The project proves a thesis that is larger than "an AI can generate an FPS":

> **An AI can become the game engine itself — continuously creating, observing, and modifying the game while the player is inside it.**

### 1.1 The loop difference

| Traditional / Claude-of-Duty | AI-Native engine |
|---|---|
| prompt → generate → play → **done** | prompt → generate → play → **AI watches** → adapt → generate more → play → **forever** |

The AI is not a code-generation tool used before launch. It is a **game system** — like physics or enemy AI — that subscribes to the same event bus and runs every frame.

### 1.2 The three layers of "AI-native"

These are three separable capabilities with very different costs. The engine already ships Layer 1.

- **Layer 1 — Content on demand** (BUILT): `prompt → LLM → validated JSON → engine builds it`. Maps and weapons are done (`AIContentEngine`, `LLMProvider`, `ContentSchemas`).
- **Layer 2 — The Director** (BUILD): AI *observes* play and adapts mid-session. Runs on the existing `EventBus`.
- **Layer 3 — Persistent memory** (BUILD): The world remembers across sessions and feeds that memory back into generation.

---

## 2. Core architectural principle: two modes, one engine

**Classic Mode and AI Mode are not two games.** They are the same engine (renderer, physics, weapons, enemies, EventBus, audio, HUD, save system) with a different **content authority** — the component that decides what the world contains.

```
                    ┌──────────────────────────────────────────┐
                    │        THE ENGINE (100% shared)          │
                    │  Engine · EventBus · ECS · RenderModule  │
                    │  MapGenerator · WeaponSystem · AI (squad)│
                    │  AudioEngine · HUD · SaveManager         │
                    └──────────────────┬───────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
          ┌──────────┴──────────┐            ┌───────────┴──────────┐
          │ MODE 1 — CLASSIC    │            │ MODE 2 — AI          │
          │ Content authority:  │            │ Content authority:   │
          │ FIXED PRESETS       │            │ LLM + DIRECTOR       │
          └─────────────────────┘            └──────────────────────┘
          • Curated map rotation  • Deterministic, offline
          • Fixed weapon catalog  • Same experience every restart
          • Fixed difficulty      • Never calls the LLM
                                             |
                                             v
                              ┌──────────────────────────────┐
                              │  AI Orchestrator (Mode 2)    │
                              │  ┌───────────┐ ┌───────────┐ │
                              │  │ World     │ │ Director  │ │
                              │  │ Agent     │ │ Agent     │ │
                              │  ├───────────┤ ├───────────┤ │
                              │  │ Mission   │ │ Balance   │ │
                              │  │ Agent     │ │ Agent     │ │
                              │  └───────────┘ └───────────┘ │
                              │  Memory System (persists)    │
                              └──────────────────────────────┘
```

### 2.1 The GameMode abstraction

The engine core must never know which mode is running. A thin `GameMode` interface owns the differences:

```ts
interface GameMode {
  readonly id: 'classic' | 'ai';
  /** Produce the next world config. Classic: from rotation; AI: from LLM or prompt. */
  nextWorldConfig(context: SessionContext): Promise<WorldConfig>;
  /** Produce the active mission (or null for endless/arcade play). */
  nextMission(config: WorldConfig): Promise<MissionContentPayload | null>;
  /** Called every frame with live telemetry; returns adaptation commands. */
  update(dt: number, telemetry: TelemetryFrame): AdaptationCommand[];
  /** Mode teardown (unsubscribe event listeners, dispose modules). */
  dispose(): void;
}
```

Both modes mount the **same** engine modules (renderer, physics, weapons, enemy AI, audio, HUD). Only the orchestration layer differs.

---

## 3. Mode 1 — CLASSIC (fixed)

### 3.1 Goals
- A deterministic, replayable FPS that runs identically on every restart.
- Zero LLM involvement: `AIContentEngine` is never constructed.
- Fully offline-capable.

### 3.2 Content sources (all fixed)

| Content | Source |
|---|---|
| Map rotation | Hardcoded curated list of `{ biome, seed }` pairs across the 6 biomes (`MapGenerator` biomes: city, forest, snow, desert, dungeon, factory). Every seed fixed and vetted for playability. |
| Weapons | `WEAPON_CATALOG` only. No AI-generated weapons. |
| Difficulty | The three fixed presets already in `DIFFICULTY_TUNING` (easy/normal/hard). |
| Enemies | Standard `ENEMY_CLASSES` with difficulty multipliers only. No live rebalancing. |
| Missions | One fixed objective template per map (default: "Eliminate all hostiles"). |
| World memory | None. Save/load exists, but no cross-session narrative changes. |

### 3.3 Boot flow (Classic)

```
Boot → MODE SELECT (CLASSIC / AI)
         │ classic
         v
   Rotate next {biome, seed} → MapGenerator → build world → spawn enemies → play
         │
         └── round clear → advance to next rotation entry (or restart current)
```

### 3.4 Acceptance
- Same `{biome, seed}` always produces the identical world (already guaranteed by `MapGenerator` determinism).
- No network calls are made during a Classic session.
- If a page loads with `?mode=classic`, the AI panel and LLM key UI are not rendered.

---

## 4. Mode 2 — AI (living)

### 4.1 Goals
- The world is (re)generated from natural language or structured requests.
- An **AI Director** adapts difficulty, spawns, and events live during play.
- Missions, weapons, and balance are generated on demand and **actually applied** to gameplay.
- The world **remembers** prior sessions and generation history.

### 4.2 Boot flow (AI)

```
Boot → MODE SELECT (CLASSIC / AI)
         │ ai
         v
   "Describe your adventure" (free text, e.g. "snowy abandoned military base")
         │
         v
   World Agent: LLM → WorldConfig (biome · density · weather · buildings · mood)
         │  └─ validation vs schema (retry ×3 → procedural fallback)
         v
   Runtime World Builder: MapGenerator + weather/lighting mutation → scene
         │
         v
   Mission Agent: generate briefing + objective → HUD
         │
         v
   PLAY — Director Agent subscribes to EventBus telemetry, adapts every frame
         │
         ├── mid-session mission swaps · difficulty shifts · event triggers
         ├── "make it night" → lighting/weather mutation (no reload)
         └── session end → memory written to localStorage
```

### 4.3 The agents

All agents are lightweight modules that communicate through the `EventBus` with **structured JSON** — never free-form text. One conversation turn may fan out to several agents.

```
                    Master Orchestrator (AI mode runtime)
                       │
        ┌──────────────┼──────────────┬──────────────┐
   World Agent    Mission Agent   Balance Agent   Director Agent
        │              │               │               │
   MapGenerator    Objective FSM   Enemy tuning    EventBus telemetry
   Weather/Lights  HUD briefing    live re-apply   + Adaptation Commands
        │              │               │               │
        └──────────────┴───────┬───────┴───────────────┘
                               │
                         Memory System
                       (localStorage-backed)
```

#### 4.3.1 World Agent (BUILD — extends Layer 1)
- Input: free-text prompt (+ optional constraints from context, e.g. difficulty).
- Output: `WorldConfig` (see §6.2) — a superset of today's `MapContentPayload`.
- The LLM never sends meshes; it sends instructions the engine already knows how to build.

#### 4.3.2 Mission Agent (BUILD)
- Input: player context (health, kills, loadout, difficulty) or explicit user request.
- Output: `MissionContentPayload` — already defined; must now be **applied** to gameplay:
  - briefing → HUD objective banner + audio callout
  - `objectiveType` → objective state machine (elimination / extraction / defense / capture)
  - success/failure conditions → win/lose evaluation each frame
- Mid-session missions: when the Director triggers "player is bored" → swap objective without a world rebuild.

#### 4.3.3 Balance Agent (BUILD)
- Input: difficulty + current player performance.
- Output: `BalanceContentPayload` — already defined, validated against `BALANCE_ENVELOPE`.
- **Application**: live `enemy.health/speed/accuracy` multipliers on existing + future spawns. Must not mutate the base `ENEMY_CLASSES` constants (use a per-session multiplier object consulted at spawn time).

#### 4.3.4 Director Agent (BUILD — the heart of AI mode)
- Input: **telemetry** — a normalized, cheaply-collected view of play.
- Output: **adaptation commands** — typed commands the runtime executes.

Telemetry sources — all derived from events already emitted on the EventBus
(`GAME_EVENTS` constants in `src/gameplay/core/GameTypes.ts`):

| Real event (`GAME_EVENTS.*`) | Telemetry derived |
|---|---|
| `DAMAGE` (target === 'player') + `HEALTH` | health, armor, damage rate |
| `KILL` (killerId === -1) | kills, kill streak; accuracy = hits (`HIT_MARKER`) ÷ shots (`WEAPON_FIRED`) |
| `WEAPON_FIRED` | weapon usage, fire rate; ammo burn via `AMMO` |
| `SOUND` (type 'footstep') | movement activity, hidden vs. aggressive play style |
| `OBJECTIVE` | mission progress, time spent idle (no `SOUND`+no `WEAPON_FIRED` for >45 s) |

Note: there is **no dedicated death event** today — death is detected inside the
`DAMAGE` handler via `player.state.dead`. The Director should derive deaths/time-to-death
from that same path (or emit a new `ai.player.died` event during Mode 2 wiring).

Adaptation commands (typed, validated):

```ts
type AdaptationCommand =
  | { kind: 'spawn_enemies'; count: number; classes: EnemyClassId[]; urgency: 0..1 }
  | { kind: 'adjust_difficulty'; difficulty: Difficulty; ramp: 'ease' | 'jump' }
  | { kind: 'set_mission'; mission: MissionContentPayload }
  | { kind: 'world_mutation'; mutation: WorldMutation }   // e.g. weather, time-of-day
  | { kind: 'event_trigger'; event: 'explosion' | 'ambush' | 'airdrop' | 'power_outage' }
  | { kind: 'grant_content'; content: 'weapon' | 'medkit' | 'ammo' }
```

Rules are a small, interpretable rule table (deterministic + probability-weighted), not a free-form LLM conversation. The LLM is used for **content**, the rule table for **reaction** (guaranteed ≤1-frame decision latency, no network round-trip in the hot path).

Example rule rows:

```
if health < 25% for > 8s                        → grant_content medkit (probability 0.8)
if killStreak >= 8 and difficulty != hard       → adjust_difficulty(hard, 'ease')
if accuracy < 0.15 and kills > 0                → set_mission stealth_lite / spawn fewer scouts
if idle (no movement, no fire) > 45s            → event_trigger(explosion near player) to flush them out
if playerKills >= targetCount of current mission → set_mission next (escalate objective type)
```

#### 4.3.5 Squad Commander (BUILD — extension of existing `SquadManager`)
- Today: squads exist and coordinate contact/suppression/flank basics.
- New: a commander brain per squad issuing orders (`flank`, `retreat`, `ambush`, `hold`, `search`, `reinforce`) via the existing squad communication path. The commander decisions can be rule-driven with LLM flavor injection ("call reinforcements" → Director spawns a support squad).

#### 4.3.6 Memory System (BUILD)
- Persist, per save slot (`SaveManager` already has slots + `gameMode` field):
  - structured session log (kills, deaths, missions completed, world state, key events like "warlord killed")
  - the AI content history (already persisted via `LocalStorageContentStorage`)
- On session start, memory is summarized (bounded token budget) and injected into the World/Mission Agent prompts:
  `"Since last session the player killed the warlord. Continue the campaign."`
- No backend: localStorage only (bounded size, e.g. cap memory at 64KB; oldest entries evicted first).

---

## 5. The shared engine core (unchanged)

"Shared" means **code is available to both modes** — it does NOT mean Classic mode
constructs or activates AI modules. Classic never instantiates `AIContentEngine` or any
LLM provider (R26.2); AI mode is the only active user of Layer 1.

The following systems are mode-agnostic and must NOT gain mode-specific branches:

- `Engine` (module lifecycle, fixed/variable timestep, profiler)
- `EventBus` (typed events, priority listeners — the spine of the Director)
- `ECSWorld`, `StateManager`, `ConfigManager`
- `RenderModule` / `Renderer` / `RenderPipeline` (HDR, CSM, Bloom, TAA, volumetric fog)
- `MapGenerator` (+ `NavGrid`, deterministic seeds)
- `PlayerController` (movement, vault/mantle/wall-run)
- `WeaponSystem` / `WeaponCatalog` / `Attachments` / `PenetrationTable`
- `EnemyController` / `SquadManager` / `AINavigator` / `PerceptionSystem` / `EnemyClasses`
- `GrenadeSystem` / `AbilitySystem` / `TracerSystem` / `ParticleSystem` / `MuzzleFlash` / `CameraShake` / `VolumetricLightEffect`
- `AudioEngine` / `MusicSystem` / `HUD`
- `SaveManager` / `Serializer`
- `AIContentEngine` / `LLMProvider` / `ContentSchemas` (Layer 1 — already shared)

**New modules (Mode 2 only):**

```
src/
  modes/
    GameMode.ts            # interface + shared types (WorldConfig, TelemetryFrame, AdaptationCommand)
    classic/ClassicMode.ts
    ai/AIMode.ts
    ai/WorldAgent.ts
    ai/MissionAgent.ts
    ai/BalanceAgent.ts
    ai/DirectorAgent.ts
    ai/MemorySystem.ts
    ai/WorldMutator.ts     # weather / time-of-day / lighting application
    ai/SquadCommander.ts
  gameplay/pickups/
    PickupSystem.ts        # medkit/ammo pickups spawnable by the Director (grant_content)
  ui/modes/ModeSelect.ts   # CLASSIC / AI boot screen
```

## 5.1 Explicitly out of scope (this spec)

The original vision also mentions NPC/Story, Economy, and Audio agents, and Creator Mode.
Those are conscious omissions here, not oversights:

- **NPC/Story agents** (backstories, dialogue, relationships) — future work; the memory
  system (R32) is the prerequisite they would build on.
- **Economy agent** — requires a persistent progression system that does not exist yet.
- **Audio/Animation/UI agents** — procedural audio already exists (`AudioEngine`); an
  LLM-driven variant is unnecessary for the two-mode milestone.
- **Creator Mode** — deferred to P5 (R34).

This spec deliberately builds the smallest set of agents that proves the thesis: World,
Mission, Balance, Director, Memory.

---

## 6. Data contracts

### 6.1 Existing (unchanged, reused)
`MapContentPayload`, `WeaponContentPayload`, `MissionContentPayload`, `BalanceContentPayload` + their validators in `ContentSchemas.ts`. `LLMProvider` interface + `OpenAICompatibleProvider` (OpenRouter preset already present) + `ProceduralFallbackProvider`.

### 6.2 New: `WorldConfig` (extends map payload)

```ts
interface WorldConfig {
  seed: number;                       // 0..2^32-1
  biome: Biome;                       // existing 6 biomes
  density: number;                    // 0..1
  weather: 'clear' | 'storm' | 'fog' | 'snow' | 'ash';   // NEW
  timeOfDay: 'day' | 'dusk' | 'night';                   // NEW
  mood: string;                       // free text for HUD/briefing flavor ("abandoned", "festive")
  buildings: number;                  // NEW: block count hint (mapped into density)
  roads: number;                      // NEW: decorative road count (visual only)
  enemyCamps: number;                 // NEW: spawn cluster hint
  difficulty: 'easy' | 'normal' | 'hard';
  coverZones: number;                 // existing
  elevatedPositions: number;          // existing
}
```

Validation: extend `validateMapPayload` (or add `validateWorldConfig`) with the same retry ×3 → fallback pattern.

### 6.3 New: `WorldMutation`

```ts
interface WorldMutation {
  weather?: WorldConfig['weather'];
  timeOfDay?: WorldConfig['timeOfDay'];
  sunColor?: string;        // hex
  fogDensity?: number;
  ambientColor?: string;    // hex
  rainIntensity?: number;   // 0..1
}
```

Applied by `WorldMutator` without a world rebuild:
- `timeOfDay: 'night'` → skybox/fog colors, sun intensity, hemisphere light, volumetric god-ray screen position/intensity
- `weather: 'storm'` → fog density, rain particle rate, audio ambience
- Uses the existing `VolumetricLightEffect.setFogColor/setFogDensity` and re-colors `worldLights` — the exact hooks `Game.ts` already maintains in `buildMap()`/`rebuildWorld()`.

---

## 7. Event contract for the Director

New events emitted by Mode 2 orchestration (namespace: `ai.*`):

| Event | Payload |
|---|---|
| `ai.director.telemetry` | `TelemetryFrame` (aggregated once per second, not per frame) |
| `ai.director.command` | `AdaptationCommand` |
| `ai.mission.active` | `{ mission: MissionContentPayload }` |
| `ai.mission.complete` | `{ mission, outcome: 'success' \| 'failure', timeMs }` |
| `ai.world.mutation` | `WorldMutation` |
| `ai.memory.changed` | `{ summary: string }` |

Telemetry aggregation: **once per second** (not per frame) to keep the Director cheap; rules read the aggregated frame.

---

## 8. Failure & degradation policy (already partly built)

1. LLM unreachable / invalid JSON / schema failure → retry ×3 (`AIContentEngine`), then `ProceduralFallbackProvider`.
2. No API key present in AI mode → AI mode still playable with procedural content + Director rules active. Prompt field still accepts text; the fallback interprets keywords (biome/snow/desert/difficulty keywords → nearest config).
3. Director never blocks the render loop: adaptation commands are executed on the next `fixedUpdate`, rules are O(rule-count) per second.
4. Memory write failures (private mode / quota) are silently ignored (already the pattern in `LocalStorageContentStorage`).
5. OpenRouter CORS: fetch from browser to `https://openrouter.ai/api/v1/chat/completions` — verified working pattern in the current demo; keep `useJsonMode` disabled if a provider rejects `response_format`.

---

## 9. Performance & latency budget

| Constraint | Budget |
|---|---|
| LLM world generation → world playable | ≤ 10 s (requirement already in R21) |
| Director decision latency | ≤ 1 frame (rules are local; zero network in hot path) |
| Telemetry aggregation | 1 Hz |
| Memory size cap | 64 KB localStorage |
| Classic mode additional startup cost | 0 (no AI code path touched) |

---

## 10. Roadmap (phases)

| Phase | Scope | Key requirements |
|---|---|---|
| **P0** | Two-mode shell: `ModeSelect` boot screen, `GameMode` interface, Classic mode = curated map rotation + fixed content, AI mode = current AI panel gated behind mode | R26, R27 |
| **P1** | AI Director: telemetry aggregation + rule table + adaptation commands (spawns, difficulty, events, mission swaps) | R28 |
| **P2** | Missions + balance actually applied (objective FSM, HUD briefing, live balance application) | R29, R31 |
| **P3** | Prompt-to-world + `WorldMutator` (weather/time-of-day) + free-text prompt parsing incl. keyword fallback | R30 |
| **P4** | Memory system + squad commander orders | R32, R33 |
| **P5** | Creator Mode (natural-language level editor) — deferred until P1–P3 land | R34 |

Each phase keeps Classic mode 100% untouched and regression-safe (all Classic tests must pass after every phase).

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LLM latency ruins the "AI feels alive" moment | Generation happens on the boot screen / pause menu with visible progress ("Generating world…"), never in the hot path |
| OpenRouter rate limits / downtime | Retry ×3 → procedural fallback; key field supports any OpenAI-compatible endpoint |
| Director makes the game unfair/frustrating | All rules respect hard caps (spawn counts, difficulty ceiling per biome); difficulty ramps 'ease' over ≥10 s |
| localStorage memory grows unbounded | 64 KB cap, oldest-first eviction, clear button (already exists for content history) |
| Two-mode code forks and drifts | Both modes share every engine module; only `GameMode` orchestration differs; CI runs Classic tests + AI smoke tests |
