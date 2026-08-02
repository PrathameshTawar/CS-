# Requirements Document

## Introduction

This document defines requirements for a browser-based, AAA-quality first-person shooter (FPS) game built with Three.js. The game is structured as an AI-native engine prototype where a Large Language Model (LLM) can generate maps, missions, NPC dialogue, weapons, and balancing rules on demand. The system is organized into 10 layers: Graphics, Visual Effects, AI Enemies, Gunplay, Movement, Multiplayer, Procedural Maps, Sound, UI/HUD, and AI-Generated Content. The visual style is original, prioritizing high readability, crisp silhouettes, impactful hit feedback, stylized energy effects, and clean UI.

---

## Glossary

- **Renderer**: The Three.js-based rendering pipeline responsible for all visual output.
- **PostFX_Pipeline**: The post-processing stack applied after scene rendering (bloom, motion blur, DOF, etc.).
- **Physics_Engine**: The physics simulation layer handling collisions, destruction, and projectile trajectories.
- **AI_Controller**: The behavior-tree-driven enemy intelligence system.
- **Combat_System**: The system managing weapon firing, hit detection, damage, and feedback.
- **Movement_System**: The system handling player locomotion, including standard movement and advanced maneuvers.
- **Audio_Engine**: The procedural and dynamic audio system.
- **Network_Manager**: The client-side networking layer handling synchronization, prediction, and lag compensation.
- **Game_Server**: The authoritative server (Colyseus or Nakama) managing multiplayer state.
- **Map_Generator**: The procedural and LLM-assisted map generation system.
- **AI_Content_Engine**: The LLM integration layer that generates game content on demand.
- **HUD**: The in-game heads-up display showing player status and contextual information.
- **CSM**: Cascaded Shadow Maps.
- **TAAS**: Temporal Anti-Aliasing and Supersampling.
- **SSR**: Screen-Space Reflections.
- **GTAO**: Ground Truth Ambient Occlusion.
- **DOF**: Depth of Field.
- **GI**: Global Illumination.
- **DDGI**: Dynamic Diffuse Global Illumination.
- **ADS**: Aim Down Sights.
- **NPC**: Non-Player Character.
- **LLM**: Large Language Model.
- **PBR**: Physically Based Rendering.
- **GPU_Particle_System**: The GPU-driven particle simulation and rendering system.
- **Behavior_Tree**: The hierarchical AI decision-making structure used by AI_Controller.
- **Squad**: A group of AI enemies that coordinate tactics.
- **Biome**: A distinct environmental theme for procedurally generated maps (city, forest, snow, desert, dungeon, factory).
- **Kill_Effect**: The visual sequence played when an enemy is eliminated.
- **Hit_Marker**: The on-screen indicator showing a successful hit.
- **Tracer**: A visible projectile path rendered in real-time.
- **Attachment**: A modular weapon component (scope, suppressor, laser, grip, magazine, stock).
- **Penetration_Table**: A data table defining material-specific bullet penetration properties.

---

## Requirements

### Requirement 1: Volumetric Fog and Atmospheric Lighting

**User Story:** As a player, I want realistic volumetric fog with light shafts and dynamic dust particles, so that the game world feels immersive and atmospheric.

#### Acceptance Criteria

1. THE Renderer SHALL render volumetric fog using a ray-marching or froxel-based technique at a minimum resolution of half the screen resolution, upscaled with temporal reprojection.
2. WHEN a directional light or spot light intersects the fog volume, THE Renderer SHALL render visible light shafts (god rays) emanating from that light source.
3. WHEN an explosion or movement event occurs within a fog-enabled zone, THE GPU_Particle_System SHALL emit dynamic dust particles that scatter and settle over a period of 3–10 seconds.
4. THE Renderer SHALL support per-volume fog density, color, and scattering coefficient as configurable parameters.
5. WHILE the player is inside a fog volume, THE PostFX_Pipeline SHALL apply a fog-colored screen edge vignette to reinforce immersion.
6. THE Renderer SHALL maintain a minimum of 60 frames per second at 1920×1080 resolution with volumetric fog active on a GPU equivalent to or better than an NVIDIA GTX 1080.

---

### Requirement 2: Advanced Lighting — Area Lights, GI, and Reflection Probes

**User Story:** As a player, I want advanced global illumination and area lights, so that the game world has physically plausible, rich lighting that reacts to scene changes.

#### Acceptance Criteria

1. THE Renderer SHALL support rectangular and disk area lights with PBR energy-conserving shading.
2. THE Renderer SHALL implement a DDGI approximation (probe grid or screen-space irradiance cache) that updates dynamically when scene geometry or emissive surfaces change.
3. WHEN a light source is destroyed or toggled, THE Renderer SHALL update indirect illumination within 3 frames using the GI approximation.
4. THE Renderer SHALL place reflection probes at author-defined or procedurally determined positions, updating each probe at a configurable interval of no less than once per second.
5. WHERE pre-baked light maps are available for a map, THE Renderer SHALL blend baked indirect lighting with dynamic GI contributions using a configurable blend weight.
6. THE Renderer SHALL support emissive surfaces as indirect light sources within the GI system.

