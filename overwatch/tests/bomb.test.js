// Bomb Defusal and armour on the server: roles and sides, carrying,
// dropping and picking up the bomb, planting, defusing (with and without a
// kit), the explosion, how rounds end, halftime, and armour damage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA } from '../shared/maps/arena.js';
import { MAX_HEALTH } from '../shared/combat.js';
import {
  BOMB_CARRIED,
  BOMB_DROPPED,
  BOMB_PLANTED,
  BOMB_WIN_REWARD,
  DEFUSE_REWARD,
  PLANT_LOSS_BONUS,
  PLANT_REWARD,
  siteAt,
} from '../shared/bomb.js';
import {
  BOMBEV_DEFUSED,
  BOMBEV_EXPLODED,
  BOMBEV_PICKED,
  BOMBEV_PLANTED,
  END_BOMB,
  END_DEFUSED,
  END_ELIMINATION,
  END_TIME,
  EV_BOMB,
  EV_HALFTIME,
  EV_KILL,
  EV_ROUND_END,
  KILL_BY_BOMB,
  PHASE_END,
  PHASE_FREEZE,
  PHASE_LIVE,
  USE_DEFUSE,
  USE_PLANT,
  writeInput,
  writeShot,
} from '../shared/protocol.js';
import { LOSS_REWARD, START_MONEY, WEAPONS, applyArmor } from '../shared/weapons.js';
import { Room } from '../server/room.js';

const RULES = {
  freezeTicks: 10,
  roundTicks: 600,
  endTicks: 10,
  matchEndTicks: 10,
  roundsToWin: 3,
  buyTicks: 120,
  plantTicks: 12,
  defuseTicks: 24,
  kitDefuseTicks: 12,
  bombTicks: 60,
};
const IDLE = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0, use: false };
const USE = { ...IDLE, use: true };
const SITE_A = [-14, -17];

function bombRoom(n = 2, rules = {}) {
  const r = new Room('b', ARENA.boxes, { map: 'arena', mapData: ARENA, mode: 'bomb', rules: { ...RULES, ...rules } });
  const ps = [];
  for (let i = 0; i < n; i++) {
    const p = r.join(`p${i}`);
    p.next = 0;
    ps.push(p);
  }
  return { r, ps };
}
const ticks = (r, n) => {
  for (let i = 0; i < n; i++) r.step();
};
// one input for each listed player, then a tick
function act(r, ...entries) {
  for (const [p, input = IDLE, shot = null] of entries) {
    r.receiveInputs(p.id, [writeInput(p.next, input, p.move.yaw, 0)], shot ? [shot] : undefined);
    p.next++;
  }
  r.step();
}
const toLive = (r) => {
  while (r.game.phase !== PHASE_LIVE) r.step();
};
const events = (r, type) => r.events.filter((e) => e.data[0] === type).map((e) => e.data);
const roundEnd = (r) => events(r, EV_ROUND_END).at(-1);
const headOf = (p) => ({ x: p.move.pos.x, y: p.move.pos.y + 1.7, z: p.move.pos.z });
function shotAt(r, p, at) {
  const o = { x: p.move.pos.x, y: p.move.pos.y + p.move.eye, z: p.move.pos.z };
  const d = Math.hypot(at.x - o.x, at.y - o.y, at.z - o.z);
  return writeShot(p.next, o, { x: (at.x - o.x) / d, y: (at.y - o.y) / d, z: (at.z - o.z) / d }, r.tick);
}
// the carrier, standing still on site A, plants
function plant(r, carrier) {
  r._place(carrier, ...SITE_A);
  for (let i = 0; i < RULES.plantTicks; i++) act(r, [carrier, USE]);
}

test('Bomb Defusal needs bomb sites: on the plaza it is team elimination', () => {
  const plaza = new Room('p', [], { mode: 'bomb' });
  assert.equal(plaza.mode, 'teams');
  assert.equal(bombRoom().r.mode, 'bomb');
  assert.equal(siteAt(ARENA.sites, ...SITE_A), 'A');
  assert.equal(siteAt(ARENA.sites, 14, -15), 'B');
  assert.equal(siteAt(ARENA.sites, 0, 0), null);
});

