/**
 * HUD.ts
 *
 * DOM-based HUD (Requirement 20). Elements:
 *  - Crosshair with hit marker flash
 *  - Ammo counter (magazine + reserve)
 *  - Health & armor bars
 *  - Compass bearing
 *  - Minimap (canvas) showing player + enemies + objectives
 *  - Kill feed
 *  - Damage numbers (world-space → screen-space)
 *  - Ability icons with cooldown indicators
 *  - Objective tracker + ping
 *
 * @module UI
 */
import * as THREE from 'three';
import { EventBus } from '../../engine/events/EventBus';
export interface HUDConfig {
    container: HTMLElement;
}
export declare class HUD {
    private readonly container;
    private readonly root;
    private readonly ammoEl;
    private readonly healthEl;
    private readonly healthFill;
    private readonly armorFill;
    private readonly compassEl;
    private readonly crosshair;
    private readonly hitMarkerEl;
    private readonly killFeedEl;
    private readonly damageLayer;
    private readonly damageDirLayer;
    private readonly abilityBar;
    private readonly objectiveEl;
    private readonly waveCounterEl;
    private readonly minimapCanvas;
    private readonly minimapCtx;
    private readonly vignette;
    private readonly screenFlash;
    private readonly skullerBadgeEl;
    private readonly deathBannerEl;
    private readonly bus;
    private readonly camera;
    private disposers;
    private minimapBounds;
    private minimapEnemies;
    private playerWorldPos;
    private playerYaw;
    private readonly compassPxPerDeg;
    private readonly compassCopyWidth;
    private compassStripEl;
    private compassTextEl;
    private compassPanelWidth;
    private dmgIndicators;
    private damageNumbers;
    constructor(bus: EventBus, camera: THREE.PerspectiveCamera, config: HUDConfig);
    /**
     * Inject the shared frosted-glass stylesheet once (banner, compass tape, pill chips).
     */
    private static ensureGlassStyles;
    /**
     * Build the compass tick tape: three copies of the cardinal ring so the tape
     * can always scroll beneath the fixed needle without exposing gaps.
     */
    private buildCompassStrip;
    private registerEvents;
    private onAmmo;
    private onHealth;
    private onHitMarker;
    private onKillFeed;
    private onDamage;
    private onKill;
    private onAbility;
    private onObjective;
    private onSquad;
    private spawnDamageNumber;
    /**
     * CoD-style directional damage indicator: a red arc pinned to the screen
     * edge in the direction of the damage source, fading over ~0.9s.
     */
    private showDirectionalDamage;
    private flashDamage;
    private flashKill;
    /** Headshot kill screen-edge flash (Requirement 7.2). */
    flashHeadshotKill(): void;
    /** Flashbang whiteout (Requirement 8.2). */
    flashbang(intensity: number): void;
    update(deltaTime: number): void;
    /**
     * Update external data sources: minimap bounds, enemies, player pos/yaw.
     */
    setMinimapData(bounds: {
        width: number;
        depth: number;
    }, enemies: {
        x: number;
        z: number;
        alive: boolean;
    }[], playerPos: THREE.Vector3, playerYaw: number): void;
    private renderMinimap;
    /** Set up ability icons (called by demo with the ability list). */
    initAbilities(abilities: {
        id: string;
        name: string;
    }[]): void;
    private escapeHtml;
    /**
     * Update the Skuller Headhunter rewards HUD badge.
     */
    updateSkullerBadge(skullCount: number, rankTitle: string, equippedSkinName: string): void;
    /**
     * Show dramatic animated Skuller emoji overlay on one-tap headshot kill.
     */
    showSkullerHeadshotOverlay(skullCount: number, rankTitle: string): void;
    /**
     * Display interactive Skuller Skins conversion modal.
     */
    showSkullerSkinsModal(rewards: any, onEquip: (skin: any) => void): void;
    /**
     * Bind click event on the Skuller badge in the top right HUD.
     */
    bindSkullerBadgeClick(handler: () => void): void;
    dispose(): void;
}
//# sourceMappingURL=HUD.d.ts.map