---

### Requirement 3: Water Rendering

**User Story:** As a player, I want realistic water surfaces with waves, reflections, refractions, and underwater effects, so that water areas feel believable and visually impressive.

#### Acceptance Criteria

1. THE Renderer SHALL simulate water surface waves using a sum-of-sines or FFT-based wave model with at least 4 independent wave components.
2. THE Renderer SHALL render real-time planar or screen-space reflections on water surfaces with a configurable reflection quality level (low, medium, high).
3. THE Renderer SHALL render refractions beneath the water surface using an offset screen-space sample with normal-map distortion.
4. WHEN the camera is submerged below the water surface, THE PostFX_Pipeline SHALL apply a caustic overlay, a blue-tint color grade, and a reduced visibility fog.
5. WHEN a physics object or character enters the water surface, THE GPU_Particle_System SHALL emit splash particles and THE Audio_Engine SHALL play the appropriate water-entry sound.

---

### Requirement 4: Destruction System

**User Story:** As a player, I want walls, objects, and cover to crack, explode, and leave debris and bullet holes, so that the environment feels reactive and tactically meaningful.

#### Acceptance Criteria

1. WHEN a destructible surface receives cumulative damage exceeding its defined damage threshold, THE Physics_Engine SHALL transition the surface through crack, fracture, and collapse states.
2. WHEN a surface collapses, THE Physics_Engine SHALL spawn rigid-body debris fragments that simulate physically plausible trajectories before coming to rest.
3. WHEN a projectile impacts a destructible or non-destructible surface, THE Renderer SHALL apply a decal from a pre-defined bullet-hole decal atlas appropriate to the surface material.
4. THE Physics_Engine SHALL support at least 4 distinct material destruction profiles: wood, concrete, glass, and metal.
5. WHEN debris fragments come to rest, THE Physics_Engine SHALL merge or despawn fragments exceeding a configurable scene debris limit to maintain performance.
6. THE Renderer SHALL remove bullet-hole decals older than a configurable time limit (minimum 30 seconds) to manage GPU memory.

---

### Requirement 5: GPU Particle System

**User Story:** As a developer and player, I want a high-performance GPU-driven particle system for smoke, sparks, blood, explosions, and shell casings, so that combat feels visceral and the engine can sustain high particle counts at 60+ FPS.

#### Acceptance Criteria

1. THE GPU_Particle_System SHALL simulate and render a minimum of 100,000 simultaneous particles using compute shaders or transform feedback on the GPU.
2. THE GPU_Particle_System SHALL support the following particle effect types: smoke, sparks, blood splatter, explosion dust, and shell casing ejection.
3. WHEN smoke particles are active within a scene, THE Renderer SHALL apply a volumetric-aware opacity blend so that smoke interacts with scene lighting rather than rendering as flat sprites.
4. THE GPU_Particle_System SHALL cull particles outside the camera frustum each frame without requiring CPU readback.
5. THE GPU_Particle_System SHALL support per-emitter parameters including: emission rate, lifetime, velocity, gravity scale, color gradient, size curve, and texture atlas selection.

---

### Requirement 6: Full Shooting Feedback Chain

**User Story:** As a player, I want a complete, layered visual and audio feedback chain every time I fire a weapon, so that shooting feels impactful, readable, and satisfying.

#### Acceptance Criteria

1. WHEN the player fires a weapon, THE Combat_System SHALL trigger the following feedback sequence in order within a single frame: muzzle flash, bloom expansion, spark particle burst, smoke puff at muzzle, shell casing ejection, tracer emission, hit marker display (on hit), and camera shake application.
2. WHEN a projectile tracer is in flight, THE Renderer SHALL render it as a glowing, elongated capsule with a configurable color, glow radius, and fade-out length trailing behind it.
3. WHEN a projectile hits a surface, THE Combat_System SHALL display a Hit_Marker on the player's HUD; the Hit_Marker color SHALL be white for a standard hit, red for a high-damage hit, and gold for a critical hit.
4. WHEN a hit is registered, THE Audio_Engine SHALL play a material-appropriate impact sound within 16ms of the hit event.
5. THE Combat_System SHALL apply camera shake with configurable magnitude and frequency on firing, inversely proportional to the weapon's stability rating.

---

### Requirement 7: Kill Effects and Headshot Effects

**User Story:** As a player, I want dramatic, stylized kill and headshot effects, so that eliminating enemies feels rewarding and visually distinct.

#### Acceptance Criteria

