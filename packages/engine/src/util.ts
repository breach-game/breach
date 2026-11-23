export const ESC = '\x1b[';
export const style = {
  dim: (s: string) => `${ESC}2m${s}${ESC}0m`,
  bold: (s: string) => `${ESC}1m${s}${ESC}0m`,
  red: (s: string) => `${ESC}31m${s}${ESC}0m`,
  green: (s: string) => `${ESC}32m${s}${ESC}0m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}0m`,
  blue: (s: string) => `${ESC}34m${s}${ESC}0m`,
  magenta: (s: string) => `${ESC}35m${s}${ESC}0m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}0m`,
};
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const SGR = /\x1b\[[0-9;]*m/y;

/**
 * Make text safe to write to a terminal. Only colour codes (SGR) survive: every other escape
 * sequence (cursor moves, screen clears, OSC 8 links, window titles) and every other control
 * character, C1 included, is dropped. Tabs and line breaks are kept.
 */
export function sanitizeTerminal(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x1b) {
      SGR.lastIndex = i;
      const m = SGR.exec(text);
      if (m) {
        out += m[0];
        i += m[0].length - 1;
      }
      continue;
    }
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)) continue;
    out += text[i];
  }
  return out;
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Small deterministic generator, so replays produce the same output. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export interface GameDate {
  iso: string; // 2026-11-23 09:14
  time: string; // 09:14:02
  unix: string; // Mon Nov 23 09:14:02 CET 2026
  ls: string; // Nov 23 09:14
}

export function gameDate(startTime: string, clock: number): GameDate {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(startTime);
  const offset = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const d = new Date(Date.parse(startTime) + clock + offset * 60_000);
  const tz = offset === 60 ? 'CET' : offset === 120 ? 'CEST' : 'UTC';
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return {
    iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${hms.slice(0, 5)} ${tz}`,
    time: hms,
    unix: `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${hms} ${tz} ${d.getUTCFullYear()}`,
    ls: `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${hms.slice(0, 5)}`,
  };
}

/**
 * A copy of a list in an order drawn from a seed: the same seed always gives the same order.
 * Deterministic on purpose (no Math.random), so that a replayed log shows what the player saw.
 */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  // FNV-1a over the seed, then a small xorshift generator.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  if (!h) h = 1;
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 0x100000000;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
