// Bots: the walkable grid and paths, filling rooms and making way for
// people in even teams, and bots that actually play (by the server's own
// rules: no refused shots), deterministically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { ARENA } from '../shared/maps/arena.js';
import { findPath, floorAt, navGrid, walkLine } from '../shared/nav.js';
import { EV_BOMB, EV_KILL, EV_ROUND_END, BOMBEV_PLANTED, MODE_BOMB, PROTOCOL_VERSION, TICK_RATE } from '../shared/protocol.js';
import { Room } from '../server/room.js';
import { BOT_PREFIX, Bot } from '../server/bots.js';
import { createRng } from '../shared/rng.js';
import { startServer } from '../server/index.js';

const plaza = JSON.parse(readFileSync(new URL('./fixtures/plaza-colliders.json', import.meta.url), 'utf8'));
const arenaRoom = (opts = {}) => new Room('b', ARENA.boxes, { map: 'arena', mapData: ARENA, mode: MODE_BOMB, seed: 7, ...opts });
const bots = (r) => [...r.players.values()].filter((p) => p.bot);
const teams = (r) => [0, 1].map((t) => [...r.players.values()].filter((p) => p.team === t).length);

test('nav: paths from both spawns to both bomb sites; walls and wall tops are not floor', () => {
  const g = navGrid(ARENA.boxes, ARENA.spawns.flat());
  for (const [sx, sz] of [ARENA.spawns[0][2], ARENA.spawns[1][2]]) {
    for (const s of Object.values(ARENA.sites)) {
      const path = findPath(g, sx, sz, (s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2);
      assert.ok(path && path.length > 5, `a way from (${sx}, ${sz})`);
    }
  }
  assert.equal(floorAt(g, -7, 0), null, 'inside the A/mid divider');
  assert.equal(floorAt(g, 0, 36), null, 'on top of the south wall: nobody gets there');
  assert.equal(floorAt(g, 0, 20), 0);
  assert.equal(walkLine(g, -14, 0, 0, 0), false, 'through the divider');
  assert.equal(walkLine(g, -14, 12, 0, 12), true, 'through the connector');
  const pg = navGrid(plaza, [[6, 16], [-6, 16]]);
  assert.ok(findPath(pg, 6, 16, -40, -30), 'across the plaza');
});

test('bots fill a room to its target in even teams and make way for people', () => {
  const r = arenaRoom({ bots: 6 });
  r.balanceBots();
  assert.equal(r.size, 0, 'no people, no bots');
  const a = r.join('alice');
  r.balanceBots();
  assert.equal(r.size, 6);
  assert.deepEqual(teams(r), [3, 3]);
  assert.ok(bots(r).every((p) => p.name.startsWith(BOT_PREFIX)));
  assert.equal(new Set(bots(r).map((p) => p.name)).size, 5, 'distinct names');
  const b = r.join('bob');
  r.balanceBots();
  assert.notEqual(b.team, a.team, 'people spread over both teams');
  assert.equal(r.size, 6);
  assert.deepEqual(teams(r), [3, 3]);
  assert.deepEqual(r.summary().players, 2);
  assert.deepEqual(r.summary().bots, 4);
  // more people than the target: no bots left on a full team, still even
  const more = [];
  for (let i = 0; i < 4; i++) {
    more.push(r.join('p' + i));
    r.balanceBots();
  }
  assert.equal(r.humans, 6);
  assert.equal(bots(r).length, 0);
  more.push(r.join('p4'));
  r.balanceBots();
  assert.deepEqual(teams(r), [4, 4], 'a bot evens out the seventh person');
  // people leave: bots take their seats; the last one out takes the bots too
  for (const p of [...more, b]) {
    r.leave(p.id);
    r.balanceBots();
  }
  assert.equal(r.size, 6);
  r.leave(a.id);
  r.balanceBots();
  assert.equal(r.size, 0);
});

test('a person can join a room full of bots', () => {
  const r = arenaRoom({ bots: 10 });
  r.join('alice');
  r.balanceBots();
  assert.equal(r.size, 10);
  assert.ok(r.join('bob'), 'a bot made way');
  r.balanceBots();
  assert.equal(r.size, 10);
  assert.equal(r.humans, 2);
  assert.deepEqual(teams(r), [5, 5]);
});

// Plays `minutes` of a room with one person (driven by a bot brain here)
// and records what happened.
function play(r, minutes) {
  const h = r.join('alice');
  r.balanceBots();
  h.bot = new Bot(r, h, createRng(99));
  const log = [];
  let seen = 0;
  for (let t = 0; t < minutes * 60 * TICK_RATE; t++) {
    r.step();
    for (const e of r.events) if (e.n > seen) log.push(e.data);
    seen = r._eventN;
  }
  return log;
}

test('bots play Bomb Defusal by the rules: they fight, plant and finish rounds', () => {
  const r = arenaRoom({ bots: 10 });
  const log = play(r, 4);
  const rounds = log.filter((e) => e[0] === EV_ROUND_END).length;
  assert.ok(rounds >= 5, `${rounds} rounds in 4 minutes`);
  assert.ok(log.filter((e) => e[0] === EV_KILL).length >= rounds * 3, 'fights');
  assert.ok(log.some((e) => e[0] === EV_BOMB && e[1] === BOMBEV_PLANTED), 'a plant');
  assert.equal([...r.players.values()].reduce((n, p) => n + p.rejected, 0), 0, 'no shot the server refused');
});

test('bots play deathmatch on the plaza, and a match replays the same from the same seed', () => {
  const run = () => {
    const r = new Room('d', plaza, { mode: 'dm', bots: 4, seed: 3 });
    const log = play(r, 1);
    return log.filter((e) => e[0] === EV_KILL).map((e) => e.slice(1, 3).join('>')).join(' ');
  };
  const a = run();
  assert.ok(a.split(' ').length >= 5, 'kills happen');
  assert.equal(run(), a);
});

test("smoke blocks a bot's sight", () => {
  const r = arenaRoom({ bots: 2 });
  const a = r.join('alice');
  r.balanceBots();
  const bot = bots(r)[0];
  r._place(bot.bot ? bot : a, 0, 20);
  r._place(a, 0, 14);
  const eye = a.move.pos.y + 1.5;
  assert.equal(bot.bot._clear(0, eye, 14), true);
  r.smokes.push({ x: 0, y: 1.5, z: 17, until: r.tick + 100 });
  assert.equal(bot.bot._clear(0, eye, 14), false);
});

test('server: bots join a new room, show up in the room list, and can be turned off', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, bots: 4 });
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${server.port}`;
  const join = (hello) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'alice', mode: 'teams', ...hello })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === 'snap') resolve({ ws, snap: m });
      });
    });
  const a = await join({ room: 'withbots' });
  assert.equal(a.snap.players.length, 3);
  assert.ok(a.snap.players.every((row) => row[7].startsWith(BOT_PREFIX)));
  const list = await (await fetch(`http://127.0.0.1:${server.port}/rooms`)).json();
  const row = list.rooms.find((x) => x.name === 'withbots');
  assert.equal(row.players, 1);
  assert.equal(row.bots, 3);
  const b = await join({ room: 'nobots', private: true, bots: false });
  assert.equal(b.snap.players.length, 0);
  a.ws.close();
  b.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(server.rooms.has('withbots'), false, 'the bots left with the last person');
});
