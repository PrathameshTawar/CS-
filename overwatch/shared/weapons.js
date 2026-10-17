// shared/weapons.js — the weapon table and the round economy, shared by the
// client (viewmodels, HUD, buy menu, prediction) and the server (which
// validates every shot, switch and purchase against the same numbers).
//
// Loadout: one primary (SMG, rifle, sniper) and one secondary (pistol).
// Everyone always has a secondary: the free pistol, or a bought one.
//
// Economy (team rounds; warmup, deathmatch and single player buy for free):
// - $800 at the start of a match, at most $16,000.
// - Kill reward depends on the weapon that killed.
// - Round win $3,250. Round loss $1,400, plus $500 for each further loss in
//   a row (at most $3,400). A draw pays everyone $1,400.
// - Buy during the freeze and the first BUY_TIME seconds of the round, near
//   your team's spawn. Survivors keep their weapons into the next round; the
//   dead respawn with the free pistol only.
// - Sell: a weapon bought this round can be sold back for its full price
//   while you can still buy (you get back what it replaced).

import { BODY_DAMAGE, FIRE_INTERVAL, HEAD_DAMAGE, MAG_SIZE, RELOAD_REFILL_AT, RELOAD_TIME, RESERVE } from './combat.js';

export const PRIMARY = 0;
export const SECONDARY = 1;

// Stats. Times in seconds. Spread (client only: the server trusts the aim,
// as it trusts view angles) is in radians: base + (hip fire ? hip : 0) +
// bloom * 0.05, where bloom grows by `grow` per shot up to `bloomMax` and
// recovers at bloomMax / 2 per second while the trigger is up. `recoil` is
// the camera kick per shot (radians). `adsFov` is the field of view when
// aiming; `scope` swaps the viewmodel for a scope overlay.
export const WEAPONS = Object.freeze({
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    slot: SECONDARY,
    price: 0, // everyone has one; not for sale
    auto: false,
    interval: 0.15,
    mag: 12,
    reserve: 48,
    reloadTime: 2.0,
    refillAt: 1.5,
    drawTime: 0.35,
    body: 25,
    head: 100,
    killReward: 300,
    spread: { base: 0.006, hip: 0.004, grow: 0.15, bloomMax: 0.5 },
    recoil: 0.009,
    adsFov: 60,
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy Pistol',
    slot: SECONDARY,
    price: 700,
    auto: false,
    interval: 0.25,
    mag: 7,
    reserve: 35,
    reloadTime: 2.2,
    refillAt: 1.6,
    drawTime: 0.45,
    body: 50,
    head: 100,
    killReward: 300,
    spread: { base: 0.004, hip: 0.008, grow: 0.5, bloomMax: 1.0 },
    recoil: 0.022,
    adsFov: 58,
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    slot: PRIMARY,
    price: 1250,
    auto: true,
    interval: 60 / 850,
    mag: 30,
    reserve: 120,
    reloadTime: 2.0,
    refillAt: 1.5,
    drawTime: 0.5,
    body: 22,
    head: 70,
    killReward: 600,
    spread: { base: 0.007, hip: 0.004, grow: 0.016, bloomMax: 0.16 },
    recoil: 0.0032,
    adsFov: 56,
  },
  rifle: {
    id: 'rifle',
    name: 'Assault Rifle',
    slot: PRIMARY,
    price: 2700,
    auto: true,
    interval: FIRE_INTERVAL,
    mag: MAG_SIZE,
    reserve: RESERVE,
    reloadTime: RELOAD_TIME,
    refillAt: RELOAD_REFILL_AT,
    drawTime: 0.6,
    body: BODY_DAMAGE,
    head: HEAD_DAMAGE,
    killReward: 300,
    spread: { base: 0.004, hip: 0.002, grow: 0.012, bloomMax: 0.12 },
    recoil: 0.0045,
    adsFov: 52,
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Rifle',
    slot: PRIMARY,
    price: 4750,
    auto: false,
    interval: 1.45, // bolt action
    mag: 5,
    reserve: 20,
    reloadTime: 3.0,
    refillAt: 2.3,
    drawTime: 0.8,
    body: 100,
    head: 100,
    killReward: 100,
    spread: { base: 0.0003, hip: 0.07, grow: 0, bloomMax: 0 },
    recoil: 0.03,
    adsFov: 16, // scoped
    scope: true,
  },
});

// Wire order (EV_SHOT carries the index) and buy-menu order.
export const WEAPON_IDS = Object.freeze(['pistol', 'heavy', 'smg', 'rifle', 'sniper']);
export const DEFAULT_SECONDARY = 'pistol';
export const DEFAULT_PRIMARY = 'rifle'; // warmup, deathmatch and single player start with one

export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1400;
export const LOSS_STEP = 500;
export const LOSS_MAX = 3400;
export const BUY_TIME = 20; // seconds of the live round you can still buy in
export const BUY_RADIUS = 10; // metres from one of your team's spawn points

export function weaponIndex(id) {
  return WEAPON_IDS.indexOf(id);
}

// A loadout entry: the weapon and its ammo.
export function makeGun(id) {
  const w = WEAPONS[id];
  return { id, ammo: w.mag, reserve: w.reserve };
}

// Money for losing `streak` rounds in a row (1 = the first loss).
export function lossReward(streak) {
  return Math.min(LOSS_MAX, LOSS_REWARD + LOSS_STEP * Math.max(0, streak - 1));
}

// The slot you hold after (re)spawning: your primary if you have one.
export function defaultSlot(loadout) {
  return loadout[PRIMARY] ? PRIMARY : SECONDARY;
}
