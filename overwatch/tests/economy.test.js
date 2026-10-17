// Weapons and money on the server: loadouts, switching, buying, selling,
// round rewards and kill rewards. Short timings keep it fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_HEALTH } from '../shared/combat.js';
import {
  BUY_FREE,
  BUY_OPEN,
  BUY_SELL_SECONDARY,
  EV_SHOT,
  PHASE_FREEZE,
  PHASE_LIVE,
  TICK_RATE,
  writeInput,
  writeShot,
} from '../shared/protocol.js';
import {
  LOSS_REWARD,
  LOSS_STEP,
  PRIMARY,
  SECONDARY,
  START_MONEY,
  WEAPONS,
  WIN_REWARD,
  lossReward,
  weaponIndex,
} from '../shared/weapons.js';
import { Room } from '../server/room.js';

const colliders = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const RULES = { freezeTicks: 10, roundTicks: 600, endTicks: 10, matchEndTicks: 10, roundsToWin: 5, buyTicks: 120 };
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };

function join(r, name) {
  const p = r.join(name);
  p.next = 0;
  return p;
}
// one input (with optional shot / switch) for p, then a tick
function act(r, p, { shotAt = null, slot = null } = {}) {
  const shots = [];
  if (shotAt) {
    const o = { x: p.move.pos.x, y: p.move.pos.y + p.move.eye, z: p.move.pos.z };
    const d = Math.hypot(shotAt.x - o.x, shotAt.y - o.y, shotAt.z - o.z);
    shots.push(writeShot(p.next, o, { x: (shotAt.x - o.x) / d, y: (shotAt.y - o.y) / d, z: (shotAt.z - o.z) / d }, r.tick));
  }
  r.receiveInputs(p.id, [writeInput(p.next, IDLE, p.move.yaw, 0)], shots, undefined, slot === null ? undefined : [[p.next, slot]]);
  p.next++;
  r.step();
}
const idle = (r, p, n) => {
  for (let i = 0; i < n; i++) act(r, p);
};
const chest = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + 1.0, z: p.move.pos.z });
const head = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + 1.7, z: p.move.pos.z });
const steps = (seconds) => Math.round(seconds * TICK_RATE);

// a team match in its first freeze, with a and b on opposite teams
function match() {
  const r = new Room('t', colliders, { rules: RULES });
  const a = join(r, 'a');
  const b = join(r, 'b');
  r.step();
  assert.equal(r.game.phase, PHASE_FREEZE);
  return { r, a, b };
}
// stands a and b face to face across the plaza, live
function faceOff(r, a, b) {
  while (r.game.phase !== PHASE_LIVE) r.step();
  r._place(a, 6, 16);
  r._place(b, -6, 16);
  r.step();
}

test('deathmatch: a rifle and a pistol, holding the rifle; buying is free', () => {
  const r = new Room('dm', colliders, { mode: 'dm' });
  const a = join(r, 'a');
  assert.deepEqual(a.loadout.map((g) => g && g.id), ['rifle', 'pistol']);
  assert.equal(a.slot, PRIMARY);
  assert.equal(r.buy(a.id, 'sniper'), true);
  assert.equal(a.loadout[PRIMARY].id, 'sniper');
  assert.equal(a.money, START_MONEY, 'free');
  const snap = r.snapshotFor(a.id);
  assert.equal(snap.me[12] & (BUY_OPEN | BUY_FREE), BUY_OPEN | BUY_FREE);
  assert.deepEqual(snap.me[10], ['sniper', WEAPONS.sniper.mag, WEAPONS.sniper.reserve]);
});

test('switching: the pistol fires with pistol damage, only once drawn', () => {
  const r = new Room('dm', colliders, { mode: 'dm' });
  const a = join(r, 'a');
  const b = join(r, 'b');
  r._place(a, 6, 16);
  r._place(b, -6, 16);
  idle(r, a, 2);
  act(r, a, { slot: SECONDARY });
  assert.equal(a.slot, SECONDARY);
  act(r, a, { shotAt: chest(b) }); // still drawing
  assert.equal(b.hp, MAX_HEALTH);
  assert.equal(a.rejected, 1);
  idle(r, a, steps(WEAPONS.pistol.drawTime));
  act(r, a, { shotAt: chest(b) });
  assert.equal(b.hp, MAX_HEALTH - WEAPONS.pistol.body);
  assert.equal(a.loadout[SECONDARY].ammo, WEAPONS.pistol.mag - 1);
  assert.equal(a.loadout[PRIMARY].ammo, WEAPONS.rifle.mag, 'each weapon has its own magazine');
  const shot = r.events.find((e) => e.data[0] === EV_SHOT).data;
  assert.equal(shot[8], weaponIndex('pistol'), 'others hear which weapon fired');
  // the pistol is semi-automatic but its rate is still enforced
  act(r, a, { shotAt: chest(b) });
  assert.equal(b.hp, MAX_HEALTH - WEAPONS.pistol.body, 'too soon after the last shot');
});

test('switching cancels a reload', () => {
  const r = new Room('dm', colliders, { mode: 'dm' });
  const a = join(r, 'a');
  idle(r, a, 2);
  a.loadout[PRIMARY].ammo = 3;
  r.receiveInputs(a.id, [writeInput(a.next, IDLE, 0, 0)], undefined, [a.next]);
  a.next++;
  r.step();
  assert.ok(a.reloadStart >= 0);
  act(r, a, { slot: SECONDARY });
  assert.equal(a.reloadStart, -1);
  idle(r, a, steps(WEAPONS.rifle.reloadTime));
  assert.equal(a.loadout[PRIMARY].ammo, 3, 'the rifle was never refilled');
});

