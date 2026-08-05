/**
 * ContentSchemas.ts
 *
 * Schemas and validation for AI-generated content (Requirements 21, 22).
 * Generated payloads are validated against these schemas before being
 * registered with gameplay systems; invalid payloads trigger retries.
 *
 * @module Content
 */

export interface WeaponGenerationRequest {
  category: 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';
  theme: string;
  powerLevel: number; // 0..1
}

export interface WeaponContentPayload {
  name: string;
  category: 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';
  baseDamage: number;
  fireRate: number; // rpm
  magazineSize: number;
  reloadTime: number;
  recoil: { vertical: number[]; horizontal: number[] };
  baseSpread: number;
  color: number;
}

export interface MapGenerationRequest {
  biome: string;
  size: { width: number; depth: number };
  density: number; // 0..1
}

export interface MapContentPayload {
  seed: number;
  biome: string;
  density: number;
  coverZones: number;
  elevatedPositions: number;
}

export interface WorldGenerationRequest {
  prompt: string;
  biome?: string;
  difficulty?: string;
}

/**
 * LLM-facing world config (R30.1) — a superset of MapContentPayload with
 * atmosphere + content-density fields. Loose string enums are validated by
 * validateWorldConfig before coercion to the strict GameMode WorldConfig.
 */
export interface WorldContentPayload {
  seed: number;
  biome: string;
  density: number; // 0..1
  weather: string; // 'clear' | 'storm' | 'fog' | 'snow' | 'ash'
  timeOfDay: string; // 'day' | 'dusk' | 'night'
  mood: string;
  buildings: number;
  roads: number;
  enemyCamps: number;
  difficulty: string; // 'easy' | 'normal' | 'hard'
  coverZones: number;
  elevatedPositions: number;
}

export interface MissionGenerationRequest {
  objectiveType: 'elimination' | 'extraction' | 'defense' | 'capture';
  difficulty: number; // 0..1
}

export interface MissionContentPayload {
  objectiveType: string;
  title: string;
  briefing: string;
  successCondition: string;
  failureCondition: string;
  targetCount: number;
}

export interface BalanceGenerationRequest {
  difficulty: 'easy' | 'normal' | 'hard';
  enemyClass: string;
}

export interface BalanceContentPayload {
  difficulty: string;
  enemyClass: string;
  healthMultiplier: number;
  speedMultiplier: number;
  accuracyMultiplier: number;
  reactionTimeMultiplier: number;
}

export type ContentPayload =
  | WeaponContentPayload
  | MapContentPayload
  | MissionContentPayload
  | BalanceContentPayload
  | WorldContentPayload;

/** Balance envelope: allowed ranges per difficulty (Requirement 22.3). */
export const BALANCE_ENVELOPE: Record<string, { health: [number, number]; speed: [number, number]; accuracy: [number, number] }> = {
  easy: { health: [0.6, 0.9], speed: [0.8, 1.0], accuracy: [0.3, 0.5] },
  normal: { health: [0.9, 1.2], speed: [0.9, 1.1], accuracy: [0.5, 0.7] },
  hard: { health: [1.2, 1.8], speed: [1.0, 1.2], accuracy: [0.7, 0.9] },
};

/** Weapon balance bounds (Requirement 22.2). */
export const WEAPON_BOUNDS: Record<string, [number, number]> = {
  damage: [5, 150],
  fireRate: [60, 1200],
  magazineSize: [5, 100],
  reloadTime: [0.5, 5],
  baseSpread: [0.001, 0.12],
};

function inRange(v: number, [min, max]: [number, number]): boolean {
  return v >= min && v <= max;
}

/**
 * Validate a weapon payload against balance bounds.
 */