1. WHEN an enemy's health reaches zero, THE Combat_System SHALL trigger the Kill_Effect sequence: enemy mesh dissolves over 0.5–1.0 seconds using a dissolve shader, an energy burst particle effect emits outward from the enemy's position, floating kill-confirmation icon rises and fades over 1 second.
2. WHEN a kill is achieved with a headshot, THE Combat_System SHALL trigger an additional headshot effect: a large screen-edge flash, an amplified camera shake lasting 0.2 seconds, and a critical hit marker three times the standard size.
3. THE GPU_Particle_System SHALL produce the energy burst for kill effects using at least 500 particles per kill event.
4. WHEN a kill effect is active, THE Audio_Engine SHALL play a distinct kill-confirmation audio cue separate from standard impact sounds.

---

### Requirement 8: Tactical Ability Effects

**User Story:** As a player, I want visually distinct and readable effects for tactical abilities (smoke grenades, flashbangs, shock grenades), so that abilities are comprehensible and impactful.

#### Acceptance Criteria

1. WHEN a smoke grenade detonates, THE GPU_Particle_System SHALL emit a volumetric smoke cloud that expands to its maximum radius over 2 seconds, persists for a configurable duration (default 15 seconds), and blocks SSR and enemy AI line-of-sight calculations.
2. WHEN a flashbang detonates within the player's field of view, THE PostFX_Pipeline SHALL apply a full-screen bloom overexposure effect that fades from full white to normal within 2–4 seconds, scaled by distance from the detonation point.
3. WHEN a shock grenade detonates, THE GPU_Particle_System SHALL emit electric arc particles from the detonation point to nearby conductive surfaces, and THE PostFX_Pipeline SHALL apply a brief screen-edge electric distortion effect.
4. WHEN a dash ability activates, THE Combat_System SHALL apply a directional motion blur streak, spawn a ghost trail using semi-transparent copies of the player mesh, and emit wind-line particles in the dash direction.

---

### Requirement 9: Enemy Hearing and Investigation

**User Story:** As a player, I want enemies to react to sounds like footsteps and gunshots, so that stealth and noise management are meaningful gameplay systems.

#### Acceptance Criteria

1. WHEN the player or another agent produces a sound event (footstep, gunshot, explosion, object interaction) within an enemy's hearing radius, THE AI_Controller SHALL register that sound event.
2. WHEN an enemy registers a sound event, THE AI_Controller SHALL transition the enemy's Behavior_Tree from its current idle or patrol state to an investigation state and navigate the enemy to the sound's origin position.
3. WHILE an enemy is in investigation state and no visual contact has been made, THE AI_Controller SHALL search the last known sound position using a configurable search radius (default 5 meters) before returning to patrol.
4. IF the player uses a suppressor and fires from beyond the enemy's hearing threshold distance, THEN THE AI_Controller SHALL NOT trigger an investigation state for that enemy.
5. THE AI_Controller SHALL define hearing radius per enemy class: Scout (15m), Heavy (8m), Sniper (25m), Engineer (10m), Medic (10m).

---

### Requirement 10: Last Known Position Search

**User Story:** As a player, I want enemies to search my last known position when they lose sight of me, so that hiding is tactical and enemies feel intelligent.

#### Acceptance Criteria

1. WHEN an enemy loses line-of-sight to the player after having detected the player, THE AI_Controller SHALL record the player's last known position (LKP) and transition to a search state.
2. WHILE in search state, THE AI_Controller SHALL navigate the enemy to the LKP and perform a sweep search of a configurable radius around it (default 8 meters).
3. IF the enemy fails to re-detect the player within a configurable search duration (default 20 seconds), THEN THE AI_Controller SHALL transition the enemy back to its patrol state and clear the LKP record.
4. WHEN multiple enemies in a Squad are searching for the player, THE AI_Controller SHALL coordinate search sectors so no two enemies search the same zone simultaneously.

---

### Requirement 11: Squad AI — Coordination and Tactics

**User Story:** As a player, I want enemy squads to communicate, use cover, coordinate pushes and retreats, so that combat against groups feels strategic and challenging.

#### Acceptance Criteria

1. THE AI_Controller SHALL organize enemies into Squads of 2–6 members with a designated Squad leader.
2. WHEN the Squad leader detects the player, THE AI_Controller SHALL broadcast a contact alert to all Squad members within radio range (default 50 meters).
3. WHILE a Squad is in combat, THE AI_Controller SHALL assign roles: at least one member suppresses the player's position while at least one member attempts to flank.
4. WHEN a Squad member's health falls below 30%, THE AI_Controller SHALL direct that member to retreat to a designated fallback position.
5. THE AI_Controller SHALL update Squad tactics at a minimum frequency of once per second.
6. IF all Squad members other than the last survivor are eliminated, THEN THE AI_Controller SHALL transition the last survivor to an aggressive solo-assault behavior.

---

### Requirement 12: Enemy Classes

**User Story:** As a player, I want distinct enemy classes with unique capabilities, so that combat variety requires different tactical responses.

#### Acceptance Criteria

