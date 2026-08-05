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
const DEFAULT_CONFIG = {
    tickRate: 20,
    interpolationDelay: 0.1,
    correctionThreshold: 0.5,
    smoothingTime: 0.1,
};
/**
 * Client-side network manager with prediction + interpolation.
 */
export class NetworkManager {
    config;
    transport;
    tick = 0;
    tickAccumulator = 0;
    /** Snapshot buffer for interpolation. */
    snapshotBuffer = [];
    /** Local predicted entities (keyed by entity id). */
    predicted = new Map();
    /** Pending corrections to apply smoothly. */
    corrections = new Map();
    onSnapshotCallback = null;
    time = 0;
    constructor(transport, config) {
        this.transport = transport;
        this.config = { ...DEFAULT_CONFIG, ...config };
        transport.onSnapshot((snap) => this.onSnapshot(snap));
    }
    /**
     * Register a callback for server-authoritative entity state
     * (used by the demo to render remote players).
     */
    onServerSnapshot(callback) {
        this.onSnapshotCallback = callback;
    }
    onSnapshot(snap) {
        this.snapshotBuffer.push(snap);
        // Trim buffer to interpolation window
        while (this.snapshotBuffer.length > 2 &&
            this.snapshotBuffer[1].serverTime < this.time - this.config.interpolationDelay) {
            this.snapshotBuffer.shift();
        }
        this.onSnapshotCallback?.(snap);
    }
    /**
     * Predict the local player and send the input command to the server.
     */
    sendInput(commands) {
        this.transport.send(commands);
        this.tick++;
    }
    /**
     * Get the predicted position for the local entity.
     */
    getPredictedState(entityId) {
        return this.predicted.get(entityId);
    }
    /**
     * Apply server reconciliation: if authoritative position differs by more
     * than threshold, schedule a smooth correction.
     */
    reconcile(entityId, authoritative) {
        const local = this.predicted.get(entityId);
        if (!local)
            return;
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
        }
        else {
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
    interpolate(entityId) {
        if (this.snapshotBuffer.length < 2) {
            const last = this.snapshotBuffer[0];
            return last?.entities[entityId] ?? null;
        }
        const renderTime = this.time - this.config.interpolationDelay;
        let before = null;
        let after = null;
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
        if (!ea || !eb)
            return null;
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
    rewindTo(tick) {
        const rewound = new Map();
        // Find the closest snapshot at or before the tick
        let best = null;
        for (const snap of this.snapshotBuffer) {
            if (snap.tick <= tick) {
                best = snap;
            }
            else {
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
    updateLocalEntity(entityId, state) {
        this.predicted.set(entityId, state);
    }
    /**
     * Per-frame update: process corrections with smoothing.
     */
    update(deltaTime) {
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
    getTick() {
        return this.tick;
    }
    getRoundTripTime() {
        // Demo: fixed simulated RTT; real impl would measure ping.
        return 0.04;
    }
    dispose() {
        this.snapshotBuffer.length = 0;
        this.corrections.clear();
        this.predicted.clear();
    }
}
function THREE_CLAMP(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI)
        diff -= Math.PI * 2;
    while (diff < -Math.PI)
        diff += Math.PI * 2;
    return a + diff * t;
}
// Re-exported helper for other modules
export function lerpAngleDeg(a, b, t) {
    return lerpAngle((a * Math.PI) / 180, (b * Math.PI) / 180, t) * (180 / Math.PI);
}
//# sourceMappingURL=NetworkManager.js.map