export function validateWeaponPayload(p: WeaponContentPayload): string | null {
  if (!p.name || typeof p.name !== 'string' || p.name.length < 2) return 'Invalid weapon name';
  if (!inRange(p.baseDamage, WEAPON_BOUNDS.damage)) return `Damage ${p.baseDamage} out of bounds`;
  if (!inRange(p.fireRate, WEAPON_BOUNDS.fireRate)) return `Fire rate ${p.fireRate} out of bounds`;
  if (!inRange(p.magazineSize, WEAPON_BOUNDS.magazineSize)) return `Magazine ${p.magazineSize} out of bounds`;
  if (!inRange(p.reloadTime, WEAPON_BOUNDS.reloadTime)) return `Reload ${p.reloadTime} out of bounds`;
  if (!inRange(p.baseSpread, WEAPON_BOUNDS.baseSpread)) return `Spread ${p.baseSpread} out of bounds`;
  if (!Array.isArray(p.recoil.vertical) || p.recoil.vertical.length === 0) return 'Recoil missing';
  if (!['rifle', 'smg', 'shotgun', 'sniper', 'pistol'].includes(p.category)) return 'Invalid category';
  return null;
}

/**
 * Validate a balance payload against the difficulty envelope.
 */
export function validateBalancePayload(p: BalanceContentPayload): string | null {
  const env = BALANCE_ENVELOPE[p.difficulty];
  if (!env) return 'Unknown difficulty';
  if (!inRange(p.healthMultiplier, env.health)) return 'Health out of envelope';
  if (!inRange(p.speedMultiplier, env.speed)) return 'Speed out of envelope';
  if (!inRange(p.accuracyMultiplier, env.accuracy)) return 'Accuracy out of envelope';
  if (p.reactionTimeMultiplier < 0.5 || p.reactionTimeMultiplier > 2.0) return 'Reaction time out of bounds';
  return null;
}

/**
 * Validate a mission payload.
 */
export function validateMissionPayload(p: MissionContentPayload): string | null {
  if (!p.title || p.title.length < 3) return 'Mission title too short';
  if (!p.briefing || p.briefing.length < 10) return 'Briefing too short';
  if (!['elimination', 'extraction', 'defense', 'capture'].includes(p.objectiveType)) return 'Invalid objective type';
  if (p.targetCount < 1 || p.targetCount > 50) return 'Target count out of bounds';
  return null;
}

/**
 * Validate a map payload.
 */
export function validateMapPayload(p: MapContentPayload): string | null {
  if (p.seed < 0 || p.seed > 0xffffffff) return 'Seed out of range';
  if (p.density < 0 || p.density > 1) return 'Density out of range';
  if (p.coverZones < 3) return 'Need at least 3 cover zones';
  if (p.elevatedPositions < 1) return 'Need at least 1 elevated position';
  return null;
}

const WORLD_BIOMES = ['city', 'forest', 'snow', 'desert', 'dungeon', 'factory'];
const WORLD_WEATHERS = ['clear', 'storm', 'fog', 'snow', 'ash'];
const WORLD_TIMES = ['day', 'dusk', 'night'];
const WORLD_DIFFICULTIES = ['easy', 'normal', 'hard'];

/**
 * Validate a world config (R30.1). Keeps backward compatibility with
 * MapContentPayload — every world payload is also a valid map payload.
 */
export function validateWorldConfig(p: WorldContentPayload): string | null {
  if (!WORLD_BIOMES.includes(p.biome)) return `Unknown biome: ${p.biome}`;
  if (typeof p.density !== 'number' || p.density < 0 || p.density > 1) return 'Density out of range';
  if (!WORLD_WEATHERS.includes(p.weather)) return `Unknown weather: ${p.weather}`;
  if (!WORLD_TIMES.includes(p.timeOfDay)) return `Unknown timeOfDay: ${p.timeOfDay}`;
  if (!WORLD_DIFFICULTIES.includes(p.difficulty)) return `Unknown difficulty: ${p.difficulty}`;
  if (typeof p.mood !== 'string' || p.mood.length > 60) return 'Mood too long';
  if (p.seed < 0 || p.seed > 0xffffffff) return 'Seed out of range';
  if (p.buildings < 0 || p.buildings > 200) return 'Buildings out of bounds';
  if (p.roads < 0 || p.roads > 100) return 'Roads out of bounds';
  if (p.enemyCamps < 0 || p.enemyCamps > 50) return 'Enemy camps out of bounds';
  if (p.coverZones < 3) return 'Need at least 3 cover zones';
  if (p.elevatedPositions < 1) return 'Need at least 1 elevated position';
  return null;
}

