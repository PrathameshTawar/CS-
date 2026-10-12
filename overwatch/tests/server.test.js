// End-to-end over real sockets: two clients join one room and see each
// other move; malformed clients are dropped.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { PROTOCOL_VERSION, TICK_RATE, writeInput } from '../shared/protocol.js';

let server;
let url;
before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
  url = `ws://127.0.0.1:${server.port}`;
});
after(() => server.close());

// A scripted client that records every message it receives.
function connect(hello = { t: 'hello', v: PROTOCOL_VERSION, name: 'bot', room: 'e2e' }) {
  const ws = new WebSocket(url);
  const c = { ws, messages: [], closed: null };
  c.next = (pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      const found = c.messages.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), ms);
      c.waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  c.waiters = [];
  ws.on('open', () => hello && ws.send(JSON.stringify(hello)));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.messages.push(m);
    c.waiters = c.waiters.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  });
  c.closedP = new Promise((resolve) => ws.on('close', (code, reason) => resolve((c.closed = { code, reason: reason.toString() }))));
  return c;
}

test('health check answers over HTTP', async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.protocol, PROTOCOL_VERSION);
});

test('two clients join one room and see each other move', async () => {
  const a = connect({ t: 'hello', v: PROTOCOL_VERSION, name: 'alice', room: 'e2e' });
  const b = connect({ t: 'hello', v: PROTOCOL_VERSION, name: 'bob', room: 'e2e' });
  const wa = await a.next((m) => m.t === 'welcome');
  const wb = await b.next((m) => m.t === 'welcome');
  assert.notEqual(wa.id, wb.id);
  assert.equal(wa.room, 'e2e');

  const seen = await b.next((m) => m.t === 'snap' && m.players.some((p) => p[0] === wa.id));
  const start = seen.players.find((p) => p[0] === wa.id);
  assert.equal(start[7], 'alice');

  // alice walks forward for half a second (60 inputs, sent in batches of 4)
  const input = { forward: 1, right: 0, jump: false, crouch: false, sprint: false, ads: 0 };
  for (let seq = 0; seq < TICK_RATE / 2; seq += 4) {
    a.ws.send(JSON.stringify({ t: 'input', i: [0, 1, 2, 3].map((k) => writeInput(seq + k, input, start[4], 0)) }));
  }
  const ack = await a.next((m) => m.t === 'snap' && m.ack === TICK_RATE / 2 - 1);
  const moved = await b.next((m) => m.t === 'snap' && m.tick >= ack.tick);
  const end = moved.players.find((p) => p[0] === wa.id);
  const dist = Math.hypot(end[1] - start[1], end[3] - start[3]);
  assert.ok(dist > 1.5, `alice moved ${dist.toFixed(2)} m as seen by bob`);
  // bob's view of alice matches alice's own authoritative state (to 1 mm)
  assert.ok(Math.abs(end[1] - ack.you[0]) < 0.001 && Math.abs(end[3] - ack.you[2]) < 0.001);

  a.ws.close();
  await b.next((m) => m.t === 'snap' && m.tick > moved.tick && !m.players.some((p) => p[0] === wa.id));
  b.ws.close();
});

test('protocol mismatches and malformed messages are rejected', async () => {
  const old = connect({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'x', room: 'e2e' });
  assert.equal((await old.next((m) => m.t === 'error')).code, 'version');
  await old.closedP;

  const junk = connect(null);
  junk.ws.on('open', () => junk.ws.send('not json'));
  assert.equal((await junk.next((m) => m.t === 'error')).code, 'bad-message');
  await junk.closedP;

  const cheat = connect();
  await cheat.next((m) => m.t === 'welcome');
  cheat.ws.send(JSON.stringify({ t: 'input', i: [[0, 5, 0, 0, 0, 0]] }));
  assert.equal((await cheat.next((m) => m.t === 'error')).code, 'bad-input');
  await cheat.closedP;
});
