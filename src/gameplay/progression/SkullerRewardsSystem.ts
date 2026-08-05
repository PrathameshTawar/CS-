/**
 * SkullerRewardsSystem.ts
 *
 * Manages the Skuller headhunter progression:
 * - Tracks Skull Emoji tokens (💀) collected from one-tap headshots
 * - Calculates Headhunter player rank titles based on skull counts
 * - Manages weapon skin unlocks and conversions using skull tokens
 * - Persists progression in localStorage
 *
 * @module Progression
 */

export interface SkullerSkin {
  id: string;
  name: string;
  description: string;
  cost: number; // cost in Skull emoji tokens (💀)
  unlocked: boolean;
  colorPalette: {
    body: number;
    dark: number;
    accent: number;
  };
}

const DEFAULT_SKINS: SkullerSkin[] = [
  {
    id: 'skuller_default',
    name: 'Skuller Headhunter (Classic)',
    description: 'Matte black military slide with crimson skull engraving.',
    cost: 0,
    unlocked: true,
    colorPalette: {
      body: 0x2c3038,
      dark: 0x181a20,
      accent: 0xa81c30, // Crimson red accent
    },
  },
  {
    id: 'skuller_stattrak',
    name: 'Mirage Stattrak™ Gold 💀',
    description: 'Gold-plated sandstone finish carved from Mirage ruins.',
    cost: 3,
    unlocked: false,
    colorPalette: {
      body: 0xc8b89e,
      dark: 0x3b6b88,
      accent: 0xffd700, // Gold accent
    },
  },
  {
    id: 'skuller_crimson',
    name: 'Crimson One-Tap 💀💀',
    description: 'Anodized blood red slide with gold skull emblems.',
    cost: 7,
    unlocked: false,
    colorPalette: {
      body: 0x8f1022,
      dark: 0x15161a,
      accent: 0xffd700,
    },
  },
  {
    id: 'skuller_hyper',
    name: 'Hyper Beast Cyber 💀💀💀',
    description: 'Neon cyberpunk magenta and electric cyan finish.',
    cost: 12,
    unlocked: false,
    colorPalette: {
      body: 0x1a1a2e,
      dark: 0x0f3460,
      accent: 0xe94560, // Electric magenta
    },
  },
  {
    id: 'skuller_dragon',
    name: 'Dragon Lore Sovereign 👑💀',
    description: 'Legendary royal gold finish with ancient dragon scales.',
    cost: 25,
    unlocked: false,
    colorPalette: {
      body: 0xd4af37,
      dark: 0x2b1e0d,
      accent: 0xff4500, // Orange dragon fire accent
    },
  },
];

export class SkullerRewardsSystem {
  private skullCount = 0;
  private lifetimeSkulls = 0;
  private equippedSkinId = 'skuller_default';
  private skins: SkullerSkin[] = [];
  private readonly storageKey = 'stride_skuller_tokens';
  private readonly skinsKey = 'stride_skuller_skins';
  private readonly equippedKey = 'stride_skuller_equipped';

  constructor() {
    this.load();
  }

  /**
   * Load skull count, skin unlock status, and equipped skin from localStorage.
   */
  private load(): void {
    try {
      const storedTokens = localStorage.getItem(this.storageKey);
      if (storedTokens) {
        const parsed = JSON.parse(storedTokens);
        this.skullCount = Number(parsed.current || 0);
        this.lifetimeSkulls = Number(parsed.lifetime || this.skullCount);
      }

      const storedEquipped = localStorage.getItem(this.equippedKey);
      if (storedEquipped) {
        this.equippedSkinId = storedEquipped;
      }

      const storedSkins = localStorage.getItem(this.skinsKey);
      let unlockedIds: string[] = ['skuller_default'];
      if (storedSkins) {
        unlockedIds = JSON.parse(storedSkins);
      }

      // Initialize skins array
      this.skins = DEFAULT_SKINS.map((s) => ({
        ...s,
        unlocked: s.cost === 0 || unlockedIds.includes(s.id),
      }));
    } catch {
      this.skins = DEFAULT_SKINS.map((s) => ({ ...s }));
    }
  }

  /**
   * Save current progression state to localStorage.
   */
  private save(): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          current: this.skullCount,
          lifetime: this.lifetimeSkulls,
        })
      );

      const unlockedIds = this.skins.filter((s) => s.unlocked).map((s) => s.id);
      localStorage.setItem(this.skinsKey, JSON.stringify(unlockedIds));
      localStorage.setItem(this.equippedKey, this.equippedSkinId);
    } catch {
      // ignore storage errors
    }
  }

  /**
   * Add Skull tokens earned from a one-tap headshot.
   */
  addSkull(count = 1): { current: number; lifetime: number; rankTitle: string } {
    this.skullCount += count;
    this.lifetimeSkulls += count;
    this.save();
    return {
      current: this.skullCount,
      lifetime: this.lifetimeSkulls,
      rankTitle: this.getRankTitle(),
    };
  }

  /**
   * Get currently available Skull emoji tokens.
   */
  getSkullCount(): number {
    return this.skullCount;
  }

  /**
   * Get lifetime Skull tokens earned.
   */
  getLifetimeSkulls(): number {
    return this.lifetimeSkulls;
  }

  /**
   * Get player's Headhunter rank title based on lifetime skulls.
   */
  getRankTitle(): string {
    if (this.lifetimeSkulls >= 25) return 'Skuller God 👑💀';
    if (this.lifetimeSkulls >= 12) return 'Master One-Tapper 💀💀💀';
    if (this.lifetimeSkulls >= 6) return 'Sharpshooter 💀💀';
    if (this.lifetimeSkulls >= 2) return 'Headhunter 💀';
    return 'Novice Headhunter 💀';
  }

  /**
   * Get all available Skuller skins.
   */
  getSkins(): SkullerSkin[] {
    return this.skins.map((s) => ({ ...s }));
  }

  /**
   * Convert collected Skull emoji tokens into a weapon skin unlock.
   */
  convertSkullsToSkin(skinId: string): { success: boolean; message: string; skin?: SkullerSkin } {
    const skin = this.skins.find((s) => s.id === skinId);
    if (!skin) {
      return { success: false, message: 'Skin not found.' };
    }
    if (skin.unlocked) {
      return { success: false, message: 'Skin is already unlocked.' };
    }
    if (this.skullCount < skin.cost) {
      return {
        success: false,
        message: `Not enough Skull tokens (💀 ${this.skullCount} / ${skin.cost}).`,
      };
    }

    this.skullCount -= skin.cost;
    skin.unlocked = true;
    this.equippedSkinId = skin.id;
    this.save();

    return {
      success: true,
      message: `Unlocked and equipped "${skin.name}"!`,
      skin: { ...skin },
    };
  }

  /**
   * Equip an unlocked skin.
   */
  equipSkin(skinId: string): boolean {
    const skin = this.skins.find((s) => s.id === skinId);
    if (!skin || !skin.unlocked) return false;
    this.equippedSkinId = skinId;
    this.save();
    return true;
  }

  /**
   * Get the currently equipped Skuller skin.
   */
  getEquippedSkin(): SkullerSkin {
    const skin = this.skins.find((s) => s.id === this.equippedSkinId);
    return skin ? { ...skin } : { ...DEFAULT_SKINS[0] };
  }
}
