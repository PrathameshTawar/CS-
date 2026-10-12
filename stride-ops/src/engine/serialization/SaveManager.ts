/**
 * SaveManager.ts
 * 
 * Manages save/load operations for game state, with support for
 * multiple save slots, auto-save, and save file migration.
 * 
 * @module Serialization
 */

import { Serializer } from './Serializer';

/**
 * Save slot metadata
 */
export interface SaveSlot {
  id: string;
  name: string;
  timestamp: number;
  version: number;
  playTime: number;
  gameMode: string;
  level: string;
  screenshot?: string; // Base64 encoded thumbnail
  fileSize: number;
}

/**
 * Save file header
 */
interface SaveHeader {
  magic: number;
  version: number;
  slotId: string;
  timestamp: number;
  playTime: number;
  checksum: number;
}

/**
 * Auto-save configuration
 */
export interface AutoSaveConfig {
  enabled: boolean;
  interval: number; // seconds
  maxSlots: number;
  slotName: string;
}

/**
 * Save manager with slots and auto-save
 */
export class SaveManager {
  private static readonly SAVE_VERSION = 1;
  private static readonly MAGIC = 0x53415645; // "SAVE"
  private static readonly STORAGE_KEY = 'fps_engine_saves';

  private readonly slots: Map<string, SaveSlot> = new Map();
  private autoSaveTimer: number = 0;
  private autoSaveConfig: AutoSaveConfig;
  private playTime: number = 0;
  private onSave: ((slot: SaveSlot) => void) | null = null;
  private onLoad: ((slotId: string) => void) | null = null;

  constructor(autoSaveConfig?: Partial<AutoSaveConfig>) {
    this.autoSaveConfig = {
      enabled: true,
      interval: 300, // 5 minutes
      maxSlots: 3,
      slotName: 'AutoSave',
      ...autoSaveConfig,
    };

    this.loadSlotMetadata();
  }

  /**
   * Create a new save slot
   */
  createSlot(name: string): string {
    const id = this.generateSlotId();
    const slot: SaveSlot = {
      id,
      name,
      timestamp: Date.now(),
      version: SaveManager.SAVE_VERSION,
      playTime: this.playTime,
      gameMode: 'unknown',
      level: 'unknown',
      fileSize: 0,
    };
    this.slots.set(id, slot);
    this.saveSlotMetadata();
    return id;
  }

