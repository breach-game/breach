import type {
  ArchiveSource,
  Artifact,
  BinarySource,
  CaptureSource,
  CertSource,
  ImageSource,
  QrSource,
} from '@breach/pack-schema';
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
/** A member read back: text when its bytes are UTF-8, else the bytes as they are (a binary member). */
const member = (raw: string): string => {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return raw;
  }
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
  pcap: '\xd4\xc3\xb2\xa1\x02\x00\x04\x00',
  png: '\x89PNG\r\n\x1a\n',
  jpeg: '\xff\xd8\xff\xe1',
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
    content: typeof v === 'string' ? utf8(v) : '$binary' in v ? binary(v.$binary) : utf8(translate(v.$t)),
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
    entries.push({ path, content: member(s.slice(i, i + size)), mtime, mode });
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

/*
 * A capture: a pcap header, then for each packet what `strings` would find in a real one (names asked
 * to the DNS, the name in a TLS hello, plain HTTP), and the packets themselves as masked data that
 * `tshark` reads back. Encrypted payloads exist only as a size: there is nothing to decrypt.
 */
function capture(src: CaptureSource): string {
  const next = rng(seedOf(JSON.stringify(src.packets.slice(0, 4))));
  let visible = '';
  for (const p of src.packets) {
    const seen =
      p.proto === 'dns'
        ? p.query
        : p.proto === 'tls' || p.proto === 'quic'
          ? (p.sni ?? '')
          : p.proto === 'http'
            ? `${p.method ?? 'GET'} ${p.path} HTTP/1.1\nHost: ${p.host}${p.body ? `\n\n${p.body}` : ''}`
            : '';
    visible += filler(next, 12 + Math.floor(next() * 24)) + (seen ? `${utf8(seen)}\x00` : '');
  }
  const body = mask(utf8(JSON.stringify(src)));
  return `${MAGIC.pcap}${u32(0)}${u32(0)}${u32(262_144)}${u32(src.iface?.startsWith('wl') ? 105 : 1)}${visible}${filler(next, 8)}CAPX${u32(body.length)}${body}`;
}

/** The packets of a capture written by `capture`, or null when the file is not one. */
export function readCapture(raw: string): CaptureSource | null {
  if (!raw.startsWith(MAGIC.pcap)) return null;
  const at = raw.indexOf('CAPX');
  if (at < 0) return null;
  const size = readU32(raw, at + 4);
  try {
    const src = JSON.parse(fromUtf8(mask(raw.slice(at + 8, at + 8 + size)))) as CaptureSource;
    return Array.isArray(src.packets) ? src : null;
  } catch {
    return null;
  }
}

const u32be = (n: number) =>
  String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** A picture of a QR code: a PNG header, then the content as masked data (no pixels are drawn). */
function qrImage(src: QrSource): string {
  const side = src.style === 'fancy' ? 512 : 290;
  const depth = src.style === 'fancy' ? '\x08\x06' : '\x01\x00';
  const body = mask(utf8(JSON.stringify(src)));
  const next = rng(seedOf(src.text));
  return `${MAGIC.png}\x00\x00\x00\x0dIHDR${u32be(side)}${u32be(side)}${depth}\x00\x00\x00${filler(next, 4)}QRCX${u32(body.length)}${body}${filler(next, 16)}`;
}

/** What a QR picture written by `qrImage` holds, or null when the file is not one. */
export function readQr(raw: string): (QrSource & { side: number }) | null {
  if (!raw.startsWith(MAGIC.png)) return null;
  const at = raw.indexOf('QRCX');
  if (at < 0) return null;
  const size = readU32(raw, at + 4);
  try {
    const src = JSON.parse(fromUtf8(mask(raw.slice(at + 8, at + 8 + size)))) as QrSource;
    if (typeof src.text !== 'string') return null;
    const i = MAGIC.png.length + 8;
    const side =
      ((raw.charCodeAt(i) << 24) |
        (raw.charCodeAt(i + 1) << 16) |
        (raw.charCodeAt(i + 2) << 8) |
        raw.charCodeAt(i + 3)) >>>
      0;
    return { ...src, side };
  } catch {
    return null;
  }
}

/* ---------- photos ---------- */

/** Tags a camera writes as plain ASCII, so that `strings` finds them as it would in a real photo. */
const PLAIN_TAGS = ['Make', 'Camera Model Name', 'Model', 'Software'];

/**
 * A photo: the file's magic, the metadata as masked data (so `strings` does not spell the position),
 * the plain tags a real file shows, then filler standing for the pixels.
 */
export function imageBytes(src: ImageSource): string {
  const body = mask(utf8(JSON.stringify(src)));
  const next = rng(seedOf(`${src.width}x${src.height}${JSON.stringify(src.exif ?? {})}`));
  const plain = Object.entries(src.exif ?? {})
    .filter(([k]) => PLAIN_TAGS.includes(k))
    .map(([, v]) => `${utf8(v)}\x00`)
    .join('');
  const head =
    src.format === 'jpeg'
      ? `${MAGIC.jpeg}\x00\x10Exif\x00\x00II*\x00`
      : `${MAGIC.png}\x00\x00\x00\x0dIHDR${u32be(src.width)}${u32be(src.height)}\x08\x02\x00\x00\x00`;
  return `${head}IMGX${u32(body.length)}${body}${plain}${filler(next, 96)}`;
}

/** What a photo written by `imageBytes` holds, or null when the file is not one. */
export function readImage(raw: string): ImageSource | null {
  if (!raw.startsWith(MAGIC.jpeg) && !raw.startsWith(MAGIC.png)) return null;
  const at = raw.indexOf('IMGX');
  if (at < 0) return null;
  const size = readU32(raw, at + 4);
  try {
    const src = JSON.parse(fromUtf8(mask(raw.slice(at + 8, at + 8 + size)))) as ImageSource;
    return typeof src.width === 'number' ? src : null;
  } catch {
    return null;
  }
}

export function isArtifact(v: unknown): v is Artifact {
  return (
    !!v &&
    typeof v === 'object' &&
    ('$binary' in v || '$archive' in v || '$cert' in v || '$capture' in v || '$qr' in v || '$image' in v)
  );
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
  if ('$capture' in a) return capture(a.$capture);
  if ('$qr' in a) return qrImage(a.$qr);
  if ('$image' in a) return imageBytes(a.$image);
  return cert(a.$cert);
}

/** True when the content holds bytes a terminal would not show: a binary file. */
export const isBinary = (content: string): boolean =>
  /[\x00-\x08\x0e-\x1a\x1c-\x1f]/.test(content.slice(0, 512)) || /[\x80-\xff]{4}/.test(content.slice(0, 512));
