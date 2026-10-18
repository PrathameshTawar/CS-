// core/settings.js — the player's settings: mouse, field of view, sound,
// graphics. Saved in the browser (localStorage) and applied on load; URL
// parameters (?sens=, ?fov=, ?q=) still override them, so test links and the
// screenshot tools stay exact.
//
// Pure functions except load/save, so the rules are unit-testable.

export const BASE_SENSITIVITY = 0.0022; // radians per mouse count at sensitivity 1

export const SETTINGS_RANGES = Object.freeze({
  sensitivity: { min: 0.1, max: 5, step: 0.05 },
  fov: { min: 60, max: 110, step: 1 },
  volume: { min: 0, max: 100, step: 1 },
});
export const QUALITY_CHOICES = Object.freeze(['auto', 'low', 'medium', 'high', 'ultra']);

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1,
  fov: 70,
  volume: 80,
  quality: 'auto',
  invertY: false,
  showStats: false,
});

const KEY = 'ow_settings';

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));

// A complete, valid settings object from anything (bad or missing values
// fall back to the defaults).
export function cleanSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  for (const key of ['sensitivity', 'fov', 'volume']) {
    const v = Number(raw[key]);
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '' && Number.isFinite(v)) s[key] = clamp(v, SETTINGS_RANGES[key]);
  }
  if (QUALITY_CHOICES.includes(raw.quality)) s.quality = raw.quality;
  if (typeof raw.invertY === 'boolean') s.invertY = raw.invertY;
  if (typeof raw.showStats === 'boolean') s.showStats = raw.showStats;
  return s;
}

// Storage can be unavailable (private windows, blocked site data) and throw.
export function loadSettings(storage = globalThis.localStorage) {
  try {
    return cleanSettings(JSON.parse(storage.getItem(KEY) || 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(cleanSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

// The config values settings drive, with URL parameters taking precedence.
export function settingsToConfig(settings, params) {
  const s = cleanSettings(settings);
  const num = (name) => {
    const v = Number(params.get(name));
    return params.has(name) && Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    mouseSensitivity: num('sens') ?? BASE_SENSITIVITY * s.sensitivity,
    fov: num('fov') ?? s.fov,
    volume: s.volume / 100,
    invertY: s.invertY,
    // null: pick by hardware
    quality: s.quality === 'auto' ? null : s.quality,
    showStats: s.showStats || params.has('debug'),
  };
}
