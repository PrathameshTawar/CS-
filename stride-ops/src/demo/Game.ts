/**
 * Game.ts
 *
 * Demo game orchestrator. Wires the engine, render pipeline, procedural
 * map, player controller, weapon system, combat feedback, AI squads,
 * audio, HUD, and networking scaffold into a playable FPS scene.
 *
 * @module Demo
 */

import * as THREE from 'three';
import { Engine } from '../engine/core/Engine';
import { WEAPON_ORDER, DIFFICULTY_TUNING, DIFFICULTY_CEILING, MAX_LIVE_ENEMIES } from './GameConstants';
import { EventBus } from '../engine/events/EventBus';
import { RenderModule } from '../rendering/core/RenderModule';
import { Renderer } from '../rendering/core/Renderer';
import { RenderPipeline } from '../rendering/core/RenderPipeline';
import { GameplayModule } from './GameplayModule';

import { InputManager, Action } from '../gameplay/core/InputManager';
import { MapGenerator, Biome, MapLayout, BlockMaterial } from '../gameplay/maps/MapGenerator';
import { PhysicsWorld } from '../physics/core/PhysicsWorld';
import { PlayerController, MoveState } from '../gameplay/player/PlayerController';
import { WeaponSystem } from '../gameplay/weapons/WeaponSystem';
import { GAME_EVENTS, SoundEvent, DamageEvent, KillEvent, SurfaceMaterial, WeaponFireEvent, PickupEvent, SquadEvent } from '../gameplay/core/GameTypes';
import { TracerSystem } from '../rendering/effects/TracerSystem';
import { MuzzleFlash } from '../rendering/effects/MuzzleFlash';
import { CameraShake } from '../rendering/effects/CameraShake';
import { ParticleSystem, ParticleKind } from '../rendering/particles/ParticleSystem';
import { VolumetricLightEffect } from '../rendering/volumetric/VolumetricLightEffect';
import { GrenadeSystem } from '../gameplay/abilities/GrenadeSystem';
import { AbilitySystem } from '../gameplay/abilities/AbilitySystem';
import { AudioEngine } from '../audio/core/AudioEngine';
import { MusicSystem, MusicState } from '../audio/mixer/MusicSystem';
import { HUD } from '../ui/hud/HUD';
import { EnemyController } from '../ai/core/EnemyController';
import { SquadManager } from '../ai/core/SquadManager';
import { NetworkManager, Snapshot, EntityState, InputCommand, NetworkTransport } from '../networking/core/NetworkManager';
import { MapContentPayload, WeaponContentPayload, WorldContentPayload } from '../engine/content/ContentSchemas';
import { WEAPON_CATALOG, WeaponCategory, WeaponDefinition } from '../gameplay/weapons/WeaponCatalog';
import { ENEMY_CLASSES, EnemyClassDef, EnemyClassId } from '../ai/classes/EnemyClasses';

import type { AdaptationCommand, Difficulty, GameMode, GameModeId, SessionContext, WorldConfig } from '../modes/GameMode';
import { ClassicMode } from '../modes/classic/ClassicMode';
import { AIMode } from '../modes/ai/AIMode';
import { MissionAgent } from '../modes/ai/MissionAgent';
import { BalanceAgent } from '../modes/ai/BalanceAgent';
import { WorldMutator } from '../modes/ai/WorldMutator';
import { DirectorAgent, DIRECTOR_COMMAND_EVENT } from '../modes/ai/DirectorAgent';
import { MemorySystem, DEFAULT_SLOT } from '../modes/ai/MemorySystem';
import { SquadCommander } from '../modes/ai/SquadCommander';
import { ReinforcementScheduler, REINFORCEMENT_TUNING } from '../modes/ai/ReinforcementScheduler';
import { ModeSelect } from '../ui/modes/ModeSelect';
import { CreatorMode } from '../modes/creator/CreatorMode';
import { CreatorUI } from '../modes/creator/CreatorUI';
import { PickupSystem } from '../gameplay/pickups/PickupSystem';
import { createGroundMaterial, createBlockMaterial, disposeProceduralMaterial } from '../rendering/textures/ProceduralTextureFactory';
import { SkyDome } from '../rendering/environment/SkyDome';
import { WeaponViewmodel } from '../rendering/viewmodel/WeaponViewmodel';
import { EnemySoldierRig } from '../rendering/characters/EnemySoldierRig';
import { ImpactDecalSystem } from '../rendering/effects/ImpactDecalSystem';
import { CinematicFXEffect } from '../rendering/postprocessing/effects/CinematicFXEffect';
import { GameUI, GameUIHost, type SettingsPanelResult } from './GameUI';
import { GameAIContent } from './GameAIContent';
import type { GameAIHost } from './GameAIContent';
import { SkullerRewardsSystem } from '../gameplay/progression/SkullerRewardsSystem';
import { KillEffectSystem } from '../rendering/effects/KillEffectSystem';
import { DestructionSystem } from '../gameplay/core/DestructionSystem';
import { Water } from '../rendering/environment/Water';
import { GISystem } from '../rendering/lighting/GISystem';
import { AbilityFXSystem } from '../rendering/effects/AbilityFXSystem';

export type { Difficulty };

export interface DemoConfig {
  container: HTMLElement;
  /** Pre-selected mode (R26.5). Omitted → show the CLASSIC / AI boot screen. */
  mode?: GameModeId;
  biome?: Biome;
  seed?: number;
  difficulty?: Difficulty;
  /**
   * LLM API key to pre-seed into localStorage on boot (via ?llmKey=…).
   * Never written to source; only persisted in the player's browser.
   */
  llmKey?: string;
}



export class DemoGame implements GameUIHost, GameAIHost {
  private readonly config: DemoConfig;
  private readonly container: HTMLElement;
  private readonly bus = new EventBus();

  private engine: Engine | null = null;
  private renderModule: RenderModule | null = null;
  private renderer: Renderer | null = null;
  private pipeline: RenderPipeline | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private scene: THREE.Scene | null = null;

  private input!: InputManager;
  private physics!: PhysicsWorld;
  private map!: MapLayout;
  private player!: PlayerController;
  private weapons = new Map<string, WeaponSystem>();
  private currentWeaponIndex = 0;

  private tracers!: TracerSystem;
  private muzzleFlash!: MuzzleFlash;
  private shake!: CameraShake;
  private particles!: ParticleSystem;
  private volumetric!: VolumetricLightEffect;
  private grenades!: GrenadeSystem;
  private abilities!: AbilitySystem;
  private audio!: AudioEngine;
  private music!: MusicSystem;
  private hud!: HUD;

  private enemies: EnemyController[] = [];
  private squads!: SquadManager;
  private nextEnemyId = 1;

  // Enemy visuals
  private enemyMeshes = new Map<number, THREE.Group>();
  private enemyRigs = new Map<number, EnemySoldierRig>();
  private prevEnemyPos = new Map<number, THREE.Vector3>();
  private prevYaw = 0;
  private prevPitch = 0;
  private sky!: SkyDome;
  private viewmodel!: WeaponViewmodel;
  private decals!: ImpactDecalSystem;
  private killEffects!: KillEffectSystem;
  private destruction!: DestructionSystem;
  private water!: Water;
  private giSystem!: GISystem;
  private abilityFX!: AbilityFXSystem;
  private cinematicFXAdded = false;
  private blockMaterials: THREE.Material[] = [];

  // Networking scaffold
  private network!: NetworkManager;

  // Screen-space light position for god rays
  private sunScreenPos = new THREE.Vector2(0.75, 0.65);

  // Destruction: map block → mesh so destroyed blocks are removed from scene
  private blockMeshes = new Map<unknown, THREE.Mesh>();

  // Round state
  private roundActive = false;
  private totalEnemies = 0;
  private playerKills = 0;
  private systemsInitialized = false;

  // Mode + AI content engine
  private difficulty: Difficulty = 'normal';
  private modeId: GameModeId | null = null;
  private gameMode: GameMode | null = null;
  private objectiveText = 'Eliminate all hostiles';
  private modeSelect: ModeSelect | null = null;
  private disposed = false;
  private director: DirectorAgent | null = null;
  private directorDisposer: (() => void) | null = null;
  private missionCompleteDisposer: (() => void) | null = null;
  private squadCommander: SquadCommander | null = null;
  private squadCommanderDisposer: (() => void) | null = null;
  private missionAgent: MissionAgent | null = null;
  private balanceAgent: BalanceAgent | null = null;
  private creatorUI: CreatorUI | null = null;
  private creatorMutationDisposer: (() => void) | null = null;
  /** R33.3: reinforcement spawns scheduled by squad commanders, fired 8s later. */
  private reinforcementScheduler: ReinforcementScheduler | null = null;
  private pickups!: PickupSystem;
  private weaponOrder: string[] = [...WEAPON_ORDER];
  private groundMesh: THREE.Mesh | null = null;
  private worldLights: THREE.Object3D[] = [];
  private sunLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private worldMutator: WorldMutator | null = null;
  private memory: MemorySystem | null = null;
  private rainActive = false;
  private rainIntensity = 0;
  /** Current atmosphere (weather/timeOfDay), carried across rebuilds (T3.4). */
  private worldWeather: WorldConfig['weather'] = 'clear';
  private worldTimeOfDay: WorldConfig['timeOfDay'] = 'day';
  private deploying = false;
  private pauseOverlay: HTMLDivElement | null = null;
  private musicBound = false;
  private skullerRewards = new SkullerRewardsSystem();
  private ui!: GameUI;
  private aiContent!: GameAIContent;

  // Misc
  private stepTimer = 0;
  private startOverlay!: HTMLDivElement;
  private messageEl!: HTMLDivElement;
  private disposers: (() => void)[] = [];

  constructor(config: DemoConfig) {
    this.config = config;
    this.container = config.container;
    this.ui = new GameUI(this);
    this.aiContent = new GameAIContent(this);
  }

  /** Kick off the demo. */
  async start(): Promise<void> {
    // ?llmKey=… pre-seeds the browser-local API key (never in source)
    if (this.config.llmKey) this.aiContent.saveLLMKey(this.config.llmKey);
    this.bindGlobalKeys();
    this.showModeFlow();
    this.engine = new Engine({ enableProfiler: false, targetFPS: 144 });

    // Gameplay module registered FIRST so its update() runs before the
    // render module each frame (no one-frame input lag).
    await this.engine.addModule(new GameplayModule(this));

    this.renderModule = new RenderModule({
      renderer: { container: this.container, antialiasing: true },
      pipeline: {
        enableHDR: true,
        // CSM off: the pipeline's cascaded shadow maps aren't consumed by the
        // demo materials (they sample the sun's own shadow map), and the extra
        // shadow pass darkened the whole frame on several GL stacks.
        enableCSM: false,
        enableSSAO: true,
        enableBloom: true,
        enableMotionBlur: true,
        enableTAA: true,
      },
    });
    await this.engine.addModule(this.renderModule);

    await this.engine.initialize();
    this.engine.start();
  }

