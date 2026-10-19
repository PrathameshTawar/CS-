// A dropped connection gets its player back; a deliberate leave doesn't
// wait; idle players are kicked; compression is optional. Real sockets.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { Room } from '../server/room.js';
import { PROTOCOL_VERSION, TICK_RATE, writeInput } from '../shared/protocol.js';

const RESUME_MS = 600;
// (the default idle limit, 90 s, never trips here)
let server;
let url;
before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, resumeMs: RESUME_MS });
  url = `ws://127.0.0.1:${server.port}`;
});
after(() => server.close());

const hello = (name, room, extra = {}) => ({ t: 'hello', v: PROTOCOL_VERSION, name, room, mode: 'dm', ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A scripted client that records every message it receives.
function connect(h, to = url) {
  const ws = new WebSocket(to);
  const c = { ws, messages: [], waiters: [] };
  c.next = (pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      const found = c.messages.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error('timed out waiting for ' + pred)), ms);
      c.waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  ws.on('open', () => ws.send(JSON.stringify(h)));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.messages.push(m);
    c.waiters = c.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  });
  c.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  return c;
}
const lists = (snap, id) => snap.players.some((p) => p[0] === id);
// the next snapshot `c` gets from now on
const fresh = (c) => {
  const n = c.messages.length;
  return c.next((m) => m.t === 'snap' && c.messages.indexOf(m) >= n);
};

test('a dropped connection comes back as the same player, with its score', async () => {
  const a = connect(hello('alice', 'drop'));
  const b = connect(hello('bob', 'drop'));
  const wa = await a.next((m) => m.t === 'welcome');
  await b.next((m) => m.t === 'welcome');
  assert.match(wa.token, /^[0-9a-f]{24}$/);
  const room = server.rooms.get('drop');
  room.players.get(wa.id).kills = 3;

  a.ws.terminate(); // the network goes: no close handshake (1006)
  await wait(150);
  assert.ok(lists(await fresh(b), wa.id), 'still in the room, standing where they were');

  const a2 = connect(hello('alice', 'drop', { resume: wa.token }));
  const back = await a2.next((m) => m.t === 'welcome');
  assert.equal(back.id, wa.id);
  assert.equal(back.resumed, true);
  const snap = await a2.next((m) => m.t === 'snap');
  assert.equal(snap.me[4], 3, 'kills kept');
  await wait(RESUME_MS + 200);
  assert.ok(lists(await fresh(b), wa.id), 'the hold timer was cancelled');
  a2.ws.close();
  b.ws.close();
});

test('a resume takes over a connection the server still thinks is alive', async () => {
  const a = connect(hello('alice', 'half'));
  const wa = await a.next((m) => m.t === 'welcome');
  // the old link is dead but nobody has noticed: the new one replaces it
  const a2 = connect(hello('alice', 'half', { resume: wa.token }));
  assert.equal((await a2.next((m) => m.t === 'welcome')).id, wa.id);
  await a.closed;
  await wait(100);
  assert.equal(server.rooms.get('half').size, 1, 'one alice, not a ghost and a copy');
  assert.ok(await a2.next((m) => m.t === 'snap'));
  a2.ws.close();
});

test('a connection that stops answering pings is dropped (and held)', async (t) => {
  const beat = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, heartbeatMs: 100 });
  t.after(() => beat.close());
  const a = connect(hello('alice', 'beat'), `ws://127.0.0.1:${beat.port}`);
  await a.next((m) => m.t === 'welcome');
  a.ws.pong = () => {}; // a vanished network answers nothing
  a.ws._receiver.removeAllListeners('ping');
  await a.closed;
  await wait(50);
  const p = [...beat.rooms.get('beat').players.values()][0];
  assert.equal(p.away, true);
});

test('the hold runs out: the player goes, and the old token joins as someone new', async () => {
  const a = connect(hello('alice', 'gone'));
  const b = connect(hello('bob', 'gone'));
  const wa = await a.next((m) => m.t === 'welcome');
  await b.next((m) => m.t === 'welcome');
  a.ws.terminate();
  await wait(RESUME_MS + 200);
  assert.ok(!lists(await fresh(b), wa.id));
  const a2 = connect(hello('alice', 'gone', { resume: wa.token }));
  const w2 = await a2.next((m) => m.t === 'welcome');
  assert.notEqual(w2.id, wa.id);
  assert.equal(w2.resumed, undefined);
  a2.ws.close();
  b.ws.close();
});

