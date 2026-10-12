// tools/shotset.mjs — capture the full deterministic shot set.
//
// Each shot is captured in its OWN isolated Chrome page (spawned via
// tools/capture.mjs, which itself launches a fresh headless Chrome per run), so
// no state — particle ages, decal buffers, exposure — leaks between shots and
// the pixels are bit-identical across runs for the same URL.
//
// Usage:
//   node tools/shotset.mjs            # write shots/<name>.png  (current)
//   node tools/shotset.mjs --baseline # write shots/baseline/<name>.png
//   node tools/shotset.mjs --only plaza,roof   # subset for a fast iteration
//
// Exit code is non-zero if any shot fails to boot or renders console errors.
// The URL for every shot pins the same seed and a fixed quality preset, so the
// same URL always produces the same frame — that is the contract imagediff.mjs
// enforces.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOT_POSES } from '../src/shotrig/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// time-of-day preset per shot (see src/sky/index.js presets)
const SHOT_TIMES = {
  plaza: 'golden',
  street: 'golden',
  fountain: 'golden',
  shop: 'golden',
  alley: 'golden',
  roof: 'golden',
  night: 'night',
};

const SEED = 0x5eed1234;
const QUALITY = 'high'; // fixed preset: same internal resolution on any machine
const TIMEOUT_MS = 120000;
const BASE_URL = process.env.SHOT_URL || 'http://127.0.0.1:5173';

const isBaseline = process.argv.includes('--baseline');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;

const names = Object.keys(SHOT_POSES).filter((n) => !only || only.includes(n));
const outDir = resolve(ROOT, isBaseline ? 'shots/baseline' : 'shots');

function capture(name) {
  const time = SHOT_TIMES[name] || 'golden';
  const url = `${BASE_URL}/?shot=${name}&time=${time}&q=${QUALITY}&seed=${SEED}`;
  const out = resolve(outDir, `${name}.png`);
  return new Promise((res) => {
    const t0 = Date.now();
    const proc = spawn(process.execPath, [resolve(__dirname, 'capture.mjs'), url, out, String(TIMEOUT_MS)], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('exit', (code) => {
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`[shotset] ${name.padEnd(10)} ${code === 0 ? 'PASS' : 'FAIL'}  (${secs}s)  ${url}`);
      res(code === 0);
    });
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`[shotset] ${isBaseline ? 'BASELINE' : 'CURRENT'} capture — ${names.length} shot(s) -> ${outDir}`);
  const results = [];
  for (const name of names) results.push(await capture(name)); // sequential: isolated pages, bounded RAM
  const failed = results.filter((ok) => !ok).length;
  console.log(`[shotset] ${results.length - failed}/${results.length} shots OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[shotset] failed:', err.message);
  process.exit(1);
});
