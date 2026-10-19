// shared/lobby.js — finding a match: the room list, Quick Play, private
// room codes and invite links. Pure functions (the menu and the tests use
// them; the server provides the list at GET /rooms).

// Room codes: no 0/O or 1/I, so they survive being read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

// A private room's code. `random` returns [0, 1) (Math.random in the menu).
export function roomCode(random = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}

// The HTTP address of `path` on a game server, from its WebSocket address.
export function serverHttpUrl(wsUrl, path) {
  try {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = path;
    u.search = '';
    return u.href;
  } catch {
    return null;
  }
}

// The room list, and where feedback and error reports go.
export const roomsUrl = (wsUrl) => serverHttpUrl(wsUrl, '/rooms');
export const feedbackUrl = (wsUrl) => serverHttpUrl(wsUrl, '/feedback');

// Quick Play: the public room in `mode` with the most players that still has
// space (a match already going is more fun than an empty one), or null.
export function pickQuickPlay(rooms, mode) {
  let best = null;
  for (const r of rooms || []) {
    if (r.mode !== mode || r.players >= r.max) continue;
    if (!best || r.players > best.players) best = r;
  }
  return best;
}

// The link that drops a friend into `room`: the game page with ?join=. The
// server address rides along (as `host`, not `server`, which would connect
// before the friend has picked a name) only when it isn't the page's default.
export function inviteUrl(pageHref, room, server = null, defaultServer = null) {
  const u = new URL(pageHref);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', room);
  if (server && server !== defaultServer) u.searchParams.set('host', server);
  return u.href;
}

// An invite in the address bar: { room, server } or null.
export function readInvite(href) {
  const u = new URL(href);
  const room = (u.searchParams.get('join') || '').replace(/[^\w-]/g, '').slice(0, 24);
  if (!room) return null;
  return { room, server: u.searchParams.get('host') || null };
}