1. THE AI_Controller SHALL implement the Scout class with attributes: movement speed 1.5× base speed, health 60 HP, primary behavior of flanking and harassment.
2. THE AI_Controller SHALL implement the Heavy class with attributes: movement speed 0.6× base speed, health 300 HP, primary behavior of frontal suppression.
3. THE AI_Controller SHALL implement the Sniper class with attributes: effective engagement range ≥ 50 meters, health 80 HP, primary behavior of maintaining distance and repositioning after each shot.
4. THE AI_Controller SHALL implement the Engineer class with the ability to deploy a stationary turret that auto-targets the player within a 20-meter radius; turret deployment time is 3 seconds.
5. THE AI_Controller SHALL implement the Medic class with the ability to heal Squad members within a 10-meter radius, restoring 20 HP per second to a maximum of 80% of the target's maximum health.

---

### Requirement 13: Per-Weapon Gunplay

**User Story:** As a player, I want each weapon to have distinct recoil, spread, ADS sway, and reload behavior, so that mastering each weapon feels rewarding and skill-expressive.

#### Acceptance Criteria

1. THE Combat_System SHALL define a unique recoil pattern per weapon, expressed as a 2D kick curve (horizontal and vertical components) applied to the camera transform on each shot.
2. THE Combat_System SHALL define per-weapon spread (base accuracy cone) and bloom (spread increase per shot fired in rapid succession) that resets to base spread after a configurable cooldown.
3. WHILE the player is aiming down sights (ADS mode active), THE Combat_System SHALL apply a configurable ADS sway: a low-frequency sinusoidal camera oscillation that reduces accuracy during movement.
4. WHEN the player initiates a reload, THE Combat_System SHALL play the weapon's reload animation, enforce a weapon-specific reload duration during which the weapon cannot fire, and restore the magazine count on animation completion.
5. WHEN the player triggers a weapon inspect action while not in combat, THE Combat_System SHALL play a first-person inspect animation without interrupting movement.

---

### Requirement 14: Bullet Penetration

**User Story:** As a player, I want bullets to penetrate certain materials (wood, glass) and be stopped by others (concrete, metal), so that cover choice and positioning are tactically meaningful.

#### Acceptance Criteria

1. THE Combat_System SHALL evaluate bullet penetration using the Penetration_Table, which defines for each material: penetration resistance, velocity reduction per penetration, and maximum penetration depth.
2. WHEN a projectile strikes a surface, THE Combat_System SHALL compare the projectile's current kinetic energy to the surface material's penetration resistance value and determine whether the projectile penetrates.
3. WHEN a projectile penetrates a surface, THE Combat_System SHALL reduce the projectile's damage by the material's damage attenuation factor before applying damage on the far side.
4. THE Combat_System SHALL support the following material entries in the Penetration_Table: wood (penetrable), glass (penetrable), concrete (blocked), metal (blocked), and drywall (penetrable with high damage reduction).
5. WHEN a projectile is stopped by a surface, THE Physics_Engine SHALL spawn a surface-appropriate impact particle effect and apply a bullet-hole decal.

---

### Requirement 15: Weapon Attachments

**User Story:** As a player, I want to customize weapons with attachments (scopes, suppressors, grips, etc.), so that loadout building is expressive and strategically meaningful.

#### Acceptance Criteria

1. THE Combat_System SHALL support the following Attachment slots per eligible weapon: optic (scope), muzzle (suppressor/flash hider), underbarrel (laser/grip), magazine, and stock.
2. WHEN an optic Attachment is equipped, THE Combat_System SHALL replace the default iron-sight ADS view with the optic's defined zoom factor and reticle texture.
3. WHEN a suppressor Attachment is equipped, THE Combat_System SHALL reduce the weapon's muzzle flash size by 90%, reduce the firing sound radius by the suppressor's defined reduction value, and apply the suppressor's defined velocity penalty to projectile speed.
4. WHEN a grip Attachment is equipped, THE Combat_System SHALL apply the grip's defined recoil reduction modifier to the weapon's recoil pattern.
5. THE Combat_System SHALL validate Attachment compatibility at equip time and reject incompatible Attachment types for each weapon category.

---

### Requirement 16: Advanced Movement System

**User Story:** As a player, I want fluid, expressive movement (slides, wall runs, vaults, mantle, climb, zip lines, rope swings), so that traversal is fast, skill-expressive, and fun.

#### Acceptance Criteria

1. WHEN the player presses the slide input while sprinting, THE Movement_System SHALL reduce the player's collider height, apply a forward velocity boost, and play a slide animation lasting until the player's speed drops below a configurable threshold or the player cancels.
2. WHEN the player jumps toward a wall surface and presses the jump input while airborne, THE Movement_System SHALL initiate wall-running: orient the camera slightly toward the wall, reduce gravity, and maintain the player's horizontal velocity along the wall for a maximum of 3 seconds.
3. WHEN the player jumps while wall-running, THE Movement_System SHALL apply a wall-jump force perpendicular to the wall surface.
4. WHEN the player approaches a waist-to-shoulder-height obstacle at running speed, THE Movement_System SHALL trigger an automatic vault animation that carries the player over the obstacle.
5. WHEN the player approaches a chest-to-above-head-height ledge while jumping, THE Movement_System SHALL trigger a mantle animation that pulls the player up onto the ledge surface.
6. WHEN the player is within interaction range of a ladder, THE Movement_System SHALL enable ladder-climbing input that moves the player vertically along the ladder's defined axis.
7. WHEN the player attaches to a zip line, THE Movement_System SHALL move the player along the zip line's spline path at a configurable speed until the end point or the player releases.
8. WHEN the player grabs a rope anchor point, THE Movement_System SHALL simulate pendulum physics on the player's position, allowing directional input to increase swing amplitude.