test('attackers spawn at +Z with the bomb; defenders at -Z', () => {
  const { r, ps: [a, d] } = bombRoom();
  r.step();
  assert.equal(r.game.phase, PHASE_FREEZE);
  assert.equal(a.team, r.game.attackers);
  assert.ok(a.move.pos.z > 20 && d.move.pos.z < -20);
  assert.equal(r.game.bomb.state, BOMB_CARRIED);
  assert.equal(r.game.bomb.carrier, a.id);
  // only attackers are told who carries it
  assert.equal(r.snapshotFor(a.id).game[10][5], a.id);
  assert.deepEqual(r.snapshotFor(d.id).game[10], [BOMB_CARRIED, 0, 0, 0, '', 0]);
});

test('planting needs the carrier standing still on a site for the whole plant time', () => {
  const { r, ps: [a] } = bombRoom();
  toLive(r);
  for (let i = 0; i < RULES.plantTicks + 2; i++) act(r, [a, USE]); // at spawn: not a site
  assert.equal(r.game.bomb.state, BOMB_CARRIED);
  r._place(a, ...SITE_A);
  for (let i = 0; i < 6; i++) act(r, [a, USE]);
  assert.equal(a.useKind, USE_PLANT);
  assert.equal(r.snapshotFor(a.id).me[17], 0.5, 'progress shown to the planter');
  act(r, [a, { ...USE, forward: 1 }]); // moved: starts over
  assert.equal(a.useSteps, 0);
  const money = a.money;
  plant(r, a);
  const b = r.game.bomb;
  assert.equal(b.state, BOMB_PLANTED);
  assert.equal(b.site, 'A');
  assert.equal(a.money, money + PLANT_REWARD);
  assert.equal(r.game.endsAt, b.explodeAt, 'the round clock is now the bomb timer');
  assert.deepEqual(events(r, EV_BOMB).at(-1), [EV_BOMB, BOMBEV_PLANTED, a.id, 'A']);
});

test('after a plant, killing the attackers is not enough: the defenders must defuse', () => {
  const { r, ps: [a, d] } = bombRoom();
  toLive(r);
  plant(r, a);
  r._kill(a, d, false, 'rifle');
  ticks(r, 3);
  assert.equal(r.game.phase, PHASE_LIVE, 'the round goes on');
  const b = r.game.bomb;
  r._place(d, b.x + 0.5, b.z);
  const before = { a: a.money, d: d.money };
  for (let i = 0; i < RULES.defuseTicks - 1; i++) act(r, [d, USE]);
  assert.equal(d.useKind, USE_DEFUSE);
  assert.equal(r.game.phase, PHASE_LIVE);
  act(r, [d, USE]);
  assert.equal(r.game.phase, PHASE_END);
  assert.deepEqual(events(r, EV_BOMB).at(-1), [EV_BOMB, BOMBEV_DEFUSED, d.id, 'A']);
  assert.deepEqual(roundEnd(r).slice(2), [d.team, END_DEFUSED]);
  assert.equal(d.money, before.d + DEFUSE_REWARD + BOMB_WIN_REWARD);
  assert.equal(a.money, before.a + LOSS_REWARD + PLANT_LOSS_BONUS, 'planting pays even in a loss');
});

test('a defuse kit halves the defuse; only defenders can buy one', () => {
  const { r, ps: [a, d] } = bombRoom();
  r.step();
  d.money = a.money = 5000;
  assert.equal(r.buy(a.id, 'kit'), 'not-for-sale');
  assert.equal(r.buy(d.id, 'kit'), true);
  assert.equal(r.buy(d.id, 'kit'), 'owned');
  toLive(r);
  plant(r, a);
  const b = r.game.bomb;
  r._place(d, b.x, b.z + 0.8);
  for (let i = 0; i < RULES.kitDefuseTicks; i++) act(r, [d, USE]);
  assert.deepEqual(roundEnd(r).slice(2), [d.team, END_DEFUSED]);
});

test('the bomb explodes: attackers win, and it kills anyone close', () => {
  const { r, ps: [a, d] } = bombRoom();
  toLive(r);
  plant(r, a);
  r._place(d, r.game.bomb.x + 3, r.game.bomb.z); // nearby, not defusing
  ticks(r, RULES.bombTicks);
  assert.deepEqual(events(r, EV_BOMB).at(-1), [EV_BOMB, BOMBEV_EXPLODED, 0, 'A']);
  assert.deepEqual(roundEnd(r).slice(2), [a.team, END_BOMB]);
  assert.equal(d.dead, true);
  assert.equal(a.dead, true, 'the planter stayed on the bomb');
  assert.ok(events(r, EV_KILL).some((e) => e[2] === d.id && e[4] === KILL_BY_BOMB));
});

