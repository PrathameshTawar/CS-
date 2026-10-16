// Hosting: one server serves the built game page and the multiplayer
// WebSocket on the same address, and the page connects back to it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { startServer } from '../server/index.js';
import { defaultServerUrl } from '../src/core/config.js';

let server, base, dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ow-host-'));
  mkdirSync(join(dir, 'site', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'site', 'index.html'), '<title>OVERWATCH</title>');
  writeFileSync(join(dir, 'site', 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'secret.txt'), 'not for players'); // beside the site, not in it
  server = await startServer({ port: 0, host: '127.0.0.1', staticDir: join(dir, 'site'), log: () => {} });
  base = `http://127.0.0.1:${server.port}`;
});
after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('serves the game page, never cached, and fingerprinted assets, cached for good', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(await page.text(), '<title>OVERWATCH</title>');
  const js = await fetch(`${base}/assets/index-abc.js`);
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/?server=x&name=y`)).status, 200, 'query strings are ignored');
});

test('the health check moves to /health once the game is served', async () => {
  const body = await (await fetch(`${base}/health`)).json();
  assert.equal(body.ok, true);
  assert.equal(body.protocol, PROTOCOL_VERSION);
});

test('nothing outside the site is reachable', async () => {
  for (const path of ['/../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/missing.js', '/%zz']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), /not for players/, path);
  }
});

test('the WebSocket game server answers on the same port', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const welcome = await new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'a', room: 'host' })));
    ws.on('message', (d) => resolve(JSON.parse(d.toString())));
    ws.on('error', reject);
  });
  assert.equal(welcome.t, 'welcome');
  ws.close();
});

test('a fresh player connects to the host that served the page', () => {
  const at = (href) => new URL(href);
  assert.equal(defaultServerUrl(at('https://overwatch.onrender.com/')), 'wss://overwatch.onrender.com');
  assert.equal(defaultServerUrl(at('http://192.168.1.20:8787/?play=1')), 'ws://192.168.1.20:8787');
  // Vite's dev and preview servers don't run the game server
  assert.equal(defaultServerUrl(at('http://127.0.0.1:5173/')), 'ws://localhost:8787');
  assert.equal(defaultServerUrl(at('http://localhost:4173/')), 'ws://localhost:8787');
  assert.equal(defaultServerUrl(at('file:///C:/game/index.html')), 'ws://localhost:8787');
  // a build that names its server (VITE_SERVER_URL) always uses it
  assert.equal(defaultServerUrl(at('https://x.itch.io/'), 'wss://game.example.com'), 'wss://game.example.com');
});