---

### Requirement 17: Multiplayer Networking

**User Story:** As a player, I want responsive, fair multiplayer with prediction and lag compensation, so that the game feels responsive on standard consumer internet connections.

#### Acceptance Criteria

1. THE Network_Manager SHALL implement client-side prediction for player movement, applying local input immediately without waiting for server confirmation.
2. THE Network_Manager SHALL implement server reconciliation: WHEN the Game_Server returns an authoritative state that differs from the predicted state by more than a configurable threshold, THE Network_Manager SHALL smoothly correct the client's position over 3–5 frames.
3. THE Network_Manager SHALL implement entity interpolation for remote players, rendering them at a position interpolated between the two most recently received state snapshots.
4. THE Game_Server SHALL implement lag compensation: WHEN processing a hit registration, THE Game_Server SHALL rewind the game state to the time of the shot (based on the shooting client's timestamp) before evaluating the hit.
5. THE Network_Manager SHALL transmit player state updates at a minimum tick rate of 20Hz; THE Game_Server SHALL process game state at a minimum tick rate of 64Hz.
6. THE Network_Manager SHALL support both WebSocket (reliable, ordered) and WebRTC data channels (unreliable, low-latency) with automatic selection based on message type.
7. IF the Network_Manager detects a connection loss lasting more than 5 seconds, THEN THE Network_Manager SHALL attempt automatic reconnection and notify the player via the HUD.

---

### Requirement 18: Procedural Map Generation

**User Story:** As a developer and player, I want procedurally generated maps across multiple biomes, so that each session offers fresh, varied environments.

#### Acceptance Criteria

1. THE Map_Generator SHALL produce playable maps for the following biomes: city, forest, snow, desert, dungeon, and factory, each with biome-specific asset sets and layout rules.
2. WHEN generating a map, THE Map_Generator SHALL guarantee the following properties: at least 3 distinct cover zones, navigable paths between all spawn points, no blocked spawn points, and at least one elevated position per 50×50 meter area.
3. THE Map_Generator SHALL use a configurable random seed, such that the same seed and biome always produce the same map layout.
4. THE Map_Generator SHALL complete map generation for a 200×200 meter area within 5 seconds on a standard modern CPU (equivalent to or better than an Intel Core i5, 8th generation).
5. WHEN generating a city biome map, THE Map_Generator SHALL produce multi-story building interiors with navigable staircases and rooftop access points.
6. THE Map_Generator SHALL produce AI navigation meshes (nav meshes) automatically alongside map geometry so that AI_Controller pathfinding is available immediately after map generation.

---

### Requirement 19: Procedural Audio System

**User Story:** As a player, I want footstep sounds and ambient audio that change based on surface type and situation, so that audio reinforces the environment and gameplay state.

#### Acceptance Criteria

1. WHEN the player or an AI character takes a step on a surface, THE Audio_Engine SHALL select and play a footstep sound from the appropriate material-specific sound bank: wood, grass, concrete, metal, or water.
2. THE Audio_Engine SHALL apply 3D positional audio attenuation to footstep sounds using an inverse-square distance model with a configurable maximum audible range per material (default: concrete 20m, wood 15m, grass 8m, metal 25m, water 12m).
3. THE Audio_Engine SHALL implement a dynamic music system with the following states: calm (no enemies detected), alert (enemy searching), combat (active firefight), and boss_encounter; transitions between states SHALL complete within 2 seconds using a cross-fade blend.
4. WHEN the game state transitions from combat to calm (all nearby enemies neutralized), THE Audio_Engine SHALL begin the cross-fade to the calm music state after a 5-second delay.
5. THE Audio_Engine SHALL support a minimum of 32 simultaneous audio channels with automatic priority-based channel management.

---

### Requirement 20: HUD and UI System

**User Story:** As a player, I want a clear, unobtrusive HUD that displays all critical information, so that I can make informed tactical decisions without the UI blocking the game view.

#### Acceptance Criteria

1. THE HUD SHALL display the following elements simultaneously: current ammo (magazine and reserve), compass bearing, mini-map, health value, armor value, equipped ability icons with cooldown indicators, kill feed, network ping, active objective description, damage numbers, and inventory summary.
2. WHEN the player takes damage, THE HUD SHALL display a floating damage number at the screen-space position of the damage source, colored white for standard damage and red for critical damage, fading out over 1.5 seconds.
3. THE HUD SHALL render a mini-map derived from the active map's nav mesh, showing the player's position, detected enemy positions, and objective markers.
4. WHEN an objective is active, THE HUD SHALL display a waypoint marker on the compass and a world-space floating marker at the objective location, visible through walls with a reduced opacity.
5. WHEN the player's health drops below 25%, THE HUD SHALL display a screen-edge blood vignette effect that pulses at 1Hz.
6. THE HUD SHALL scale all elements correctly for screen resolutions from 1280×720 to 3840×2160 using resolution-independent layout units.

---

### Requirement 21: AI-Generated Content — Map and Mission Generation

**User Story:** As a developer, I want the AI_Content_Engine to generate maps, missions, and objectives using an LLM, so that the game can produce infinite, diverse content without manual authoring.

#### Acceptance Criteria

1. WHEN provided a biome type and a set of gameplay constraints, THE AI_Content_Engine SHALL call the configured LLM API and return a valid map generation configuration (seed, layout parameters, asset density, key point positions) within 10 seconds.
2. THE AI_Content_Engine SHALL validate the LLM-returned map configuration against a defined schema before passing it to THE Map_Generator; IF the returned configuration is invalid, THEN THE AI_Content_Engine SHALL retry the LLM request up to 3 times before falling back to a default procedural configuration.
3. WHEN a mission is requested, THE AI_Content_Engine SHALL generate a mission definition containing: objective type (elimination, extraction, defense, capture), target identifiers, success and failure conditions, and a briefing text string.
4. THE AI_Content_Engine SHALL generate NPC dialogue strings for pre-mission briefings, in-mission callouts, and post-mission debriefs on request.
5. THE AI_Content_Engine SHALL expose a structured API that accepts a content-type identifier and a context object, and returns a typed content payload, so that other game systems can request LLM-generated content without direct LLM coupling.

---

### Requirement 22: AI-Generated Content — Weapons and Enemy Balancing

**User Story:** As a developer, I want the AI_Content_Engine to generate new weapon definitions and enemy balance parameters, so that the game's content pool can expand dynamically.

#### Acceptance Criteria

1. WHEN a new weapon generation request is issued, THE AI_Content_Engine SHALL produce a weapon definition object containing: weapon category, base damage, fire rate, magazine size, recoil pattern descriptor, spread values, supported Attachment slots, and visual effect descriptors.
2. THE AI_Content_Engine SHALL validate generated weapon definitions against balance bounds (e.g., damage within [5, 150], fire rate within [60, 1200] rounds per minute) before the definition is registered with THE Combat_System.
3. WHEN an enemy balancing request is issued for a specific difficulty level, THE AI_Content_Engine SHALL produce enemy attribute overrides (health, speed, accuracy, reaction time) that respect a configurable per-difficulty balance envelope.
4. THE AI_Content_Engine SHALL log all generated content payloads with a timestamp and a content hash to a persistent store, so that generated content can be reproduced or audited.

---

### Requirement 23: Rendering Performance Contract

**User Story:** As a player, I want the game to run at 60+ FPS on capable hardware, so that gameplay is smooth and responsive.

#### Acceptance Criteria

1. THE Renderer SHALL maintain a minimum of 60 frames per second at 1920×1080 with all high-quality graphics settings active on a GPU equivalent to or better than an NVIDIA GTX 1080.
2. THE Renderer SHALL support a configurable quality preset system with at least three presets (Low, Medium, High) that adjust shadow resolution, particle count, GI quality, reflection quality, and volumetric fog density.
3. WHEN the measured frame time exceeds 20ms for 5 consecutive frames, THE Renderer SHALL automatically reduce the active quality tier by one step if adaptive quality mode is enabled.
4. THE PostFX_Pipeline SHALL execute all active post-processing passes in a single multi-pass render target chain without redundant full-screen copies.
5. THE Renderer SHALL use frustum culling and occlusion culling to exclude geometry outside the camera's view volume from the draw call list each frame.

---

### Requirement 24: Input and Controls

**User Story:** As a player, I want responsive, fully remappable controls, so that the game is accessible and feels precise on keyboard/mouse and gamepad.

#### Acceptance Criteria

1. THE Input_Manager SHALL process keyboard and mouse input with a polling interval of one frame (≤ 16ms at 60Hz), applying input immediately to the Movement_System and Combat_System.
2. THE Input_Manager SHALL support gamepad input via the Gamepad API with analog stick dead-zone calibration and configurable sensitivity curves.
3. THE Input_Manager SHALL allow full key/button remapping for all gameplay actions, persisting the mapping to browser local storage.
4. WHEN raw mouse input is available via the Pointer Lock API, THE Input_Manager SHALL use raw mouse delta values for camera aiming rather than processed cursor position.
5. THE Input_Manager SHALL apply a configurable mouse sensitivity multiplier and separate ADS sensitivity multiplier to all camera-rotation inputs.

---

### Requirement 25: Asset and Content Pipeline

**User Story:** As a developer, I want a structured asset pipeline that supports hot-reloading and LLM-injected assets, so that iteration speed is fast and AI-generated content can be integrated at runtime.

#### Acceptance Criteria

1. THE Renderer SHALL load all 3D assets in glTF 2.0 format with Draco mesh compression and KTX2 texture compression.
2. WHEN a new asset is registered by THE AI_Content_Engine at runtime, THE Renderer SHALL load and cache it without requiring a page reload.
3. THE Renderer SHALL implement texture streaming with a minimum of 4 mip levels per texture, loading higher-resolution mips only when the texture occupies more than a configurable screen-area threshold.
4. WHEN a map transition occurs, THE Renderer SHALL unload assets exclusive to the previous map and release their GPU memory within 2 seconds of the transition.
5. THE AI_Content_Engine SHALL generate procedural texture descriptors (base color, roughness, metallic, normal map parameters) that THE Renderer can synthesize on the GPU without requiring pre-authored texture files.

---

# Part 2 — Two-Mode Architecture (AI-Native Scope)

The following requirements extend the engine into a two-mode platform: a fixed Classic mode and a living AI mode. Both modes share the engine core defined in Part 1. See `design.md` for the architecture and `tasks.md` for the build plan.

---

### Requirement 26: Mode Selection and Boot Flow

**User Story:** As a player, I want to choose between a fixed Classic mode and a living AI mode at launch, so that I can play a deterministic experience or a generated, adaptive one.

#### Acceptance Criteria

1. THE Game SHALL present a mode-selection screen ("CLASSIC" / "AI") before the game world is built.
2. WHEN the player selects Classic mode, THE Game SHALL construct the world from fixed presets and SHALL NOT construct or call any LLM provider.
3. WHEN the player selects AI mode, THE Game SHALL expose the AI content panel (LLM provider, API key, prompt input) and SHALL support natural-language world requests.
4. THE Game SHALL expose a `GameMode` interface such that the engine core has no mode-specific branches; the renderer, physics, weapons, enemy AI, audio, and HUD systems SHALL be identical across modes.
5. IF the page loads with a `mode` query parameter, THE Game SHALL boot directly into the requested mode without showing the mode-selection screen.

---

### Requirement 27: Classic Mode — Fixed Content and Determinism

**User Story:** As a player, I want Classic mode to be a deterministic, replayable experience that is identical on every restart and works fully offline.

#### Acceptance Criteria

1. THE Classic mode SHALL use a hardcoded, curated map rotation of `{biome, seed}` pairs covering the 6 biome types; the same pair SHALL always produce the identical world via THE Map_Generator.
2. THE Classic mode SHALL use only weapons from THE Weapon_Catalog; no AI-generated weapons SHALL be registered.
3. THE Classic mode SHALL apply difficulty exclusively through the three fixed tuning presets (easy/normal/hard) and SHALL NOT perform live rebalancing.
4. WHEN a Classic-mode round is cleared, THE Game SHALL advance to the next entry in the map rotation (or restart the current entry if the rotation is exhausted).
5. THE Classic mode SHALL make no network calls during a session.

---

### Requirement 28: AI Director — Telemetry and Adaptive Commands

**User Story:** As a player, I want the game to watch how I play and adapt (spawns, difficulty, events, missions) so that the experience stays challenging and never boring.

#### Acceptance Criteria

1. THE Director Agent SHALL subscribe to THE Event_Bus and derive telemetry from existing events (player damage, health, kills, deaths, weapon fired, footsteps, objective progress).
2. THE Director Agent SHALL aggregate telemetry into a normalized frame exactly once per second (never per render frame).
3. THE Director Agent SHALL evaluate a local, interpretable rule table against the aggregated telemetry and SHALL emit typed adaptation commands (spawn_enemies, adjust_difficulty, set_mission, world_mutation, event_trigger, grant_content) with decision latency of at most one frame.
4. WHEN the player's health is below 25% for more than 8 seconds, THE Director Agent SHALL issue a grant_content(medkit) command with a probability of at least 0.8.
5. WHEN the player achieves a kill streak of 8 or more at difficulty below hard, THE Director Agent SHALL issue an adjust_difficulty(hard) command that ramps over at least 10 seconds.
6. WHEN the player has been idle (no movement, no firing) for more than 45 seconds, THE Director Agent SHALL issue an event_trigger to flush the player out of hiding.
7. THE Director Agent SHALL respect hard caps on spawn counts and difficulty ceilings per biome, and SHALL NOT issue commands that make the mission unwinnable.

---

### Requirement 29: Generated Missions Applied to Gameplay

**User Story:** As a player, I want AI-generated missions to change the actual gameplay — briefing text, HUD objectives, and win/lose conditions — rather than being display-only content.

#### Acceptance Criteria

1. WHEN a mission is generated or selected, THE Mission Agent SHALL apply its briefing to the HUD objective banner and trigger a pre-mission callout (a UI cue or synthesized audio chime — THE Audio_Engine has no voice-callout API today).
2. THE Mission Agent SHALL run an objective state machine for each supported objective type (elimination, extraction, defense, capture) and SHALL evaluate success and failure conditions every frame.
3. WHEN the player completes a mission's success condition, THE Game SHALL emit an ai.mission.complete event with the outcome and elapsed time.
4. WHEN the Director issues a set_mission command mid-session, THE Game SHALL swap the active objective without rebuilding the world.
5. THE Mission Agent SHALL generate missions informed by player context (health, kills, difficulty) and by the player's demonstrated play style (e.g. low health → stealth-flavored objective, explosion-heavy → convoy/destruction objective).

---

### Requirement 30: Prompt-to-World Generation and World Mutation

**User Story:** As a player, I want to describe a world in natural language ("snowy abandoned military base") and have it generated, and to change the mood live ("make it night") without reloading.

#### Acceptance Criteria

1. WHEN given a free-text prompt, THE World Agent SHALL produce a validated `WorldConfig` containing seed, biome, density, weather, timeOfDay, mood, buildings, roads, enemyCamps, difficulty, coverZones, and elevatedPositions.
2. THE World Agent SHALL validate the LLM-returned config against the schema, retrying up to 3 times before falling back to THE Procedural_Fallback_Provider.
3. IF no LLM key is configured, THE World Agent SHALL interpret the prompt by keyword (biome names, "snow"/"desert"/"night", difficulty words) and produce a matching config procedurally.
4. WHEN a world mutation (weather or time-of-day change) is requested, THE World_Mutator SHALL update fog color/density, sun and hemisphere light colors, ambient intensity, and volumetric god-ray parameters in place, WITHOUT rebuilding the world or reloading the page.
5. WHEN timeOfDay becomes "night", THE World_Mutator SHALL reduce sun intensity, tint the fog dark, and reposition/reduce the volumetric light effect accordingly.
6. WHEN weather becomes "storm", THE World_Mutator SHALL increase fog density and activate rain particles and storm ambience. NOTE: THE GPU_Particle_System has no rain emitter today — a new rain ParticleKind/emitter SHALL be added as part of this requirement.

---

### Requirement 31: Live Balance Application

**User Story:** As a developer, I want AI-generated balance payloads to actually change live enemy behavior, so that adaptive difficulty is real and testable.

#### Acceptance Criteria

1. THE Balance Agent SHALL produce `BalanceContentPayload` overrides validated against the difficulty envelope (BALANCE_ENVELOPE).
2. WHEN a balance payload is applied, THE Game SHALL apply health/speed/accuracy/reaction-time multipliers to newly spawned enemies and to existing living enemies without mutating the base ENEMY_CLASSES definitions.
3. THE Game SHALL expose the active per-session multiplier set so that other systems (HUD, Director) can read the current balance state.
4. WHEN difficulty changes, THE Balance Agent SHALL re-issue overrides within 2 seconds and ramp accuracy/damage over at least 10 seconds.

---

### Requirement 32: Persistent World Memory

**User Story:** As a player, I want the world to remember what I did in previous sessions, so that the campaign feels continuous and my actions have consequences.

#### Acceptance Criteria

1. THE Memory_System SHALL persist a structured session log (kills, deaths, missions completed, world state, key events) per save slot using localStorage only, with a bounded size of 64 KB and oldest-first eviction.
2. ON session start in AI mode, THE Memory_System SHALL summarize the memory within a bounded token budget and inject the summary into World and Mission Agent prompts.
3. THE Memory_System SHALL reference the existing generated-content history log so that previously generated maps and weapons can be recalled and re-applied.
4. IF localStorage is unavailable, THE Memory_System SHALL degrade gracefully with no error and AI mode SHALL continue without memory.

---

### Requirement 33: Squad Commander Tactics

**User Story:** As a player, I want enemy squads to execute commander-level tactics (flank, retreat, ambush, hold, search, call reinforcements) so that squad fights feel coordinated and intelligent.

#### Acceptance Criteria

1. THE Squad_Commander SHALL assign one commander brain per squad that issues orders through the existing Squad_Manager communication path.
2. THE Squad_Commander SHALL support the orders: flank, retreat, ambush, hold position, search, and call reinforcements.
3. WHEN a squad issues a call-reinforcements order, THE Game SHALL spawn a support squad via the Director within a configurable delay (default 8 seconds), respecting the global spawn cap.
4. THE Squad_Commander SHALL update orders at most once per second.

---

### Requirement 34: Creator Mode (Deferred)

**User Story:** As a creator, I want to build and edit the world through natural language ("add a castle", "make it darker", "replace zombies with robots") so that the game doubles as an AI-powered level editor.

#### Acceptance Criteria

1. Creator mode is a THIRD mode, deferred until requirements 28–33 are implemented.
2. WHEN Creator mode is active, THE Game SHALL apply incremental natural-language mutations to the live world (add/remove/restyle entities) without restarting the session.
3. THE Game SHALL expose a chat-style input panel for creator commands and a visible event log of applied mutations.
