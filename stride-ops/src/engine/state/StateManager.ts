/**
 * StateManager.ts
 * 
 * Centralized state management with undo/redo support,
 * state snapshots, and reactive state subscriptions.
 * 
 * @module State
 */

import { EventBus } from '../events/EventBus';

/**
 * State change event
 */
export interface StateChangeEvent {
  key: string;
  previousValue: any;
  currentValue: any;
  timestamp: number;
}

/**
 * State snapshot for undo/redo
 */
interface StateSnapshot {
  data: Record<string, any>;
  timestamp: number;
  label: string;
}

/**
 * State validator function
 */
type StateValidator = (value: any) => boolean | string;

/**
 * State manager with undo/redo support and reactive subscriptions
 */
export class StateManager {
  private readonly state: Map<string, any> = new Map();
  private readonly defaultState: Map<string, any> = new Map();
  private readonly validators: Map<string, StateValidator> = new Map();
  private readonly listeners: Map<string, Set<(event: StateChangeEvent) => void>> = new Map();
  private readonly eventBus: EventBus;

  // Undo/redo
  private undoStack: StateSnapshot[] = [];
  private redoStack: StateSnapshot[] = [];
  private readonly maxUndoDepth: number = 50;
  private batchLevel: number = 0;
  private batchedChanges: Map<string, { previous: any; current: any }> = new Map();
  private readonly freezeState: boolean = false;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Define a state key with default value and optional validator
   */
  define(key: string, defaultValue: any, validator?: StateValidator): void {
    this.defaultState.set(key, defaultValue);
    this.state.set(key, defaultValue);
    if (validator) {
      this.validators.set(key, validator);
    }
  }

  /**
   * Get a state value by key
   */
  get<T = any>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  /**
   * Get a state value with a fallback default
   */
  getOrDefault<T = any>(key: string, fallback: T): T {
    return this.state.has(key) ? (this.state.get(key) as T) : fallback;
  }

  /**
   * Set a state value by key
   */
  set(key: string, value: any, label?: string): void {
    if (this.freezeState) {
      throw new Error('Cannot modify frozen state.');
    }

    const previousValue = this.state.get(key);

    // Validate
    const validator = this.validators.get(key);
    if (validator) {
      const result = validator(value);
      if (typeof result === 'string') {
        throw new Error(`State validation failed for '${key}': ${result}`);
      }
      if (!result) {
        throw new Error(`State validation failed for '${key}'.`);
      }
    }

    this.state.set(key, value);

    if (this.batchLevel > 0) {
      // Batch changes
      if (!this.batchedChanges.has(key)) {
        this.batchedChanges.set(key, { previous: previousValue, current: value });
      } else {
        this.batchedChanges.get(key)!.current = value;
      }
    } else {
      // Immediate notification
      this.notifyListeners(key, previousValue, value);
      this.pushUndoState(key, previousValue, value, label);
    }
  }

  /**
   * Set multiple state values at once
   */
  setMultiple(changes: Record<string, any>, label?: string): void {
    this.beginBatch();
    for (const [key, value] of Object.entries(changes)) {
      this.set(key, value);
    }
    this.endBatch(label);
  }

  /**
   * Begin a batch of state changes
   */
  beginBatch(): void {
    this.batchLevel++;
  }

  /**
   * End a batch of state changes
   */
  endBatch(label?: string): void {
    if (this.batchLevel === 0) {
      console.warn('[StateManager] Mismatched endBatch() call.');
      return;
    }

    this.batchLevel--;

    if (this.batchLevel === 0 && this.batchedChanges.size > 0) {
      // Notify all batched changes
      for (const [key, change] of this.batchedChanges) {
        this.notifyListeners(key, change.previous, change.current);
      }

      // Push a single undo state for the batch
      this.pushUndoState(
        'batch',
        null,
        null,
        label || `Batch update (${this.batchedChanges.size} keys)`
      );

      this.batchedChanges.clear();
    }
  }

  /**
   * Subscribe to changes on a specific state key
   */
  onChange(key: string, callback: (event: StateChangeEvent) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    return () => this.listeners.get(key)?.delete(callback);
  }

