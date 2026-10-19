// server/index.js — OVERWATCH multiplayer server: HTTP health check + a
// WebSocket endpoint, rooms, and the fixed-rate tick loop.
//
//   PORT  (default 8787)        listen port
//   HOST  (default 0.0.0.0)     listen address
//   SEED  (default 0x5eed1234)  map seed; clients must load the same map
//   STATIC_DIR (default ../dist) the built game (`npm run build`); served
//                                at / when it exists, so one host serves
//                                both the page and the game server
//   COMPRESS   (default off)     1: compress WebSocket messages (less
//                                bandwidth, much more CPU; see DEFLATE)
//   BOTS       (default 6)       fill each room with bots up to this many
//                                players (even teams; people replace them);
//                                0: no bots
//
// Run: `npm run server` from overwatch/, then open the game with
// `?server=ws://<host>:8787` (and optionally `&room=<name>&name=<you>`).
// After `npm run build`, http://<host>:8787/ serves the game itself.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { buildColliders } from '../shared/map.js';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  SNAPSHOT_EVERY,
  TICK_RATE,
  cleanLabel,
  decode,
  encode,
} from '../shared/protocol.js';
import { Room } from './room.js';

const MAX_ROOMS = 64;
const MAX_MESSAGES_PER_SECOND = 120; // inputs arrive ~30/s; pings ~1/s
const HELLO_TIMEOUT_MS = 10000; // generous: a client may hitch while loading
// A dropped connection keeps its player (standing still) this long, so the
// client can come back with its resume token as the same player.
const RESUME_MS = 30000;
// Pings every HEARTBEAT_MS; a connection that missed the last pong is dead
// (a network that vanished without closing) and is dropped, which holds it.
const HEARTBEAT_MS = 10000;
// Close codes that mean the player left on purpose (normal, page closed,
// closed with no code): they go at once. A broken link (1006) is held.
const CLOSE_LEFT = new Set([1000, 1001, 1005]);
// Optional (COMPRESS=1): snapshots shrink about 5x on the wire (14 -> 3 KB/s
// a player) but the server's CPU roughly quadruples (200 players: 25% -> 98%
// of a core), so it's off unless bandwidth costs more than CPU. A small
// window and memLevel keep each connection's zlib memory down.
const DEFLATE = {
  zlibDeflateOptions: { level: 1, memLevel: 7 },
  serverMaxWindowBits: 13,
  threshold: 128,
  concurrencyLimit: 16,
};
const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../dist', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Serves the built game from `root`. Returns false when there is no such
// file, so the caller can answer 404. Never serves outside `root`.
async function serveStatic(root, req, res) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return false;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(root, normalize('.' + path));
  if (file !== root && !file.startsWith(root + sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
      // Vite fingerprints everything under assets/; the page itself must stay fresh
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

export async function startServer({
  port = 8787,
  host = '0.0.0.0',
  seed = 0x5eed1234,
  rules = {},
  resumeMs = RESUME_MS,
  compress = false,
  bots = 0,
  heartbeatMs = HEARTBEAT_MS,
  staticDir = null,
  log = console.log,
} = {}) {
  seed >>>= 0;
  const plazaColliders = await buildColliders(seed, 'plaza');
  const { ARENA } = await import('../shared/maps/arena.js');
  const rooms = new Map();
  const clients = new Set(); // { ws, room, player }

  const root = staticDir && existsSync(join(staticDir, 'index.html')) ? resolve(staticDir) : null;

  const http = createServer(async (req, res) => {
    const json = (body) => {
      // public information; any page (e.g. the Vite dev server) may read it
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    const path = req.url.split('?')[0];
    // the room list for the menu: public rooms only, busiest first
    if (path === '/rooms') {
      const list = [...rooms.values()].filter((r) => !r.private).map((r) => r.summary());
      return json({ protocol: PROTOCOL_VERSION, rooms: list.sort((a, b) => b.players - a.players) });
    }
    // health check for hosting platforms; also the whole answer when there is no built game
    if (path === '/health' || !root) return json({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.size, players: clients.size });
    if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(root, req, res))) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: compress ? DEFLATE : false });

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  };
  const reject = (ws, code, message) => {
    send(ws, { t: 'error', code, message });
    ws.close(1008, code);
  };
  // The player leaves the room now (the room goes when it's empty).
  const remove = (room, player, why) => {
    clearTimeout(player.awayTimer);
    room.leave(player.id);
    room.balanceBots(); // a bot takes the seat (or the bots go with the last person)
    log(`[leave] ${player.name}#${player.id} <- ${room.name} (${room.humans} players${why ? ', ' + why : ''})`);
    if (room.size === 0 && rooms.get(room.name) === room) rooms.delete(room.name);
  };

  // Drops a client for good: no coming back as the same player.
  const kick = (client, code, message) => {
    client.kicked = true;
    reject(client.ws, code, message);
  };

  wss.on('connection', (ws) => {
    const client = { ws, room: null, player: null, window: 0, count: 0, alive: true };
    ws.on('pong', () => (client.alive = true));
    clients.add(client);
    const helloTimer = setTimeout(() => !client.player && reject(ws, 'timeout', 'no hello'), HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      // flood guard
      const now = Date.now();
      if (now - client.window >= 1000) {
        client.window = now;
        client.count = 0;
      }
      if (++client.count > MAX_MESSAGES_PER_SECOND) return kick(client, 'flood', 'too many messages');

      const msg = isBinary ? null : decode(data.toString());
      if (!msg) return reject(ws, 'bad-message', 'malformed message');

      if (!client.player) {
        if (msg.t !== 'hello') return reject(ws, 'bad-message', 'expected hello');
        if (msg.v !== PROTOCOL_VERSION) return reject(ws, 'version', `server speaks protocol ${PROTOCOL_VERSION}`);
        const roomName = cleanLabel(msg.room, 'public', 24);
        let room = rooms.get(roomName);
        // back after a dropped connection: the same player, where they were
        // (if the old connection hasn't been noticed as dead yet, this one
        // replaces it)
        const held = room && typeof msg.resume === 'string' ? [...room.players.values()].find((p) => p.token === msg.resume) : null;
        if (held) {
          for (const old of clients) {
            if (old !== client && old.player === held) {
              old.replaced = true;
              old.ws.terminate();
            }
          }
          clearTimeout(helloTimer);
          clearTimeout(held.awayTimer);
          held.away = false;
          held.idle = 0;
          held.queue.length = 0;
          client.room = room;
          client.player = held;
          send(ws, { t: 'welcome', id: held.id, token: held.token, seed, map: room.map, room: roomName, tick: room.tick, resumed: true });
          log(`[back] ${held.name}#${held.id} -> ${roomName}`);
          return;
        }
        if (!room) {
          if (rooms.size >= MAX_ROOMS) return reject(ws, 'busy', 'server is full');
          // the hello that creates a room picks its mode and map
          // team and bomb rooms default to arena; dm rooms to plaza (unless requested)
          // Bomb Defusal needs a map with bomb sites; on the plaza it's team elimination
          const mode = msg.mode === 'dm' ? 'dm' : msg.mode === 'bomb' ? 'bomb' : 'teams';
          const requestedMap = msg.map ? cleanLabel(msg.map, 'arena', 16) : (mode === 'dm' ? 'plaza' : 'arena');
          const map = requestedMap === 'plaza' ? 'plaza' : 'arena';
          const colliders = map === 'arena' ? ARENA.boxes : plazaColliders;
          const mapData = map === 'arena' ? ARENA : null;
          room = new Room(roomName, colliders, { seed, map, mapData, mode, rules, private: msg.private === true, bots: msg.bots === false ? 0 : bots });
          rooms.set(roomName, room);
        }
        const player = room.join(cleanLabel(msg.name, 'player', 16));
        if (!player) return reject(ws, 'room-full', `room "${roomName}" is full`);
        room.balanceBots();
        clearTimeout(helloTimer);
        player.token = randomBytes(12).toString('hex');
        player.away = false;
        client.room = room;
        client.player = player;
        send(ws, { t: 'welcome', id: player.id, token: player.token, seed, map: room.map, room: roomName, tick: room.tick });
        log(`[join] ${player.name}#${player.id} -> ${roomName} [${room.mode}/${room.map}] (${room.humans} players, ${room.size - room.humans} bots)`);
        return;
      }

      if (msg.t === 'input') {
        if (!client.room.receiveInputs(client.player.id, msg.i, msg.f, msg.r, msg.w, msg.n)) kick(client, 'bad-input', 'malformed input');
      } else if (msg.t === 'buy') {
        client.room.buy(client.player.id, msg.w); // the next snapshot shows the result
      } else if (msg.t === 'sell') {
        client.room.sell(client.player.id, msg.w);
      } else if (msg.t === 'ping') {
        send(ws, { t: 'pong', c: msg.c });
      }
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      clients.delete(client);
      const { room, player } = client;
      if (!room || !player || client.replaced) return;
      // left on purpose or kicked: gone now; dropped: held for a while
      if (CLOSE_LEFT.has(code) || client.kicked || closing || resumeMs <= 0) return remove(room, player);
      player.away = true;
      player.awayTimer = setTimeout(() => remove(room, player, 'did not come back'), resumeMs);
      log(`[away] ${player.name}#${player.id} <- ${room.name}`);
    });
    ws.on('error', () => ws.terminate());
  });

  // Fixed-rate tick loop: run however many ticks are due, catch up at most
  // a quarter second after a stall.
  const tickMs = 1000 / TICK_RATE;
  let last = performance.now();
  let acc = 0;
  let ticks = 0;
  let closing = false;
  const loop = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + now - last, 250);
    last = now;
    while (acc >= tickMs) {
      acc -= tickMs;
      for (const room of rooms.values()) room.step();
      // once a second: idle players make way for ones who'll play
      if (++ticks % TICK_RATE === 0) {
        for (const c of clients) {
          if (c.player && !c.kicked && c.player.idle >= c.room.rules.afkTicks) kick(c, 'afk', 'kicked for being idle');
        }
      }
      for (const c of clients) {
        if (c.player && c.room.tick % SNAPSHOT_EVERY === 0) send(c.ws, c.room.snapshotFor(c.player.id));
      }
    }
  }, 2);

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) c.ws.terminate();
      else {
        c.alive = false;
        c.ws.ping();
      }
    }
  }, heartbeatMs);

  await new Promise((resolve) => http.listen(port, host, resolve));
  const address = http.address();
  log(`[server] protocol ${PROTOCOL_VERSION}, seed ${seed}, ${plazaColliders.length} colliders, ws://${host}:${address.port}`);
  log(root ? `[server] serving the game from ${root} at http://${host}:${address.port}/` : '[server] no built game to serve (run `npm run build` to serve it here)');

  return {
    port: address.port,
    rooms,
    close: () =>
      new Promise((resolve) => {
        clearInterval(loop);
        clearInterval(heartbeat);
        closing = true; // nobody is held for a server that's going away
        for (const room of rooms.values()) for (const p of room.players.values()) clearTimeout(p.awayTimer);
        for (const c of clients) c.ws.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}

// started directly: `node server/index.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({
    port: Number(process.env.PORT) || 8787,
    host: process.env.HOST || '0.0.0.0',
    seed: Number(process.env.SEED) || 0x5eed1234,
    staticDir: process.env.STATIC_DIR || DEFAULT_STATIC_DIR,
    compress: process.env.COMPRESS === '1',
    bots: process.env.BOTS === undefined ? 6 : Number(process.env.BOTS) || 0,
  });
  // hosting platforms stop a deploy with SIGTERM: close sockets and exit cleanly
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close().then(() => process.exit(0)));
  }
}