  /**
   * Lazily pull the initialized renderer from the render module and build
   * all gameplay systems. Called on the first update() — the engine
   * initializes modules in order, so the renderer exists by then.
   */
  ensureSystemsInitialized(): void {
    if (this.systemsInitialized) return;
    this.systemsInitialized = true;

    this.renderModule = this.engine!.getModule<RenderModule>('RenderModule')!;
    this.renderer = this.renderModule.getRenderer();
    this.pipeline = this.renderModule.getPipeline();
    this.camera = this.renderer.getCamera();
    this.scene = this.renderer.getScene();
    // Day-sky deep blue; the WorldMutator re-applies the per-time clear color.
    this.renderer.setClearColor(0x2a76c8);

    this.initSystems();
    // Re-run after initSystems(): enterMode() called setupDirector() before
    // this.squads existed (live-browser catch), so the SquadCommander needs
    // recreating with the real squad manager. Idempotent — it disposes first.
    this.setupDirector();
    this.buildMap();
    this.buildWorld();
    this.spawnEnemies();
    this.initHUD();
    this.initAudio();
    this.initNetworking();
    this.registerEvents();
    this.roundActive = true;
  }

  private initSystems(): void {
    this.input = new InputManager();
    this.audio = new AudioEngine();
    this.music = new MusicSystem();

    this.map = new MapGenerator().generate({
      biome: this.config.biome ?? Biome.City,
      seed: this.config.seed ?? 1337,
    });

    this.physics = new PhysicsWorld(this.map.blocks, this.map.bounds);
    this.player = new PlayerController(this.camera!, this.physics, this.input, undefined, {
      x: this.map.spawnPoints[0]?.x ?? 10,
      y: 2,
      z: this.map.spawnPoints[0]?.z ?? 10,
      yaw: this.map.spawnPoints[0]?.yaw ?? 0,
    });

    // Weapons
    this.weaponOrder = [...WEAPON_ORDER];
    for (const id of this.weaponOrder) {
      this.weapons.set(id, new WeaponSystem(this.bus, this.physics, this.camera!, id, { sourceId: -1, suppressed: false }));
    }

    // Effects
    this.tracers = new TracerSystem(this.scene!);
    this.muzzleFlash = new MuzzleFlash(this.camera!);
    this.shake = new CameraShake(this.camera!);
    this.particles = new ParticleSystem(this.scene!);
    this.grenades = new GrenadeSystem(this.bus);
    this.abilities = new AbilitySystem(this.bus, this.player);
    this.squads = new SquadManager(this.bus);
    this.pickups = new PickupSystem(this.scene!, this.bus);

    // Visual overhaul systems
    this.sky = new SkyDome(this.scene!);
    this.viewmodel = new WeaponViewmodel(this.camera!);
    this.decals = new ImpactDecalSystem(this.scene!);
    this.killEffects = new KillEffectSystem(this.scene!, this.particles, this.shake, this.hud);
    this.destruction = new DestructionSystem(this.bus, this.physics, this.scene!, this.particles, this.decals, this.blockMeshes as any);
    this.water = new Water(this.scene!, { width: 400, depth: 400, waterHeight: -0.5 });
    this.giSystem = new GISystem();
    this.abilityFX = new AbilityFXSystem(this.scene!);
    const initialDef = this.getCurrentWeapon()?.getDefinition();
    if (initialDef) this.viewmodel.setWeapon(initialDef.category);
  }

  private buildMap(): void {
    const scene = this.scene!;
    const palette = MapGenerator.getPalette(this.map.biome);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(this.map.bounds.width, this.map.bounds.depth);
    const groundMat = createGroundMaterial(this.map.biome, palette.groundColor, this.map.seed);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.map.bounds.width / 2, 0, this.map.bounds.depth / 2);
    ground.receiveShadow = true;
    scene.add(ground);
    this.groundMesh = ground;

    // Blocks
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const getMat = (material: BlockMaterial, color: number): THREE.MeshStandardMaterial => {
      const key = `${material}_${color}`;
      if (!materialCache.has(key)) {
        const mat = createBlockMaterial(material, color, this.map.seed);
        materialCache.set(key, mat);
        this.blockMaterials.push(mat);
      }
      return materialCache.get(key)!;
    };

