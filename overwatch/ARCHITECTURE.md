# OVERWATCH — engine contract

**Every subsystem must read this before writing code. It is the only coordination mechanism.**

Target: a browser FPS whose *visual and tactile quality* stands next to a modern
Call of Duty. WebGL2 + Three.js r180, no external art assets — all textures,
meshes, animation and audio are generated procedurally at load time.

## Hard rules

1. **You own your directory. Never edit files outside it.** Another agent owns
   every other directory and your edit will be clobbered or will break them.
2. **Never import another subsystem's module.** Get it at runtime:
   `const fx = ctx.get('fx')`. This is what makes parallel work safe.
3. **No new npm dependencies.** `three` only. No CDN fetches, no external
   images/HDRIs/models/audio files — the game must run fully offline.
4. **No `Math.random()` in gameplay or visuals.** Use `ctx.rng` (see
   `shared/rng.js`) or a `ctx.rng.fork()` you keep. Capture reproducibility
   depends on it.
5. **Allocate nothing per-frame.** Preallocate vectors, matrices and arrays in
   `init()` and reuse. A `new THREE.Vector3()` inside `update()` is a bug.
6. **Dispose what you create.** Geometries, materials, textures and render
   targets get freed in `dispose()`.
7. `npm run build` and `npm test` must pass and `node tools/capture.mjs` must
   produce a frame after your change. If you break the boot, nobody else can
   work.
8. **`shared/` is gameplay the multiplayer server also runs.** Code there is
   plain JS: no `three`, no DOM, no `ctx`, no randomness, no per-step
   allocation. A change to it changes the server too — `npm test` pins its
   behaviour (movement must reproduce `tests/fixtures/movement-trace.json`
   bit-for-bit; re-record the fixture only for an intended gameplay change).

## Subsystem interface

```js
export class MySystem {
  static id = 'mysystem';       // unique; how others reach you
  static deps = ['render'];     // ids that must init before you

  async init(ctx) {}            // build resources; may await
  fixedUpdate(h, ctx) {}        // optional, 120 Hz, deterministic gameplay
  update(dt, ctx) {}            // optional, once per frame
  lateUpdate(dt, ctx) {}        // optional, after all update()
  resize(w, h, ctx) {}          // optional
  dispose() {}                  // optional
}
```

