import type { ArchiveSource, Artifact, BinarySource, CertSource } from '@breach/pack-schema';
import { rng } from './util.ts';

/**
 * Files that are not plain text. A pack describes them as data (`Artifact`); the engine writes their
 * bytes here, one character per byte (code points 0 to 255), so the rest of the virtual file system
 * keeps handling strings. Nothing here is a real format: the layouts only look like one to `strings`,
 * `file`, `unzip`, `tar` and `openssl`, which read them back.
 */

const bytesToString = (bytes: ArrayLike<number>): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]! & 0xff);
  return s;
};
const utf8 = (text: string) => bytesToString(new TextEncoder().encode(text));
const fromUtf8 = (raw: string): string => {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return new TextDecoder().decode(bytes);
};
const u16 = (n: number) => String.fromCharCode(n & 0xff, (n >> 8) & 0xff);
const u32 = (n: number) => u16(n & 0xffff) + u16((n >>> 16) & 0xffff);
const readU16 = (s: string, i: number) => s.charCodeAt(i) | (s.charCodeAt(i + 1) << 8);
const readU32 = (s: string, i: number) => (readU16(s, i) | (readU16(s, i + 2) << 16)) >>> 0;

/** Bytes that are never printable, so `strings` finds only what the pack listed. */
function filler(next: () => number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    const r = Math.floor(next() * 128);
    s += String.fromCharCode(r < 9 ? r : r < 27 ? r + 5 : 0x80 + r);
  }
  return s;
}

const seedOf = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const MAGIC = {
  elf: '\x7fELF\x02\x01\x01\x00',
  pe: 'MZ\x90\x00\x03\x00\x00\x00',
  macho: '\xcf\xfa\xed\xfe\x07\x00\x00\x01',
  firmware: '\x27\x05\x19\x56\x00\x00\x00\x00',
  data: '\x00\x00\x00\x00',
  zip: 'PK\x03\x04',
  zipEnd: 'PK\x05\x06',
  tar: 'ustar\x00',
  gzip: '\x1f\x8b\x08\x00',
} as const;

function binary(src: BinarySource): string {
  const next = rng(seedOf(src.strings.join('\n')));
  let s = MAGIC[src.format] + filler(next, 56);
  for (const text of src.strings) s += filler(next, 6 + Math.floor(next() * 20)) + utf8(text) + '\x00';
  return s + filler(next, 32);
}

export interface ArchiveEntry {
  path: string;
  content: string;
  mtime: number;
  mode: number;
}

/** Stored zip entries or tar members, in a layout of our own; `tgz` hides the tar behind a mask. */
function archive(src: ArchiveSource, translate: (key: string) => string, mtime: number): string {
  const files = Object.entries(src.files).map(([path, v]) => ({
    path,
    content: utf8(typeof v === 'string' ? v : translate(v.$t)),
  }));
  if (src.format === 'zip') {
    let s = '';
    for (const f of files) {
      const name = utf8(f.path);
      s += MAGIC.zip + u16(name.length) + u32(f.content.length) + u32(mtime) + u16(0o644) + name + f.content;
    }
    return s + MAGIC.zipEnd + u16(files.length);
  }
  let tar = '';
  for (const f of files) {
    const name = utf8(f.path);
    tar += MAGIC.tar + u16(name.length) + u32(f.content.length) + u32(mtime) + u16(0o644) + name + f.content;
  }
  tar += '\x00'.repeat(12);
  return src.format === 'tar' ? tar : MAGIC.gzip + mask(tar);
}

/** A reversible mask standing for compression: the members of a `.tar.gz` are not readable by `strings`. */
const mask = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ (0xa5 ^ ((i * 7) & 0x5a)));
  return out;
};

/** Read back the members of a zip, tar or tar.gz written by `archive`; null when it is not one. */
export function readArchive(raw: string): { format: 'zip' | 'tar' | 'tgz'; entries: ArchiveEntry[] } | null {
  let format: 'zip' | 'tar' | 'tgz';
  let s = raw;
  if (raw.startsWith(MAGIC.zip)) format = 'zip';
  else if (raw.startsWith(MAGIC.gzip)) {
    format = 'tgz';
    s = mask(raw.slice(MAGIC.gzip.length));
    if (!s.startsWith(MAGIC.tar)) return null;
  } else if (raw.startsWith(MAGIC.tar)) format = 'tar';
  else return null;
  const head = format === 'zip' ? MAGIC.zip : MAGIC.tar;
  const entries: ArchiveEntry[] = [];
  let i = 0;
  while (s.startsWith(head, i)) {
    i += head.length;
    const nameLen = readU16(s, i);
    const size = readU32(s, i + 2);
    const mtime = readU32(s, i + 6);
    const mode = readU16(s, i + 10);
    i += 12;
    const path = fromUtf8(s.slice(i, i + nameLen));
    i += nameLen;
    entries.push({ path, content: fromUtf8(s.slice(i, i + size)), mtime, mode });
    i += size;
    if (entries.length > 200) break;
  }
  return entries.length ? { format, entries } : null;
}

/** The decoded body of a certificate written by `cert`, or null. */
export function readCert(pem: string): (CertSource & { der: string }) | null {
  const m = /-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/.exec(pem);
  if (!m) return null;
  try {
    const der = atob(m[1]!.replace(/\s+/g, ''));
    if (!der.startsWith('\x30\x82')) return null;
    const body = JSON.parse(fromUtf8(der.slice(4))) as CertSource;
    if (typeof body.subject !== 'string' || typeof body.issuer !== 'string') return null;
    return { ...body, der };
  } catch {
    return null;
  }
}

/**
 * A certificate in PEM form. Its body starts like DER (`0x30 0x82`, so the base64 starts with `MII`)
 * and carries the fields as data: `openssl x509` reads them back, nothing is ever signed.
 */
function cert(src: CertSource): string {
  const body = utf8(JSON.stringify(src));
  const der = `\x30\x82${String.fromCharCode((body.length >> 8) & 0xff, body.length & 0xff)}${body}`;
  const b64 = btoa(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function isArtifact(v: unknown): v is Artifact {
  return !!v && typeof v === 'object' && ('$binary' in v || '$archive' in v || '$cert' in v);
}

/** The bytes of an artifact, as a string of code points 0 to 255 (a certificate is plain text). */
export function buildArtifact(a: Artifact, translate: (key: string) => string, startTime?: string): string {
  if ('$binary' in a) return binary(a.$binary);
  if ('$archive' in a) {
    const t = startTime ? Date.parse(startTime) : Number.NaN;
    return archive(
      a.$archive,
      translate,
      Number.isNaN(t) ? 1_800_000_000 : Math.floor(t / 1000) - 86_400 * 3,
    );
  }
  return cert(a.$cert);
}

/** True when the content holds bytes a terminal would not show: a binary file. */
export const isBinary = (content: string): boolean =>
  /[\x00-\x08\x0e-\x1a\x1c-\x1f]/.test(content.slice(0, 512)) || /[\x80-\xff]{4}/.test(content.slice(0, 512));
