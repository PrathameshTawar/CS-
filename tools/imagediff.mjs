// tools/imagediff.mjs — per-pixel gate between two screenshots or two
// directories of named shots. Exits non-zero if ANY pixel differs beyond the
// (default zero) tolerance.
//
// Usage:
//   node tools/imagediff.mjs a.png b.png [--tol N]
//   node tools/imagediff.mjs [--dirA shots --dirB shots/baseline] [--tol N]
//
// Directory mode compares the UNION of both directories: a shot present in
// only one side fails the gate, so a `--only` subset run on one side can never
// silently pass. The PNG decoder is dependency-free (node:zlib only): 8-bit
// RGB/RGBA/gray, non-interlaced, all filter types — exactly what headless
// Chrome emits. No Math.random, no timestamps: comparing the same two files
// always yields the same result, so this is a reliable CI-style gate.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve, join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// minimal PNG decoder (node:zlib only)
// ---------------------------------------------------------------------------

function decodePNG(buf) {
  // signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error('PNG missing IHDR');
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);

  let channels;
  if (colorType === 6) channels = 4; // RGBA
  else if (colorType === 2) channels = 3; // RGB
  else if (colorType === 0) channels = 1; // gray
  else throw new Error(`color type ${colorType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  // decompressed IDAT carries one filter byte per scanline + pixel bytes
  const total = height * (stride + 1);
  if (raw.length < total) throw new Error(`truncated PNG (need ${total} raw bytes, got ${raw.length})`);
  const out = Buffer.alloc(height * stride);
  let rp = 0;

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff; // Sub
      else if (filter === 2) v = (v + b) & 0xff; // Up
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff; // Average
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff; // Paeth
      row[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

async function compare(aPath, bPath, tol) {
  const [a, b] = [decodePNG(await readFile(aPath)), decodePNG(await readFile(bPath))];
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    console.error(
      `imagediff: size mismatch ${aPath} ${a.width}x${a.height}x${a.channels} vs ` +
        `${bPath} ${b.width}x${b.height}x${b.channels}`,
    );
    return false;
  }
  const n = a.data.length;
  let diffs = 0;
  let maxDelta = 0;
  let first = null;
  const ch = a.channels;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > tol) {
      diffs++;
      if (d > maxDelta) maxDelta = d;
      if (!first) {
        const p = Math.floor(i / ch);
        first = { x: p % a.width, y: Math.floor(p / a.width), delta: d };
      }
    }
  }
  if (diffs) {
    const total = a.width * a.height;
    console.error(
      `imagediff: ${diffs} pixel(s) differ (${(diffs / total * 100).toFixed(4)}%), ` +
        `max delta ${maxDelta}, first at (${first.x}, ${first.y}) — ${aPath} vs ${bPath}`,
    );
    return false;
  }
  console.log(`imagediff: OK — ${aPath} identical to ${bPath}`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const tolArg = args.find((a) => a.startsWith('--tol='));
  const tol = tolArg ? Number(tolArg.split('=')[1]) : 0;
  const dirAArg = args.find((a) => a.startsWith('--dirA='));
  const dirBArg = args.find((a) => a.startsWith('--dirB='));
  const files = args.filter((a) => !a.startsWith('--'));

  let ok;
  if (files.length === 2) {
    const a = resolve(files[0]);
    const b = resolve(files[1]);
    if (!existsSync(a) || !existsSync(b)) {
      console.error(`imagediff: missing file — ${!existsSync(a) ? a : b}`);
      process.exit(1);
    }
    ok = await compare(a, b, tol);
  } else {
    // directory mode: the UNION of both dirs — any shot present in exactly one
    // side fails the gate.
    const aPath = resolve(dirAArg ? dirAArg.split('=')[1] : 'shots');
    const bPath = resolve(dirBArg ? dirBArg.split('=')[1] : 'shots/baseline');
    const namesA = (await readdir(aPath)).filter((f) => f.endsWith('.png')).map((f) => basename(f));
    const namesB = (await readdir(bPath)).filter((f) => f.endsWith('.png')).map((f) => basename(f));
    const names = [...new Set([...namesA, ...namesB])].sort();
    if (!names.length) {
      console.error(`imagediff: no PNGs found in ${aPath} or ${bPath}`);
      process.exit(1);
    }
    let allOk = true;
    for (const name of names) {
      const pa = join(aPath, name);
      const pb = join(bPath, name);
      if (!existsSync(pa)) {
        console.error(`imagediff: missing in ${aPath}: ${name}`);
        allOk = false;
        continue;
      }
      if (!existsSync(pb)) {
        console.error(`imagediff: missing in ${bPath}: ${name}`);
        allOk = false;
        continue;
      }
      allOk = (await compare(pa, pb, tol)) && allOk;
    }
    ok = allOk;
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('imagediff failed:', err.message);
  process.exit(1);
});