test('a switch to a slot you have nothing in is ignored', () => {
  const { r, a } = match();
  assert.equal(a.loadout[PRIMARY], null);
  assert.equal(a.slot, SECONDARY);
  act(r, a, { slot: PRIMARY });
  assert.equal(a.slot, SECONDARY);
});

test('a team match starts on the free pistol and $800; buy and sell during the freeze', () => {
  const { r, a } = match();
  assert.deepEqual(a.loadout.map((g) => g && g.id), [null, 'pistol']);
  assert.equal(a.money, START_MONEY);
  assert.equal(r.buy(a.id, 'rifle'), 'no-money');
  assert.equal(r.buy(a.id, 'pistol'), 'not-for-sale');
  assert.equal(r.buy(a.id, 'nope'), 'bad-weapon');
  assert.equal(r.buy(a.id, 'heavy'), true);
  assert.equal(a.money, START_MONEY - WEAPONS.heavy.price);
  assert.equal(a.loadout[SECONDARY].id, 'heavy');
  assert.equal(r.buy(a.id, 'heavy'), 'owned');
  assert.ok(r.snapshotFor(a.id).me[12] & BUY_SELL_SECONDARY);
  // sold back: the money and the free pistol return
  assert.equal(r.sell(a.id, 'heavy'), true);
  assert.equal(a.money, START_MONEY);
  assert.equal(a.loadout[SECONDARY].id, 'pistol');
  assert.equal(r.sell(a.id, 'pistol'), 'not-sellable');
});

test('buying over a weapon bought this round refunds it; selling gives back the one before', () => {
  const { r, a } = match();
  a.money = 10000;
  assert.equal(r.buy(a.id, 'smg'), true);
  assert.equal(r.buy(a.id, 'rifle'), true);
  assert.equal(a.money, 10000 - WEAPONS.rifle.price, 'the SMG was refunded');
  assert.equal(r.sell(a.id, 'rifle'), true);
  assert.equal(a.money, 10000);
  assert.equal(a.loadout[PRIMARY], null);
});

test('buying needs buy time and the buy zone', () => {
  const { r, a } = match();
  r._place(a, -40, -40); // far from ALPHA's or BRAVO's spawns
  assert.equal(r.buy(a.id, 'heavy'), 'cannot-buy');
  const [x, z] = r.teamSpawns[a.team][0];
  r._place(a, x, z);
  assert.equal(r.buy(a.id, 'heavy'), true);
  while (r.game.phase !== PHASE_LIVE) r.step();
  assert.equal(r.sell(a.id, 'heavy'), true, 'still buy time after the freeze');
  while (r.tick < r.game.buyUntil) r.step();
  assert.equal(r.buy(a.id, 'heavy'), 'cannot-buy', 'buy time is over');
  assert.equal(r.snapshotFor(a.id).me[12] & BUY_OPEN, 0);
});

test('rounds pay the winners $3,250 and the losers $1,400, then $500 more per loss in a row', () => {
  const { r, a, b } = match();
  faceOff(r, a, b);
  act(r, a, { shotAt: head(b) });
  assert.equal(b.dead, true);
  const pistolKill = WEAPONS.pistol.killReward;
  assert.equal(a.money, START_MONEY + pistolKill + WIN_REWARD);
  assert.equal(b.money, START_MONEY + LOSS_REWARD);
  // round 2: b loses again
  faceOff(r, a, b);
  idle(r, a, steps(WEAPONS.pistol.interval) + 1);
  act(r, a, { shotAt: head(b) });
  assert.equal(b.money, START_MONEY + LOSS_REWARD + LOSS_REWARD + LOSS_STEP);
  assert.equal(lossReward(9), 3400, 'capped');
});

test('survivors keep what they bought; the dead start over on the pistol', () => {
  const { r, a, b } = match();
  a.money = b.money = 5000;
  assert.equal(r.buy(a.id, 'smg'), true);
  assert.equal(r.buy(b.id, 'rifle'), true);
  faceOff(r, a, b);
  act(r, a, { slot: PRIMARY });
  idle(r, a, steps(WEAPONS.smg.drawTime));
  for (let i = 0; i < 6 && !b.dead; i++) {
    act(r, a, { shotAt: head(b) });
    idle(r, a, steps(WEAPONS.smg.interval));
  }
  assert.equal(b.dead, true);
  assert.equal(a.kills, 1);
  assert.equal(a.money, 5000 - WEAPONS.smg.price + WEAPONS.smg.killReward + WIN_REWARD, 'SMG kills pay $600');
  while (r.game.phase !== PHASE_FREEZE) r.step();
  assert.deepEqual(a.loadout.map((g) => g && g.id), ['smg', 'pistol']);
  assert.equal(a.loadout[PRIMARY].ammo, WEAPONS.smg.mag, 'refilled');
  assert.equal(a.slot, PRIMARY);
  assert.equal(r.sell(a.id, 'smg'), 'not-sellable', 'only this round\'s purchases sell back');
  assert.deepEqual(b.loadout.map((g) => g && g.id), [null, 'pistol']);
});

test('the snapshot carries money, the loadout and the buy window', () => {
  const { r, a, b } = match();
  const snap = r.snapshotFor(a.id);
  const [, , ammo, reserve, , , , , money, slot, primary, secondary, flags] = snap.me;
  assert.deepEqual([ammo, reserve, money, slot, primary, secondary], [12, 48, START_MONEY, SECONDARY, null, ['pistol', 12, 48]]);
  assert.equal(flags & BUY_OPEN, BUY_OPEN);
  assert.equal(snap.game[8], r.game.buyUntil);
  assert.equal(snap.players.find((p) => p[0] === b.id)[11], 'pistol', 'what the others hold');
});
