// core/rng.js — xoshiro128** seeded PRNG.
//
// Hard rule: every gameplay/visual decision must come from ctx.rng or a fork of
// it, never Math.random(). Reproducible captures depend on this. Fork with a
// stable label so subsystem streams are independent and deterministic.

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

// SplitMix32 — expands a 32-bit seed into a full 128-bit xoshiro state.
function splitmix32(a) {
  return function () {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed = 0x5eed1234) {
  const sm = splitmix32(seed >>> 0);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();

  const nextUint32 = () => {
    const t = (b << 9) >>> 0;
    let r = rotl(Math.imul(b, 5), 7);
    r = Math.imul(r, 9) >>> 0;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= t;
    c ^= t;
    return r;
  };

  const nextFloat = () => nextUint32() * 2.3283064365386963e-10; // [0, 1)

  return {
    seed,
    nextUint32,
    nextFloat,
    range(min, max) {
      return min + nextFloat() * (max - min);
    },
    int(min, max) {
      return min + Math.floor(nextFloat() * (max - min + 1));
    },
    chance(p) {
      return nextFloat() < p;
    },
    sign() {
      return nextFloat() < 0.5 ? -1 : 1;
    },
    pick(arr) {
      return arr[Math.min(arr.length - 1, Math.floor(nextFloat() * arr.length))];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(nextFloat() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
    // Independent, deterministic stream for a subsystem. Pass a stable label.
    fork(label = 0) {
      return createRng((nextUint32() ^ (label >>> 0)) >>> 0);
    },
  };
}

// Deterministic hash of integer lattice coords -> [0, 1). Used by the texture
// forge so generated surfaces are stable regardless of resolution.
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
