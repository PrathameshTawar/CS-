# STRIDE OPS — AI-Native FPS Engine

> **A browser-based, AI-native first-person shooter engine built on Three.js.**
> Features a two-mode architecture: **CLASSIC** (deterministic, offline) and **AI** (generated, adaptive, persistent).

[![Tests](https://img.shields.io/badge/tests-186%20passing-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r162-lightgrey)](https://threejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

---

## Architecture Overview

STRIDE OPS is built on a **two-mode, one-engine** architecture. The engine core (renderer, physics, weapons, enemies, audio, HUD) is 100% shared between modes. The only difference is the **content authority** — the component that decides what the world contains.

```
┌──────────────────────────────────────────────────────┐
│                 THE ENGINE (100% shared)              │
│  Engine · EventBus · ECS · RenderModule · MapGenerator│
│  WeaponSystem · AI (squad) · AudioEngine · HUD       │
└───────────────────────┬──────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │                           │
┌─────────┴──────────┐     ┌──────────┴──────────┐
│ MODE 1 — CLASSIC   │     │ MODE 2 — AI          │
│ Content authority:  │     │ Content authority:   │
│ FIXED PRESETS      │     │ LLM + DIRECTOR       │
└────────────────────┘     └──────────────────────┘
```

### Key Design Principles

- **Mode-agnostic core**: The engine never branches on which mode is running. Renderer, physics, weapons, enemy AI, audio, and HUD are identical across modes.
- **Event-driven Director**: The AI Director runs on the existing `EventBus` — it watches gameplay events and reacts with deterministic rules (not an LLM in the hot path).
- **Content as data**: The LLM generates structured JSON configs, never meshes or code. The engine already knows how to build everything.
- **Incremental mutations**: World changes (weather, time-of-day) apply in-place without reloading the page.

---

## Modes

### CLASSIC Mode

A deterministic, replayable, fully offline FPS experience.

| Feature | Implementation |
|---------|---------------|
| **Map rotation** | 12 curated `{biome, seed}` pairs across 6 biomes (City, Forest, Snow, Desert, Dungeon, Factory) |
| **Weapons** | Fixed `WEAPON_CATALOG` only — no AI-generated weapons |
| **Difficulty** | 3 fixed presets (easy/normal/hard) — no live rebalancing |
| **Missions** | Fixed "Eliminate all hostiles" objective |
| **Network calls** | Zero — fully offline |
| **Determinism** | Same seed + biome always produces the identical world (`MapGenerator` determinism verified) |

### AI Mode

A living, adaptive experience where the world is generated from natural language and an AI Director adapts gameplay in real-time.

| Feature | Implementation |
|---------|---------------|
| **World generation** | Free-text prompts → LLM → validated `WorldConfig` → `MapGenerator` |
| **AI Director** | Watches telemetry at 1Hz, evaluates rules, emits adaptation commands |
| **Missions** | Generated objectives (elimination, extraction, defense, capture) |
| **Balance** | Live per-class enemy multipliers with smooth 10s ramps |
| **World mutation** | Weather/time-of-day changes applied in-place, no reload |
| **Memory** | Cross-session persistence via localStorage (64KB cap) |
| **Squad tactics** | Commander brains issue flank/retreat/ambush/hold/reinforce orders |

### Creator Mode

A natural-language level editor (third mode, built after P1–P3).

| Feature | Implementation |
|---------|---------------|
| **Chat-style input** | "add enemy", "make it night", "clear enemies" |
| **Incremental mutations** | Applied without restarting the session |
| **Mutation log** | Visible chronological event log of all applied commands |

---

## The AI Director (Heart of the System)

The **Director Agent** is what makes this project "AI-native" rather than "a shooter with a chatbot bolted on." It's a deterministic observer that runs on the existing `EventBus` — no LLM in the hot path, no network round-trips during gameplay.

### How It Works

1. **Subscribe** — The Director listens to 6 existing event types:
   - `GAME_EVENTS.HEALTH` — player health/armor changes
   - `GAME_EVENTS.KILL` — kills and kill streaks
   - `GAME_EVENTS.WEAPON_FIRED` — shots fired, firing activity
   - `GAME_EVENTS.HIT_MARKER` — shots hit (for accuracy)
   - `GAME_EVENTS.SOUND` (footsteps) — movement activity
   - `GAME_EVENTS.OBJECTIVE` — mission progress

2. **Aggregate** — Telemetry is normalized into a `TelemetryFrame` exactly **once per second** (never per frame — that would be noisy and unfair).

3. **Evaluate** — A small, interpretable **rule table** is evaluated against each frame. Rules are deterministic + probability-weighted, with cooldowns to prevent spam.

4. **Emit** — Rules produce typed `AdaptationCommand` objects that the runtime executes.

### Baseline Rules

| Rule | Trigger | Response |
|------|---------|----------|
| **Low-health medkit** | Health < 25% for > 8s | Grant medkit (85% probability) |
| **Kill-streak ramp** | Kill streak ≥ 8 at difficulty below hard | Ramp difficulty to hard |
| **Idle flush** | No movement/firing for > 45s | Trigger explosion near player |
| **Domination spawns** | Kill streak ≥ 5 with spawn cap remaining | Spawn 2 enemies (scout + heavy) |

### Adaptation Commands

```typescript
type AdaptationCommand =
  | { kind: 'spawn_enemies'; count: number; classes: EnemyClassId[]; urgency: number }
  | { kind: 'adjust_difficulty'; difficulty: Difficulty; ramp: 'ease' | 'jump' }
  | { kind: 'set_mission'; mission: MissionContentPayload }
  | { kind: 'world_mutation'; mutation: WorldMutation }
  | { kind: 'event_trigger'; event: 'explosion' | 'ambush' | 'airdrop' | 'power_outage' }
  | { kind: 'grant_content'; content: 'weapon' | 'medkit' | 'ammo' }
```

---

## Project Structure

```
src/
├── index.ts                          # Library entry point
├── demo/
│   ├── main.ts                       # Demo bootstrap (HTML entry)
│   ├── Game.ts                       # Demo orchestrator (wires everything)
│   ├── GameplayModule.ts             # Engine module driving the demo's update loop
│   ├── GameConstants.ts              # Shared difficulty/LLM/weapon constants
│   ├── GameUI.ts                     # Settings overlays, pause menu, history UI
│   ├── GameAIContent.ts              # LLM map/weapon generation + history apply
│   └── ContentHistory.ts             # Content persistence
├── engine/
│   ├── core/Engine.ts                # Game loop, module lifecycle
│   ├── ecs/ECSWorld.ts               # Entity Component System
│   ├── events/EventBus.ts            # Typed event bus
│   ├── content/                      # LLM integration layer
│   │   ├── AIContentEngine.ts        # Content generation orchestration
│   │   ├── ContentSchemas.ts         # Validation schemas
│   │   └── LLMProvider.ts            # OpenAI-compatible + procedural fallback
│   ├── config/ConfigManager.ts
│   ├── profiler/Profiler.ts
│   ├── serialization/                # Save/load system
│   └── state/StateManager.ts
├── rendering/
│   ├── core/Renderer.ts              # Three.js wrapper
│   ├── core/RenderPipeline.ts        # HDR, CSM, post-processing orchestration
│   ├── core/RenderModule.ts          # Engine module
│   ├── hdr/HDRPipeline.ts            # HDR rendering
│   ├── postprocessing/               # SSAO, Bloom, MotionBlur, TAA, GodRays
│   ├── shadows/CascadedShadowMap.ts
│   ├── lighting/                     # Area lights, light factory
│   ├── particles/ParticleSystem.ts   # GPU-driven particles
│   ├── volumetric/                   # Volumetric light shafts
│   ├── characters/EnemySoldierRig.ts # Enemy character rig
│   ├── effects/                      # CameraShake, MuzzleFlash, Tracers, Decals
│   ├── environment/SkyDome.ts        # Procedural sky
│   ├── pbr/PBRMaterialManager.ts
│   ├── textures/                     # Procedural texture generation
│   ├── viewmodel/WeaponViewmodel.ts  # First-person weapon viewmodel
│   └── webgpu/WebGPUAdapter.ts       # WebGPU adapter (future)
├── gameplay/
│   ├── core/GameTypes.ts             # Event types, constants
│   ├── core/InputManager.ts          # Keyboard/mouse/gamepad input
│   ├── player/PlayerController.ts    # Movement, health, damage
│   ├── weapons/                      # WeaponSystem, WeaponCatalog, Attachments, PenetrationTable
│   ├── maps/MapGenerator.ts          # 6-biome procedural map generation
│   ├── maps/NavGrid.ts               # AI navigation grid
│   ├── abilities/                    # GrenadeSystem, AbilitySystem
│   ├── pickups/PickupSystem.ts       # Medkit/ammo pickups
│   └── progression/SkullerRewardsSystem.ts  # Skull rewards
├── ai/
│   ├── core/EnemyController.ts       # AI state machine
│   ├── core/SquadManager.ts          # Squad coordination
│   ├── classes/EnemyClasses.ts        # Scout, Heavy, Sniper, Engineer, Medic
│   ├── navigation/AINavigator.ts      # Pathfinding
│   └── perception/PerceptionSystem.ts # Sight, hearing, memory
├── audio/
│   ├── core/AudioEngine.ts            # 3D positional audio
│   └── mixer/MusicSystem.ts           # Dynamic music states
├── physics/
│   └── core/PhysicsWorld.ts           # Collision, raycasting
├── networking/
│   └── core/NetworkManager.ts         # Client networking scaffold
├── modes/
│   ├── GameMode.ts                    # GameMode interface + shared types
│   ├── classic/ClassicMode.ts         # Fixed rotation mode
│   ├── ai/
│   │   ├── AIMode.ts                  # AI mode orchestration
│   │   ├── DirectorAgent.ts           # AI Director (telemetry → rules → commands)
│   │   ├── WorldAgent.ts              # Prompt-to-world generation
│   │   ├── WorldMutator.ts            # In-place weather/time-of-day mutations
│   │   ├── MissionAgent.ts            # Objective state machine (FSM)
│   │   ├── BalanceAgent.ts            # Live enemy tuning
│   │   ├── MemorySystem.ts            # Cross-session persistence
│   │   ├── SquadCommander.ts          # Per-squad tactical orders
│   │   └── ReinforcementScheduler.ts  # 8s delayed reinforcement spawns
│   └── creator/
│       ├── CreatorMode.ts             # Natural-language level editor
│       └── CreatorUI.ts               # Chat-style editor panel
└── ui/
    ├── hud/HUD.ts                     # In-game HUD
    └── modes/ModeSelect.ts            # CLASSIC / AI boot screen

tests/unit/
├── 24 test suites, 186 tests total    # All passing
```

---

## Setup & Development

### Prerequisites

- Node.js 18+
- npm 9+

### Quick Start

```bash
# Install dependencies
npm install

# Run the development server (demo at http://localhost:8080)
npm run demo:dev

# Or build the demo bundle
npm run demo:build

# Serve the built demo
npm run serve:demo
```

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run build` | `tsc` | TypeScript library build → `dist/` |
| `npm run build:watch` | `tsc --watch` | Watch mode for library build |
| `npm test` | `jest` | Run all 186 unit tests |
| `npm run test:watch` | `jest --watch` | Watch mode for tests |
| `npm run test:coverage` | `jest --coverage` | Test coverage report |
| `npm run lint` | `eslint` | Lint all source files |
| `npm run demo:build` | `webpack --mode production` | Build demo bundle → `dist-demo/` |
| `npm run demo:dev` | `webpack serve --mode development` | Dev server on port 8080 |
| `npm run serve:demo` | `node serve-demo.mjs` | Static server for built demo on port 8099 |
| `npm run docs` | `typedoc` | Generate API documentation → `docs/api/` |
| `npm run deploy:gh-pages` | `gh-pages -d dist-demo` | Deploy to GitHub Pages (requires `gh-pages` npm package) |
| `npm run deploy:netlify` | `netlify deploy --prod` | Deploy to Netlify (requires `netlify-cli` npm package) |
| `npm run deploy:netlify:draft` | `netlify deploy` | Deploy to Netlify draft URL (preview before production) |

### Demo URL Parameters

The demo supports query-string configuration:

```
http://localhost:8080?mode=classic&biome=forest&seed=4242&difficulty=hard
```

| Parameter | Values | Description |
|-----------|--------|-------------|
| `mode` | `classic` \| `ai` | Fast-boot directly into a mode (skips mode select) |
| `biome` | `city` \| `forest` \| `snow` \| `desert` \| `dungeon` \| `factory` | Map biome |
| `seed` | integer | Map generation seed |
| `difficulty` | `easy` \| `normal` \| `hard` | Game difficulty |
| `llmKey` | API key | Pre-seeds the LLM API key into localStorage |

---

## LLM Integration

The AI Content Engine supports **OpenAI-compatible providers** (OpenAI, OpenRouter, DeepSeek) with a **procedural fallback** when no API key is configured.

### Supported Providers

| Provider | Base URL | Model (default) |
|----------|----------|-----------------|
| **OpenRouter** (free tier) | `https://openrouter.ai/api/v1` | `google/gemma-4-26b-a4b-it:free` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |

### How It Works

1. User types a prompt (e.g., "snowy abandoned military base at night")
2. `WorldAgent` sends it to the configured LLM with a structured JSON schema
3. `AIContentEngine` validates the response against `ContentSchemas`
4. On validation failure, retries up to 3 times
5. On persistent failure, falls back to **keyword interpretation** (biome names, "snow"/"desert"/"night", difficulty words)
6. Everything is logged to a persistent history with content hashes, stats, and click-to-restore

### API Key Security

- API keys are stored in **browser localStorage only** — never in source code
- Use `?llmKey=sk-or-v1-...` to pre-seed on page load
- No backend proxy — the browser calls the LLM provider directly

---

## Build Plan

The project was built in 5 phases, each with a clear definition of done:

| Phase | Feature | Status |
|-------|---------|--------|
| **P0** | Two-mode shell (Classic/AI mode select, mode-agnostic engine) | ✅ Complete |
| **P1** | AI Director (telemetry, rules, adaptation commands, pickups) | ✅ Complete |
| **P2** | Missions & Balance (objective FSM, live enemy tuning, 10s ramps) | ✅ Complete |
| **P3** | Prompt-to-World & Mutation (WorldAgent, keyword fallback, in-place weather/time) | ✅ Complete |
| **P4** | Memory & Squad Commander (localStorage persistence, 6 order types, reinforcements) | ✅ Complete |
| **P5** | Creator Mode (natural-language level editor, chat UI, mutation log) | ✅ Complete |

---

## Testing

The project has **24 test suites** with **186 tests**, all passing:

```
PASS tests/unit/ai-content-engine.test.ts
PASS tests/unit/ai-enemy.test.ts
PASS tests/unit/ai-navigator.test.ts
PASS tests/unit/ai-perception.test.ts
PASS tests/unit/ai-squad.test.ts
PASS tests/unit/balance-live.test.ts
PASS tests/unit/classic-mode.test.ts
PASS tests/unit/creator-mode.test.ts
PASS tests/unit/director-rules.test.ts
PASS tests/unit/directorRules.test.ts
PASS tests/unit/eventBus.test.ts
PASS tests/unit/game-setup-order.test.ts
PASS tests/unit/mapgen.test.ts
PASS tests/unit/memory-cap.test.ts
PASS tests/unit/mission-fsm.test.ts
PASS tests/unit/mode-select.test.ts
PASS tests/unit/navgrid.test.ts
PASS tests/unit/penetration.test.ts
PASS tests/unit/reinforcement-scheduler.test.ts
PASS tests/unit/serializer.test.ts
PASS tests/unit/squad-commander.test.ts
PASS tests/unit/world-agent.test.ts
PASS tests/unit/world-config-validation.test.ts
PASS tests/unit/world-mutator.test.ts
```

---

## Rendering Pipeline

The rendering system is an HDR forward+ pipeline with a full post-processing stack:

```
Frame Order:
  1. TAA jitter              — jitter projection matrix for sub-pixel AA
  2. CSM update              — fit shadow cascade frusta to current camera
  3. CSM render              — write depth maps from light's POV
  4. HDR begin               — bind float16 render target
  5. Scene render            — forward pass with PBR materials + CSM shadows
  6. Post-processing         — SSAO → GodRays → MotionBlur → Bloom → TAA
  7. HDR end                 — tone-map (ACES filmic) + cinematic grade
  8. Present                 — blit LDR to screen
```

### Post-Processing Effects

| Effect | Description |
|--------|-------------|
| **SSAO** | Screen-space ambient occlusion for contact shading |
| **God Rays** | Volumetric light shafts from the sun |
| **Motion Blur** | Per-pixel velocity-based blur |
| **Bloom** | HDR bloom with 6-pass gaussian blur |
| **TAA** | Temporal anti-aliasing with sub-pixel jitter + resolve |
| **Cinematic Grade** | Vignette, film grain, ACES tone mapping, S-curve contrast |

---

## Key Technical Decisions

- **No LLM in the hot path**: The Director uses deterministic rules, not an LLM, for real-time decisions. The LLM is reserved for content generation (worlds, missions, weapons) where latency is acceptable.
- **EventBus as spine**: All inter-module communication goes through the typed `EventBus`. The Director subscribes as a passive observer and emits commands — it never couples to gameplay systems directly.
- **Deterministic map generation**: Same seed + biome always produces the same map. This is verified in tests and guarantees reproducible Classic mode.
- **Per-session multiplier sets**: Balance changes apply to living enemies without mutating the base `ENEMY_CLASSES` constants. Each enemy reads its multiplier at spawn time + re-reads on difficulty change.
- **64KB memory cap**: Cross-session memory fits in localStorage with oldest-first eviction. No backend required.

---

## License

MIT — see LICENSE file for details.

---

## Built With

- [Three.js](https://threejs.org/) — 3D rendering library
- [TypeScript](https://www.typescriptlang.org/) — Type-safe JavaScript
- [Webpack](https://webpack.js.org/) — Build tooling
- [Jest](https://jestjs.io/) — Testing framework