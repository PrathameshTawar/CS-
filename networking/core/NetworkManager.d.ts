/**
 * NetworkManager.ts
 *
 * Multiplayer networking scaffold (Requirement 17). Implements the
 * client-side architecture needed for responsive multiplayer:
 *  - Client-side prediction (apply input locally immediately)
 *  - Server reconciliation (smooth correction toward authoritative state)
 *  - Entity interpolation for remote players
 *  - Lag compensation hook for hit registration (server rewinds state)
 *
 * The demo runs a local authoritative simulation in the same process;
 * the transport interface supports swapping in a real WebSocket/WebRTC
 * backend (Colyseus/Nakama) later.
 *
 * @module Networking
 */
export interface Snapshot {
    tick: number;
    entities: Record<number, EntityState>;
    serverTime: number;
}
export interface EntityState {
    id: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    velocityX: number;
    velocityY: number;
    velocityZ: number;
}
export interface InputCommand {
    tick: number;
    forward: number;
    right: number;
    jump: boolean;
    crouch: boolean;
    fire: boolean;
}
export interface NetworkTransport {
    send(input: InputCommand): void;
    onSnapshot(callback: (snap: Snapshot) => void): void;
}
export interface NetworkManagerConfig {
    tickRate: number;
    /** Max interpolation delay in seconds. */
    interpolationDelay: number;
    /** Reconciliation correction threshold (m). */
    correctionThreshold: number;
    /** Smoothing seconds for corrections. */
    smoothingTime: number;
}
/**
 * Client-side network manager with prediction + interpolation.
 */
export declare class NetworkManager {
    private readonly config;
    private readonly transport;
    private tick;
    private tickAccumulator;
    /** Snapshot buffer for interpolation. */
    private snapshotBuffer;
    /** Local predicted entities (keyed by entity id). */
    private readonly predicted;
    /** Pending corrections to apply smoothly. */
    private corrections;
    private onSnapshotCallback;
    private time;
    constructor(transport: NetworkTransport, config?: Partial<NetworkManagerConfig>);
    /**
     * Register a callback for server-authoritative entity state
     * (used by the demo to render remote players).
     */
    onServerSnapshot(callback: (snap: Snapshot) => void): void;
    private onSnapshot;
    /**
     * Predict the local player and send the input command to the server.
     */
    sendInput(commands: InputCommand): void;
    /**
     * Get the predicted position for the local entity.
     */
    getPredictedState(entityId: number): EntityState | undefined;
    /**
     * Apply server reconciliation: if authoritative position differs by more
     * than threshold, schedule a smooth correction.
     */
    reconcile(entityId: number, authoritative: EntityState): void;
    /**
     * Interpolate a remote entity's render position between snapshots.
     * Returns null when not enough data.
     */
    interpolate(entityId: number): EntityState | null;
    /**
     * Lag compensation hook: rewind entity states to a given tick before
     * evaluating a hit (Requirement 17.4). The demo's local server uses
     * this to validate shots against past positions.
     */
    rewindTo(tick: number): Map<number, EntityState>;
    /** Update local predicted state (called by gameplay sim). */
    updateLocalEntity(entityId: number, state: EntityState): void;
    /**
     * Per-frame update: process corrections with smoothing.
     */
    update(deltaTime: number): void;
    getTick(): number;
    getRoundTripTime(): number;
    dispose(): void;
}
export declare function lerpAngleDeg(a: number, b: number, t: number): number;
//# sourceMappingURL=NetworkManager.d.ts.map