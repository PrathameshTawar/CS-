/**
 * tools-analyze-png.mjs — dependency-free PNG visual analysis for the
 * harsh-critic loop. Uses only Node built-ins (zlib) to decode PNGs.
 *
 * Reports, for the image at argv[2]:
 *   - size, bit depth, color type
 *   - luminance histogram (10 buckets) + mean/median/stdev
 *   - % crushed black (<16), % blown white (>239)
 *   - horizontal thirds (sky / mid / ground) mean luminance + dominant color
 *   - saturation & warmth per third
 *   - edge density (detail richness) via 1D gradient sampling
 *   - vertical luminance profile at 16 rows (spot banding / dead bands)
 *
 * Usage: node tools-analyze-png.mjs shot.png
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [,, file] = process.argv;
const buf = readFileSync(file);

// --- PNG chunk walker ---
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
let off = 8;
let w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0); h = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9];
  } else if (type === 'IDAT') {
    idat.push(data);
  }
  off += 12 + len;
}

const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
if (!channels) throw new Error(`unsupported colorType ${colorType}`);
const raw = inflateSync(Buffer.concat(idat));
const stride = w * channels;
const pix = Buffer.alloc(h * stride);

// --- unfilter ---
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < h; y++) {
  const f = raw[y * (stride + 1)];
  const row = y * stride, prev = (y - 1) * stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? pix[row + x - channels] : 0;
    const b = y > 0 ? pix[prev + x] : 0;
    const c = (x >= channels && y > 0) ? pix[prev + x - channels] : 0;
    let v = raw[y * (stride + 1) + 1 + x];
    if (f === 1) v += a;
    else if (f === 2) v += b;
    else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) v += paeth(a, b, c);
    pix[row + x] = v & 0xff;
  }
}

const lumAt = (x, y) => {
  const i = (y * w + x) * channels;
  return 0.299 * pix[i] + 0.587 * pix[i + 1] + 0.114 * pix[i + 2];
};
const rgbAt = (x, y) => {
  const i = (y * w + x) * channels;
  return [pix[i], pix[i + 1], pix[i + 2]];
};

// --- stats ---
const SW = Math.min(w, 320), SH = Math.min(h, 180); // sample grid
const hist = new Array(10).fill(0);
let sum = 0, sumSq = 0, n = 0, crushed = 0, blown = 0;
const maxLum = 255 * 3; // for normalization below
for (let gy = 0; gy < SH; gy += 2) for (let gx = 0; gx < SW; gx += 2) {
  const x = Math.floor(gx * w / SW), y = Math.floor(gy * h / SH);
  const L = lumAt(x, y);
  hist[Math.min(9, Math.floor(L / 25.6))]++;
  sum += L; sumSq += L * L; n++;
  if (L < 16) crushed++;
  if (L > 239) blown++;
}
const mean = sum / n;
const stdev = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

const third = (y0f, y1f) => {
  let r = 0, g = 0, b = 0, L = 0, m = 0;
  for (let gy = 0; gy < SH / 3; gy += 2) for (let gx = 0; gx < SW; gx += 2) {
    const x = Math.floor((gx + SW / 3 * 0.5) * w / SW);
    const y = Math.floor(((y0f + (y1f - y0f) * gy / (SH / 3)) + 0.5 / SH) * h);
    const [rr, gg, bb] = rgbAt(x, y);
    r += rr; g += gg; b += bb; L += 0.299 * rr + 0.587 * gg + 0.114 * bb; m++;
  }
  const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / m;
  const warmth = (r - b) / m;
  return {
    lum: Math.round(L / m),
    rgb: [Math.round(r / m), Math.round(g / m), Math.round(b / m)],
    sat: Math.round(sat),
    warmth: Math.round(warmth),
  };
};

// edge density per third: mean abs gradient on horizontal scan lines
const edges = (y0f, y1f) => {
  let acc = 0, m = 0;
  for (let gy = 0; gy < 6; gy++) {
    const y = Math.floor((y0f + (y1f - y0f) * (gy + 0.5) / 6) * h);
    let prev = lumAt(0, y);
    for (let x = 1; x < w; x += 8) {
      const L = lumAt(x, y);
      acc += Math.abs(L - prev); m++; prev = L;
    }
  }
  return Math.round(acc / m * 10) / 10;
};

// vertical profile: mean luminance at 16 evenly-spaced rows
const profile = [];
for (let i = 0; i < 16; i++) {
  const y = Math.floor((i + 0.5) / 16 * h);
  let s = 0;
  for (let x = 0; x < w; x += 6) s += lumAt(x, y);
  profile.push(Math.round(s / (w / 6)));
}

console.log(`== ${file} ==`);
console.log(`size ${w}x${h}  bitDepth ${bitDepth}  colorType ${colorType}  channels ${channels}`);
console.log(`lum  mean=${mean.toFixed(1)} stdev=${stdev.toFixed(1)}  crushed(<16)=${(100 * crushed / n).toFixed(1)}%  blown(>239)=${(100 * blown / n).toFixed(1)}%`);
console.log(`hist [0-25.5]:${hist[0]}  [25.5-51]:${hist[1]}  [51-76]:${hist[2]}  [76-102]:${hist[3]}  [102-128]:${hist[4]}  [128-153]:${hist[5]}  [153-179]:${hist[6]}  [179-204]:${hist[7]}  [204-230]:${hist[8]}  [230-255]:${hist[9]}`);
const sk = third(0, 1 / 3), md = third(1 / 3, 2 / 3), gr = third(2 / 3, 1);
console.log(`sky third   lum=${sk.lum} rgb=${sk.rgb.join(',')} sat=${sk.sat} warm=${sk.warmth} edges=${edges(0, 1 / 3)}`);
console.log(`mid third   lum=${md.lum} rgb=${md.rgb.join(',')} sat=${md.sat} warm=${md.warmth} edges=${edges(1 / 3, 2 / 3)}`);
console.log(`ground third lum=${gr.lum} rgb=${gr.rgb.join(',')} sat=${gr.sat} warm=${gr.warmth} edges=${edges(2 / 3, 1)}`);
console.log(`vert profile (16 rows, top->bottom): ${profile.join(' ')}`);
