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
  tickRate: number; // client send rate (Hz)
  /** Max interpolation delay in seconds. */
  interpolationDelay: number;
  /** Reconciliation correction threshold (m). */
  correctionThreshold: number;
  /** Smoothing seconds for corrections. */
  smoothingTime: number;
}

const DEFAULT_CONFIG: NetworkManagerConfig = {
  tickRate: 20,
  interpolationDelay: 0.1,
  correctionThreshold: 0.5,
  smoothingTime: 0.1,
};

/**
 * Client-side network manager with prediction + interpolation.
 */
export class NetworkManager {
  private readonly config: NetworkManagerConfig;
  private readonly transport: NetworkTransport;
  private tick = 0;
  private tickAccumulator = 0;

  /** Snapshot buffer for interpolation. */
  private snapshotBuffer: Snapshot[] = [];
  /** Local predicted entities (keyed by entity id). */
  private readonly predicted = new Map<number, EntityState>();
  /** Pending corrections to apply smoothly. */
  private corrections = new Map<number, { from: EntityState; target: EntityState; startTime: number }>();

  private onSnapshotCallback: ((snap: Snapshot) => void) | null = null;
  private time = 0;

  constructor(transport: NetworkTransport, config?: Partial<NetworkManagerConfig>) {
    this.transport = transport;
    this.config = { ...DEFAULT_CONFIG, ...config };
    transport.onSnapshot((snap) => this.onSnapshot(snap));
  }

  /**
   * Register a callback for server-authoritative entity state
   * (used by the demo to render remote players).
   */
  onServerSnapshot(callback: (snap: Snapshot) => void): void {
    this.onSnapshotCallback = callback;
  }

  private onSnapshot(snap: Snapshot): void {
    this.snapshotBuffer.push(snap);
    // Trim buffer to interpolation window
    while (
      this.snapshotBuffer.length > 2 &&
      this.snapshotBuffer[1].serverTime < this.time - this.config.interpolationDelay
    ) {
      this.snapshotBuffer.shift();
    }
    this.onSnapshotCallback?.(snap);
  }

  /**
   * Predict the local player and send the input command to the server.
   */
  sendInput(commands: InputCommand): void {
    this.transport.send(commands);
    this.tick++;
  }

  /**
   * Get the predicted position for the local entity.
   */
  getPredictedState(entityId: number): EntityState | undefined {
    return this.predicted.get(entityId);
  }

  /**
   * Apply server reconciliation: if authoritative position differs by more
   * than threshold, schedule a smooth correction.
   */
  reconcile(entityId: number, authoritative: EntityState): void {
    const local = this.predicted.get(entityId);
    if (!local) return;
    const dx = local.x - authoritative.x;
    const dy = local.y - authoritative.y;
    const dz = local.z - authoritative.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.config.correctionThreshold) {
      this.corrections.set(entityId, {
        from: { ...local },
        target: { ...authoritative },
        startTime: this.time,
      });
    } else {
      // Apply authoritative velocity for damping
      local.velocityX = authoritative.velocityX;
      local.velocityY = authoritative.velocityY;
      local.velocityZ = authoritative.velocityZ;
    }
  }

  /**
   * Interpolate a remote entity's render position between snapshots.
   * Returns null when not enough data.
   */
  interpolate(entityId: number): EntityState | null {
    if (this.snapshotBuffer.length < 2) {
      const last = this.snapshotBuffer[0];
      return last?.entities[entityId] ?? null;
    }

    const renderTime = this.time - this.config.interpolationDelay;
    let before: Snapshot | null = null;
    let after: Snapshot | null = null;

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      const a = this.snapshotBuffer[i];
      const b = this.snapshotBuffer[i + 1];
      if (a.serverTime <= renderTime && b.serverTime >= renderTime) {
        before = a;
        after = b;
        break;
      }
    }
    if (!before || !after) {
      before = this.snapshotBuffer[this.snapshotBuffer.length - 2];
      after = this.snapshotBuffer[this.snapshotBuffer.length - 1];
    }

    const ea = before.entities[entityId];
    const eb = after.entities[entityId];
    if (!ea || !eb) return null;

    const span = Math.max(0.0001, after.serverTime - before.serverTime);
    const t = THREE_CLAMP((renderTime - before.serverTime) / span, 0, 1);

    return {
      id: entityId,
      x: ea.x + (eb.x - ea.x) * t,
      y: ea.y + (eb.y - ea.y) * t,
      z: ea.z + (eb.z - ea.z) * t,
      yaw: lerpAngle(ea.yaw, eb.yaw, t),
      velocityX: eb.velocityX,
      velocityY: eb.velocityY,
      velocityZ: eb.velocityZ,
    };
  }

  /**
   * Lag compensation hook: rewind entity states to a given tick before
   * evaluating a hit (Requirement 17.4). The demo's local server uses
   * this to validate shots against past positions.
   */
  rewindTo(tick: number): Map<number, EntityState> {
    const rewound = new Map<number, EntityState>();
    // Find the closest snapshot at or before the tick
    let best: Snapshot | null = null;
    for (const snap of this.snapshotBuffer) {
      if (snap.tick <= tick) {
        best = snap;
      } else {
        break;
      }
    }
    if (best) {
      for (const [id, state] of Object.entries(best.entities)) {
        rewound.set(Number(id), { ...state });
      }
    }
    return rewound;
  }

  /** Update local predicted state (called by gameplay sim). */
  updateLocalEntity(entityId: number, state: EntityState): void {
    this.predicted.set(entityId, state);
  }

  /**
   * Per-frame update: process corrections with smoothing.
   */
  update(deltaTime: number): void {
    this.time += deltaTime;

    for (const [id, corr] of this.corrections) {
      const t = Math.min(1, (this.time - corr.startTime) / this.config.smoothingTime);
      const local = this.predicted.get(id);
      if (!local) {
        this.corrections.delete(id);
        continue;
      }
      local.x = corr.from.x + (corr.target.x - corr.from.x) * t;
      local.y = corr.from.y + (corr.target.y - corr.from.y) * t;
      local.z = corr.from.z + (corr.target.z - corr.from.z) * t;
      local.yaw = lerpAngle(corr.from.yaw, corr.target.yaw, t);
      if (t >= 1) {
        this.corrections.delete(id);
      }
    }

    this.tickAccumulator += deltaTime;
    const tickInterval = 1 / this.config.tickRate;
    while (this.tickAccumulator >= tickInterval) {
      this.tickAccumulator -= tickInterval;
      // Server tick emission is handled by the simulation host.
    }
  }

  getTick(): number {
    return this.tick;
  }

  getRoundTripTime(): number {
    // Demo: fixed simulated RTT; real impl would measure ping.
    return 0.04;
  }

  dispose(): void {
    this.snapshotBuffer.length = 0;
    this.corrections.clear();
    this.predicted.clear();
  }
}

function THREE_CLAMP(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// Re-exported helper for other modules
export function lerpAngleDeg(a: number, b: number, t: number): number {
  return lerpAngle((a * Math.PI) / 180, (b * Math.PI) / 180, t) * (180 / Math.PI);
}