  /**
   * Subscribe to all state changes
   */
  onAnyChange(callback: (event: StateChangeEvent) => void): () => void {
    const disposers: (() => void)[] = [];
    const handler = (event: StateChangeEvent) => callback(event);

    // We use a wildcard approach via the event bus
    for (const key of this.state.keys()) {
      disposers.push(this.onChange(key, handler));
    }
    return () => disposers.forEach((d) => d());
  }

  /**
   * Notify listeners of a state change
   */
  private notifyListeners(key: string, previousValue: any, currentValue: any): void {
    const event: StateChangeEvent = {
      key,
      previousValue,
      currentValue,
      timestamp: performance.now(),
    };

    const listeners = this.listeners.get(key);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (error) {
          console.error(`[StateManager] Error in listener for '${key}':`, error);
        }
      }
    }

    // Also emit via event bus
    this.eventBus.emit('state.changed', { key, previousValue, currentValue });
  }

  /**
   * Push an undo state
   */
  private pushUndoState(
    key: string,
    _previousValue: any,
    _currentValue: any,
    label?: string
  ): void {
    if (key === 'batch') {
      // For batch, snapshot the entire state
      const snapshot: StateSnapshot = {
        data: this.getAll(),
        timestamp: performance.now(),
        label: label || 'State change',
      };
      this.undoStack.push(snapshot);
      this.redoStack.length = 0; // Clear redo stack on new action
    } else {
      // For individual changes, store a full snapshot
      const snapshot: StateSnapshot = {
        data: { ...this.getAll() },
        timestamp: performance.now(),
        label: label || `Set '${key}'`,
      };
      this.undoStack.push(snapshot);
      this.redoStack.length = 0; // Clear redo stack on new action
    }

    // Trim undo stack
    if (this.undoStack.length > this.maxUndoDepth) {
      this.undoStack.shift();
    }
  }

  /**
   * Check if undo is available
   */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Undo the last state change
   */
  undo(): void {
    if (!this.canUndo) return;

    const currentSnapshot: StateSnapshot = {
      data: { ...this.getAll() },
      timestamp: performance.now(),
      label: 'Undo',
    };
    this.redoStack.push(currentSnapshot);

    const snapshot = this.undoStack.pop()!;
    this.restoreSnapshot(snapshot);
  }

  /**
   * Redo the last undone state change
   */
  redo(): void {
    if (!this.canRedo) return;

    const currentSnapshot: StateSnapshot = {
      data: { ...this.getAll() },
      timestamp: performance.now(),
      label: 'Redo',
    };
    this.undoStack.push(currentSnapshot);

    const snapshot = this.redoStack.pop()!;
    this.restoreSnapshot(snapshot);
  }

  /**
   * Restore state from a snapshot
   */
  private restoreSnapshot(snapshot: StateSnapshot): void {
    this.beginBatch();
    for (const [key, value] of Object.entries(snapshot.data)) {
      if (this.state.has(key)) {
        const previous = this.state.get(key);
        this.state.set(key, value);
        this.notifyListeners(key, previous, value);
      }
    }
    this.endBatch(snapshot.label);
  }

  /**
   * Reset a state key to its default value
   */
  reset(key: string): void {
    if (this.defaultState.has(key)) {
      this.set(key, this.defaultState.get(key));
    }
  }

  /**
   * Reset all state to defaults
   */
  resetAll(): void {
    this.beginBatch();
    for (const [key, value] of this.defaultState) {
      this.set(key, value);
    }
    this.endBatch('Reset all state');
  }

  /**
   * Get all state as a plain object
   */
  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.state) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Check if a state key exists
   */
  has(key: string): boolean {
    return this.state.has(key);
  }

  /**
   * Get all state keys
   */
  get keys(): string[] {
    return Array.from(this.state.keys());
  }

  /**
   * Update the state (called each frame for time-based updates)
   */
  update(_deltaTime: number): void {
    // Time-based state cleanup or transitions handled here
  }

  /**
   * Serialize state to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * Load state from JSON
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    this.beginBatch();
    for (const [key, value] of Object.entries(data)) {
      if (this.state.has(key)) {
        this.set(key, value);
      }
    }
    this.endBatch('Load state from JSON');
  }

  /**
   * Dispose the state manager
   */
  dispose(): void {
    this.state.clear();
    this.defaultState.clear();
    this.validators.clear();
    this.listeners.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batchedChanges.clear();
  }
}