test('leaving on purpose is immediate, and the last one out closes the room', async () => {
  const a = connect(hello('alice', 'bye'));
  const b = connect(hello('bob', 'bye'));
  const wa = await a.next((m) => m.t === 'welcome');
  await b.next((m) => m.t === 'welcome');
  a.ws.close(1000, 'left');
  await wait(100);
  assert.ok(!lists(await fresh(b), wa.id));
  b.ws.close(1000, 'left');
  await wait(100);
  assert.equal(server.rooms.has('bye'), false);
});

test('an idle player is kicked, an active one is not; the kicked can not resume', async (t) => {
  // a server whose idle limit is half a second
  const quick = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, rules: { afkTicks: TICK_RATE / 2 } });
  t.after(() => quick.close());
  const at = `ws://127.0.0.1:${quick.port}`;
  const a = connect(hello('idler', 'afk'), at);
  const b = connect(hello('mover', 'afk'), at);
  const wa = await a.next((m) => m.t === 'welcome');
  const wb = await b.next((m) => m.t === 'welcome');
  const idle = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
  const walk = { ...idle, forward: 1 };
  // both send inputs for 1.5 s (the limit here is 0.5 s); only one moves
  for (let seq = 0; seq < (TICK_RATE * 3) / 2; seq += 4) {
    const batch = (inp) => ({ t: 'input', i: [0, 1, 2, 3].map((k) => writeInput(seq + k, inp, 0, 0)) });
    if (a.ws.readyState === WebSocket.OPEN) a.ws.send(JSON.stringify(batch(idle)));
    b.ws.send(JSON.stringify(batch(walk)));
    await wait(1000 / 30);
  }
  const err = await a.next((m) => m.t === 'error');
  assert.equal(err.code, 'afk');
  assert.equal(await a.closed, 1008);
  assert.equal(b.ws.readyState, WebSocket.OPEN, 'the mover stays');
  const a2 = connect(hello('idler', 'afk', { resume: wa.token }), at);
  assert.notEqual((await a2.next((m) => m.t === 'welcome')).id, wa.id, 'a kick is final');
  assert.ok(wb.id);
  a2.ws.close();
  b.ws.close();
});

test('compression is off by default and on with `compress`', async (t) => {
  const plain = connect(hello('alice', 'zip'));
  await plain.next((m) => m.t === 'snap');
  assert.equal(plain.ws.extensions, '');
  plain.ws.close();
  const zipped = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, compress: true });
  t.after(() => zipped.close());
  const z = connect(hello('alice', 'zip'), `ws://127.0.0.1:${zipped.port}`);
  await z.next((m) => m.t === 'snap');
  assert.match(z.ws.extensions, /permessage-deflate/);
  z.ws.close();
});

test('idle time: only alive, unfrozen players with company count; looking around resets it', () => {
  const r = new Room('idle', [{ min: [-50, -1, -50], max: [50, 0, 50], surface: 'concrete' }], { mode: 'dm' });
  const a = r.join('a');
  const still = { forward: 0, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
  let seq = 0;
  const tick = (p, yaw = p.move.yaw) => {
    r.receiveInputs(p.id, [writeInput(seq++, still, yaw, 0)]);
    r.step();
  };
  for (let i = 0; i < 10; i++) tick(a);
  assert.equal(a.idle, 0, 'alone in the room: nobody is waiting for the slot');
  const b = r.join('b');
  for (let i = 0; i < 10; i++) tick(a);
  assert.equal(a.idle, 10);
  tick(a, a.move.yaw + 0.2);
  assert.equal(a.idle, 0, 'turned to look');
  r._kill(a, b, false, 'pistol');
  for (let i = 0; i < 10; i++) tick(a);
  assert.equal(a.idle, 0, 'the dead wait, they are not idle');
});
