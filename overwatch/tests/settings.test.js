// Player settings: validation, storage, and how they become config (URL
// parameters still win, so test links and screenshot tools stay exact).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_SENSITIVITY,
  DEFAULT_SETTINGS,
  cleanSettings,
  loadSettings,
  saveSettings,
  settingsToConfig,
} from '../src/core/settings.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('defaults match the game before there were settings', () => {
  const c = settingsToConfig(DEFAULT_SETTINGS, new URLSearchParams());
  assert.equal(c.mouseSensitivity, 0.0022);
  assert.equal(c.fov, 70);
  assert.equal(c.volume, 0.8);
  assert.equal(c.quality, null, 'auto: picked by hardware');
  assert.equal(c.invertY, false);
  assert.equal(c.showStats, false);
});

test('bad or out-of-range values are clamped or replaced by defaults', () => {
  const s = cleanSettings({ sensitivity: 99, fov: 10, volume: 'loud', quality: 'insane', invertY: 'yes', showStats: true });
  assert.equal(s.sensitivity, 5);
  assert.equal(s.fov, 60);
  assert.equal(s.volume, DEFAULT_SETTINGS.volume);
  assert.equal(s.quality, 'auto');
  assert.equal(s.invertY, false);
  assert.equal(s.showStats, true);
  assert.deepEqual(cleanSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(cleanSettings({ fov: null, volume: '' }), DEFAULT_SETTINGS, 'empty values are not zero');
});

test('settings survive a save and load; broken or blocked storage falls back to defaults', () => {
  const storage = memoryStorage();
  assert.equal(saveSettings({ ...DEFAULT_SETTINGS, sensitivity: 1.5, fov: 90, quality: 'low', invertY: true }, storage), true);
  const s = loadSettings(storage);
  assert.deepEqual([s.sensitivity, s.fov, s.quality, s.invertY], [1.5, 90, 'low', true]);
  storage.setItem('ow_settings', '{not json');
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(blocked), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, blocked), false);
});

test('settings become config; URL parameters override them', () => {
  const s = { ...DEFAULT_SETTINGS, sensitivity: 2, fov: 95, volume: 30, quality: 'medium' };
  const c = settingsToConfig(s, new URLSearchParams());
  assert.equal(c.mouseSensitivity, BASE_SENSITIVITY * 2);
  assert.equal(c.fov, 95);
  assert.equal(c.volume, 0.3);
  assert.equal(c.quality, 'medium');
  const u = settingsToConfig(s, new URLSearchParams('sens=0.001&fov=80&debug'));
  assert.equal(u.mouseSensitivity, 0.001);
  assert.equal(u.fov, 80);
  assert.equal(u.showStats, true, '?debug shows the stats');
});