/** Deterministic string hash → world seed (same prompt → same world, R30.1). */
export function hashPrompt(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = (Math.imul(31, h) + prompt.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Keyword interpretation of a free-text world prompt (R30.3): maps
 * "snow"/"desert"/"night"/difficulty words to the nearest config. Used when
 * no LLM key is configured, or as the procedural fallback after retries.
 */
export function interpretWorldPrompt(
  prompt: string,
  context: { biome?: string; difficulty?: string } = {}
): WorldContentPayload {
  const text = prompt.toLowerCase();
  const has = (re: RegExp): boolean => re.test(text);

  // Biome keywords
  let biome = context.biome ?? 'city';
  if (has(/\b(snowy|snow|arctic|ice|frozen|tundra|blizzard)\b/)) biome = 'snow';
  else if (has(/\b(desert|dune|sand|arid)\b/)) biome = 'desert';
  else if (has(/\b(forest|jungle|woods|wooded)\b/)) biome = 'forest';
  else if (has(/\b(city|urban|downtown|streets)\b/)) biome = 'city';
  else if (has(/\b(dungeon|cave|underground|cavern)\b/)) biome = 'dungeon';
  else if (has(/\b(factory|industrial|warehouse|plant)\b/)) biome = 'factory';

  // Weather keywords
  let weather = 'clear';
  if (has(/\b(storm|thunder|lightning|rain|downpour)\b/)) weather = 'storm';
  else if (has(/\b(fog|mist|haze)\b/)) weather = 'fog';
  else if (has(/\b(snowy|snow|blizzard|snowfall)\b/)) weather = 'snow';
  else if (has(/\b(ash|volcanic|ember)\b/)) weather = 'ash';

  // Time-of-day keywords
  let timeOfDay = 'day';
  if (has(/\b(night|midnight|dark|nightfall)\b/)) timeOfDay = 'night';
  else if (has(/\b(dusk|evening|sunset|twilight)\b/)) timeOfDay = 'dusk';

  // Difficulty keywords
  let difficulty = context.difficulty ?? 'normal';
  if (has(/\b(hard|brutal|insane|difficult|merciless)\b/)) difficulty = 'hard';
  else if (has(/\b(easy|casual|relaxed)\b/)) difficulty = 'easy';

  // Density keywords
  let density = 0.55;
  if (has(/\b(dense|crowded|cluttered|packed)\b/)) density = 0.8;
  else if (has(/\b(sparse|empty|open|barren)\b/)) density = 0.35;

  // Mood adjectives (all matched, joined)
  const moods: string[] = [];
  if (has(/\b(abandoned|ruined|derelict)\b/)) moods.push('abandoned');
  if (has(/\b(military|army|base|bunker)\b/)) moods.push('military');
  if (has(/\b(radioactive|toxic|contaminated)\b/)) moods.push('toxic');
  if (has(/\b(festive|celebration)\b/)) moods.push('festive');

  return {
    seed: hashPrompt(prompt),
    biome,
    density,
    weather,
    timeOfDay,
    mood: moods.length > 0 ? moods.join(' ') : 'generated',
    buildings: Math.round(density * 12),
    roads: Math.round(density * 6),
    enemyCamps: Math.max(1, Math.round(density * 3)),
    difficulty,
    coverZones: Math.max(3, Math.round(density * 10)),
    elevatedPositions: Math.max(1, Math.round(density * 5)),
  };
}

export function validatePayload(type: string, payload: ContentPayload): string | null {
  switch (type) {
    case 'weapon': return validateWeaponPayload(payload as WeaponContentPayload);
    case 'map': return validateMapPayload(payload as MapContentPayload);
    case 'mission': return validateMissionPayload(payload as MissionContentPayload);
    case 'balance': return validateBalancePayload(payload as BalanceContentPayload);
    case 'world': return validateWorldConfig(payload as WorldContentPayload);
    default: return `Unknown content type: ${type}`;
  }
}
