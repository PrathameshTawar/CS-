// Finding a match: the server's room list (public rooms only), Quick Play,
// private room codes and invite links.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { CODE_LENGTH, inviteUrl, pickQuickPlay, readInvite, roomCode, roomsUrl } from '../shared/lobby.js';
import { startServer } from '../server/index.js';

let server;
before(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
});
after(() => server.close());

function join(hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  return new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, ...hello })));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') resolve(ws);
    });
    ws.on('error', reject);
  });
}

test('GET /rooms lists public rooms with their mode, map and players; private rooms stay hidden', async () => {
  const a = await join({ name: 'a', room: 'open-bomb', mode: 'bomb', map: 'arena' });
  const b = await join({ name: 'b', room: 'open-bomb' });
  const c = await join({ name: 'c', room: 'K7QX2M', mode: 'dm', map: 'plaza', private: true });
  const res = await fetch(`http://127.0.0.1:${server.port}/rooms`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'readable from the dev server page too');
  const body = await res.json();
  assert.equal(body.protocol, PROTOCOL_VERSION);
  assert.deepEqual(body.rooms.map((r) => [r.name, r.mode, r.map, r.players, r.max]), [['open-bomb', 'bomb', 'arena', 2, 10]]);
  assert.equal(server.rooms.get('K7QX2M').private, true, 'the private room exists, just unlisted');
  for (const ws of [a, b, c]) ws.close();
});

test('Quick Play picks the busiest public room in the mode that still has space', () => {
  const rooms = [
    { name: 'a', mode: 'bomb', players: 3, max: 10 },
    { name: 'b', mode: 'bomb', players: 10, max: 10 },
    { name: 'c', mode: 'bomb', players: 6, max: 10 },
    { name: 'd', mode: 'dm', players: 9, max: 10 },
  ];
  assert.equal(pickQuickPlay(rooms, 'bomb').name, 'c');
  assert.equal(pickQuickPlay(rooms, 'dm').name, 'd');
  assert.equal(pickQuickPlay(rooms, 'teams'), null);
  assert.equal(pickQuickPlay([], 'bomb'), null);
});

test('room codes are short and unambiguous; the room list address comes from the server address', () => {
  const code = roomCode();
  assert.equal(code.length, CODE_LENGTH);
  assert.match(code, /^[A-HJ-NP-Z2-9]+$/, 'no 0, O, 1 or I');
  assert.equal(roomsUrl('wss://overwatch.onrender.com'), 'https://overwatch.onrender.com/rooms');
  assert.equal(roomsUrl('ws://localhost:8787'), 'http://localhost:8787/rooms');
  assert.equal(roomsUrl('not a url'), null);
});

test('invite links carry the room, and the server only when it is not the page\'s own', () => {
  const page = 'https://overwatch.onrender.com/?server=wss%3A%2F%2Foverwatch.onrender.com&name=alice&room=K7QX2M';
  const own = inviteUrl(page, 'K7QX2M', 'wss://overwatch.onrender.com', 'wss://overwatch.onrender.com');
  assert.equal(own, 'https://overwatch.onrender.com/?join=K7QX2M', "no name, and no 'server' (that would connect at once)");
  assert.deepEqual(readInvite(own), { room: 'K7QX2M', server: null });
  const other = inviteUrl('http://127.0.0.1:5173/', 'lan', 'ws://192.168.1.20:8787', 'ws://localhost:8787');
  assert.deepEqual(readInvite(other), { room: 'lan', server: 'ws://192.168.1.20:8787' });
  assert.deepEqual(readInvite('https://x/?join=%3Cscript%3E'), { room: 'script', server: null }, 'only room-name characters survive');
  assert.equal(readInvite('https://x/'), null);
});
