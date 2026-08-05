// tools/capture.mjs — headless screenshot of one frame via CDP over
// WebSocket (Node >= 22 built-in WebSocket + fetch; no puppeteer needed).
//
// Usage:
//   node tools/capture.mjs [url] [out.png] [timeoutMs]
//
// Defaults: http://127.0.0.1:5173  shots/shot.png  15000ms
// Polls for window.__owBooted (set by src/main.js on the first frame), then
// captures. Exits non-zero if the boot flag never appears.

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const url = process.argv[2] || 'http://127.0.0.1:5173';
const outPath = resolve(ROOT, process.argv[3] || 'shots/shot.png');
const timeoutMs = Number(process.argv[4] || 15000);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_PATH.');
}

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolvePromise({
        send(method, params = {}, sessionId) {
          const msgId = ++id;
          ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
          return new Promise((res, rej) => pending.set(msgId, { res, rej }));
        },
        close() {
          ws.close();
        },
        _onMessage(cb) {
          ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
              const { res, rej } = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.error) rej(new Error(msg.error.message));
              else res(msg.result);
            } else if (cb) {
              cb(msg);
            }
          };
        },
      });
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });
}

function printErrors(errors) {
  if (!errors.length) return;
  console.error(`capture: ${errors.length} console/WebGL error(s) detected:`);
  const seen = new Set();
  for (const e of errors) {
    if (!seen.has(e)) {
      seen.add(e);
      console.error('  - ' + e);
    }
  }
}

// Wait for the spawned Chrome to actually exit, then remove its profile dir.
// (process.exit() alone would race Chrome's teardown: rmSync would hit a
// locked dir and the .chrome-tmp-<pid> dirs would accumulate across shotset
// runs.)
async function shutdown(code, proc, cdp, userData) {
  try {
    if (cdp && cdp.close) cdp.close();
  } catch {
    /* best effort */
  }
  try {
    if (proc && proc.exitCode === null) {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      // give Chrome up to 2s to release the profile dir
      await Promise.race([
        new Promise((r) => proc.once('exit', r)),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }
  } catch {
    /* best effort */
  }
  // Chrome's helper processes (GPU/renderer) can hold the profile dir locked
  // a moment after the main process exits — retry so Windows cleanup sticks.
  for (let i = 0; i < 4; i++) {
    try {
      rmSync(userData, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  process.exit(code);
}

async function main() {
  const chrome = findChrome();
  // Unique profile per run: sequential captures (shotset) must never reuse a
  // locked profile dir or Chrome refuses to start. Removed on exit so shotset
  // runs don't accumulate .chrome-tmp-<pid> dirs in the repo root.
  const userData = resolve(ROOT, `.chrome-tmp-${process.pid}`);
  process.on('exit', () => {
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userData}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--window-size=1600,900',
      '--force-device-scale-factor=1',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const timer = setTimeout(() => rej(new Error('Chrome did not expose DevTools endpoint')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        res(m[1]);
      }
    });
    proc.on('exit', (code) => rej(new Error(`Chrome exited early (${code})`)));
  });

  const cdp = await connect(wsUrl);
  const consoleErrors = [];
  cdp._onMessage((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails;
      const text = (d && (d.exception && d.exception.description || d.text)) || 'exception';
      consoleErrors.push(String(text).split('\n')[0]);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleErrors.push(String(text).split('\n')[0]);
    } else if (msg.method === 'Log.entryAdded' && msg.params && msg.params.entry && msg.params.entry.level === 'error') {
      consoleErrors.push(String(msg.params.entry.text || '').split('\n')[0]);
    }
  });

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const session = (method, params = {}) => cdp.send(method, params, sessionId);

  await session('Page.enable');
  await session('Runtime.enable');
  await session('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session('Page.navigate', { url });

  // poll for window.__owBooted
  const deadline = Date.now() + timeoutMs;
  let booted = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await session('Runtime.evaluate', {
        expression: 'window.__owBooted || false',
        returnByValue: true,
      });
      if (res.result && res.result.value) {
        booted = true;
        break;
      }
    } catch {
      /* page mid-navigation */
    }
  }
  if (!booted) {
    console.error(`capture: boot flag not set within ${timeoutMs}ms — game failed to boot`);
    // diagnose: boot phase + overlay text (e.g. "BOOT FAILED: ...") + progress bar
    try {
      const res = await session('Runtime.evaluate', {
        expression: 'JSON.stringify({ phase: window.__owPhase || "none", prewarm: window.__owPrewarm || "none", overlay: (document.getElementById("boot") || {}).innerText || "", bar: ((document.getElementById("bootbar") || {}).style || {}).width || "" })',
        returnByValue: true,
      });
      console.error('boot state:', (res.result && res.result.value) || '(unavailable)');
    } catch {
      /* ignore */
    }
    // save a diagnostic screenshot of whatever is on screen
    try {
      const shot = await session('Page.captureScreenshot', { format: 'png' });
      if (shot && shot.data) {
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, Buffer.from(shot.data, 'base64'));
        console.error(`capture: saved failure screenshot to ${outPath}`);
      }
    } catch {
      /* ignore */
    }
    printErrors(consoleErrors);
    await shutdown(1, proc, cdp, userData);
    return;
  }

  // settle a couple of frames
  await new Promise((r) => setTimeout(r, 1200));

  // telemetry: frame stats + HUD state exposed by the dev system
  try {
    const tel = await session('Runtime.evaluate', {
      expression: 'window.__ow ? JSON.stringify(window.__ow) : null',
      returnByValue: true,
    });
    if (tel.result && tel.result.value) console.log('telemetry:', tel.result.value);
  } catch {
    /* ignore */
  }

  const { data } = await session('Page.captureScreenshot', { format: 'png' });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(data, 'base64'));
  console.log(`capture: wrote ${outPath}`);

  if (consoleErrors.length) {
    printErrors(consoleErrors);
    await shutdown(1, proc, cdp, userData);
    return;
  }

  await shutdown(0, proc, cdp, userData);
}

main().catch((err) => {
  console.error('capture failed:', err.message);
  process.exit(1);
});
