// Names people may use, and feedback reaching the server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { FALLBACK_NAME, isOffensive, playerName } from '../shared/names.js';
import { feedbackUrl, roomsUrl } from '../shared/lobby.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { startServer } from '../server/index.js';

test('names: slurs and obscenities are refused through tricks; ordinary names pass', () => {
  for (const bad of ['fuck', 'F u c k', 'fvck', 'FUUUCK', 'sh1t', 'shit69', 'n1gga', 'b1tch', 'madarchod', 'MC', 'BhenChod', 'chutiya123', 'gandu_pro', 'c0ck69', 'xXfuckXx']) {
    assert.equal(isOffensive(bad), true, bad);
    assert.equal(playerName(bad), FALLBACK_NAME);
  }
  for (const ok of ['Cassie', 'Nigel', 'Grape', 'Lundgren', 'Dickson', 'Torpedo', 'Kshitij', 'Shitij', 'Scunthorpe', 'Hancock', 'Cocktail', 'Assassin', 'Prathamesh', 'Ace_99']) {
    assert.equal(isOffensive(ok), false, ok);
    assert.equal(playerName(ok), ok);
  }
});

test("names: nobody can pass as a bot, and junk becomes 'player'", () => {
  assert.equal(playerName('BOT Ace'), 'Ace');
  assert.equal(playerName('bot'), FALLBACK_NAME);
  assert.equal(playerName('Botanist'), 'Botanist');
  assert.equal(playerName('   '), FALLBACK_NAME);
  assert.equal(playerName(42), FALLBACK_NAME);
  assert.equal(playerName('a'.repeat(40)).length, 16);
});

test('server addresses for the room list and feedback', () => {
  assert.equal(roomsUrl('wss://game.example.com/'), 'https://game.example.com/rooms');
  assert.equal(feedbackUrl('ws://localhost:8787'), 'http://localhost:8787/feedback');
  assert.equal(feedbackUrl('not a url'), null);
});

test('server: the name filter applies, and the welcome says the name others see', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
  t.after(() => server.close());
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'BOT sh1t', room: 'names' })));
  const welcome = await new Promise((r) => ws.on('message', (d) => r(JSON.parse(d.toString()))));
  assert.equal(welcome.name, FALLBACK_NAME);
  assert.equal([...server.rooms.get('names').players.values()][0].name, FALLBACK_NAME);
  ws.close();
});

test('server: feedback is taken, rate-limited, and shown only with the key', async (t) => {
  const logs = [];
  const server = await startServer({ port: 0, host: '127.0.0.1', log: (m) => logs.push(m), feedbackKey: 'sekrit' });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}/feedback`;
  const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
  const res = await post({ kind: 'feedback', text: 'stuck on <the> crate', info: { map: 'arena', fps: 60 } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'pages on other sites (itch.io) may send');
  assert.equal((await post({ kind: 'spam', text: 'x' })).status, 400);
  assert.equal((await post({ kind: 'error', text: '   ' })).status, 400);
  assert.ok(logs.some((l) => l.startsWith('[feedback] stuck on <the> crate')), 'in the server log');

  assert.equal((await fetch(base)).status, 404, 'no key: nothing to see');
  assert.equal((await fetch(base + '?key=wrong')).status, 404);
  const page = await (await fetch(base + '?key=sekrit')).text();
  assert.ok(page.includes('stuck on &#60;the&#62; crate'), 'escaped on the page');
  const json = await (await fetch(base + '?key=sekrit&format=json')).json();
  assert.equal(json.reports.length, 1);
  assert.match(json.reports[0].info, /"map":"arena"/);

  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await post({ kind: 'error', text: 'e' + i })).status === 429) limited++;
  assert.ok(limited > 0, 'one address can only send so much');
});

test('server: without a key set, nobody can read the reports', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
  t.after(() => server.close());
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/feedback?key=`)).status, 404);
});