`ctx` provides: `scene`, `camera`, `viewScene`, `viewCamera`, `canvas`,
`config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, `has(id)`.

- `scene` / `camera` — the world. `viewScene` / `viewCamera` — the first-person
  weapon, drawn separately so it can never clip through walls.
- `time` — `{ elapsed, raw, dt, fixed, alpha, scale, frame }`. Use `alpha` to
  interpolate rendered transforms between physics steps.
- `config.q` — the active quality preset. Respect `q.taa`, `q.gtao`, `q.ssr`,
  `q.volumetrics`, `q.shadowMapSize`, `q.particleBudget`, `q.decalBudget`.
  Never exceed a budget.

## Ownership map

| id | directory | owns |
|---|---|---|
| `render` | `src/render/` | WebGLRenderer, HDR pipeline, all post-processing, CSM shadows, the final composite |
| `materials` | `src/materials/` | procedural PBR texture generation, the shared material library, triplanar/detail mapping |
| `sky` | `src/sky/` | physical sky, sun/moon, time of day, IBL/env map generation, volumetric fog & light shafts |
| `world` | `src/world/` | level geometry, the modular building kit, props, set dressing, static collision meshes. Layout randomness comes from `layoutRng(seed)` (`shared/map.js`) so the server can rebuild the colliders headlessly |
| `physics` | `src/physics/` | the client's `CollisionWorld` (`shared/collision.js`): raycasts, character controller collision; rigid bodies, ragdolls, penetration |
| `player` | `src/player/` | camera feel, sprint/slide/mantle/lean, health; the movement step itself is `shared/movement.js` |
| `weapons` | `src/weapons/` | the loadout (primary + pistol) and switching, weapon meshes, viewmodel rig, ADS and the sniper scope, recoil, sway, bob, draw/reload/inspect animation, ballistics. Combat clocks run on fixed steps, like the server's |
| `grenades` | `src/grenades/` | grenades on the client: inventory, throwing (with prediction), flights, smoke clouds, flash blindness, HE blasts; the weapons system holds them (key 4) |
| `spectate` | `src/spectate/` | while dead online: the death camera (on your killer) and spectating teammates; owns the camera then |
| `bomb` | `src/bomb/` | Bomb Defusal on the client: the bomb model, plant/defuse bar and hints, beeps, the explosion (online only; the server runs the rules) |
| `buy` | `src/buy/` | the buy menu (B), money and buy-time HUD; online it asks the server through `net` |
| `fx` | `src/fx/` | GPU particles, muzzle flash, tracers, impacts, decals, smoke, blood, shells |
| `ai` | `src/ai/` | enemy characters, navigation, perception, cover selection, combat behaviour |
| `ui` | `src/ui/` | HUD, crosshair, hitmarkers, damage indicators, ammo, killfeed, menus, the settings panel (`src/ui/settings.js`; the stored values and their rules are `src/core/settings.js`) |
| `audio` | `src/audio/` | synthesized weapon/foley audio, spatialisation, reverb, occlusion, mix |
| `net` | `src/net/` | multiplayer client (only with `?server=`): input upload, prediction/reconciliation, remote-player interpolation and stand-in meshes. Replaces `ai` when online |

Shared, owned by the lead (do not edit): `src/core/`, `src/main.js`,
`src/dev/`, `src/characters/`, `shared/`, `tests/`, `tools/`, `vite.config.js`.

`src/characters/soldier.js` is the procedural soldier (skinned boxes on a
skeleton, walk/aim/crouch pose) used by both `ai` and `net`; plain
functions, not a subsystem.

### `shared/` — client/server gameplay

| module | contents |
|---|---|
| `shared/rng.js` | the seeded PRNG (`src/core/rng.js` re-exports it) |
| `shared/collision.js` | `CollisionWorld`: slab raycasts, overlap tests, the axis-separated character mover. It resolves overlap after each move instead of sweeping, so per-step deltas must stay small (fixed steps keep them under 10 cm) |
| `shared/movement.js` | `createMoveState`, `stepMove`: one fixed step of walk/run/crouch/jump/fall (on the ground it follows steps down; in the air it falls until it lands), `settle` (a spawn put down on the floor), `fallDamage` |
| `shared/map.js` | `layoutRng(seed)`, and `buildColliders(seed)`, which runs the world headlessly in Node and returns its static colliders |
| `shared/combat.js` | rifle constants, damage, the bullet trace (`traceShot`) and player hitboxes |
| `shared/nav.js` | where players can walk, for bots: a 0.5 m grid of standable floor built from the colliders (only what's reachable from a spawn), straight-walk checks and A* paths |
| `shared/lobby.js` | finding a match: room codes, the room-list address, Quick Play's pick, invite links |
| `shared/grenades.js` | grenade table, the deterministic flight (`stepFlight`), HE damage and flash duration |
| `shared/bomb.js` | Bomb Defusal numbers (plant/defuse/bomb times, radius, rewards) and `siteAt` |
| `shared/weapons.js` | the weapon table (prices, fire rate, ammo, damage, spread, draw/reload times) and the round economy |
| `shared/protocol.js` | the wire protocol: message shapes, rates, input validation, state packing |

### Multiplayer

`server/` (npm workspace; `npm run server`) is authoritative. `room.js` holds
the rules without sockets; `index.js` adds HTTP + WebSocket, rooms and the
120 Hz tick loop.

- Clients send one input per fixed step (batched at 30 Hz); yaw/pitch are the
  only client-owned values. The server applies at most one input per tick
  per player (with 250 ms of catch-up credit), so nobody moves faster than
  real time. No inputs, no movement: a backgrounded tab stands still.
- Snapshots go out at 20 Hz: the recipient's exact movement state plus the
  last input seq applied, and every other player rounded to 1 mm.
- The client predicts with the same `stepMove`, rewinds to each snapshot and
  replays unacknowledged inputs; with 200 ms RTT the correction is 0 m.
  Remote players render 100 ms in the past, interpolated between snapshots.
- The welcome carries a resume token. A connection that drops (any close but
  1000/1001/1005, the deliberate ones) leaves its player in the room, away,
  for 30 s; a hello with the token in that time takes the same player back
  (`resumed: true`). The client reconnects on its own (`reconnecting`,
  frozen, retrying every 2 s for 25 s) and resets its prediction buffers;
  if the hold ran out it's a fresh join under a new id. Kicked players
  can't resume. A resume also takes over a player whose old connection the
  server hasn't noticed is dead. Dead links are found from both ends: the
  server pings every 10 s and drops a client that missed the last pong; the
  client treats 5 s without a message as a dropped link.
- Idle players: `Room` counts ticks a living, unfrozen player with company
  sends no movement, look change or action (`player.idle`); the server
  kicks at `rules.afkTicks` (90 s) with error code `afk`.
- Bots (`server/bots.js`) are room players whose input comes from a `Bot`
  instead of a socket: each tick it queues one input plus any shot, reload
  or switch, so the server's own rules move it and time and resolve its
  shots (lag compensation sees `viewTick` = now). It perceives line of
  sight against the static map (smoke clouds, tracked by the room, block
  it), gunfire within 25 m and who shot it; it aims with a 0.4-0.7 s
  reaction and a settling error plus per-shot spread. Goals come from the
  mode: carry the bomb to this round's shared site and plant, hold a site
  and defuse, or hunt. `Room.balanceBots()` keeps `bots` players in even
  teams as people come and go; a full room drops a bot for a person; the
  room list counts people (`players`) and `bots` separately.
- WebSocket compression is opt-in (`COMPRESS=1`): about 5x less traffic
  for about 4x the server CPU.
- The net system connects on its first frame, after boot: shader prewarm can
  block the page for seconds and would otherwise stall the handshake.
- Shots and reloads ride the input stream, tagged with the input seq they
  happen before, so the server resolves each one against exactly the state
  it was fired from. Fire rate, ammo and reloads are timed in the shooter's
  own input steps. The muzzle must be within 0.75 m of the server's eye
  position.
- Lag compensation: the server records every player's hitbox each tick (64
  ticks kept) and rewinds the other players to the tick the shooter saw,
  at most 400 ms back.
- Fall damage is the server's: a landing step faster than
  `SAFE_FALL_SPEED` costs `fallDamage(impact)`, sent as `EV_HIT` from
  shooter 0 (the world), and a deadly one is `EV_KILL` with `KILL_BY_FALL`.
  The client predicts the landing (camera dip, shake, sound), not the damage.
- The client's weapon still traces locally for instant tracers and blood:
  `net` gives remote players client-side `flesh` hitboxes. Damage,
  hitmarkers, kills and respawns come only from the server.
- Matches (`room.js`, mode `teams`): WARMUP → FREEZE → LIVE → END → … →
  MATCH_END, with timings in `DEFAULT_RULES`. Teammates are skipped in the
  hit trace (no friendly fire). While FREEZE or MATCH_END is on, the server
  acks inputs without moving anyone, and the client sets `player.frozen` so
  prediction agrees. Mode `dm` skips teams and rounds.

Client and server agree bit-for-bit within one JS runtime. Across runtimes
(Chromium vs Node) `Math.sin`/`cos` can differ in the last bit, so expect
differences around 1e-15 m; server reconciliation absorbs them.

## Cross-subsystem events

Emit and listen via `ctx.events`. Payloads are plain objects. The canonical set:

| event | payload | emitted by |
|---|---|---|
| `weapon:fire` | `{ weapon, origin: {x,y,z}, dir: {x,y,z}, seed }` | weapons |
| `weapon:reload` | `{ weapon, phase }` | weapons |
| `weapon:switch` | `{ slot, weapon }` — a weapon is being drawn (net sends it to the server) | weapons |
| `weapon:shell` | `{ position, velocity }` | weapons |
| `bullet:impact` | `{ point, normal, surface, incident, damage }` | physics |
| `bullet:tracer` | `{ from, to, speed }` | weapons |
| `damage:dealt` | `{ target, amount, headshot, killed, point }` | ai / physics |
| `damage:taken` | `{ amount, from, health }` | player |
| `actor:death` | `{ actor, point, impulse }` | ai |
| `actor:fire` | `{ origin, weapon? }` — another shooter fired (AI soldier, remote player) | ai, net |
| `actor:footstep` | `{ position, running }` — another character's step | net |
| `bomb:event` | `{ kind, player, name, site, byMe }` — planted / defused / exploded / dropped / picked up (protocol `BOMBEV_*`) | net |
| `grenade:throw` | `{ type, origin, dir, lob }` — our throw, for the server | grenades |
| `grenade:thrown` | `{ type, lob }` — any local throw (sound) | grenades |
| `grenade:spawn` / `grenade:pop` | the server's throw and detonation events | net |
| `grenade:effect` | `{ type, position }` — a grenade went off here | grenades |
| `flash:blind` | `{ duration }` — we were flashed | grenades |
| `explosion` | `{ point, radius, damage }` — single-player HE (the AI takes damage) | grenades |
| `bomb:beep` | `{ position, urgent }` — the planted bomb's beep | bomb |
| `match:halftime` | `{ attackers }` — teams switch sides | net |
| `player:kill` | `{ killer, victim, headshot, weapon?, byMe, onMe }` (names; `killer: null` = fell off the map; `weapon` its display name) | net, player |

`damage:dealt` semantics: `target` is who the damage lands ON. When an enemy
round connects, `target` is `'player'`; the player system applies it and emits
`damage:taken`. When a player round hits a soldier, `target` is the soldier
object — filter `target !== 'player'` before drawing a hitmarker. `killed` is
true when the damage drops the target to 0; the emitter also fires
`actor:death` in that case. Online, `net` emits `damage:dealt` with
`target: { remoteId }` only when the server confirms a hit, `damage:taken`
when the server lowers our health, and `player:kill` for the kill feed.
| `player:land` | `{ velocity, surface }` | player |
| `player:footstep` | `{ position, surface, running }` | player |
| `player:state` | `{ stance, sprinting, sliding, ads }` | player |
| `explosion` | `{ position, radius, damage }` | any |
| `resize` | `{ width, height }` | engine |

If you need an event that is not listed, add a row here in the same commit.

## Surface types

Shared vocabulary for impact FX, decals, audio and footsteps. Physics tags every
collider with one of: `concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`,
`water`, `foliage`, `fabric`, `flesh`, `rubber`, `plaster`.

## Render integration

`render` exposes these to other subsystems:

```js
const r = ctx.get('render');
r.renderer            // THREE.WebGLRenderer — do not change its state outside a frame
r.registerPass(pass)  // insert a custom post pass
r.addLight(light)     // register a punctual light so it participates in culling/budgets
r.requestEnvMap()     // PMREM env map currently in use
r.screenSize          // { width, height } of the internal render target
r.depthTexture        // linear depth, for soft particles / SSR
r.velocityTexture     // motion vectors, for TAA / motion blur
```

Anything drawn into `viewScene` is composited after the world with a cleared
depth buffer.

Per-object opt-outs, honoured every frame by `render._collect`:

```js
mesh.userData.owNoPrepass = true  // keep out of the depth/normal/velocity prepass
mesh.userData.owNoShadow  = true  // do not cast into the CSM cascades
```

`owNoShadow` is the ONLY shadow-caster switch: the cascades draw with
`scene.overrideMaterial` and never consult `mesh.castShadow`. `src/ai` relies
on this for its off-screen actor LOD.

### The point-light count is a shader permutation key

`r.addLight()` puts a light under distance culling, and the cull sets
`light.visible = false` once the fade reaches zero. Three bakes the number of
**visible** point lights into every material's program cache key, so one lamp
crossing its radius recompiles every lit material in the scene. Anything that
registers distance-culled point lights must keep the visible count constant.
Two ways, both pixel-exact:

- drive `intensity` to 0 and leave `visible` true (what `src/fx/lights.js` does), or
- park zero-intensity "ballast" lights and top the count up to a fixed slot
  budget every `lateUpdate`.

A light whose colour × intensity is exactly 0 adds a float `0.0` to the
irradiance accumulator, so extra lit slots cannot move a pixel.

### Pre-warm

`src/core/prewarm.js` runs before the first frame and calls
`prewarmMaterials(ctx)` on every subsystem that implements it. The contract:
**build and compile every material the subsystem can produce, without spawning
gameplay objects, drawing a gameplay frame, or touching the clock/RNG.**
`renderer.compileAsync(scene, camera)` alone only reaches the forward lit
variant — not the CSM depth pass, the MRT prepass, or the post chain.

## Quality bar

Every visual subsystem is reviewed by an adversarial critic against real CoD
frames. Non-negotiables:

- **No flat/untextured surfaces.** Every material needs albedo variation, a
  normal map, roughness variation, and a detail layer visible at 0.5 m.
- **No uniform lighting.** Contact shadows, bounce, ambient occlusion, and a
  clear key/fill/rim separation.
- **Physically plausible values.** Albedo in 0.02–0.9, metals are 0 or 1,
  real-world light intensities, exposure-driven not multiplier-driven.
- **Nothing perfectly straight, clean, or repeated.** Edge wear, grime in
  crevices, subtle warp, varied instance rotation/scale.
- **Every action has weight.** Recoil, camera shake, screen-space impulse,
  audio transient, and a visual FX on every impact.