    for (const block of this.map.blocks) {
      const mat = getMat(block.material, block.color);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.hx * 2, block.hy * 2, block.hz * 2), mat);
      mesh.position.set(block.x, block.y, block.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (block.material === 'glass') {
        (mesh.material as THREE.MeshStandardMaterial).transparent = true;
        (mesh.material as THREE.MeshStandardMaterial).opacity = 0.45;
        (mesh.material as THREE.MeshStandardMaterial).metalness = 0.2;
      }
      scene.add(mesh);
      this.blockMeshes.set(block, mesh);
    }

    // Lighting (CS2 Mirage High-Contrast Directional Sun)
    // Sun 4.2 / hemi 1.15 (legacy light units, see Renderer.initialize). The
    // sun stays dominant over the hemisphere for directional contrast; these
    // are also the WorldMutator base values (it re-applies on every config).
    const sun = new THREE.DirectionalLight(palette.sunColor, 4.2);
    sun.position.set(50, 70, 30);
    // The sun's PCF shadow map reads as fully-occluded on software GL stacks
    // (SwiftShader / WebKit WebGL / llvmpipe), crushing the whole scene to
    // black. Real GPUs render it correctly, so only disable shadows when the
    // Enable sun shadow map for realistic lighting. (Software GL fallback disabled for quality)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    const d = 55;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);
    this.worldLights.push(sun, sun.target);
    this.sunLight = sun;

    const hemi = new THREE.HemisphereLight(palette.skyColor, palette.groundColor, 1.15);
    scene.add(hemi);
    this.worldLights.push(hemi);
    this.hemiLight = hemi;

    // Fog
    scene.fog = new THREE.FogExp2(palette.fogColor, palette.fogDensity);

    // Volumetric effect — added to post pipeline ONCE, then retinted on rebuild
    if (!this.volumetric) {
      this.volumetric = new VolumetricLightEffect({
        fogColor: palette.fogColor,
        fogDensity: palette.fogDensity * 0.4,
      });
      // Insert at index 0 so it reads the HDR target's real depth texture
      if (this.pipeline) {
        this.volumetric.setDepthTexture(this.pipeline.getHDRPipeline().getHDRTarget().depthTexture);
        this.pipeline.getPostPipeline().addEffect(this.volumetric, 0);
      }
    } else {
      this.volumetric.setFogColor(palette.fogColor);
      this.volumetric.setFogDensity(palette.fogDensity * 0.4);
    }

    // Cinematic grade (vignette/grain/color) once, at the end of the chain
    if (!this.cinematicFXAdded) {
      this.cinematicFXAdded = true;
      this.pipeline!.getPostPipeline().addEffect(new CinematicFXEffect());
    }

    // WorldMutator targets are accessors, so it survives rebuilds even
    // though lights/fog are recreated per map (T3.4). Rebuild it each map
    // so the biome palette is fresh, carrying the current atmosphere over.
    this.worldMutator = new WorldMutator(
      {
        sun: () => this.sunLight,
        hemi: () => this.hemiLight,
        fog: () => (this.scene?.fog as THREE.FogExp2 | null) ?? null,
        volumetric: () => this.volumetric ?? null,
        renderer: () => this.renderer,
        setRain: (active: boolean, intensity: number) => {
          this.rainActive = active;
          this.rainIntensity = intensity;
        },
        setStorm: (active: boolean) => this.audio?.setStormActive(active),
        sky: () => this.sky,
      },
      this.map.biome,
      { weather: this.worldWeather, timeOfDay: this.worldTimeOfDay }
    );
  }

  private buildWorld(): void {
    // Volumetric light screen position (sun projects at upper right)
    this.volumetric.setLightScreenPosition(this.sunScreenPos.x, this.sunScreenPos.y);
  }

  private spawnEnemies(): void {
    const routeAssignments = this.map.patrolRoutes;
    const tuning = DIFFICULTY_TUNING[this.difficulty];
    const spawnCount = Math.min(tuning.count, this.map.spawnPoints.length * 2);
    const classes: EnemyClassId[] = ['scout', 'heavy', 'sniper', 'engineer', 'medic', 'scout', 'heavy', 'sniper'];

    for (let i = 0; i < spawnCount; i++) {
      const spawn = this.map.spawnPoints[(i + 1) % this.map.spawnPoints.length];
      const classId = classes[i % classes.length];
      // Difficulty-scaled clone of the class definition
      const base = ENEMY_CLASSES[classId];
      let def: EnemyClassDef;
      const bal = this.balanceAgent?.getMultiplier(classId);
      if (bal) {
        def = {
          ...base,
          health: Math.round(base.health * tuning.health * bal.healthMultiplier),
          speed: base.speed * tuning.speed * bal.speedMultiplier,
          accuracy: Math.min(0.95, base.accuracy * tuning.accuracy * bal.accuracyMultiplier),
        };
      } else {
        def = {
          ...base,
          health: Math.round(base.health * tuning.health),
          speed: base.speed * tuning.speed,
          accuracy: Math.min(0.95, base.accuracy * tuning.accuracy),
        };
      }
      const route = routeAssignments.length > 0 ? routeAssignments[i % routeAssignments.length] : undefined;

      const enemy = new EnemyController(this.bus, this.physics, {
        id: this.nextEnemyId++,
        name: `${def.name} ${i + 1}`,
        classDef: def,
        navGrid: this.map.navGrid,
        spawn: { x: spawn.x, y: 0, z: spawn.z },
        patrolRoute: route,
      });

      this.enemies.push(enemy);
      this.totalEnemies++;
      // Smoke grenades block AI line of sight (Requirement 8.1)
      enemy.setOcclusionChecker((x, y, z) => this.grenades.isInSmoke(x, y, z));
      this.createEnemyMesh(enemy);
    }

    // Squad formation: group into squads of up to 3
    for (let i = 0; i < this.enemies.length; i += 3) {
      this.squads.createSquad(this.enemies.slice(i, i + 3));
    }
  }

  private createEnemyMesh(enemy: EnemyController): void {
    const rig = new EnemySoldierRig(enemy.classDef);
    rig.group.position.copy(enemy.position);
    rig.group.rotation.y = enemy.yaw;
    this.scene!.add(rig.group);
    enemy.meshGroup = rig.group;
    this.enemyMeshes.set(enemy.id, rig.group);
    this.enemyRigs.set(enemy.id, rig);
  }

  private initHUD(): void {
    this.hud = new HUD(this.bus, this.camera!, { container: this.container });
    this.hud.initAbilities(this.abilities.getAbilities());
    this.hud.setMinimapData(
      { width: this.map.bounds.width, depth: this.map.bounds.depth },
      this.enemies.map((e) => ({ x: e.position.x, z: e.position.z, alive: e.alive })),
      this.player.getPosition(),
      this.player.state.yaw
    );
    this.updateSkullerHudBadge();
    this.hud.bindSkullerBadgeClick(() => this.openSkullerSkinsModal());
  }

  private updateSkullerHudBadge(): void {
    if (!this.hud) return;
    const current = this.skullerRewards.getSkullCount();
    const rankTitle = this.skullerRewards.getRankTitle();
    const skinName = this.skullerRewards.getEquippedSkin().name;
    this.hud.updateSkullerBadge(current, rankTitle, skinName);
  }

  private openSkullerSkinsModal(): void {
    if (!this.hud) return;
    this.hud.showSkullerSkinsModal(this.skullerRewards, (newSkin) => {
      this.updateSkullerHudBadge();
      const currentWeapon = this.getCurrentWeapon();
      if (currentWeapon && currentWeapon.getDefinition().id === 'skuller') {
        this.viewmodel.setSkinPalette(newSkin.colorPalette);
      }
    });
  }

  private initAudio(): void {
    this.audio.init();
    this.audio.resume();
    const ctx = this.audio.getContext();
    if (ctx) {
      this.music.init(ctx);
      this.music.setState(MusicState.Calm);
    }
  }

  private initNetworking(): void {
    // Local transport: echoes snapshots back (local simulation demo).
    const transport: NetworkTransport = {
      send: (_input: InputCommand) => { /* loopback: no-op */ },
      onSnapshot: (cb: (snap: Snapshot) => void) => {
        // Simulated server snapshots of the player entity
        this.disposers.push(
          this.bus.on(GAME_EVENTS.DAMAGE, () => {
            cb(this.buildSnapshot());
          })
        );
      },
    };
    this.network = new NetworkManager(transport, { tickRate: 20 });
  }

  private buildSnapshot(): Snapshot {
    const pos = this.player.getPosition();
    const state: EntityState = {
      id: 1,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: this.player.state.yaw,
      velocityX: this.player.state.velocity.x,
      velocityY: this.player.state.velocity.y,
      velocityZ: this.player.state.velocity.z,
    };
    return {
      tick: this.network.getTick(),
      serverTime: performance.now() / 1000,
      entities: { 1: state },
    };
  }

  private registerEvents(): void {
    const bus = this.bus;

    // Weapon fired → feedback chain (Requirement 6)
    this.disposers.push(
      bus.on<WeaponFireEvent>(GAME_EVENTS.WEAPON_FIRED, (e) => {
        if (e.sourceId !== -1) return; // player only
        const weapon = this.weapons.get(e.weaponId);
        const def = weapon?.getDefinition();
        if (!def) return;

        // Viewmodel recoil + muzzle flash anchored at the barrel tip
        this.viewmodel.triggerRecoil(1 - def.stability);
        this.muzzleFlash.trigger(def.flashSize, def.stability);
        const muzzleWorld = new THREE.Vector3();
        this.viewmodel.getMuzzleWorld(muzzleWorld);
        // Camera-local (the flash group is a camera child). worldToLocal uses
        // matrixWorldInverse, so force a fresh camera matrix first.
        this.camera!.updateMatrixWorld(true);
        const muzzleLocal = new THREE.Vector3();
        this.camera!.worldToLocal(muzzleLocal.copy(muzzleWorld));
        this.muzzleFlash.setOffset(muzzleLocal.x, muzzleLocal.y, muzzleLocal.z);
        this.particles.emitMuzzleFlash(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, e.direction.x, e.direction.y, e.direction.z);

        // Camera shake (inversely proportional to stability)
        this.shake.addShake((1 - def.stability) * 0.25 + 0.1, 0.1, 12);

        // Shell casing
        const right = new THREE.Vector3(e.direction.z, 0, -e.direction.x);
        this.particles.emitShellCasing(
          muzzleWorld.x + right.x * 0.3,
          muzzleWorld.y - 0.2,
          muzzleWorld.z + right.z * 0.3,
          right.x,
          right.z
        );

        // Sound
        this.audio.playGunshot(e.position, e.suppressed, e.suppressed ? 0.3 : 0.8);
      }),

      // Impact → particles + audio (Requirement 6.4)
      bus.on(GAME_EVENTS.IMPACT, (e: any) => {
        this.particles.emitImpact(e.position.x, e.position.y, e.position.z, e.normal.x, e.normal.y, e.normal.z, e.surface);
        if (e.surface === 'flesh' || e.surface === 'enemy') {
          this.decals.spawnBloodSplatter(e.position, e.normal, 0.65);
        } else {
          this.decals.spawnBulletHole(e.position, e.normal, e.surface === 'metal' ? 0.045 : 0.06);
        }
        this.audio.playImpact(e.position, e.surface as SurfaceMaterial, e.force);
      }),

      // Sound events → AI hearing + footstep audio
      bus.on<SoundEvent>(GAME_EVENTS.SOUND, (e) => {
        this.squads.onSound(e, performance.now() / 1000);
        if (e.type === 'footstep') {
          this.audio.playFootstep(e.surface ?? SurfaceMaterial.Concrete, e.position, e.volume);
        }
      }),

      // Damage events → health/armor + HUD
      bus.on<DamageEvent>(GAME_EVENTS.DAMAGE, (e) => {
        if (e.target === 'player') {
          this.player.applyDamage(e.amount);
          this.audio.playPlayerHit();
          this.bus.emit(GAME_EVENTS.HEALTH, {
            health: this.player.state.health,
            maxHealth: this.player.state.maxHealth,
            armor: this.player.state.armor,
            maxArmor: this.player.state.maxArmor,
          });
          if (this.player.state.dead) {
            this.showMessage('YOU DIED — click to respawn', true);
            this.input.requestPointerLock();
            this.memory?.recordDeath();
          }
        }
      }),

      // Kill events → kill effects (Requirement 7)
      bus.on<KillEvent>(GAME_EVENTS.KILL, (e) => {
        if (e.killerId === -1) {
          this.playerKills++;
          this.audio.playKillCue();
          if (e.worldPosition) {
            this.decals.spawnBloodPool({ x: e.worldPosition.x, y: e.worldPosition.y, z: e.worldPosition.z }, 1.2);
            if (this.killEffects) {
              this.killEffects.onKill(new THREE.Vector3(e.worldPosition.x, e.worldPosition.y, e.worldPosition.z), e.headshot);
            }
          }
          this.shake.addShake(0.3, 0.25, 8);
          this.memory?.recordKill(e.victimName ?? 'Enemy');
          this.bus.emit(GAME_EVENTS.KILL_FEED, {
            killerName: 'You',
            victimName: e.victimName,
            headshot: e.headshot,
          });

          const currentWeapon = this.getCurrentWeapon();
          const isSkullerKill = currentWeapon && currentWeapon.getDefinition().id === 'skuller';
          if (e.headshot || isSkullerKill) {
            const { current, rankTitle } = this.skullerRewards.addSkull(1);
            if (this.hud) {
              this.hud.showSkullerHeadshotOverlay(current, rankTitle);
            }
            this.updateSkullerHudBadge();
          }
        }
      }),

      // Grenade detonation → effects
      bus.on(GAME_EVENTS.GRENADE, (e: any) => {
        if (e.type === 'smoke') {
          this.particles.emitSmokeCloud(e.position.x, e.position.y, e.position.z, 7, 60);
          this.abilityFX?.spawnSmokeCloud(e.position, 8.0, 6.0);
        } else if (e.type === 'flash') {
          this.hud.flashbang(1.0);
          this.abilityFX?.triggerFlashbang(1.0);
          this.audio.playExplosion(e.position, 0.7);
        } else if (e.type === 'shock') {
          this.particles.emitEnergyBurst(e.position.x, e.position.y, e.position.z);
          this.abilityFX?.spawnElectricArcs(e.position, 5.0, 1.5);
          this.decals.spawnScorch(e.position, 1.1);
          this.audio.playExplosion(e.position, 0.9);
          this.bus.emit(GAME_EVENTS.EXPLOSION, { position: e.position, radius: 4.5, maxDamage: 250 });
        }
      }),

      // Pickup collected → apply effect (Director grants, T1.5/T1.6)
      bus.on<PickupEvent>(GAME_EVENTS.PICKUP, (e) => {
        if (e.kind === 'medkit') {
          this.player.heal(50);
        } else if (e.kind === 'ammo') {
          const w = this.getCurrentWeapon();
          if (w) w.getState().reserve += 40;
        }
        this.audio.playUIClick();
      })
    );
  }

  private showMessage(text: string, big: boolean): void {
    this.ui.showMessage(text, big);
  }

  activeOverlay(): HTMLElement {
    return this.ui.activeOverlay();
  }

  refreshHistory(root: HTMLElement): void {
    this.ui.refreshHistory(root);
  }

  escapeHTML(s: string): string {
    return this.ui.escapeHTML(s);
  }

  isPauseOpen(): boolean {
    return !!this.pauseOverlay?.isConnected;
  }

  setRoundActive(v: boolean): void {
    this.roundActive = v;
  }

  getWorldMutator(): WorldMutator | null {
    return this.worldMutator;
  }

  getMemory(): MemorySystem | null {
    return this.memory;
  }

  getWeather(): WorldConfig['weather'] {
    return this.worldWeather;
  }

  getTimeOfDay(): WorldConfig['timeOfDay'] {
    return this.worldTimeOfDay;
  }

  setWeather(v: WorldConfig['weather']): void {
    this.worldWeather = v;
  }

  setTimeOfDay(v: WorldConfig['timeOfDay']): void {
    this.worldTimeOfDay = v;
  }

  getGameMode(): GameMode | null {
    return this.gameMode;
  }

  /**
   * Apply an AI-generated map payload to the live world and sync the active
   * overlay's biome dropdown so Deploy/Resume doesn't regenerate a map.
   * Shared by AI generation and history click-to-restore.
   */
  applyAIMap(map: MapContentPayload): void {
    const currentBiome = this.map?.biome ?? Biome.City;
    const aiBiome = (Object.values(Biome) as string[]).includes(map.biome) ? (map.biome as Biome) : currentBiome;
    this.rebuildWorld(aiBiome, map.seed);
    // Keep the pause menu paused after an in-menu application
    if (this.pauseOverlay?.isConnected) this.roundActive = false;
    const activeOverlay = this.activeOverlay();
    const biomeSel = activeOverlay.querySelector('#biomeSel') as HTMLSelectElement | null;
    if (biomeSel) biomeSel.value = aiBiome;
  }

  /**
   * Apply a generated WorldConfig to the live world: rebuild the map with its
   * biome/seed, then set weather/timeOfDay via the WorldMutator (T3.4).
   */
  applyWorldConfig(wc: WorldContentPayload): void {
    const currentBiome = this.map?.biome ?? Biome.City;
    const aiBiome = (Object.values(Biome) as string[]).includes(wc.biome) ? (wc.biome as Biome) : currentBiome;
    this.rebuildWorld(aiBiome, wc.seed, {
      seed: wc.seed,
      biome: aiBiome,
      density: wc.density,
      weather: (wc.weather as WorldConfig['weather']) ?? 'clear',
      timeOfDay: (wc.timeOfDay as WorldConfig['timeOfDay']) ?? 'day',
      mood: wc.mood,
      buildings: wc.buildings,
      roads: wc.roads,
      enemyCamps: wc.enemyCamps,
      difficulty: (wc.difficulty as Difficulty) ?? this.difficulty,
      coverZones: wc.coverZones,
      elevatedPositions: wc.elevatedPositions,
    });
    if (this.pauseOverlay?.isConnected) this.roundActive = false;
  }

  /**
   * Global key + pointer-lock handling, bound once in start().
   * Escape opens/closes the in-game pause menu (which exposes mode switching
   * and the AI content panel without a page reload).
   */
  private bindGlobalKeys(): void {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P') {
        if (!this.pauseOverlay && this.roundActive && !this.startOverlay.isConnected) {
          this.openSkullerSkinsModal();
          return;
        }
      }
      if (e.code !== 'Escape') return;
      if (this.pauseOverlay) {
        this.closePauseMenu(true);
      } else if (this.roundActive && !this.startOverlay.isConnected) {
        this.openPauseMenu();
      }
    });

    // Click to re-lock pointer after an involuntary exit (e.g. pressing Esc
    // outside the pause menu). Skipped while the pause menu is open.
    document.addEventListener('pointerlockchange', () => {
      if (this.pauseOverlay) return;
      if (!document.pointerLockElement && this.roundActive && !this.startOverlay.isConnected) {
        this.messageEl.textContent = 'Click to resume';
        this.messageEl.style.fontSize = '18px';
        this.messageEl.style.opacity = '1';
        const onMouse = () => {
          this.input.requestPointerLock();
          this.messageEl.style.opacity = '0';
          document.removeEventListener('mousedown', onMouse);
        };
        document.addEventListener('mousedown', onMouse);
      }
    });
  }

  /** The mode fixed by config or ?mode= query param, if any (R26.5). */
  private fixedMode(): GameModeId | null {
    return this.config.mode ?? ModeSelect.resolveFromQuery(new URLSearchParams(window.location.search));
  }

  /** Show the CLASSIC / AI boot screen. */
  private showModeSelection(): void {
    this.modeSelect = new ModeSelect();
    this.modeSelect.show(this.container, (id) => this.enterMode(id));
  }

  /** Mode flow (R26.1, R26.5): fast-boot into a fixed mode, else boot screen. */
  private showModeFlow(): void {
    const fixed = this.fixedMode();
    if (fixed) this.enterMode(fixed);
    else this.showModeSelection();
  }

  /** Return to the mode-selection screen (or the mode's settings if fixed by URL). */
  private returnToMenu(): void {
    const fixed = this.fixedMode();
    if (fixed) this.enterMode(fixed);
    else this.showModeSelection();
  }

  /** Construct the selected mode and show its settings overlay. */
  private enterMode(id: GameModeId): void {
    this.modeSelect?.hide();
    this.modeSelect = null;
    this.modeId = id;
    this.gameMode =
      id === 'classic'
        ? new ClassicMode(this.difficulty)
        : id === 'creator'
        ? new CreatorMode(this.bus)
        : new AIMode();
    this.gameMode.reset?.();
    this.setupDirector();
    this.buildStartOverlay();
  }

  /**
   * (Re)create the AI Director for the current mode/map. Classic mode and
   * menu returns tear it down. Called on mode entry and world rebuilds.
   */
  private setupDirector(): void {
    this.directorDisposer?.();
    this.directorDisposer = null;
    this.missionCompleteDisposer?.();
    this.missionCompleteDisposer = null;
    this.creatorMutationDisposer?.();
    this.creatorMutationDisposer = null;
    this.creatorUI?.unmount();
    this.creatorUI = null;
    this.director?.dispose();
    this.director = null;
    this.squadCommanderDisposer?.();
    this.squadCommanderDisposer = null;
    this.squadCommander?.dispose();
    this.squadCommander = null;
    this.reinforcementScheduler = null;
    this.missionAgent?.dispose();
    this.missionAgent = null;
    this.balanceAgent = null;
    if (this.modeId !== 'ai') return;
    this.director = new DirectorAgent(this.bus, {
      getDifficulty: () => this.difficulty,
      difficultyCeiling: DIFFICULTY_CEILING[this.map?.biome ?? Biome.City],
      maxSpawnedEnemies: 8,
    });
    this.missionAgent = new MissionAgent(this.bus);
    this.balanceAgent = new BalanceAgent();
    this.balanceAgent.setDifficulty(this.difficulty, true);
    this.missionCompleteDisposer = this.bus.on('ai.mission.complete', (e: any) => {
      if (e.outcome === 'success') {
        this.showMessage(`★ MISSION COMPLETED: ${e.mission?.title ?? 'Objective Clear'} (${Math.round(e.elapsedTime ?? 0)}s) ★`, true);
        this.audio.playMissionCallout();
        this.memory?.recordMissionComplete(this.objectiveText);
      } else {
        this.showMessage(`✖ MISSION FAILED: ${e.mission?.title ?? 'Objective Failed'} (${e.reason ?? 'Failed'}) ✖`, true);
        this.audio.playMissionCallout();
      }
    });
    this.directorDisposer = this.bus.on(DIRECTOR_COMMAND_EVENT, (cmd: AdaptationCommand) => {
      this.executeDirectorCommand(cmd);
    });

    // T4.5/T4.6: the commander and reinforcement scheduler need this.squads,
    // which is assigned lazily by initSystems() on the first engine frame.
    // enterMode() calls setupDirector() before that (live-browser catch), so
    // guard here and let ensureSystemsInitialized() re-run setupDirector().
    if (!this.squads) return;
    this.squadCommander = new SquadCommander(this.bus, this.squads, {
      getDifficulty: () => this.difficulty,
    });
    // T4.6: a 'reinforce' order schedules a Director support-squad spawn that
    // fires after an 8s delay (R33.3, SQUAD_REINFORCE_DELAY). The scheduler's
    // cap gate stops spawns when the scene is already at MAX_LIVE_ENEMIES.
    this.reinforcementScheduler = new ReinforcementScheduler({
      canFire: () => {
        const alive = this.enemies.filter((e) => e.alive).length;
        return alive < MAX_LIVE_ENEMIES;
      },
    });
    this.squadCommanderDisposer = this.bus.on<SquadEvent>(GAME_EVENTS.SQUAD, (e) => {
      if (e.type === 'reinforce') {
        // Data-driven loadout per difficulty (R33.3): resolved at schedule time
        // so live Director escalations change the mix on the next call.
        const mix = REINFORCEMENT_TUNING[this.difficulty];
        this.reinforcementScheduler?.schedule(mix.classes.length, mix.classes);
      }
    });
  }

  /**
   * R33.3: fire reinforcement spawns that are due. The scheduler already
   * enforced the 8s delay and the MAX_LIVE_ENEMIES cap gate; spawnDirectorEnemies
   * keeps its internal cap check as a second line of defense.
   */
  private processPendingReinforcements(): void {
    if (!this.reinforcementScheduler) return;
    for (const req of this.reinforcementScheduler.poll()) {
      this.spawnDirectorEnemies({ kind: 'spawn_enemies', count: req.count, classes: req.classes, urgency: 1 });
      // R32: remember the wave so the next session's briefing recalls it.
      this.memory?.recordReinforcement(req.count, req.classes);
    }
  }

  /**
   * Lazy per-slot memory (R32.1-R32.4). Created only in AI mode so Classic
   * never constructs AI modules (R26.2); degrades gracefully to memory-only
   * when localStorage is unavailable (R32.4).
   */
  private ensureMemory(): MemorySystem | null {
    if (this.modeId !== 'ai') return null;
    if (!this.memory) {
      this.memory = new MemorySystem({
        // R32.3: the summary references the existing content-history log so
        // generated maps/weapons can be recalled and re-applied later.
        historySummary: () => this.aiContent.recallableHistoryLine(),
      });
    }
    return this.memory;
  }

  private sessionContext(biome?: Biome, seed?: number): SessionContext {
    const context: SessionContext = {
      difficulty: this.difficulty,
      ...(biome !== undefined ? { biome } : {}),
      ...(seed !== undefined ? { seed } : {}),
    };
    // R32.2: inject the bounded prior-session summary into World/Mission prompts.
    const memory = this.ensureMemory();
    if (memory) context.memorySummary = memory.summarize(DEFAULT_SLOT);
    return context;
  }

  /**
   * Deploy the selected settings into a live session. The active mode supplies
   * the world config (Classic: next rotation entry; AI: the selection), so the
   * engine core never branches on mode (R26.4).
   */
  private async deploy(panel: SettingsPanelResult): Promise<void> {
    // Guard against double-clicks: a second deploy would advance the Classic
    // rotation a second time and skip an entry.
    if (this.deploying) return;
    this.deploying = true;
    try {
      // Don't deploy mid-generation — the in-flight rebuild would swap the
      // world out from under the player right after the game starts.
      if (this.aiContent.isGenerating) {
        if (panel.statusEl) panel.statusEl.textContent = 'AI generation in progress — please wait.';
        return;
      }
      if (!this.gameMode) return;
      this.ensureSystemsInitialized();
      if (panel.apiKeyInput) this.aiContent.saveLLMKey(panel.apiKeyInput.value);

      const difficulty = panel.diffSel.value as Difficulty;
      const biome = panel.biomeSel ? (panel.biomeSel.value as Biome) : this.map.biome;
      const seed = panel.biomeSel
        ? biome === this.map.biome
          ? this.map.seed
          : undefined
        : this.map.seed;

      // T3.6: free-text prompt → World Agent (LLM or keyword fallback).
      const prompt = panel.promptInput?.value.trim();
      const aiPanel = this.modeId === 'ai';
      if (prompt && aiPanel) {
        this.aiContent.ensureWorldAgent(panel.apiKeyInput?.value ?? '');
        if (panel.statusEl) panel.statusEl.textContent = '🌍 Generating world…';
      }
      const context: SessionContext = this.sessionContext(biome, seed);
      if (prompt) context.prompt = prompt;

      // R32: start the session log once the world config is requested; the
      // summary above is captured BEFORE start so it reflects past sessions.
      this.ensureMemory()?.startSession(DEFAULT_SLOT);

      const wc: WorldConfig = await this.gameMode.nextWorldConfig(context);
      // Explicit panel selects (start menu) override the generated config —
      // they are user intent, and the no-prompt AI path always returns
      // clear/day (R30.4).
      if (aiPanel && !prompt) {
        if (panel.weatherSel) wc.weather = panel.weatherSel.value as WorldConfig['weather'];
        if (panel.timeSel) wc.timeOfDay = panel.timeSel.value as WorldConfig['timeOfDay'];
      }
      const sameWorld = wc.biome === this.map.biome && wc.seed === this.map.seed;
      if (difficulty !== this.difficulty || !sameWorld) {
        this.difficulty = difficulty;
        this.rebuildWorld(wc.biome, wc.seed, wc);
      } else {
        // Same world — apply weather/time-of-day from the generated config
        // (or the panel selects) in place, no rebuild (R30.4).
        this.worldMutator?.applyConfig(wc);
        this.worldWeather = wc.weather;
        this.worldTimeOfDay = wc.timeOfDay;
      }
      if (panel.statusEl) panel.statusEl.textContent = '✅ World ready — deploying';
      // R32.1: record the deployed world state for the active session.
      this.memory?.recordWorld({
        biome: wc.biome,
        weather: wc.weather,
        timeOfDay: wc.timeOfDay,
        mood: wc.mood,
      });
      if (panel.weatherSel) panel.weatherSel.value = wc.weather;
      if (panel.timeSel) panel.timeSel.value = wc.timeOfDay;

      this.startOverlay.remove();
      // Re-attach cleanly (avoids duplicate listeners after a main-menu return)
      this.input.detach();
      this.input.attach(this.renderer!.getDomElement(), true);
      this.audio.resume();
      this.initMusic();
      this.roundActive = true;
      const mission = await this.gameMode.nextMission(wc);
      this.objectiveText = mission?.briefing ?? 'Eliminate all hostiles';
      if (mission && this.missionAgent) {
        this.missionAgent.setMission(mission);
        this.audio.playMissionCallout();
      } else {
        this.bus.emit(GAME_EVENTS.OBJECTIVE, {
          text: this.objectiveText,
          progress: { current: 0, target: this.totalEnemies },
        });
      }
      if (this.modeId === 'creator') {
        this.setupCreatorMode();
      }
    } finally {
      this.deploying = false;
    }
  }

  private setupCreatorMode(): void {
    this.creatorMutationDisposer?.();
    this.creatorUI?.unmount();
    this.creatorUI = new CreatorUI(this.bus, (command) => {
      if (this.gameMode?.id === 'creator') {
        (this.gameMode as CreatorMode).parseAndExecuteCommand(command);
      }
    });
    this.creatorUI.mount(this.container);
    this.creatorMutationDisposer = this.bus.on('creator.mutation', (e: any) => {
      this.executeCreatorMutation(e);
    });
  }

  private executeCreatorMutation(e: any): void {
    if (e.type === 'add_entity') {
      if (e.entityType === 'enemy') {
        this.spawnDirectorEnemies({
          kind: 'spawn_enemies',
          count: 1,
          classes: [e.enemyClass || 'scout'],
          urgency: 1,
        });
        this.showMessage(`🛠 CREATOR: Spawned enemy (${e.enemyClass || 'scout'})`, true);
      } else if (e.entityType === 'cover') {
        this.spawnCreatorCoverBlock();
        this.showMessage('🛠 CREATOR: Added cover block', true);
      }
    } else if (e.type === 'remove_entity') {
      for (const enemy of this.enemies) {
        if (enemy.alive) {
          enemy.alive = false;
          const rig = this.enemyRigs.get(enemy.id);
          if (rig) rig.setDead();
        }
      }
      this.showMessage('🛠 CREATOR: Cleared all enemies', true);
    } else if (e.type === 'mutate_world') {
      if (this.worldMutator && e.mutation) {
        this.worldMutator.apply(e.mutation);
      }
      if (e.mutation?.weather) {
        this.worldWeather = e.mutation.weather;
        this.showMessage(`🛠 CREATOR: Weather set to ${e.mutation.weather}`, true);
      }
      if (e.mutation?.timeOfDay) {
        this.worldTimeOfDay = e.mutation.timeOfDay;
        this.showMessage(`🛠 CREATOR: Time of day set to ${e.mutation.timeOfDay}`, true);
      }
    } else if (e.type === 'set_difficulty') {
      this.difficulty = e.difficulty;
      this.showMessage(`🛠 CREATOR: Difficulty set to ${e.difficulty.toUpperCase()}`, true);
    } else if (e.type === 'restyle') {
      this.showMessage(`🛠 CREATOR: Restyle theme -> ${e.theme}`, true);
    }
  }

  private spawnCreatorCoverBlock(): void {
    if (!this.physics || !this.scene || !this.player) return;
    const playerPos = this.player.getPosition();
    const x = playerPos.x + 4;
    const z = playerPos.z;
    const y = this.physics.groundHeightAt(x, z) + 1;
    const block = {
      x,
      y,
      z,
      hx: 1,
      hy: 1,
      hz: 1,
      material: 'concrete' as const,
      color: 0,
      destructible: false,
    };
    this.physics.addBlock(block);
    if (this.map?.blocks) {
      this.map.blocks.push(block);
    }
    const mat = createBlockMaterial('concrete', 0, this.map?.seed || 123);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.blockMeshes.set(block, mesh);
  }

  /**
   * Execute a Director adaptation command (T1.5). Commands arrive on the
   * bus from DirectorAgent; the engine core stays mode-agnostic.
   */
  private executeDirectorCommand(cmd: AdaptationCommand): void {
    switch (cmd.kind) {
      case 'spawn_enemies':
        this.spawnDirectorEnemies(cmd);
        break;
      case 'adjust_difficulty': {
        const ceiling = DIFFICULTY_CEILING[this.map.biome] ?? 'hard';
        const target = this.clampDifficulty(cmd.difficulty, ceiling);
        if (target !== this.difficulty) {
          this.difficulty = target;
          this.balanceAgent?.setDifficulty(target, false);
          this.showMessage(`⚠ DIRECTOR: difficulty escalated to ${target.toUpperCase()}`, true);
          this.bus.emit(GAME_EVENTS.OBJECTIVE, {
            text: this.objectiveText,
            progress: { current: this.playerKills, target: this.totalEnemies },
          });
        }
        break;
      }
      case 'set_mission': {
        // T2.3: Mid-session set_mission swaps the objective without rebuilding the world (R29.4).
        this.missionAgent?.setMission(cmd.mission);
        this.objectiveText = cmd.mission.briefing || cmd.mission.title;
        this.showMessage(`🎯 NEW OBJECTIVE: ${this.objectiveText}`, true);
        this.audio.playMissionCallout(); // UI Audio feedback for mission
        this.bus.emit(GAME_EVENTS.OBJECTIVE, {
          text: this.objectiveText,
          progress: { current: this.playerKills, target: this.totalEnemies },
        });
        break;
      }
      case 'event_trigger':
        this.triggerDirectorEvent(cmd.event);
        break;
      case 'grant_content':
        this.grantDirectorContent(cmd.content);
        break;
      case 'world_mutation':
        // Live weather/time-of-day change (T3.4): apply in place, no rebuild.
        if (cmd.mutation.weather) this.worldWeather = cmd.mutation.weather;
        if (cmd.mutation.timeOfDay) this.worldTimeOfDay = cmd.mutation.timeOfDay;
        this.worldMutator?.apply(cmd.mutation);
        // R32: remember Director-driven atmosphere changes for the briefing.
        this.memory?.recordWorldMutation(cmd.mutation.weather, cmd.mutation.timeOfDay);
        this.showMessage(`🌍 WORLD MUTATED — ${cmd.mutation.weather ?? cmd.mutation.timeOfDay ?? 'atmosphere'}`, true);
        break;
    }
  }

  /** Clamp a difficulty request to the per-biome ceiling (R28.7). */
  private clampDifficulty(target: Difficulty, ceiling: Difficulty): Difficulty {
    const order: Difficulty[] = ['easy', 'normal', 'hard'];
    const ti = order.indexOf(target);
    const ci = order.indexOf(ceiling);
    return order[Math.min(ti, ci)];
  }

  /** Spawn enemies on the map for a Director spawn_enemies command. */
  private spawnDirectorEnemies(cmd: Extract<AdaptationCommand, { kind: 'spawn_enemies' }>): void {
    // Count ALIVE enemies — the array keeps dead entries (meshes hidden only).
    const alive = this.enemies.filter((e) => e.alive).length;
    if (alive >= MAX_LIVE_ENEMIES) return; // scene safety cap
    const tuning = DIFFICULTY_TUNING[this.difficulty];
    const playerPos = this.player.getPosition();
    // Prefer spawn points farthest from the player (fair spawning)
    const pool = this.map.spawnPoints
      .slice()
      .sort((a, b) => this.spawnDistance(b, playerPos) - this.spawnDistance(a, playerPos));

    const spawned: EnemyController[] = [];
    let placed = 0;
    for (let i = 0; i < pool.length && placed < cmd.count; i++) {
      const spawn = pool[i];
      if (this.spawnDistance(spawn, playerPos) < 12) continue; // keep it fair
      const classId = cmd.classes[placed % cmd.classes.length];
      const base = ENEMY_CLASSES[classId];
      let def: EnemyClassDef;
      const bal = this.balanceAgent?.getMultiplier(classId);
      if (bal) {
        def = {
          ...base,
          health: Math.round(base.health * tuning.health * bal.healthMultiplier),
          speed: base.speed * tuning.speed * bal.speedMultiplier,
          accuracy: Math.min(0.95, base.accuracy * tuning.accuracy * bal.accuracyMultiplier),
        };
      } else {
        def = {
          ...base,
          health: Math.round(base.health * tuning.health),
          speed: base.speed * tuning.speed,
          accuracy: Math.min(0.95, base.accuracy * tuning.accuracy),
        };
      }
      const enemy = new EnemyController(this.bus, this.physics, {
        id: this.nextEnemyId++,
        name: `${def.name} ${this.nextEnemyId}`,
        classDef: def,
        navGrid: this.map.navGrid,
        spawn: { x: spawn.x, y: 0, z: spawn.z },
      });
      enemy.setOcclusionChecker((x, y, z) => this.grenades.isInSmoke(x, y, z));
      this.enemies.push(enemy);
      this.totalEnemies++;
      this.createEnemyMesh(enemy);
      spawned.push(enemy);
      placed++;
    }
    for (let i = 0; i < spawned.length; i += 3) {
      this.squads.createSquad(spawned.slice(i, i + 3));
    }
    if (spawned.length > 0) {
      this.bus.emit(GAME_EVENTS.OBJECTIVE, {
        text: this.objectiveText,
        progress: { current: this.playerKills, target: this.totalEnemies },
      });
    }
  }

  private spawnDistance(sp: { x: number; z: number }, pos: THREE.Vector3): number {
    return Math.hypot(sp.x - pos.x, sp.z - pos.z);
  }

  /** Execute a Director event_trigger (explosion / ambush / airdrop). */
  private triggerDirectorEvent(event: 'explosion' | 'ambush' | 'airdrop' | 'power_outage'): void {
    const playerPos = this.player.getPosition();
    const angle = Math.random() * Math.PI * 2;
    const dist = event === 'ambush' ? 12 + Math.random() * 8 : 8 + Math.random() * 10;
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    const y = this.physics.groundHeightAt(x, z) + 0.5;

    switch (event) {
      case 'explosion': {
        // Flush the player out of hiding (R28.6) — visual cue, no direct damage.
        this.particles.emitExplosion(x, y, z);
        this.audio.playExplosion({ x, y, z }, 0.9);
        this.bus.emit(GAME_EVENTS.EXPLOSION, { position: { x, y, z }, radius: 5.0, maxDamage: 250 });
        this.shake.addShake(0.35, 0.3, 10);
        // Let enemies hear it too (Requirement 9)
        this.bus.emit<SoundEvent>(GAME_EVENTS.SOUND, {
          type: 'explosion',
          position: { x, y, z },
          radius: 60,
          volume: 1,
          sourceId: -2,
        });
        this.showMessage('💥 EXPLOSION NEARBY — keep moving!', true);
        break;
      }
      case 'ambush':
        this.spawnDirectorEnemies({ kind: 'spawn_enemies', count: 2, classes: ['scout', 'scout'], urgency: 0.8 });
        this.showMessage('⚠ AMBUSH — reinforcements inbound!', true);
        break;
      case 'airdrop': {
        this.pickups.spawn('medkit', { x, y: y + 0.4, z });
        this.pickups.spawn('ammo', { x: x + 1.5, y: y + 0.4, z: z + 1 });
        this.showMessage('📦 AIRDROP DEPLOYED', true);
        break;
      }
      case 'power_outage':
        // Requires the WorldMutator (Phase 3); no-op for now.
        break;
    }
  }

  /** Execute a Director grant_content (medkit / ammo dropped near the player). */
  private grantDirectorContent(content: 'weapon' | 'medkit' | 'ammo'): void {
    if (content === 'weapon') {
      // AI weapon generation arrives in Phase 2; nothing to drop yet.
      return;
    }
    const playerPos = this.player.getPosition();
    const fwd = this.player.getForward();
    const x = playerPos.x + fwd.x * 3.5;
    const z = playerPos.z + fwd.z * 3.5;
    const y = this.physics.groundHeightAt(x, z) + 0.4;
    if (content === 'medkit') {
      this.pickups.spawn('medkit', { x, y, z });
      this.showMessage('🧪 MEDICAL SUPPLIES DELIVERED', false);
    } else {
      this.pickups.spawn('ammo', { x, y, z });
      this.showMessage('🔫 AMMO CRATE DELIVERED', false);
    }
  }

  /** After a round clear, Classic mode advances the next rotation map (T0.6). */
  private scheduleNextClassicMap(): void {
    setTimeout(() => {
      if (this.disposed || this.gameMode?.id !== 'classic' || this.roundActive) return;
      void (async () => {
        const wc = await this.gameMode!.nextWorldConfig(this.sessionContext());
        this.difficulty = wc.difficulty;
        this.rebuildWorld(wc.biome, wc.seed);
        this.objectiveText = (await this.gameMode!.nextMission(wc))?.briefing ?? 'Eliminate all hostiles';
        this.bus.emit(GAME_EVENTS.OBJECTIVE, {
          text: this.objectiveText,
          progress: { current: 0, target: this.totalEnemies },
        });
      })().catch((err) => console.error('[Demo] auto world advance failed:', err));
    }, 3000);
  }

  private buildStartOverlay(): void {
    this.startOverlay = this.ui.startOverlay;
    this.messageEl = this.ui.messageEl;
    this.startOverlay?.remove();
    const aiPanel = this.modeId === 'ai';
    const modeLabel = aiPanel
      ? 'AI MODE — generated content · adaptive difficulty'
      : 'CLASSIC MODE — fixed maps · deterministic · offline';
    this.startOverlay = document.createElement('div');
    this.startOverlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(4,8,14,0.30) 0%,rgba(4,8,14,0.42) 45%,rgba(3,5,9,0.66) 100%);backdrop-filter:blur(3px) saturate(1.3);-webkit-backdrop-filter:blur(3px) saturate(1.3);z-index:20;color:#fff;font-family:system-ui;overflow:auto;';
    this.startOverlay.innerHTML = `
      ${this.ui.settingsStyles()}
      <h1 style="font-size:46px;margin:0 0 6px;letter-spacing:5px;text-shadow:0 0 34px rgba(80,170,255,0.45),0 2px 10px rgba(0,0,0,0.9)">STRIDE OPS</h1>
      <p style="opacity:0.7;margin:0 0 22px">${modeLabel}</p>
      <div class="so-panel">
        ${this.ui.settingsPanelHTML(aiPanel)}
        <div class="so-divider"></div>
        <div class="so-actions">
          <button id="backBtn" class="so-back" type="button">← CHANGE MODE</button>
          <button id="startBtn" style="background:#22c55e;color:#04150a">CLICK TO DEPLOY</button>
        </div>
        <div class="so-hint" style="margin-top:14px">
          WASD move · Shift sprint · Ctrl slide · Space jump · RMB aim · LMB fire · R reload<br>
          E dash · G smoke · F flash · V shock · 1-6 weapons · J inspect · Esc pause<br>
          Jump near a wall to wall-run · run at low walls to vault
        </div>
      </div>`;
    this.container.appendChild(this.startOverlay);

    const panel = this.ui.wireSettingsPanel(this.startOverlay, aiPanel);
    if (panel.biomeSel) panel.biomeSel.value = this.map?.biome ?? this.config.biome ?? Biome.City;
    panel.diffSel.value = this.difficulty ?? this.config.difficulty ?? 'normal';
    if (panel.weatherSel) panel.weatherSel.value = this.worldWeather;
    if (panel.timeSel) panel.timeSel.value = this.worldTimeOfDay;

    this.startOverlay.querySelector('#backBtn')!.addEventListener('click', () => {
      this.startOverlay.remove();
      this.returnToMenu();
    });
    this.startOverlay.querySelector('#startBtn')!.addEventListener('click', () => {
      void this.deploy(panel).catch((err) => {
        console.error('[Demo] deploy failed:', err);
        if (panel.statusEl) panel.statusEl.textContent = '❌ Deployment failed — see console.';
      });
    });

    if (this.messageEl) {
      this.messageEl.remove();
    }
    this.messageEl = document.createElement('div');
    this.messageEl.style.cssText = 'position:absolute;left:50%;top:40%;transform:translateX(-50%);color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.8);z-index:15;transition:opacity 0.5s;opacity:0;font-weight:700;';
    this.container.appendChild(this.messageEl);
  }

  /**
   * Open the in-game pause menu (Esc): freeze the simulation, release pointer
   * lock, and expose the settings/AI panel for live adjustments.
   */
  private openPauseMenu(): void {
    if (this.pauseOverlay || !this.roundActive) return;
    this.roundActive = false;
    if (document.pointerLockElement) document.exitPointerLock();

    const aiPanel = this.modeId === 'ai';
    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(5,8,12,0.8);z-index:25;color:#fff;font-family:system-ui;overflow:auto;';
    this.pauseOverlay.innerHTML = `
      ${this.ui.settingsStyles()}
      <h1 style="font-size:36px;margin:0 0 6px;letter-spacing:3px">PAUSED</h1>
      <p style="opacity:0.7;margin:0 0 20px">${aiPanel ? 'adjust the mission or generate content — changes apply on resume' : 'adjust difficulty — changes apply on resume'}</p>
      <div class="so-panel">
        ${this.ui.settingsPanelHTML(aiPanel)}
        <div class="so-divider"></div>
        <div class="so-actions">
          <button id="resumeBtn" style="background:#22c55e;color:#04150a">▶ RESUME</button>
          <button id="menuBtn" style="background:rgba(255,255,255,0.14);color:#fff">MAIN MENU</button>
        </div>
      </div>`;
    this.container.appendChild(this.pauseOverlay);

    const panel = this.ui.wireSettingsPanel(this.pauseOverlay, aiPanel);
    if (panel.biomeSel) panel.biomeSel.value = this.map.biome;
    panel.diffSel.value = this.difficulty;
    if (panel.weatherSel) panel.weatherSel.value = this.worldWeather;
    if (panel.timeSel) panel.timeSel.value = this.worldTimeOfDay;

    this.pauseOverlay.querySelector('#resumeBtn')!.addEventListener('click', () => this.closePauseMenu(true));
    this.pauseOverlay.querySelector('#menuBtn')!.addEventListener('click', () => this.closePauseMenu(false));
  }

  private closePauseMenu(resume: boolean): void {
    if (!this.pauseOverlay) return;
    if (this.aiContent.isGenerating) {
      const statusEl = this.pauseOverlay.querySelector('#aiStatus') as HTMLDivElement | null;
      if (statusEl) statusEl.textContent = 'AI generation in progress — please wait.';
      return;
    }
    const biomeSel = this.pauseOverlay.querySelector('#biomeSel') as HTMLSelectElement | null;
    const diffSel = this.pauseOverlay.querySelector('#diffSel') as HTMLSelectElement;
    const apiKeyInput = this.pauseOverlay.querySelector('#apiKey') as HTMLInputElement | null;
    const weatherSelLive = this.pauseOverlay.querySelector('#weatherSel') as HTMLSelectElement | null;
    const timeSelLive = this.pauseOverlay.querySelector('#timeSel') as HTMLSelectElement | null;
    if (apiKeyInput) this.aiContent.saveLLMKey(apiKeyInput.value);
    this.pauseOverlay.remove();
    this.pauseOverlay = null;

    if (resume) {
      const difficulty = diffSel.value as Difficulty;
      const biome = biomeSel ? (biomeSel.value as Biome) : this.map.biome;
      const sameWorld = !biomeSel || biome === this.map.biome;
      if (difficulty !== this.difficulty || !sameWorld) {
        this.difficulty = difficulty;
        this.rebuildWorld(biome, sameWorld ? this.map.seed : undefined);
      }
      if (this.modeId === 'ai' && this.worldMutator) {
        const weather = weatherSelLive?.value as WorldConfig['weather'] | undefined;
        const timeOfDay = timeSelLive?.value as WorldConfig['timeOfDay'] | undefined;
        if (weather || timeOfDay) {
          const m = {
            ...(weather ? { weather } : {}),
            ...(timeOfDay ? { timeOfDay } : {}),
          };
          this.worldMutator.apply(m);
          if (weather) this.worldWeather = weather;
          if (timeOfDay) this.worldTimeOfDay = timeOfDay;
        }
      }
      this.roundActive = true;
      this.input.requestPointerLock();
      this.bus.emit(GAME_EVENTS.OBJECTIVE, {
        text: this.objectiveText,
        progress: { current: 0, target: this.totalEnemies },
      });
    } else {
      this.returnToMenu();
    }
  }

  private initMusic(): void {
    if (this.musicBound) return;
    this.musicBound = true;
    // Music reacts to combat
    this.disposers.push(
      this.bus.on(GAME_EVENTS.KILL, () => this.music.onCombat(this.squads.getEnemyCount() > 0)),
      this.bus.on(GAME_EVENTS.SQUAD, () => this.music.onCombat(true)),
      this.bus.on(GAME_EVENTS.SOUND, () => this.music.onCombat(this.squads.getEnemyCount() > 0))
    );
  }

  /**
   * Per-frame update (driven by engine game loop).
   */
  update(deltaTime: number): void {
    this.ensureSystemsInitialized();
    if (!this.roundActive) return;

    // Vault / mantle attempt BEFORE movement, while the grounded state
    // from the previous frame is still valid.
    this.handleVaultMantle();

    // --- Player ---
    this.player.update(deltaTime);
    const playerPos = this.player.getPosition();

    // Cinematic menu drift: slow orbital sway while the start overlay is up
    // (input is detached, so the player's yaw/pitch are static — the drift is
    // pure camera motion and the player takes over cleanly on deploy).
    if (this.startOverlay?.isConnected && this.camera) {
      const t = performance.now() / 1000;
      this.camera.rotation.y += Math.sin(t * 0.09) * 0.0010 + 0.0005;
      this.camera.rotation.x += Math.sin(t * 0.13) * 0.0004;
    }

    // Pickups (Director grants) against the player's position
    this.pickups.update(deltaTime, playerPos);

    // Weapon handling
    this.handleWeapons(deltaTime);

    // Ability + grenade input
    this.handleAbilities();

    // Footsteps (procedural, per surface)
    this.handleFootsteps(deltaTime);

    // --- Grenades ---
    this.grenades.update(deltaTime);

    // --- Abilities ---
    this.abilities.update(deltaTime);

    // --- AI update ---
    const time = performance.now() / 1000;
    const playerVisible = true;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.update(deltaTime, playerPos, playerVisible, time);
      // Sync mesh + rig animation
      const mesh = this.enemyMeshes.get(enemy.id);
      const rig = this.enemyRigs.get(enemy.id);
      if (mesh) {
        mesh.position.copy(enemy.position);
        mesh.rotation.y = enemy.yaw;
      }
      if (rig) {
        const prev = this.prevEnemyPos.get(enemy.id);
        const speed = prev ? prev.distanceTo(enemy.position) / Math.max(deltaTime, 0.001) : 0;
        this.prevEnemyPos.set(enemy.id, enemy.position.clone());
        rig.update(deltaTime, { moving: speed > 0.4, speed, alive: enemy.alive });
      }
    }
    this.squads.update(deltaTime, playerPos);

    // T4.5: squad commander issues tactical orders (≤1s refresh, R33.4).
    this.squadCommander?.update(deltaTime, playerPos);
    // T4.6: fire due reinforcement spawns (8s after the call, R33.3).
    this.processPendingReinforcements();

    // --- AI Director (AI mode only) ---
    this.director?.update(deltaTime);
    this.missionAgent?.update(deltaTime);
    if (this.balanceAgent) {
      this.balanceAgent.update(deltaTime);
      if (this.balanceAgent.isTransitioning()) {
        const tuning = DIFFICULTY_TUNING[this.difficulty];
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const bal = this.balanceAgent.getMultiplier(enemy.classDef.id);
          if (bal && tuning) {
            enemy.rebalance(bal, ENEMY_CLASSES[enemy.classDef.id], tuning);
          }
        }
      }
    }

    // Dead enemies play a fall animation via their rig, then hide
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        const rig = this.enemyRigs.get(enemy.id);
        if (rig) {
          if (!rig.isDead()) rig.setDead();
          rig.update(deltaTime, { moving: false, speed: 0, alive: false });
        }
        const mesh = this.enemyMeshes.get(enemy.id);
        if (mesh) mesh.visible = !(rig?.isHidden() ?? true);
      }
    }

    // Round win check
    const aliveEnemies = this.enemies.filter((e) => e.alive).length;
    if (aliveEnemies === 0 && this.roundActive) {
      this.roundActive = false;
      this.showMessage(`ROUND CLEAR — ${this.playerKills} kills!`, true);
      this.bus.emit(GAME_EVENTS.OBJECTIVE, { text: 'Round clear!' });
      this.music.onCombat(false);
      this.memory?.recordMissionComplete(this.objectiveText);
      // T0.6: Classic mode advances the fixed rotation to the next map.
      if (this.gameMode?.id === 'classic') {
        this.scheduleNextClassicMap();
      }
    }

    // --- Effects update ---
    this.tracers.update(deltaTime);
    this.muzzleFlash.update(deltaTime);
    this.shake.update(deltaTime);
    this.particles.update(deltaTime);
    if (this.killEffects) this.killEffects.update(deltaTime);
    if (this.destruction) this.destruction.update(deltaTime);
    if (this.water) this.water.update(deltaTime, this.renderer?.getNativeRenderer(), this.scene!, this.camera!);
    if (this.giSystem) this.giSystem.update(deltaTime, this.worldLights);
    if (this.abilityFX) this.abilityFX.update(deltaTime);

    // --- Sky dome follows the camera ---
    this.sky.update(deltaTime, this.camera!);

    // --- First-person viewmodel (bob/sway/recoil/ADS) ---
    const lookDelta = { x: this.player.state.yaw - this.prevYaw, y: this.player.state.pitch - this.prevPitch };
    this.prevYaw = this.player.state.yaw;
    this.prevPitch = this.player.state.pitch;
    this.viewmodel.setADS(this.player.state.ads);
    // "J" inspect — play the viewmodel inspect animation (advertised in the
    // menu hints, now actually wired). Disabled while ADS/sprinting so the
    // pose transition reads cleanly.
    if (this.input.wasPressed(Action.Inspect) && !this.player.state.ads && !this.player.state.sprinting) {
      this.viewmodel.inspect();
    }
    this.viewmodel.update(
      deltaTime,
      {
        moving: this.player.getHorizontalSpeed() > 0.5,
        sprinting: this.player.state.sprinting,
        ads: this.player.state.ads,
        horizontalSpeed: this.player.getHorizontalSpeed(),
      },
      lookDelta
    );

    // --- Impact decals ---
    this.decals.update(deltaTime);

    // Storm rain follows the player (R30.6, T3.5)
    if (this.rainActive) {
      this.particles.emitRain(playerPos.x, playerPos.z, this.rainIntensity);
    }

    // --- Audio listener ---
    const eye = this.player.getEyePosition();
    const fwd = this.player.getForward();
    this.audio.setListenerPosition(eye.x, eye.y, eye.z);
    this.audio.setListenerOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    this.music.update(deltaTime);

    // --- Networking ---
    this.network.update(deltaTime);
    const snap = this.buildSnapshot();
    this.network.updateLocalEntity(1, snap.entities[1]);

    // --- HUD ---
    this.hud.setMinimapData(
      { width: this.map.bounds.width, depth: this.map.bounds.depth },
      this.enemies.map((e) => ({ x: e.position.x, z: e.position.z, alive: e.alive })),
      playerPos,
      this.player.state.yaw
    );
    this.hud.update(deltaTime);

    // Weapon state → HUD ammo
    const weapon = this.getCurrentWeapon();
    if (weapon) {
      const ws = weapon.getState();
      this.bus.emit(GAME_EVENTS.AMMO, {
        weaponId: ws.weaponId,
        magazine: ws.magazine,
        magazineSize: weapon.getMagazineSize(),
        reserve: ws.reserve,
        reloading: ws.reloading,
        reloadProgress: ws.reloadProgress,
      });
    }

    // Health → HUD
    this.bus.emit(GAME_EVENTS.HEALTH, {
      health: this.player.state.health,
      maxHealth: this.player.state.maxHealth,
      armor: this.player.state.armor,
      maxArmor: this.player.state.maxArmor,
    });

    this.input.endFrame();
  }

  private getCurrentWeapon(): WeaponSystem | undefined {
    return this.weapons.get(this.weaponOrder[this.currentWeaponIndex]);
  }

  /**
   * Vault / mantle attempt. Called BEFORE player.update() so the grounded
   * state from the previous frame is still valid. If a vault or mantle
   * starts, the player enters a locked animation state and the jump key
   * is consumed; otherwise the normal jump inside update() takes over.
   */
  private handleVaultMantle(): void {
    if (!this.input.wasPressed(Action.Jump)) return;
    if (!this.player.isGrounded()) return;
    this.viewmodel.triggerJumpBounce(5.5);
    if (this.player.tryVault()) return;
    this.player.tryMantle();
  }

  private handleWeapons(deltaTime: number): void {
    const weapon = this.getCurrentWeapon();
    if (!weapon) return;

    // Weapon switch
    const switchActions = [Action.Switch1, Action.Switch2, Action.Switch3, Action.Switch4, Action.Switch5, Action.Switch6];
    let newIndex = this.currentWeaponIndex;
    if (this.input.wasPressed(Action.NextWeapon)) {
      newIndex = (this.currentWeaponIndex + 1) % this.weaponOrder.length;
    } else if (this.input.wasPressed(Action.PrevWeapon)) {
      newIndex = (this.currentWeaponIndex - 1 + this.weaponOrder.length) % this.weaponOrder.length;
    } else {
      for (let i = 0; i < this.weaponOrder.length && i < switchActions.length; i++) {
        if (this.input.wasPressed(switchActions[i])) {
          newIndex = i;
          break;
        }
      }
    }

    if (newIndex !== this.currentWeaponIndex) {
      this.currentWeaponIndex = newIndex;
      const switched = this.weapons.get(this.weaponOrder[newIndex]);
      if (switched) {
        const def = switched.getDefinition();
        this.viewmodel.setWeapon(def.category);
        if (def.id === 'skuller') {
          this.viewmodel.setSkinPalette(this.skullerRewards.getEquippedSkin().colorPalette);
        }
      }
      const pos = this.player.getPosition();
      this.bus.emit(GAME_EVENTS.SOUND, {
        type: 'reload',
        position: { x: pos.x, y: pos.y, z: pos.z },
        radius: 0,
        volume: 0,
      } as SoundEvent);
      this.audio.playUIClick();
    }

    const ads = this.player.state.ads;
    const aimDir = this.getAimDirection();

    // Fire
    const firing = this.input.isDown(Action.Fire);
    if (firing && !weapon.getDefinition().automatic && this.input.wasPressed(Action.Fire)) {
      this.fireWeapon(weapon, aimDir, ads);
    } else if (firing && weapon.getDefinition().automatic) {
      this.fireWeapon(weapon, aimDir, ads);
    }

    // Reload
    if (this.input.wasPressed(Action.Reload)) {
      weapon.startReload();
      if (weapon.getState().reloading) {
        this.audio.playReload();
        this.viewmodel.reload(weapon.getDefinition().reloadTime);
      }
    }

    // Inspect
    if (this.input.wasPressed(Action.Inspect)) {
      weapon.startInspect();
    }

    // ADS FOV interpolation
    const targetFov = ads ? weapon.getDefinition().adsFov : 75;
    this.camera!.fov = THREE.MathUtils.lerp(this.camera!.fov, targetFov, Math.min(1, deltaTime * 12));
    this.camera!.updateProjectionMatrix();

    weapon.update(deltaTime, this.player.getHorizontalSpeed() > 0.5);
  }

  private fireWeapon(weapon: WeaponSystem, aimDir: THREE.Vector3, ads: boolean): void {
    const eye = this.player.getEyePosition();
    const result = weapon.fire(eye, aimDir, ads, performance.now() / 1000, 1 / 60);

    if (weapon.getState().reloading) {
      this.audio.playReload();
      this.viewmodel.reload(weapon.getDefinition().reloadTime);
    }

    if (!result) return;

    // Tracer
    if (result.hit) {
      this.tracers.spawnTracer(
        eye,
        result.hit.point,
        weapon.getDefinition().tracerColor,
        0.06
      );

      // Damage enemy if hit
      const enemy = this.findEnemyAt(result.hit.point);
      if (enemy) {
        const isSkuller = weapon.getDefinition().id === 'skuller';
        const hitHeight = result.hit.point.y - enemy.position.y;
        const isHeadshot = hitHeight > 1.35 || (isSkuller && hitHeight > 1.15);
        const finalDamage = isHeadshot ? result.damage * 4.0 : result.damage;
        enemy.applyDamage(finalDamage, -1, isHeadshot);
        this.enemyRigs.get(enemy.id)?.hitFlash();
        this.particles.emitBlood(
          enemy.position.x,
          enemy.position.y + 1,
          enemy.position.z,
          -aimDir.x,
          0,
          -aimDir.z
        );
        // Hit marker (Requirement 6.3)
        const marker = result.damage >= 80 ? 'critical' : result.damage >= 45 ? 'high' : 'hit';
        this.bus.emit(GAME_EVENTS.HIT_MARKER, { kind: marker });
        // Kill feed is emitted by the GAME_EVENTS.KILL handler on actual
        // death — no per-hit spam here.
      }
    }

    // Impact event (Requirement 6.4) — include block ref for DestructionSystem (R4)
    if (result.hit && !result.penetrated) {
      this.bus.emit(GAME_EVENTS.IMPACT, {
        position: result.hit.point,
        normal: result.hit.normal,
        surface: result.hit.surface,
        force: 0.6,
        penetrated: false,
        block: result.hit.block,
      });
    }

    // Destroy destructible blocks on hit
    if (result.hit && result.hit.block?.destructible) {
      this.destroyBlock(result.hit.block);
    }

    // Impact sound on surfaces
    if (result.hit) {
      this.audio.playImpact(result.hit.point, result.hit.surface, 0.5);
    }
  }

  private destroyBlock(block: { x: number; y: number; z: number }): void {
    // Simple destruction: emit debris (Requirement 4)
    this.particles.emitExplosion(block.x, block.y, block.z);
    this.particles.emit({
      kind: ParticleKind.Dust,
      count: 20,
      position: { x: block.x, y: block.y, z: block.z },
      spread: Math.PI,
      speed: 4,
      life: 1.5,
      size: 0.5,
      color: 0x8a7a5a,
    });
    // Remove from physics
    this.physics.removeBlock(block as any);
    // Remove the matching mesh from the scene so no invisible wall remains.
    // Geometry is per-mesh and safe to dispose; materials are shared/cached,
    // so leave them for the cache to own.
    const mesh = this.blockMeshes.get(block);
    if (mesh) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      this.blockMeshes.delete(block);
    }
  }

  private findEnemyAt(point: { x: number; y: number; z: number }): EnemyController | null {
    let closest: EnemyController | null = null;
    let closestDist = 1.2;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const d = Math.hypot(enemy.position.x - point.x, enemy.position.y + 1 - point.y, enemy.position.z - point.z);
      if (d < closestDist) {
        closestDist = d;
        closest = enemy;
      }
    }
    return closest;
  }

  private getAimDirection(): THREE.Vector3 {
    const camera = this.camera!;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    return dir;
  }

  private handleAbilities(): void {
    // Dash (E)
    if (this.input.wasPressed(Action.Dash)) {
      const fwd = this.player.getForward();
      if (this.abilities.triggerDash(fwd)) {
        this.audio.playDash();
        this.shake.addShake(0.15, 0.2, 8);
        this.abilityFX?.spawnGhostTrail(this.viewmodel?.getRoot() ?? this.player.getCamera(), 0.35);
      }
    }

    // Grenades
    if (this.input.wasPressed(Action.GrenadeSmoke)) {
      if (this.abilities.consumeGrenade('smoke')) {
        this.grenades.throwGrenade('smoke', this.player.getEyePosition(), this.getAimDirection(), -1);
        this.audio.playGrenadeThrow();
      }
    }
    if (this.input.wasPressed(Action.GrenadeFlash)) {
      if (this.abilities.consumeGrenade('flash')) {
        this.grenades.throwGrenade('flash', this.player.getEyePosition(), this.getAimDirection(), -1);
        this.audio.playGrenadeThrow();
      }
    }
    if (this.input.wasPressed(Action.GrenadeShock)) {
      if (this.abilities.consumeGrenade('shock')) {
        this.grenades.throwGrenade('shock', this.player.getEyePosition(), this.getAimDirection(), -1);
        this.audio.playGrenadeThrow();
      }
    }
  }

  private handleFootsteps(deltaTime: number): void {
    const speed = this.player.getHorizontalSpeed();
    const grounded = this.player.isGrounded();
    const state = this.player.getMoveState();

    if (grounded && speed > 0.5 && state !== MoveState.Slide && state !== MoveState.Crouch) {
      const interval = state === MoveState.Sprint ? 0.32 : 0.5;
      this.stepTimer += deltaTime;
      if (this.stepTimer >= interval) {
        this.stepTimer = 0;
        const pos = this.player.getPosition();
        const groundY = this.physics.groundHeightAt(pos.x, pos.z);
        // Determine surface from blocks at this position
        const surface = this.surfaceAt(pos.x, pos.z);
        const sound: SoundEvent = {
          type: 'footstep',
          position: { x: pos.x, y: groundY, z: pos.z },
          radius: surface === SurfaceMaterial.Metal ? 25 : surface === SurfaceMaterial.Wood ? 15 : surface === SurfaceMaterial.Grass ? 8 : 12,
          volume: state === MoveState.Sprint ? 0.9 : 0.5,
          surface,
          sourceId: -1,
        };
        this.bus.emit(GAME_EVENTS.SOUND, sound);
      }
    } else {
      this.stepTimer = 0;
    }
  }

  // ─── GameUIHost bridge methods (delegated to GameAIContent) ─────────────

  loadLLMKeyInternal(): string {
    return this.aiContent.loadLLMKeyInternal();
  }

  async generateAIMapInternal(biome: Biome, apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.aiContent.generateAIMapInternal(biome, apiKey, statusEl);
  }

  async generateAIWeaponInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.aiContent.generateAIWeaponInternal(apiKey, statusEl);
  }

  async testLLMConnectionInternal(apiKey: string, statusEl: HTMLDivElement): Promise<void> {
    await this.aiContent.testLLMConnectionInternal(apiKey, statusEl);
  }

  clearAIEngineLogInternal(): void {
    this.aiContent.clearAIEngineLogInternal();
  }

  applyHistoryEntryInternal(hash: string, statusEl: HTMLDivElement | null): void {
    this.aiContent.applyHistoryEntryInternal(hash, statusEl);
  }

  applyLiveMutationInternal(m: { weather?: WorldConfig['weather']; timeOfDay?: WorldConfig['timeOfDay'] }): void {
    this.aiContent.applyLiveMutationInternal(m);
  }

  getContentStorageInternal() { return this.aiContent.getContentStorageInternal(); }

  getRestoreNoticeInternal(): string {
    return this.aiContent.getRestoreNoticeInternal();
  }

  /**
   * Regenerate the entire world for a new biome/seed. Tears down world
   * geometry, enemies, and bound systems, then rebuilds everything.
   * An optional WorldConfig applies its weather/timeOfDay afterwards (T3.4).
   */
  rebuildWorld(biome: Biome, seed?: number, config?: WorldConfig): void {
    this.ensureSystemsInitialized();
    const scene = this.scene!;

    // Teardown world geometry
    if (this.groundMesh) {
      scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      disposeProceduralMaterial(this.groundMesh.material as THREE.Material);
      this.groundMesh = null;
    }
    for (const [, mesh] of this.blockMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.blockMeshes.clear();
    for (const mat of this.blockMaterials) disposeProceduralMaterial(mat);
    this.blockMaterials = [];
    for (const light of this.worldLights) scene.remove(light);
    this.worldLights = [];
    this.sunLight = null;
    this.hemiLight = null;

    // Teardown enemies
    for (const [, rig] of this.enemyRigs) rig.dispose();
    this.enemyRigs.clear();
    this.enemyMeshes.clear();
    this.prevEnemyPos.clear();
    this.decals?.clear();
    this.enemies = [];
    this.squads.dispose();
    this.squads = new SquadManager(this.bus);

    // Regenerate map + systems bound to it
    this.map = new MapGenerator().generate({ biome, seed: seed ?? Math.floor(Math.random() * 0xffffffff) });
    this.physics = new PhysicsWorld(this.map.blocks, this.map.bounds);
    const spawn = this.map.spawnPoints[0] ?? { x: 10, y: 2, z: 10, yaw: 0 };
    this.player = new PlayerController(this.camera!, this.physics, this.input, undefined, {
      x: spawn.x,
      y: 2,
      z: spawn.z,
      yaw: spawn.yaw ?? 0,
    });

    this.weapons.clear();
    for (const id of this.weaponOrder) {
      this.weapons.set(id, new WeaponSystem(this.bus, this.physics, this.camera!, id, { sourceId: -1, suppressed: false }));
    }
    this.grenades = new GrenadeSystem(this.bus);
    this.abilities = new AbilitySystem(this.bus, this.player);
    this.hud.initAbilities(this.abilities.getAbilities());

    this.buildMap();
    this.spawnEnemies();

    this.totalEnemies = this.enemies.length;
    this.playerKills = 0;
    this.pickups?.dispose();
    this.pickups = new PickupSystem(this.scene!, this.bus);
    // New biome → new difficulty ceiling + fresh Director session
    this.setupDirector();
    // Apply the generated world's weather/timeOfDay to the live scene (T3.4)
    if (config && this.worldMutator) {
      this.worldMutator.applyConfig(config);
      this.worldWeather = config.weather;
      this.worldTimeOfDay = config.timeOfDay;
    }
    this.roundActive = true;
  }

  /** Convert an AI weapon payload into a registered, playable weapon. */
  registerAIWeapon(payload: WeaponContentPayload): number {
    const id = `ai_weapon_${Date.now()}`;
    const category = (Object.values(WeaponCategory) as string[]).includes(payload.category)
      ? (payload.category as WeaponCategory)
      : WeaponCategory.Rifle;
    const def: WeaponDefinition = {
      id,
      name: payload.name,
      category,
      baseDamage: payload.baseDamage,
      falloff: [15, 50, 0.6],
      fireRate: payload.fireRate,
      magazineSize: payload.magazineSize,
      reserveAmmo: payload.magazineSize * 4,
      reloadTime: payload.reloadTime,
      inspectTime: 1.4,
      recoil: { vertical: payload.recoil.vertical, horizontal: payload.recoil.horizontal },
      baseSpread: payload.baseSpread,
      bloomPerShot: 0.005,
      bloomMax: 0.07,
      bloomCooldown: 0.4,
      adsZoom: 1.5,
      adsSpreadMultiplier: 0.35,
      adsFov: 55,
      swayAmount: 0.0012,
      swayFrequency: 0.9,
      bulletSpeed: 900,
      penetrationPower: 45,
      soundRadius: 40,
      tracerColor: payload.color,
      flashSize: 1.0,
      automatic: category === WeaponCategory.Rifle || category === WeaponCategory.SMG,
      pellets: category === WeaponCategory.Shotgun ? 8 : 1,
      stability: 0.7,
      attachments: { optic: true, muzzle: true, underbarrel: true, magazine: true, stock: true },
    };
    WEAPON_CATALOG[id] = def;
    this.weaponOrder.push(id);
    this.weapons.set(id, new WeaponSystem(this.bus, this.physics, this.camera!, id, { sourceId: -1, suppressed: false }));
    const slot = this.weaponOrder.length - 1;
    this.currentWeaponIndex = slot;
    return slot;
  }

  private surfaceAt(x: number, z: number): SurfaceMaterial {
    // Query the block below the player's feet
    const blocks = this.physics.getBlocks();
    for (const block of blocks) {
      if (
        x >= block.x - block.hx && x <= block.x + block.hx &&
        z >= block.z - block.hz && z <= block.z + block.hz
      ) {
        const map: Record<string, SurfaceMaterial> = {
          concrete: SurfaceMaterial.Concrete,
          wood: SurfaceMaterial.Wood,
          glass: SurfaceMaterial.Glass,
          metal: SurfaceMaterial.Metal,
          dirt: SurfaceMaterial.Dirt,
          grass: SurfaceMaterial.Grass,
          stone: SurfaceMaterial.Concrete,
        };
        return map[block.material] ?? SurfaceMaterial.Concrete;
      }
    }
    // Ground plane material by biome
    switch (this.map.biome) {
      case Biome.Forest: return SurfaceMaterial.Grass;
      case Biome.Desert: case Biome.Dungeon: return SurfaceMaterial.Dirt;
      case Biome.Snow: return SurfaceMaterial.Concrete;
      default: return SurfaceMaterial.Concrete;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.modeSelect?.hide();
    this.modeSelect = null;
    this.directorDisposer?.();
    this.directorDisposer = null;
    this.director?.dispose();
    this.director = null;
    this.squadCommanderDisposer?.();
    this.squadCommanderDisposer = null;
    this.squadCommander?.dispose();
    this.squadCommander = null;
    this.reinforcementScheduler = null;
    this.worldMutator = null;
    this.aiContent.dispose();
    this.rainActive = false;
    this.audio?.setStormActive(false);
    this.pickups?.dispose();
    this.gameMode?.dispose();
    this.gameMode = null;
    this.roundActive = false;
    // R32.1: close and persist the session log on teardown.
    this.memory?.endSession();
    this.memory = null;
    for (const d of this.disposers) d();
    this.disposers = [];
    this.hud?.dispose();
    this.tracers?.dispose();
    this.muzzleFlash?.dispose();
    this.particles?.dispose();
    this.sky?.dispose();
    this.viewmodel?.dispose();
    this.decals?.dispose();
    for (const [, rig] of this.enemyRigs) rig.dispose();
    this.enemyRigs.clear();
    if (this.groundMesh) disposeProceduralMaterial(this.groundMesh.material as THREE.Material);
    for (const mat of this.blockMaterials) disposeProceduralMaterial(mat);
    this.blockMaterials = [];
    this.audio?.dispose();
    this.input?.dispose();
    this.killEffects?.dispose();
    this.destruction?.dispose();
    this.water?.dispose();
    this.giSystem?.dispose();
    this.abilityFX?.dispose();
    this.squads?.dispose();
    this.startOverlay?.remove();
    this.pauseOverlay?.remove();
    this.messageEl?.remove();
    await this.engine?.dispose();
  }
}
