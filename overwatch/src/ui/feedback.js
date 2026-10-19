// ui/feedback.js — players tell us what broke, and page errors report
// themselves, to the game server's /feedback (the server the game plays
// on, or the page's default one in single player).
//
// Each report carries what helps reproduce it: map, mode, room, online
// state, ping, fps, quality and the browser. No names unless the player
// writes one. Errors are reported once each, at most MAX_ERRORS a session.

import { feedbackUrl } from '../../shared/lobby.js';
import { PROTOCOL_VERSION } from '../../shared/protocol.js';

const MAX_ERRORS = 5;

// Frames the browser draws per second, counted over `ms` (the game's own
// meter reads the game clock, which stops while single player is paused).
export function measureFps(ms = 500) {
  return new Promise((resolve) => {
    let frames = 0;
    let first = 0;
    const tick = (t) => {
      if (!first) first = t;
      else frames++;
      if (t - first < ms) requestAnimationFrame(tick);
      else resolve(frames ? Math.round((frames * 1000) / (t - first)) : undefined);
    };
    requestAnimationFrame(tick);
  });
}

// What the game is doing right now (for a report).
export async function gameInfo(ctx) {
  const cfg = ctx.config;
  const net = ctx.peek && ctx.peek('net');
  const fps = await measureFps();
  return {
    protocol: PROTOCOL_VERSION,
    map: cfg.map,
    mode: net ? cfg.mode : 'single player',
    room: net ? net.room : undefined,
    online: net ? net.status : undefined,
    ping: net ? Math.round(net.rtt) : undefined,
    fps,
    quality: cfg.quality,
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio || 1}`,
    browser: navigator.userAgent.slice(0, 160),
    page: location.host,
  };
}

// Sends one report; resolves true when the server took it.
export async function sendReport(serverWsUrl, kind, text, info) {
  const url = feedbackUrl(serverWsUrl);
  if (!url) return false;
  try {
    // text/plain: a "simple" request, no CORS preflight
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ kind, text, info }), keepalive: true });
    return res.ok;
  } catch {
    return false;
  }
}

// Reports uncaught errors and rejected promises (deduplicated, capped).
export function reportErrors(ctx, serverWsUrl) {
  const seen = new Set();
  const report = (message, stack) => {
    const key = String(message).slice(0, 200);
    if (seen.has(key) || seen.size >= MAX_ERRORS) return;
    seen.add(key);
    gameInfo(ctx).then((info) => sendReport(serverWsUrl(), 'error', `${key}\n${String(stack || '').slice(0, 1200)}`, info));
  };
  const onError = (e) => report(e.message, e.error && e.error.stack);
  const onRejection = (e) => report(e.reason && e.reason.message ? e.reason.message : e.reason, e.reason && e.reason.stack);
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  return () => {
    removeEventListener('error', onError);
    removeEventListener('unhandledrejection', onRejection);
  };
}
