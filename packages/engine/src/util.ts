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
