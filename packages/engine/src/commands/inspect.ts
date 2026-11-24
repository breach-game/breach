import type { Advisory } from '@breach/pack-schema';
import { isBinary, MAGIC, readArchive, readCert, readImage, readQr } from '../artifact.ts';
import { canWrite, lookup } from '../vfs.ts';
import { inputs, readFile } from './files.ts';
import { type Command, type CommandCtx, err, getopt, out, type Run } from './types.ts';

/*
 * Tools of a forensic analyst: what is this file, what does it hide, what does it hold. They only
 * read the virtual file system; extraction writes through `FileWritten` like any other command.
 */

/** Digest of bytes held as code points 0 to 255 (`artifact.ts`), or of text as UTF-8. */
async function digest(algo: 'SHA-256' | 'SHA-1' | 'SHA-512', content: string): Promise<string> {
  const bytes = /[^\x00-\xff]/.test(content)
    ? new TextEncoder().encode(content)
    : Uint8Array.from(content, (c) => c.charCodeAt(0));
  const d = await globalThis.crypto.subtle.digest(algo, bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- strings ---------- */

const strings: Command = {
  name: 'strings',
  summary: 'cmd.strings',
  explain: 'explain.strings',
  group: 'files',
  async *run(ctx): Run {
    const { values, rest } = getopt(ctx.args, ['n']);
    const min = Math.max(1, Math.min(64, Number(values.n ?? 4) || 4));
    const sources = yield* inputs(ctx, rest);
    const re = new RegExp(`[\\x20-\\x7e\\t]{${min},}`, 'g');
    for (const { text } of sources) {
      const found = text.match(re) ?? [];
      if (found.length) yield out(found.join('\n'));
    }
    return sources.length ? 0 : 1;
  },
};

/* ---------- file ---------- */

/** What `file` would say about some content. */
export function describe(content: string): string {
  if (!content.length) return 'empty';
  if (content.startsWith(MAGIC.elf))
    return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, stripped';
  if (content.startsWith(MAGIC.pe)) return 'PE32+ executable (console) x86-64, for MS Windows';
  if (content.startsWith(MAGIC.macho)) return 'Mach-O 64-bit arm64 executable';
  if (content.startsWith(MAGIC.firmware))
    return 'u-boot legacy uImage, Linux/ARM, OS Kernel Image (Not compressed)';
  if (content.startsWith(MAGIC.zip))
    return 'Zip archive data, at least v1.0 to extract, compression method=store';
  if (content.startsWith(MAGIC.gzip))
    return 'gzip compressed data, from Unix, original size modulo 2^32 10240';
  if (content.startsWith(MAGIC.tar)) return 'POSIX tar archive';
  if (content.startsWith(MAGIC.pcap))
    return content.charCodeAt(20) === 105
      ? 'pcap capture file, microsecond ts (little-endian) - version 2.4 (802.11, capture length 262144)'
      : 'pcap capture file, microsecond ts (little-endian) - version 2.4 (Ethernet, capture length 262144)';
  if (content.startsWith(MAGIC.jpeg)) {
    const img = readImage(content);
    const exif =
      img?.exif && Object.keys(img.exif).length ? ', Exif Standard: [TIFF image data, little-endian]' : '';
    return `JPEG image data${exif}, baseline, precision 8, ${img?.width ?? 640}x${img?.height ?? 480}, components 3`;
  }
  if (content.startsWith(MAGIC.png)) {
    const img = readImage(content);
    if (img) return `PNG image data, ${img.width} x ${img.height}, 8-bit/color RGB, non-interlaced`;
    const qr = readQr(content);
    const side = qr?.side ?? 290;
    return qr?.style === 'fancy'
      ? `PNG image data, ${side} x ${side}, 8-bit/color RGBA, non-interlaced`
      : `PNG image data, ${side} x ${side}, 1-bit grayscale, non-interlaced`;
  }
  if (isBinary(content)) return 'data';
  const head = content.slice(0, 400);
  if (head.startsWith('-----BEGIN CERTIFICATE-----')) return 'PEM certificate';
  if (head.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) return 'OpenSSH private key';
  if (/^-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(head)) return 'PEM RSA private key';
  if (/^ssh-(rsa|ed25519) /.test(head)) return 'OpenSSH ED25519 public key';
  const ascii = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(content);
  const charset = ascii ? 'ASCII text' : 'Unicode text, UTF-8 text';
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(head);
  if (shebang) {
    const prog = (shebang[1]!.endsWith('/env') ? shebang[2] : shebang[1]!.split('/').pop()) ?? '';
    if (prog === 'bash') return `Bourne-Again shell script, ${charset} executable`;
    if (prog.startsWith('python')) return `Python script, ${charset} executable`;
    if (prog === 'node') return `Node.js script, ${charset} executable`;
    return `POSIX shell script, ${charset} executable`;
  }
  if (/^(Return-Path:|Received:|Delivered-To:|From [^\s]+ )/m.test(head.split('\n')[0] ?? ''))
    return `SMTP mail, ${charset}`;
  if (/^\s*<(!doctype html|html)/i.test(head)) return `HTML document, ${charset}`;
  if (/^\s*[{[]/.test(head)) {
    try {
      JSON.parse(content);
      return 'JSON text data';
    } catch {
      /* not JSON after all */
    }
  }
  if (head.startsWith('%PDF-')) return 'PDF document, version 1.7';
  return charset;
}

const file: Command = {
  name: 'file',
  summary: 'cmd.file',
  explain: 'explain.file',
  group: 'files',
  async *run(ctx): Run {
    const { rest } = getopt(ctx.args);
    if (!rest.length) {
      yield err('Usage: file [-bchikLlNnprsSvzZ0] [file ...]');
      return 1;
    }
    let status = 0;
    for (const arg of rest) {
      const node = lookup(ctx.state.fs, ctx.path(arg));
      if (!node) {
        yield out(`${arg}: cannot open \`${arg}' (No such file or directory)`);
        status = 1;
      } else if (node.t === 'd') yield out(`${arg}: directory`);
      else {
        const text = yield* readFile(ctx, arg);
        if (text !== null) yield out(`${arg}: ${describe(text)}`);
      }
    }
    return status;
  },
};

/* ---------- archives ---------- */

const pad = (s: string | number, n: number) => String(s).padStart(n);
const when = (epoch: number) => {
  const d = new Date(epoch * 1000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};

/** Write an extracted member, refusing paths that leave the destination (`../`, absolute). */
function* extract(ctx: CommandCtx, dest: string, path: string, content: string, tool: string) {
  if (path.startsWith('/') || path.split('/').includes('..')) {
    yield err(`${tool}: skipping: ${path}  (path would leave the destination)`);
    return false;
  }
  const abs = ctx.path(`${dest}/${path}`);
  const existing = lookup(ctx.state.fs, abs);
  if (existing?.t === 'd') return false;
  if (existing && !canWrite(existing, ctx.game.currentUser)) {
    yield err(`${tool}: ${path}: Permission denied`);
    return false;
  }
  const parent = lookup(ctx.state.fs, ctx.path(dest));
  if (parent && parent.t === 'd' && !canWrite(parent, ctx.game.currentUser) && !existing) {
    yield err(`${tool}: ${path}: Permission denied`);
    return false;
  }
  ctx.emit({ type: 'FileWritten', host: ctx.state.host, path: abs, content, append: false, dirs: true });
  return true;
}

const unzip: Command = {
  name: 'unzip',
  summary: 'cmd.unzip',
  explain: 'explain.unzip',
  group: 'files',
  async *run(ctx): Run {
    const { flags, values, rest } = getopt(ctx.args, ['d']);
    const [name, ...members] = rest;
    if (!name) {
      yield out('UnZip 6.00 of 20 April 2009. Usage: unzip [-lpo] file[.zip] [list] [-d exdir]');
      return 0;
    }
    const raw = yield* readFile(ctx, name);
    if (raw === null) return 9;
    const zip = readArchive(raw);
    if (!zip || zip.format !== 'zip') {
      yield err(
        `Archive:  ${name}\n  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.`,
      );
      return 9;
    }
    const chosen = members.length ? zip.entries.filter((e) => members.includes(e.path)) : zip.entries;
    for (const m of members)
      if (!zip.entries.some((e) => e.path === m)) yield err(`caution: filename not matched:  ${m}`);
    if (flags.has('p')) {
      for (const e of chosen) yield { k: 'out', text: e.content };
      return 0;
    }
    if (flags.has('l')) {
      let total = 0;
      const lines = [
        `Archive:  ${name}`,
        '  Length      Date    Time    Name',
        '---------  ---------- -----   ----',
      ];
      for (const e of chosen) {
        const { date, time } = when(e.mtime);
        const size = new TextEncoder().encode(e.content).length;
        total += size;
        lines.push(`${pad(size, 9)}  ${date} ${time}   ${e.path}`);
      }
      lines.push('---------                     -------');
      lines.push(
        `${pad(total, 9)}                     ${chosen.length} file${chosen.length === 1 ? '' : 's'}`,
      );
      yield out(lines.join('\n'));
      return 0;
    }
    const dest = values.d ?? '.';
    yield out(`Archive:  ${name}`);
    for (const e of chosen)
      if (yield* extract(ctx, dest, e.path, e.content, 'unzip'))
        yield out(` extracting: ${dest === '.' ? '' : `${dest.replace(/\/$/, '')}/`}${e.path}`);
    return 0;
  },
};

const tar: Command = {
  name: 'tar',
  summary: 'cmd.tar',
  explain: 'explain.tar',
  group: 'files',
  async *run(ctx): Run {
    // `tar xzf a.tgz` and `tar -xzf a.tgz` are the same.
    const args = [...ctx.args];
    if (args[0] && /^[ctxvzfC]+$/.test(args[0])) args[0] = `-${args[0]}`;
    const { flags, values, rest } = getopt(args, ['f', 'C']);
    const name = values.f;
    if (!name || !(flags.has('t') || flags.has('x'))) {
      yield err(
        "tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' for more information.",
      );
      return 2;
    }
    const raw = yield* readFile(ctx, name);
    if (raw === null) return 2;
    const archive = readArchive(raw);
    if (!archive || archive.format === 'zip') {
      yield err(
        'tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors',
      );
      return 2;
    }
    const chosen = rest.length ? archive.entries.filter((e) => rest.includes(e.path)) : archive.entries;
    const verbose = flags.has('v');
    const listing = (e: (typeof chosen)[number]) => {
      if (!verbose) return e.path;
      const { date, time } = when(e.mtime);
      const size = new TextEncoder().encode(e.content).length;
      return `-rw-r--r-- root/root ${pad(size, 9)} ${date} ${time} ${e.path}`;
    };
    if (flags.has('t')) {
      yield out(chosen.map(listing).join('\n'));
      return 0;
    }
    const dest = values.C ?? '.';
    for (const e of chosen) {
      const written = yield* extract(ctx, dest, e.path, e.content, 'tar');
      if (written && verbose) yield out(e.path);
    }
    return 0;
  },
};

/* ---------- openssl ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const opensslDate = (iso: string) => {
  const d = new Date(iso);
  const hms = d.toISOString().slice(11, 19);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${hms} ${d.getUTCFullYear()} GMT`;
};
const dn = (s: string) =>
  s
    .split(/\s*,\s*/)
    .map((p) => p.replace(/\s*=\s*/, ' = '))
    .join(', ');
const hexColons = (hex: string) => hex.toUpperCase().match(/../g)!.join(':');

async function* x509(ctx: CommandCtx, args: string[]): Run {
  const opts = new Set<string>();
  let input: string | undefined;
  let digestName: 'sha1' | 'sha256' = 'sha1';
  let ext: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-in') input = args[++i];
    else if (a === '-ext') ext = args[++i];
    else if (a === '-sha256' || a === '-sha1') digestName = a.slice(1) as 'sha1' | 'sha256';
    else if (a.startsWith('-')) opts.add(a.slice(1));
  }
  let pem: string | null;
  if (input) pem = yield* readFile(ctx, input);
  else pem = ctx.stdin;
  if (pem === null) return 1;
  const cert = readCert(pem);
  if (!cert) {
    yield err('Could not find certificate from <stdin>\nUnable to load certificate');
    return 1;
  }
  const lines: string[] = [];
  const sigalg = cert.sigalg ?? 'sha256WithRSAEncryption';
  const key = cert.key ?? 'rsaEncryption 2048';
  if (opts.has('text')) {
    const [alg, bits] = key.split(/\s+/);
    lines.push(
      'Certificate:',
      '    Data:',
      '        Version: 3 (0x2)',
      '        Serial Number:',
      `            ${cert.serial.toLowerCase()}`,
      `        Signature Algorithm: ${sigalg}`,
      `        Issuer: ${dn(cert.issuer)}`,
      '        Validity',
      `            Not Before: ${opensslDate(cert.notBefore)}`,
      `            Not After : ${opensslDate(cert.notAfter)}`,
      `        Subject: ${dn(cert.subject)}`,
      '        Subject Public Key Info:',
      `            Public Key Algorithm: ${alg}`,
      ...(bits ? [`                Public-Key: (${bits} bit)`] : []),
    );
    if (cert.san?.length)
      lines.push(
        '        X509v3 extensions:',
        '            X509v3 Subject Alternative Name: ',
        `                ${cert.san.map((n) => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? `IP Address:${n}` : `DNS:${n}`)).join(', ')}`,
      );
    lines.push(`    Signature Algorithm: ${sigalg}`);
  }
  if (opts.has('subject')) lines.push(`subject=${dn(cert.subject)}`);
  if (opts.has('issuer')) lines.push(`issuer=${dn(cert.issuer)}`);
  if (opts.has('serial')) lines.push(`serial=${cert.serial.replace(/:/g, '')}`);
  if (opts.has('dates') || opts.has('startdate')) lines.push(`notBefore=${opensslDate(cert.notBefore)}`);
  if (opts.has('dates') || opts.has('enddate')) lines.push(`notAfter=${opensslDate(cert.notAfter)}`);
  if (ext === 'subjectAltName')
    lines.push(
      'X509v3 Subject Alternative Name: ',
      `    ${(cert.san ?? []).map((n) => `DNS:${n}`).join(', ')}`,
    );
  if (opts.has('fingerprint')) {
    const algo = digestName === 'sha256' ? 'SHA-256' : 'SHA-1';
    lines.push(`${digestName} Fingerprint=${hexColons(await digest(algo, cert.der))}`);
  }
  if (!opts.has('noout')) lines.push(pem.trim());
  if (lines.length) yield out(lines.join('\n'));
  return 0;
}

const DGST: Record<string, { algo: 'SHA-256' | 'SHA-1' | 'SHA-512'; label: string }> = {
  sha256: { algo: 'SHA-256', label: 'SHA2-256' },
  sha1: { algo: 'SHA-1', label: 'SHA1' },
  sha512: { algo: 'SHA-512', label: 'SHA2-512' },
};

const openssl: Command = {
  name: 'openssl',
  summary: 'cmd.openssl',
  explain: 'explain.openssl',
  group: 'files',
  async *run(ctx): Run {
    const [sub, ...args] = ctx.args;
    if (sub === 'x509') return yield* x509(ctx, args);
    if (sub === 'dgst' || sub === 'sha256' || sub === 'sha1') {
      let algoName = sub === 'dgst' ? 'sha256' : sub;
      const files: string[] = [];
      for (const a of args) {
        if (a.startsWith('-')) algoName = a.slice(1);
        else files.push(a);
      }
      const algo = DGST[algoName];
      if (!algo) {
        yield err(`dgst: Unknown option or message digest: ${algoName}\ndgst: Use -help for summary.`);
        return 1;
      }
      const sources = yield* inputs(ctx, files);
      for (const { name, text } of sources)
        yield out(
          `${algo.label}(${name === '(standard input)' ? 'stdin' : name})= ${await digest(algo.algo, text)}`,
        );
      return sources.length ? 0 : 1;
    }
    yield err(
      sub
        ? `Invalid command '${sub}'; type "help" for a list.`
        : 'usage: openssl x509 -in <cert.pem> -noout -text | openssl dgst -sha256 <file>',
    );
    return 1;
  },
};

/* ---------- hashid ---------- */

const HASH_SHAPES: [RegExp, string[]][] = [
  [/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/, ['bcrypt', 'Blowfish(OpenBSD)']],
  [/^\$argon2(id|i|d)\$/, ['Argon2']],
  [/^\$6\$/, ['SHA-512 Crypt']],
  [/^\$5\$/, ['SHA-256 Crypt']],
  [/^\$1\$/, ['MD5 Crypt', 'Cisco-IOS(MD5)', 'FreeBSD MD5']],
  [/^\$P\$|^\$H\$/, ['Wordpress ≥ v2.6.2', 'Joomla ≥ v2.5.18', "PHPass' Portable Hash"]],
  [/^\$y\$/, ['yescrypt']],
  [/^pbkdf2_sha256\$/, ['Django(PBKDF2-HMAC-SHA256)']],
  [/^\{SSHA\}/, ['SSHA-1(Base64)', 'Netscape LDAP SSHA']],
  [
    /^[a-f0-9]{128}$/i,
    ['SHA-512', 'Whirlpool', 'Salsa10', 'Salsa20', 'SHA3-512', 'Skein-512', 'Skein-1024(512)'],
  ],
  [/^[a-f0-9]{96}$/i, ['SHA-384', 'SHA3-384', 'Skein-512(384)', 'Skein-1024(384)']],
  [
    /^[a-f0-9]{64}$/i,
    [
      'Snefru-256',
      'SHA-256',
      'RIPEMD-256',
      'Haval-256',
      'GOST R 34.11-94',
      'GOST CryptoPro S-Box',
      'SHA3-256',
      'Skein-256',
      'Skein-512(256)',
    ],
  ],
  [/^[a-f0-9]{56}$/i, ['SHA-224', 'Haval-224', 'SHA3-224', 'Skein-256(224)', 'Skein-512(224)']],
  [
    /^[a-f0-9]{40}$/i,
    [
      'SHA-1',
      'Double SHA-1',
      'RIPEMD-160',
      'Haval-160',
      'Tiger-160',
      'HAS-160',
      'LinkedIn',
      'Skein-256(160)',
      'Skein-512(160)',
    ],
  ],
  [
    /^[a-f0-9]{32}$/i,
    [
      'MD2',
      'MD5',
      'MD4',
      'Double MD5',
      'LM',
      'RIPEMD-128',
      'Haval-128',
      'Tiger-128',
      'Skein-256(128)',
      'Skein-512(128)',
      'Lotus Notes/Domino 5',
      'Skype',
      'Snefru-128',
      'NTLM',
      'Domain Cached Credentials',
      'Domain Cached Credentials 2',
      'DNSSEC(NSEC3)',
      'RAdmin v2.x',
    ],
  ],
  [/^[a-f0-9]{16}$/i, ['MySQL323', 'DES(Oracle)', 'Half MD5', 'Oracle 7-10g', 'FNV-164', 'CRC-64']],
  [/^[a-f0-9]{8}$/i, ['CRC-32', 'CRC-32B', 'FCS-32', 'ELF-32', 'Fletcher-32', 'FNV-32', 'Adler-32']],
];

/** Candidate algorithms for a hash, from its shape alone, as hashid lists them. */
export function identifyHash(hash: string): string[] {
  for (const [re, names] of HASH_SHAPES) if (re.test(hash)) return names;
  return [];
}

const hashid: Command = {
  name: 'hashid',
  summary: 'cmd.hashid',
  explain: 'explain.hashid',
  group: 'files',
  async *run(ctx): Run {
    const { rest } = getopt(ctx.args);
    const hashes = rest.length
      ? rest
      : (ctx.stdin ?? '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
    if (!hashes.length) {
      yield err('usage: hashid [-h] [-e] [-m] [-j] [-o FILE] [--version] INPUT');
      return 2;
    }
    for (const h of hashes.slice(0, 20)) {
      const names = identifyHash(h);
      yield out(
        `Analyzing '${h}'\n${names.length ? names.map((n) => `[+] ${n}`).join('\n') : '[+] Unknown hash'}`,
      );
    }
    return 0;
  },
};

/* ---------- sbom ---------- */

export interface Component {
  name: string;
  version: string;
  type: string;
}

/** Components listed by a manifest or lock file, by its name and content. Unknown formats give none. */
export function components(name: string, text: string): Component[] {
  const base = name.split('/').pop() ?? name;
  const found: Component[] = [];
  if (base === 'requirements.txt' || base.endsWith('.requirements.txt')) {
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z0-9_.-]+)\s*==\s*([A-Za-z0-9_.+-]+)/.exec(line);
      if (m) found.push({ name: m[1]!.toLowerCase(), version: m[2]!, type: 'python' });
    }
    return found;
  }
  if (base === 'go.mod') {
    for (const line of text.split('\n')) {
      const m = /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/\S+)\s+(v[\w.+-]+)/.exec(line);
      if (m) found.push({ name: m[1]!, version: m[2]!, type: 'go-module' });
    }
    return found;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return found;
  }
  if (!data || typeof data !== 'object') return found;
  const obj = data as Record<string, unknown>;
  if (obj.bomFormat === 'CycloneDX' && Array.isArray(obj.components)) {
    for (const c of obj.components as Record<string, unknown>[])
      if (typeof c.name === 'string' && typeof c.version === 'string')
        found.push({
          name: c.name,
          version: c.version,
          type: typeof c.type === 'string' ? c.type : 'library',
        });
    return found;
  }
  if (obj.packages && typeof obj.packages === 'object') {
    for (const [path, p] of Object.entries(obj.packages as Record<string, { version?: string }>)) {
      const i = path.lastIndexOf('node_modules/');
      if (i < 0 || typeof p?.version !== 'string') continue;
      found.push({ name: path.slice(i + 'node_modules/'.length), version: p.version, type: 'npm' });
    }
    return found;
  }
  if (obj.dependencies && typeof obj.dependencies === 'object') {
    const lock = base === 'package-lock.json';
    for (const [n, v] of Object.entries(obj.dependencies as Record<string, unknown>)) {
      const version = typeof v === 'string' ? v : (v as { version?: string })?.version;
      if (typeof version === 'string')
        found.push({ name: n, version: lock ? version : version.replace(/^[~^]/, ''), type: 'npm' });
    }
  }
  return found;
}