  /**
   * Save game state to a slot
   */
  async save(slotId: string, data: Record<string, any>): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) {
      throw new Error(`Save slot '${slotId}' not found.`);
    }

    // Update slot metadata
    slot.timestamp = Date.now();
    slot.playTime = this.playTime;
    slot.version = SaveManager.SAVE_VERSION;

    // Create save data package
    const savePackage = {
      header: {
        magic: SaveManager.MAGIC,
        version: SaveManager.SAVE_VERSION,
        slotId,
        timestamp: slot.timestamp,
        playTime: this.playTime,
        checksum: 0, // Will be computed
      },
      data,
    };

    // Serialize to binary
    const serialized = Serializer.toBinary(savePackage);
    slot.fileSize = serialized.byteLength;

    // Store in localStorage (indexedDB would be better for production)
    try {
      const base64 = this.arrayBufferToBase64(serialized);
      localStorage.setItem(`${SaveManager.STORAGE_KEY}_${slotId}`, base64);
    } catch (error) {
      console.error('[SaveManager] Failed to save:', error);
      throw new Error('Failed to write save data.');
    }

    this.saveSlotMetadata();
    this.onSave?.(slot);
  }

  /**
   * Load game state from a slot
   */
  async load(slotId: string): Promise<Record<string, any> | null> {
    const slot = this.slots.get(slotId);
    if (!slot) {
      throw new Error(`Save slot '${slotId}' not found.`);
    }

    try {
      const base64 = localStorage.getItem(`${SaveManager.STORAGE_KEY}_${slotId}`);
      if (!base64) return null;

      const buffer = this.base64ToArrayBuffer(base64);
      const savePackage = Serializer.fromBinary(buffer) as {
        header: SaveHeader;
        data: Record<string, any>;
      };

      // Verify header
      if (savePackage.header.magic !== SaveManager.MAGIC) {
        throw new Error('Invalid save file.');
      }

      this.playTime = savePackage.header.playTime;
      this.onLoad?.(slotId);

      return savePackage.data;
    } catch (error) {
      console.error('[SaveManager] Failed to load:', error);
      throw new Error('Failed to read save data.');
    }
  }

  /**
   * Delete a save slot
   */
  deleteSlot(slotId: string): void {
    this.slots.delete(slotId);
    localStorage.removeItem(`${SaveManager.STORAGE_KEY}_${slotId}`);
    this.saveSlotMetadata();
  }

  /**
   * Get all save slots
   */
  getSlots(): SaveSlot[] {
    return Array.from(this.slots.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a specific save slot
   */
  getSlot(slotId: string): SaveSlot | undefined {
    return this.slots.get(slotId);
  }

  /**
   * Update the game mode and level for the current save
   */
  updateContext(slotId: string, gameMode: string, level: string): void {
    const slot = this.slots.get(slotId);
    if (slot) {
      slot.gameMode = gameMode;
      slot.level = level;
      this.saveSlotMetadata();
    }
  }

  /**
   * Perform an auto-save if conditions are met
   */
  autoSave(data: Record<string, any>): void {
    if (!this.autoSaveConfig.enabled) return;

    // Find or create auto-save slot
    let autoSlot = Array.from(this.slots.values()).find(
      (s) => s.name === this.autoSaveConfig.slotName
    );

    if (!autoSlot) {
      // Check if we need to recycle old auto-saves
      const autoSaves = Array.from(this.slots.values())
        .filter((s) => s.name === this.autoSaveConfig.slotName)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (autoSaves.length >= this.autoSaveConfig.maxSlots) {
        this.deleteSlot(autoSaves[0].id);
      }

      autoSlot = {
        id: this.generateSlotId(),
        name: this.autoSaveConfig.slotName,
        timestamp: Date.now(),
        version: SaveManager.SAVE_VERSION,
        playTime: this.playTime,
        gameMode: 'unknown',
        level: 'unknown',
        fileSize: 0,
      };
      this.slots.set(autoSlot.id, autoSlot);
    }

    this.save(autoSlot.id, data).catch((error) => {
      console.error('[SaveManager] Auto-save failed:', error);
    });
  }

  /**
   * Update the play time (call each frame)
   */
  updatePlayTime(deltaTime: number): void {
    this.playTime += deltaTime;

    // Check auto-save timer
    this.autoSaveTimer += deltaTime;
    if (this.autoSaveTimer >= this.autoSaveConfig.interval) {
      this.autoSaveTimer = 0;
      // Trigger auto-save externally
    }
  }

  /**
   * Get the total play time
   */
  getPlayTime(): number {
    return this.playTime;
  }

  /**
   * Format play time as a string
   */
  static formatPlayTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  }

  /**
   * Set save/load callbacks
   */
  onSaveEvent(callback: (slot: SaveSlot) => void): void {
    this.onSave = callback;
  }

  onLoadEvent(callback: (slotId: string) => void): void {
    this.onLoad = callback;
  }

  /**
   * Generate a unique slot ID
   */
  private generateSlotId(): string {
    return `save_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Save slot metadata to localStorage
   */
  private saveSlotMetadata(): void {
    const metadata = Array.from(this.slots.values()).map((slot) => ({
      id: slot.id,
      name: slot.name,
      timestamp: slot.timestamp,
      version: slot.version,
      playTime: slot.playTime,
      gameMode: slot.gameMode,
      level: slot.level,
      fileSize: slot.fileSize,
    }));
    localStorage.setItem(
      `${SaveManager.STORAGE_KEY}_metadata`,
      JSON.stringify(metadata)
    );
  }

  /**
   * Load slot metadata from localStorage
   */
  private loadSlotMetadata(): void {
    try {
      const metadata = localStorage.getItem(`${SaveManager.STORAGE_KEY}_metadata`);
      if (metadata) {
        const slots: SaveSlot[] = JSON.parse(metadata);
        for (const slot of slots) {
          this.slots.set(slot.id, slot);
        }
      }
    } catch (error) {
      console.warn('[SaveManager] Failed to load slot metadata:', error);
    }
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert Base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Clear all save data
   */
  clearAll(): void {
    for (const slotId of this.slots.keys()) {
      localStorage.removeItem(`${SaveManager.STORAGE_KEY}_${slotId}`);
    }
    this.slots.clear();
    localStorage.removeItem(`${SaveManager.STORAGE_KEY}_metadata`);
  }

  /**
   * Dispose the save manager
   */
  dispose(): void {
    this.slots.clear();
    this.onSave = null;
    this.onLoad = null;
  }
}