test('the carrier drops the bomb on death; another attacker picks it up by walking over it', () => {
  const { r, ps: [a, d, c] } = bombRoom(3);
  assert.equal(c.team, a.team);
  toLive(r);
  const carrier = r.players.get(r.game.bomb.carrier);
  const other = carrier === a ? c : a;
  r._place(carrier, 0, 10);
  r._kill(carrier, d, false, 'rifle');
  const b = r.game.bomb;
  assert.equal(b.state, BOMB_DROPPED);
  assert.ok(Math.abs(b.x) < 0.01 && Math.abs(b.z - 10) < 0.01);
  r._place(d, 0.5, 10); // defenders can't take it
  ticks(r, 2);
  assert.equal(b.state, BOMB_DROPPED);
  r._place(other, 1, 10);
  ticks(r, 1);
  assert.equal(b.state, BOMB_CARRIED);
  assert.equal(b.carrier, other.id);
  assert.deepEqual(events(r, EV_BOMB).at(-1), [EV_BOMB, BOMBEV_PICKED, other.id, '']);
});

test('defenders win when time runs out without a plant, or when every attacker dies first', () => {
  const t = bombRoom();
  toLive(t.r);
  ticks(t.r, RULES.roundTicks);
  assert.deepEqual(roundEnd(t.r).slice(2), [t.ps[1].team, END_TIME]);
  const e = bombRoom();
  toLive(e.r);
  e.r._kill(e.ps[0], e.ps[1], false, 'rifle');
  e.r.step();
  assert.deepEqual(roundEnd(e.r).slice(2), [e.ps[1].team, END_ELIMINATION]);
});

test('halftime: the teams swap sides, money and gear reset', () => {
  const { r, ps: [a, d] } = bombRoom();
  for (let round = 1; round <= 2; round++) {
    toLive(r);
    r._kill(d, a, false, 'rifle'); // attackers win both
    while (r.game.phase !== PHASE_FREEZE) r.step();
  }
  assert.deepEqual(events(r, EV_HALFTIME).at(-1), [EV_HALFTIME, d.team]);
  assert.equal(r.game.attackers, d.team);
  assert.equal(r.game.round, 3);
  assert.deepEqual(r.game.score, [2, 0].map((s, t) => (t === a.team ? s : 0)), 'the score stays');
  assert.equal(a.money, START_MONEY);
  assert.ok(d.move.pos.z > 20, 'the new attackers spawn at +Z');
  assert.equal(r.game.bomb.carrier, d.id);
});

test('armour soaks damage by weapon; the helmet protects the head', () => {
  assert.deepEqual(applyArmor(34, 0.78, 100, false, false), { health: 27, armor: 7 });
  assert.deepEqual(applyArmor(100, 0.78, 100, false, true), { health: 100, armor: 0 }, 'no helmet');
  assert.deepEqual(applyArmor(100, 0.78, 100, true, true), { health: 78, armor: 22 });
  assert.deepEqual(applyArmor(34, 0.78, 0, true, false), { health: 34, armor: 0 }, 'no armour left');
  assert.ok(applyArmor(WEAPONS.sniper.body, WEAPONS.sniper.armorPen, 100, true, false).health >= MAX_HEALTH, 'the sniper still kills');

  const { r, ps: [a, d] } = bombRoom();
  r.step();
  d.money = 5000;
  assert.equal(r.buy(d.id, 'vest'), true);
  assert.equal(r.buy(d.id, 'vest'), 'owned');
  assert.equal(r.buy(d.id, 'vesthelm'), true, 'the helmet on its own');
  assert.equal(d.money, 5000 - 650 - 350);
  toLive(r);
  r._place(a, -3, 12); // face to face across mid, clear of the container
  r._place(d, 3, 12);
  r.step();
  act(r, [a, IDLE, shotAt(r, a, headOf(d))]);
  assert.equal(d.dead, false, 'a pistol headshot does not kill through a helmet');
  assert.ok(d.armor < 100 && d.hp < MAX_HEALTH);
  const snap = r.snapshotFor(d.id);
  assert.deepEqual(snap.me.slice(13, 16), [d.armor, 1, 0]);
});
