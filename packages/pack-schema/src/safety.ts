/**
 * Content safety rules. They enforce "no real target, ever": every domain and every IP address a
 * pack mentions must be reserved for documentation, testing or private use.
 */

const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

/** Hosts players may be pointed to (learning resources). Never targets. */
export const LINK_ALLOWLIST = [
  'root-me.org',
  'tryhackme.com',
  'owasp.org',
  'cyber.gouv.fr',
  'cybermalveillance.gouv.fr',
  'nmap.org',
  'git-scm.com',
  'gitea.io',
  'w3.org',
];

export function isReservedDomain(name: string): boolean {
  const n = name.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9*]([a-z0-9.*-]*[a-z0-9])?$/.test(n)) return false;
  const tld = n.split('.').pop() ?? '';
  if (RESERVED_TLDS.includes(tld)) return true;
  return RESERVED_DOMAINS.some((d) => n === d || n.endsWith(`.${d}`));
}

function ipv4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** Blocks reserved for private use, documentation or loopback: RFC 1918, RFC 5737, RFC 1122. */
const RESERVED_BLOCKS: [number[], number][] = [
  [[10, 0, 0, 0], 8],
  [[127, 0, 0, 0], 8],
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
  [[192, 0, 2, 0], 24],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
];

const toInt = (p: number[]) => ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
const maskOf = (bits: number) => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

/**
 * An address, or a network written `a.b.c.d/bits`, that lies entirely inside one reserved block.
 * A network wider than its block (`10.0.0.0/0`, `192.168.0.0/8`) is refused: it would take in real
 * Internet addresses.
 */
export function isReservedIp(ip: string): boolean {
  const p = ipv4(ip);
  if (!p) return false;
  const bitsText = ip.split('/')[1];
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const n = toInt(p);
  return RESERVED_BLOCKS.some(([base, size]) => bits >= size && (n & maskOf(size)) >>> 0 === toInt(base));
}

const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const HOST_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
/** Top-level domains that make a name look like a real Internet host. */
const REAL_TLDS = new Set(
  'com net org io fr de uk co dev app ai gov edu ru cn info biz eu us ca ch be es nl xyz tech cloud online site store shop tv cc jp br in au pl se no fi dk pt gr cz at ie lu'.split(
    ' ',
  ),
);

function allowedHostname(h: string): boolean {
  const n = h.toLowerCase();
  if (!REAL_TLDS.has(n.split('.').pop() ?? '')) return true;
  if (isReservedDomain(n)) return true;
  return LINK_ALLOWLIST.some((d) => n === d || n.endsWith(`.${d}`));
}

function scanText(text: string, where: string, problems: string[]) {
  for (const ip of text.match(IP_RE) ?? []) {
    const parts = ip.split('.').map(Number);
    // Version strings such as "1.27.0.1" are not addresses.
    if (parts.some((p) => p > 255)) continue;
    if (!isReservedIp(ip) && !/^0\.|^255\./.test(ip))
      problems.push(`${where}: IP address ${ip} is not in a reserved range`);
  }
  for (const h of text.match(HOST_RE) ?? []) {
    if (!allowedHostname(h)) problems.push(`${where}: host name ${h} is not a reserved domain`);
  }
  // Terminal escape sequences and other control characters: a pack could redraw the screen or plant
  // a link. Tabs and line breaks are the only control characters a text may hold.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text))
    problems.push(`${where}: control characters are not allowed`);
  if (/<script\b|javascript:|\bon(load|error|click)\s*=/i.test(text))
    problems.push(`${where}: script-like content is not allowed`);
}

function walk(value: unknown, where: string, problems: string[], depth = 0) {
  if (depth > 40) {
    problems.push(`${where}: nesting too deep`);
    return;
  }
  if (typeof value === 'string') scanText(value, where, problems);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`, problems, depth + 1));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      scanText(k, `${where}.${k} (key)`, problems);
      walk(v, `${where}.${k}`, problems, depth + 1);
    }
}

type PackLike = {
  world?: {
    scope: { domains: string[]; networks: string[] };
    hosts: { hostname: string; ip: string }[];
    dns: Record<string, unknown>;
  };
  mission?: unknown;
  i18n?: unknown;
  authors?: unknown;
};

/**
 * The sources of a debrief's `facts` card cite the real world on purpose (a post-mortem, an advisory).
 * Their addresses are shaped by the schema and shown as plain text, so they skip the host name check.
 * Everything else in the mission, the labels included, is still scanned.
 */
function withoutSourceUrls(mission: unknown): unknown {
  const m = mission as { debrief?: { facts?: { sources?: { label?: unknown }[] } } } | undefined;
  const sources = m?.debrief?.facts?.sources;
  if (!m || !Array.isArray(sources)) return mission;
  return {
    ...m,
    debrief: {
      ...m.debrief,
      facts: { ...m.debrief?.facts, sources: sources.map((x) => ({ label: x?.label })) },
    },
  };
}

/**
 * What a page puts on the clipboard (`copy` blocks) is the one text a player is told never to paste.
 * It must stay a fictional tool of the world: no shell, no download, no encoded command, nothing
 * that would run if someone did paste it in a real terminal.
 */
const REAL_COMMAND =
  /powershell|pwsh|mshta|rundll32|regsvr32|certutil|bitsadmin|wscript|cscript|cmd(\.exe)?\s*\/[ck]|invoke-|\biex\b|-enc(odedcommand)?\b|frombase64|base64\s+-d|\b(curl|wget|nc|ncat|bash|sh|zsh|python3?|perl|osascript)\b|\|\s*\w|`|\$\(/i;

function copyTexts(value: unknown, found: string[], depth = 0) {
  if (depth > 40 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) copyTexts(v, found, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === 'copy' && v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string')
      found.push((v as { text: string }).text);
    else copyTexts(v, found, depth + 1);
  }
}

function checkCopies(pack: PackLike, problems: string[]) {
  const texts: string[] = [];
  copyTexts(pack.world, texts);
  copyTexts(pack.mission, texts);
  const i18n = (pack.i18n ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const text of texts)
    for (const candidate of [text, ...Object.values(i18n).map((l) => l?.[text])])
      if (typeof candidate === 'string' && REAL_COMMAND.test(candidate))
        problems.push(
          `copy block "${text.slice(0, 40)}": a copied text must be a fictional tool, not a real command`,
        );
}

export function checkPackSafety(pack: PackLike): string[] {
  const problems: string[] = [];
  checkCopies(pack, problems);
  const w = pack.world;
  if (w) {
    for (const d of w.scope.domains)
      if (!isReservedDomain(d)) problems.push(`scope domain ${d} is not reserved`);
    for (const n of w.scope.networks)
      if (!isReservedIp(n)) problems.push(`scope network ${n} is not reserved`);
    for (const h of w.hosts) {
      if (!isReservedDomain(h.hostname)) problems.push(`host ${h.hostname} is not a reserved domain`);
      if (!isReservedIp(h.ip)) problems.push(`host IP ${h.ip} is not in a reserved range`);
    }
    for (const name of Object.keys(w.dns))
      if (!isReservedDomain(name)) problems.push(`DNS name ${name} is not reserved`);
  }
  walk(pack.world, 'world', problems);
  walk(withoutSourceUrls(pack.mission), 'mission', problems);
  walk(pack.i18n, 'i18n', problems);
  return [...new Set(problems)].slice(0, 30);
}