const MANIFESTS =
  /(^|\/)(package-lock\.json|package\.json|requirements\.txt|go\.mod|bom\.json|[\w.-]+\.cdx\.json)$/;

const sbom: Command = {
  name: 'sbom',
  summary: 'cmd.sbom',
  explain: 'explain.sbom',
  group: 'files',
  async *run(ctx): Run {
    const { flags, rest } = getopt(ctx.args);
    const target = rest[0];
    if (!target) {
      yield err('usage: sbom <directory | lock file> [--vuln]');
      return 2;
    }
    const node = lookup(ctx.state.fs, ctx.path(target));
    if (!node) {
      yield err(`sbom: ${target}: No such file or directory`);
      return 1;
    }
    const files: string[] = [];
    if (node.t === 'f') files.push(target);
    else {
      const walk = (dir: typeof node, prefix: string) => {
        if (dir.t !== 'd') return;
        for (const [n, child] of Object.entries(dir.c).sort(([a], [b]) => a.localeCompare(b))) {
          if (n === 'node_modules' || n === '.git') continue;
          const p = `${prefix}/${n}`;
          if (child.t === 'd') walk(child, p);
          else if (MANIFESTS.test(p)) files.push(p);
        }
      };
      walk(node, target.replace(/\/$/, ''));
      // A lock file says more than its manifest: skip `package.json` when its lock is there.
      for (const f of [...files])
        if (f.endsWith('/package.json') && files.includes(f.replace(/package\.json$/, 'package-lock.json')))
          files.splice(files.indexOf(f), 1);
    }
    const all: Component[] = [];
    for (const f of files) {
      const text = yield* readFile(ctx, f);
      if (text !== null) all.push(...components(f, text));
    }
    const seen = new Set<string>();
    const list = all
      .filter(
        (c) => !seen.has(`${c.type}:${c.name}@${c.version}`) && seen.add(`${c.type}:${c.name}@${c.version}`),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
    if (!list.length) {
      yield err(`sbom: no package manifest found in ${target}`);
      return 1;
    }
    const table = (head: string[], rows: string[][]) => {
      const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
      return [head, ...rows]
        .map((r) =>
          r
            .map((c, i) => c.padEnd(w[i]!))
            .join('  ')
            .trimEnd(),
        )
        .join('\n');
    };
    if (!flags.has('vuln')) {
      yield out(
        `✔ Cataloged ${list.length} package${list.length === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}`,
      );
      yield out(
        table(
          ['NAME', 'VERSION', 'TYPE'],
          list.map((c) => [c.name, c.version, c.type]),
        ),
      );
      return 0;
    }
    const advisories: Advisory[] = [...ctx.world.advisories, ...(ctx.game.mission?.advisories ?? [])];
    const hits = list.flatMap((c) =>
      advisories.filter((a) => a.package === c.name && a.versions.includes(c.version)).map((a) => ({ c, a })),
    );
    ctx.emit({
      type: 'SbomScanned',
      target: ctx.path(target),
      components: list.length,
      findings: hits.map((h) => h.a.id),
    });
    if (!hits.length) {
      yield out(`✔ Scanned ${list.length} packages\nNo vulnerabilities found`);
      return 0;
    }
    yield out(
      `✔ Scanned ${list.length} packages, ${hits.length} vulnerabilit${hits.length === 1 ? 'y' : 'ies'} found`,
    );
    yield out(
      table(
        ['NAME', 'INSTALLED', 'FIXED-IN', 'TYPE', 'VULNERABILITY', 'SEVERITY'],
        hits.map(({ c, a }) => [
          c.name,
          c.version,
          a.fixed ?? "(won't fix)",
          c.type,
          a.id,
          a.severity[0]!.toUpperCase() + a.severity.slice(1),
        ]),
      ),
    );
    for (const { a } of hits) yield out(`  ${a.id}: ${ctx.t(a.summary)}`);
    return 0;
  },
};

/* ---------- mail headers ---------- */

/** The header block of a message, with folded lines joined. */
export function parseHeaders(text: string): { name: string; value: string }[] {
  const head = text.split(/\r?\n\r?\n/)[0] ?? '';
  const out: { name: string; value: string }[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1]!.value += ` ${line.trim()}`;
    else {
      const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
      if (m) out.push({ name: m[1]!, value: m[2]! });
    }
  }
  return out;
}

