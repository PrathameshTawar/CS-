/**
 * Attachments.ts
 *
 * Weapon attachment system (Requirement 15). Attachments modify weapon
 * stats at equip time and are validated for slot compatibility.
 *
 * @module Gameplay
 */

export type AttachmentSlot = 'optic' | 'muzzle' | 'underbarrel' | 'magazine' | 'stock';

export type AttachmentId =
  | 'scope_4x'
  | 'red_dot'
  | 'suppressor'
  | 'flash_hider'
  | 'laser'
  | 'grip'
  | 'extended_mag'
  | 'quick_mag'
  | 'light_stock'
  | 'heavy_stock';

export interface AttachmentModifiers {
  /** Recoil multiplier (<1 reduces recoil). */
  recoilMultiplier?: number;
  /** Spread multiplier. */
  spreadMultiplier?: number;
  /** Muzzle flash size multiplier. */
  flashMultiplier?: number;
  /** Sound radius multiplier. */
  soundRadiusMultiplier?: number;
  /** Zoom factor (optics). */
  zoom?: number;
  /** Reload time multiplier. */
  reloadMultiplier?: number;
  /** Magazine capacity bonus. */
  magazineBonus?: number;
  /** Stability bonus (reduces camera shake). */
  stabilityBonus?: number;
  /** Bullet speed multiplier. */
  bulletSpeedMultiplier?: number;
}

export interface AttachmentDef {
  id: AttachmentId;
  name: string;
  slot: AttachmentSlot;
  description: string;
  modifiers: AttachmentModifiers;
}

export const ATTACHMENT_CATALOG: Record<AttachmentId, AttachmentDef> = {
  scope_4x: {
    id: 'scope_4x',
    name: '4x Tactical Scope',
    slot: 'optic',
    description: '4x magnification with precision reticle.',
    modifiers: { zoom: 4.0, spreadMultiplier: 0.2 },
  },
  red_dot: {
    id: 'red_dot',
    name: 'Red Dot Sight',
    slot: 'optic',
    description: '1.5x with clean red dot reticle.',
    modifiers: { zoom: 1.5, spreadMultiplier: 0.5 },
  },
  suppressor: {
    id: 'suppressor',
    name: 'Suppressor',
    slot: 'muzzle',
    description: 'Reduces sound radius and muzzle flash by 90%.',
    modifiers: { flashMultiplier: 0.1, soundRadiusMultiplier: 0.1, bulletSpeedMultiplier: 0.92 },
  },
  flash_hider: {
    id: 'flash_hider',
    name: 'Flash Hider',
    slot: 'muzzle',
    description: 'Hides muzzle flash.',
    modifiers: { flashMultiplier: 0.15 },
  },
  laser: {
    id: 'laser',
    name: 'Tactical Laser',
    slot: 'underbarrel',
    description: 'Reduces hip-fire spread while equipped.',
    modifiers: { spreadMultiplier: 0.7 },
  },
  grip: {
    id: 'grip',
    name: 'Foregrip',
    slot: 'underbarrel',
    description: 'Reduces vertical recoil by 15%.',
    modifiers: { recoilMultiplier: 0.85 },
  },
  extended_mag: {
    id: 'extended_mag',
    name: 'Extended Magazine',
    slot: 'magazine',
    description: '+50% magazine capacity.',
    modifiers: { magazineBonus: 0.5 },
  },
  quick_mag: {
    id: 'quick_mag',
    name: 'Quick-Draw Magazine',
    slot: 'magazine',
    description: 'Reloads 25% faster.',
    modifiers: { reloadMultiplier: 0.75 },
  },
  light_stock: {
    id: 'light_stock',
    name: 'Light Stock',
    slot: 'stock',
    description: 'Faster movement, slightly more recoil.',
    modifiers: { recoilMultiplier: 1.1, stabilityBonus: -0.1 },
  },
  heavy_stock: {
    id: 'heavy_stock',
    name: 'Heavy Stock',
    slot: 'stock',
    description: 'Massively reduces recoil.',
    modifiers: { recoilMultiplier: 0.8, stabilityBonus: 0.2 },
  },
};

/**
 * A weapon's current attachment loadout.
 */
export class AttachmentLoadout {
  private equipped = new Map<AttachmentSlot, AttachmentDef>();

  constructor(initial?: Partial<Record<AttachmentSlot, AttachmentId>>) {
    if (initial) {
      for (const [slot, id] of Object.entries(initial)) {
        if (id) this.equip(slot as AttachmentSlot, id);
      }
    }
  }

  /**
   * Equip an attachment. Throws if the slot is not supported by the
   * weapon or the attachment slot conflicts.
   */
  equip(slot: AttachmentSlot, id: AttachmentId, supportedSlots?: Partial<Record<AttachmentSlot, boolean>>): void {
    const def = ATTACHMENT_CATALOG[id];
    if (!def) throw new Error(`Unknown attachment: ${id}`);
    if (def.slot !== slot) throw new Error(`Attachment '${id}' belongs to slot '${def.slot}', not '${slot}'.`);
    if (supportedSlots && supportedSlots[slot] !== true) {
      throw new Error(`Slot '${slot}' is not supported by this weapon.`);
    }
    this.equipped.set(slot, def);
  }

  remove(slot: AttachmentSlot): void {
    this.equipped.delete(slot);
  }

  get(slot: AttachmentSlot): AttachmentDef | undefined {
    return this.equipped.get(slot);
  }

  getAll(): AttachmentDef[] {
    return Array.from(this.equipped.values());
  }

  /** Aggregate all modifier multipliers. */
  getModifiers(): Required<AttachmentModifiers> {
    const acc: Required<AttachmentModifiers> = {
      recoilMultiplier: 1,
      spreadMultiplier: 1,
      flashMultiplier: 1,
      soundRadiusMultiplier: 1,
      zoom: 1,
      reloadMultiplier: 1,
      magazineBonus: 0,
      stabilityBonus: 0,
      bulletSpeedMultiplier: 1,
    };
    for (const def of this.equipped.values()) {
      const m = def.modifiers;
      if (m.recoilMultiplier !== undefined) acc.recoilMultiplier *= m.recoilMultiplier;
      if (m.spreadMultiplier !== undefined) acc.spreadMultiplier *= m.spreadMultiplier;
      if (m.flashMultiplier !== undefined) acc.flashMultiplier *= m.flashMultiplier;
      if (m.soundRadiusMultiplier !== undefined) acc.soundRadiusMultiplier *= m.soundRadiusMultiplier;
      if (m.zoom !== undefined) acc.zoom *= m.zoom;
      if (m.reloadMultiplier !== undefined) acc.reloadMultiplier *= m.reloadMultiplier;
      if (m.magazineBonus !== undefined) acc.magazineBonus += m.magazineBonus;
      if (m.stabilityBonus !== undefined) acc.stabilityBonus += m.stabilityBonus;
      if (m.bulletSpeedMultiplier !== undefined) acc.bulletSpeedMultiplier *= m.bulletSpeedMultiplier;
    }
    return acc;
  }
}
