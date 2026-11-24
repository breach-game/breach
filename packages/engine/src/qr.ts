/**
 * A small QR code encoder (ISO/IEC 18004), so that `qr show` draws the code a pack describes: byte
 * mode, error correction level M, versions 1 to 10 (up to 213 bytes). It only ever encodes texts of
 * the pack, whose addresses are reserved names (`*.test`, `*.example`) that lead nowhere.
 */

const DATA_PER_BLOCK: [number, number, number, number][] = [
  // [blocks in group 1, data codewords each, blocks in group 2, data codewords each], level M
  [1, 16, 0, 0],
  [1, 28, 0, 0],
  [1, 44, 0, 0],
  [2, 32, 0, 0],
  [2, 43, 0, 0],
  [4, 27, 0, 0],
  [4, 31, 0, 0],
  [2, 38, 2, 39],
  [3, 36, 2, 37],
  [4, 43, 1, 44],
];
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const ALIGN: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const dataCapacity = (v: number) => {
  const [b1, d1, b2, d2] = DATA_PER_BLOCK[v - 1]!;
  return b1 * d1 + b2 * d2;
};

/* ---------- Reed-Solomon over GF(256), polynomial 0x11d ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] = next[j]! ^ g[j]!;
      next[j + 1] = next[j + 1]! ^ mul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g;
}

function remainder(data: number[], degree: number): number[] {
  const g = generator(degree);
  const r = new Array<number>(degree).fill(0);
  for (const d of data) {
    const factor = d ^ r.shift()!;
    r.push(0);
    for (let i = 0; i < degree; i++) r[i] = r[i]! ^ mul(g[i + 1]!, factor);
  }
  return r;
}

/* ---------- bits and codewords ---------- */

function codewords(bytes: Uint8Array, v: number): number[] {
  const capacity = dataCapacity(v);
  const bits: number[] = [];
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const [b1, d1, b2, d2] = DATA_PER_BLOCK[v - 1]!;
  const ec = EC_PER_BLOCK[v - 1]!;
  const blocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const size = i < b1 ? d1 : d2;
    blocks.push(data.slice(at, at + size));
    at += size;
  }
  const ecBlocks = blocks.map((b) => remainder(b, ec));
  const out: number[] = [];
  const longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]!);
  return out;
}

/* ---------- the matrix ---------- */

function bch(value: number, poly: number, bits: number): number {
  let v = value << bits;
  const top = 31 - Math.clz32(poly);
  while (31 - Math.clz32(v) >= top) v ^= poly << (31 - Math.clz32(v) - top);
  return (value << bits) | v;
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function build(v: number, words: number[], mask: number): boolean[][] {
  const n = 17 + 4 * v;
  const m: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixed: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    m[r]![c] = dark;
    fixed[r]![c] = true;
  };
  // Finder patterns and their separators.
  for (const [fr, fc] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const)
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(fr + r, fc + c, ring !== 2 && ring !== 4);
      }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns.
  const pos = ALIGN[v - 1]!;
  for (const r of pos)
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  // Format information: level M (00) and the mask.
  const format = bch(mask, 0x537, 10) ^ 0x5412;
  const fbit = (i: number) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(i, 8, fbit(i));
  set(7, 8, fbit(6));
  set(8, 8, fbit(7));
  set(8, 7, fbit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, fbit(i));
  for (let i = 0; i < 8; i++) set(8, n - 1 - i, fbit(i));
  for (let i = 8; i < 15; i++) set(n - 15 + i, 8, fbit(i));
  set(n - 8, 8, true);
  // Version information, from version 7.
  if (v >= 7) {
    const info = bch(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const dark = ((info >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  // Data, in two-column zigzags from the bottom right.
  let i = 0;
  const total = words.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? n - 1 - vert : vert;
        if (fixed[r]![c]) continue;
        let dark = false;
        if (i < total) dark = ((words[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
        m[r]![c] = dark !== MASKS[mask]!(r, c);
      }
  }
  return m;
}

/** The usual penalty, so that the chosen mask is the one a reader likes best. */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let b = 0; b + 10 < n; b++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(a, b + k) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
  };
  lines((r, c) => m[r]![c]!);
  lines((c, r) => m[r]![c]!);
  for (let r = 0; r + 1 < n; r++)
    for (let c = 0; c + 1 < n; c++) {
      const x = m[r]![c];
      if (x === m[r]![c + 1] && x === m[r + 1]![c] && x === m[r + 1]![c + 1]) score += 3;
    }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return score;
}

/** The modules of the QR code for a text (true = dark), or null when it is too long. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  const need = (ver: number) => 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
  while (v <= 10 && need(v) > dataCapacity(v) * 8) v++;
  if (v > 10) return null;
  const words = codewords(bytes, v);
  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(v, words, mask);
    const s = penalty(m);
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

/**
 * The code drawn with half blocks, two rows of modules per line, light on dark so that a phone can
 * read it off the screen: a light module is a lit half, a dark one is left black. A quiet zone of
 * two modules surrounds it.
 */
export function qrBlocks(m: boolean[][], quiet = 2): string[] {
  const n = m.length + quiet * 2;
  const light = (r: number, c: number) => {
    const rr = r - quiet;
    const cc = c - quiet;
    if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) return true;
    return !m[rr]![cc];
  };
  const out: string[] = [];
  for (let r = 0; r < n; r += 2) {
    let line = '';
    for (let c = 0; c < n; c++) {
      const top = light(r, c);
      const bottom = r + 1 < n ? light(r + 1, c) : false;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    out.push(line);
  }
  return out;
}