const domainOf = (v: string | undefined) => /@([A-Za-z0-9.-]+)/.exec(v ?? '')?.[1]?.toLowerCase();

const mailhdr: Command = {
  name: 'mailhdr',
  summary: 'cmd.mailhdr',
  explain: 'explain.mailhdr',
  group: 'files',
  async *run(ctx): Run {
    const sources = yield* inputs(
      ctx,
      ctx.args.filter((a) => !a.startsWith('-')),
    );
    if (!sources.length) return 1;
    for (const { name, text } of sources) {
      const headers = parseHeaders(text);
      if (!headers.length) {
        yield err(`mailhdr: ${name}: no mail headers found`);
        continue;
      }
      const get = (h: string) => headers.find((x) => x.name.toLowerCase() === h.toLowerCase())?.value;
      const from = get('From');
      const fromDomain = domainOf(from);
      const lines: string[] = [];
      const row = (label: string, value: string | undefined, other?: string) => {
        if (value === undefined) return;
        const d = domainOf(value);
        const differs = other !== undefined && d && fromDomain && d !== fromDomain;
        lines.push(`${`${label}:`.padEnd(14)}${value}${differs ? `   [domain ${d} ≠ ${fromDomain}]` : ''}`);
      };
      row('From', from);
      row('Reply-To', get('Reply-To'), 'from');
      row('Return-Path', get('Return-Path'), 'from');
      row('To', get('To'));
      row('Subject', get('Subject'));
      row('Date', get('Date'));
      row('Message-ID', get('Message-ID'), 'from');
      const hops = headers.filter((h) => h.name.toLowerCase() === 'received').reverse();
      if (hops.length) {
        lines.push('', 'Received (oldest first):');
        hops.forEach((h, i) => {
          const m = /from\s+(\S+)\s*(?:\(([^)]*)\))?.*?\bby\s+(\S+)/i.exec(h.value);
          const ip = /\[?(\d{1,3}(?:\.\d{1,3}){3})\]?/.exec(m?.[2] ?? h.value)?.[1];
          const date = h.value.split(';').slice(1).join(';').trim();
          lines.push(
            m
              ? `  ${i + 1}. ${m[1]}${ip ? ` [${ip}]` : ''} -> ${m[3]}${date ? `   ${date}` : ''}`
              : `  ${i + 1}. ${h.value}`,
          );
        });
      }
      const auth = headers.filter((h) =>
        /^(authentication-results|received-spf|arc-authentication-results)$/i.test(h.name),
      );
      if (auth.length) {
        lines.push('', 'Authentication:');
        for (const a of auth) {
          for (const m of a.value.matchAll(/\b(spf|dkim|dmarc|arc)=(\w+)([^;]*)/gi))
            lines.push(`  ${m[1]!.toLowerCase().padEnd(6)}${m[2]!.toLowerCase().padEnd(10)}${m[3]!.trim()}`);
          if (/^received-spf$/i.test(a.name))
            lines.push(
              `  spf   ${a.value.split(/\s/)[0]!.toLowerCase().padEnd(10)}${a.value.split(/\s/).slice(1).join(' ')}`,
            );
        }
      } else lines.push('', 'Authentication: (no Authentication-Results header)');
      yield out(lines.join('\n'));
      ctx.emit({ type: 'FileRead', host: ctx.state.host, path: ctx.path(name) });
    }
    return 0;
  },
};

/* ---------- call ---------- */

const call: Command = {
  name: 'call',
  summary: 'cmd.call',
  explain: 'explain.call',
  group: 'network',
  async *run(ctx): Run {
    const [number, ...words] = ctx.args;
    if (!number) {
      yield err('usage: call <number> "<what you say>"');
      return 2;
    }
    const npc = ctx.game.phoneOf(number);
    yield out(`Dialling ${number}…`);
    yield { k: 'wait', ms: 900 };
    if (!npc) {
      yield err('The number you have dialled is not in service.');
      return 1;
    }
    const message = words.join(' ').trim();
    yield out(`Connected: ${npc.name} (${ctx.t(npc.role)})`);
    if (!message) {
      yield out(`${npc.name}: ${npc.greeting ? ctx.t(npc.greeting) : '…'}`);
      yield out('Call ended.');
      return 0;
    }
    const r = ctx.game.call(number, message);
    if (!r.ok) {
      yield err('Call dropped.');
      return 1;
    }
    yield out(`${npc.name}: ${r.reply}`);
    yield out('Call ended.');
    return 0;
  },
};

export const inspectCommands: Command[] = [strings, file, unzip, tar, openssl, hashid, sbom, mailhdr, call];
