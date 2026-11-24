import type { SmsMessage, WifiNetwork } from '@breach/pack-schema';
import { readQr } from '../artifact.ts';
import { qrBlocks, qrMatrix } from '../qr.ts';
import { lookup } from '../vfs.ts';
import { type Command, type CommandCtx, err, out, type Run } from './types.ts';

/**
 * Tools for the home and the personal side of security: the Wi-Fi networks in range and the text
 * messages of a phone. Both only read what the pack declares. The Wi-Fi scan is the passive list
 * every phone shows: nothing is captured, joined or cracked.
 */

const bars = (signal: number) =>
  signal > 75 ? '▂▄▆█' : signal > 50 ? '▂▄▆_' : signal > 25 ? '▂▄__' : '▂___';
const rate = (n: WifiNetwork) =>
  n.channel > 14 ? '270 Mbit/s' : n.security === 'WEP' ? '54 Mbit/s' : '130 Mbit/s';

const WIFI_FIELDS = [
  'IN-USE',
  'BSSID',
  'SSID',
  'MODE',
  'CHAN',
  'RATE',
  'SIGNAL',
  'BARS',
  'SECURITY',
] as const;
type WifiField = (typeof WIFI_FIELDS)[number];

function wifiCell(n: WifiNetwork, f: WifiField): string {
  switch (f) {
    case 'IN-USE':
      return n.inUse ? '*' : '';
    case 'BSSID':
      return n.bssid;
    case 'SSID':
      return n.ssid || '--';
    case 'MODE':
      return 'Infra';
    case 'CHAN':
      return String(n.channel);
    case 'RATE':
      return rate(n);
    case 'SIGNAL':
      return String(n.signal);
    case 'BARS':
      return bars(n.signal);
    case 'SECURITY':
      return n.security === 'open' ? '--' : n.security;
  }
}

const table = (head: readonly string[], rows: string[][]) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  return [head as string[], ...rows].map((r) =>
    r
      .map((c, i) => c.padEnd(w[i]!))
      .join('  ')
      .trimEnd(),
  );
};

/** The networks in range now: the world's, then the mission's, each while its condition holds. */
export function wifiInRange(ctx: CommandCtx): WifiNetwork[] {
  return [...ctx.world.wifi, ...(ctx.game.mission?.wifi ?? [])]
    .filter((n) => ctx.game.holds(n.if))
    .sort((a, b) => b.signal - a.signal);
}

const nmcli: Command = {
  name: 'nmcli',
  summary: 'cmd.nmcli',
  explain: 'explain.nmcli',
  group: 'network',
  async *run(ctx): Run {
    // `nmcli connection …`: the networks this machine saved, and joins again by itself.
    const positional: string[] = [];
    let fieldText = '';
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === '-f' || a === '--fields') fieldText = ctx.args[++i] ?? '';
      else if (!a.startsWith('-')) positional.push(a);
    }
    const head = positional[0]?.toLowerCase() ?? '';
    if (head.length >= 1 && 'connection'.startsWith(head))
      return yield* connection(ctx, positional.slice(1), fieldText);
    let fields: WifiField[] = [...WIFI_FIELDS];
    const words: string[] = [];
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === '-f' || a === '--fields') {
        const asked = (ctx.args[++i] ?? '').toUpperCase().split(',').filter(Boolean);
        const unknown = asked.find((f) => !(WIFI_FIELDS as readonly string[]).includes(f));
        if (unknown || !asked.length) {
          yield err(`Error: invalid field '${unknown ?? ''}'; allowed fields: ${WIFI_FIELDS.join(',')}.`);
          return 2;
        }
        fields = asked as WifiField[];
      } else if (!a.startsWith('-')) words.push(a.toLowerCase());
    }
    const [object, sub, verb] = words;
    const isDevice = object !== undefined && 'device'.startsWith(object);
    if (!isDevice || sub !== 'wifi' || (verb !== undefined && verb !== 'list' && verb !== 'rescan')) {
      yield err(ctx.t('nmcli.usage'));
      return 2;
    }
    if (ctx.state.host !== ctx.world.player.host) {
      yield err('Error: No Wi-Fi device found.');
      return 10;
    }
    const seen = wifiInRange(ctx);
    ctx.emit({ type: 'WifiScanned', networks: seen.length });
    if (verb === 'rescan') return 0;
    const lines = table(
      fields,
      seen.map((n) => fields.map((f) => wifiCell(n, f))),
    );
    yield out(lines.join('\n'));
    return 0;
  },
};

/* ---------- saved Wi-Fi connections ---------- */

/** Where NetworkManager keeps the networks a machine joins again by itself. */
export const CONNECTIONS_DIR = '/etc/NetworkManager/system-connections';

interface SavedConnection {
  name: string;
  path: string;
  content: string;
  ssid: string;
  autoconnect: boolean;
  type: string;
}

const iniValue = (content: string, key: string) =>
  new RegExp(`^\\s*${key.replace('.', '\\.')}\\s*=\\s*(.*)$`, 'm').exec(content)?.[1]?.trim();

/** The connections saved on the workstation, read from their keyfiles. */
export function savedConnections(ctx: CommandCtx): SavedConnection[] {
  const dir = lookup(ctx.state.fs, CONNECTIONS_DIR);
  if (!dir || dir.t !== 'd') return [];
  const found: SavedConnection[] = [];
  for (const [file, node] of Object.entries(dir.c)) {
    if (node.t !== 'f' || !file.endsWith('.nmconnection')) continue;
    const name = iniValue(node.content, 'id') ?? file.replace(/\.nmconnection$/, '');
    const auto = (iniValue(node.content, 'autoconnect') ?? 'true').toLowerCase();
    found.push({
      name,
      path: `${CONNECTIONS_DIR}/${file}`,
      content: node.content,
      ssid: iniValue(node.content, 'ssid') ?? name,
      autoconnect: !['false', 'no', '0'].includes(auto),
      type: iniValue(node.content, 'type') ?? 'wifi',
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const uuidOf = (name: string) => {
  let h = 2166136261;
  const parts: string[] = [];
  for (const len of [8, 4, 4, 4, 12]) {
    let s = '';
    while (s.length < len) {
      for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
      s += (h >>> 0).toString(16).padStart(8, '0');
    }
    parts.push(s.slice(0, len));
  }
  return parts.join('-');
};

const CONNECTION_FIELDS = ['NAME', 'UUID', 'TYPE', 'DEVICE', 'AUTOCONNECT'] as const;

async function* connection(ctx: CommandCtx, words: string[], fieldText: string): Run {
  const [verb = 'show', name, prop, value] = words;
  if (ctx.state.host !== ctx.world.player.host) {
    yield err('Error: NetworkManager is not running.');
    return 8;
  }
  const saved = savedConnections(ctx);
  const inUse = wifiInRange(ctx).find((n) => n.inUse)?.ssid;
  if ('show'.startsWith(verb) && verb.length >= 1) {
    let fields: string[] = ['NAME', 'UUID', 'TYPE', 'DEVICE'];
    if (fieldText) {
      const asked = fieldText.toUpperCase().split(',').filter(Boolean);
      const unknown = asked.find((f) => !(CONNECTION_FIELDS as readonly string[]).includes(f));
      if (unknown || !asked.length) {
        yield err(`Error: invalid field '${unknown ?? ''}'; allowed fields: ${CONNECTION_FIELDS.join(',')}.`);
        return 2;
      }
      fields = asked;
    }
    ctx.emit({ type: 'ConnectionsListed', connections: saved.length });
    const cell = (c: SavedConnection, f: string) =>
      f === 'NAME'
        ? c.name
        : f === 'UUID'
          ? uuidOf(c.name)
          : f === 'TYPE'
            ? c.type
            : f === 'DEVICE'
              ? c.ssid === inUse
                ? 'wlan0'
                : '--'
              : c.autoconnect
                ? 'yes'
                : 'no';
    yield out(
      table(
        fields,
        saved.map((c) => fields.map((f) => cell(c, f))),
      ).join('\n'),
    );
    return 0;
  }
  const target = saved.find((c) => c.name === name || uuidOf(c.name) === name);
  if (
    !name ||
    (!('delete'.startsWith(verb) && verb.length >= 3) && !('modify'.startsWith(verb) && verb.length >= 3))
  ) {
    yield err(ctx.t('nmcli.usage'));
    return 2;
  }
  if (!target) {
    yield err(`Error: unknown connection '${name}'.`);
    return 10;
  }
  if ('delete'.startsWith(verb)) {
    ctx.emit({ type: 'FileRemoved', host: ctx.state.host, path: target.path });
    yield out(`Connection '${target.name}' (${uuidOf(target.name)}) successfully deleted.`);
    return 0;
  }
  const yes = ['yes', 'true', 'on', '1'].includes((value ?? '').toLowerCase());
  const no = ['no', 'false', 'off', '0'].includes((value ?? '').toLowerCase());
  if ((prop !== 'connection.autoconnect' && prop !== 'autoconnect') || (!yes && !no)) {
    yield err(
      'Error: this game changes one property: nmcli connection modify <name> connection.autoconnect yes|no',
    );
    return 2;
  }
  const line = `autoconnect=${yes ? 'true' : 'false'}`;
  const content = /^\s*autoconnect\s*=.*$/m.test(target.content)
    ? target.content.replace(/^\s*autoconnect\s*=.*$/m, line)
    : target.content.replace(/^\[connection\][^\n]*\n/m, (h) => `${h}${line}\n`);
  ctx.emit({ type: 'FileWritten', host: ctx.state.host, path: target.path, content, append: false });
  return 0;
}

/* ---------- QR codes ---------- */

/** What a QR code's text is, and where scanning it would really take the phone. */
export function qrMeaning(text: string): string[] {
  const wifi = /^WIFI:(.*)$/i.exec(text);
  if (wifi) {
    const field = (k: string) =>
      new RegExp(`(?:^|;)${k}:((?:\\\\.|[^;])*)`).exec(wifi[1]!)?.[1]?.replace(/\\(.)/g, '$1');
    const t = field('T') ?? 'nopass';
    return [
      'Type:      Wi-Fi network (the phone offers to join it)',
      `SSID:      ${field('S') ?? ''}`,
      `Security:  ${t === 'nopass' || t === '' ? 'open (no password)' : t}`,
      ...(field('P') ? [`Password:  ${field('P')}`] : []),
      ...(field('H') === 'true' ? ['Hidden:    yes'] : []),
    ];
  }
  const links = linksIn(text);
  if (links.length) {
    const l = links[0]!;
    return [
      `Type:      web address${/^http:/i.test(l.url) ? ' (plain http, not encrypted)' : ''}`,
      `Opens:     ${l.host}`,
      ...(l.url.length > 60
        ? ['Note:      the full address is long; a phone preview shows only its start']
        : []),
    ];
  }
  if (/^(sms|smsto|tel|mailto):/i.test(text))
    return [`Type:      ${text.split(':')[0]!.toLowerCase()} (the phone prepares a message or a call)`];
  return ['Type:      text'];
}

function* readQrFile(
  ctx: CommandCtx,
  arg: string,
): Generator<ReturnType<typeof err>, { abs: string; qr: ReturnType<typeof readQr> } | null> {
  const abs = ctx.path(arg);
  const node = lookup(ctx.state.fs, abs);
  if (!node || node.t !== 'f') {
    yield err(`${ctx.name}: ${arg}: No such file or directory`);
    return null;
  }
  return { abs, qr: readQr(node.content) };
}

const zbarimg: Command = {
  name: 'zbarimg',
  summary: 'cmd.zbarimg',
  explain: 'explain.zbarimg',
  group: 'files',
  async *run(ctx): Run {
    const quiet = ctx.args.includes('-q') || ctx.args.includes('--quiet');
    const files = ctx.args.filter((a) => !a.startsWith('-'));
    if (!files.length) {
      yield err('usage: zbarimg [-q] <image>...');
      return 2;
    }
    let found = 0;
    for (const f of files) {
      const r = yield* readQrFile(ctx, f);
      if (!r) return 2;
      if (r.qr) {
        found++;
        ctx.emit({ type: 'QrDecoded', file: r.abs, text: r.qr.text });
        yield out(`QR-Code:${r.qr.text}`);
      }
    }
    if (!quiet)
      yield err(
        `scanned ${found} barcode symbols from ${files.length} images in 0.0${2 + files.length} seconds`,
      );
    if (found < files.length) {
      if (!quiet)
        yield err(
          'WARNING: barcode data was not detected in some image(s)\nThings to check:\n  - is the barcode type supported? Currently supported symbologies are:\n\t. QR-Code',
        );
      return 4;
    }
    return 0;
  },
};

const qr: Command = {
  name: 'qr',
  summary: 'cmd.qr',
  explain: 'explain.qr',
  group: 'files',
  async *run(ctx): Run {
    const [verb, file] = ctx.args.filter((a) => !a.startsWith('-'));
    if ((verb !== 'decode' && verb !== 'show') || !file) {
      yield err(ctx.t('qr.usage'));
      return 2;
    }
    const r = yield* readQrFile(ctx, file);
    if (!r) return 2;
    if (!r.qr) {
      yield err(`qr: ${file}: no QR code found in this file`);
      return 4;
    }
    const { text, style } = r.qr;
    if (verb === 'show') {
      const m = qrMatrix(text);
      if (!m) {
        yield err('qr: this code is too large to draw here');
        return 1;
      }
      const lines = qrBlocks(m);
      // A dressed-up code: the same modules, in colour. A logo would hide some of them.
      yield out(
        style === 'fancy' && ctx.tty
          ? lines.map((l) => `\x1b[38;5;183m${l}\x1b[0m`).join('\n')
          : lines.join('\n'),
      );
      yield out(ctx.t('qr.shown'));
      return 0;
    }
    ctx.emit({ type: 'QrDecoded', file: r.abs, text });
    yield out([`Content:   ${text}`, ...qrMeaning(text)].join('\n'));
    return 0;
  },
};

/** What kind of sender a text message shows: the first thing to read before believing it. */
export function senderKind(from: string): 'name' | 'shortcode' | 'number' {
  if (/^\d{5}$/.test(from)) return 'shortcode';
  return from.startsWith('+') ? 'number' : 'name';
}

const SENDER_NOTE = {
  name: 'sender name (free text, set by whoever sends the message)',
  shortcode: 'short code (rented from an operator)',
  number: 'mobile or landline number',
} as const;

/** Addresses written in a message, with the host a tap would really reach. */
export function linksIn(text: string): { url: string; host: string }[] {
  const found: { url: string; host: string }[] = [];
  for (const m of text.matchAll(/\bhttps?:\/\/([A-Za-z0-9.-]+)[^\s)»"]*/g))
    found.push({ url: m[0].replace(/[.,;:!?]+$/, ''), host: m[1]!.toLowerCase().replace(/\.$/, '') });
  return found;
}

export function inbox(ctx: CommandCtx): SmsMessage[] {
  return [...ctx.world.sms, ...(ctx.game.mission?.sms ?? [])]
    .filter((m) => ctx.game.holds(m.if))
    .sort((a, b) => a.at.localeCompare(b.at));
}

const sms: Command = {
  name: 'sms',
  summary: 'cmd.sms',
  explain: 'explain.sms',
  group: 'files',
  async *run(ctx): Run {
    const messages = inbox(ctx);
    const arg = ctx.args.find((a) => !a.startsWith('-'));
    if (arg === undefined) {
      ctx.emit({ type: 'SmsRead', sms: '*' });
      if (!messages.length) {
        yield out('No messages.');
        return 0;
      }
      const rows = messages.map((m, i) => {
        const text = ctx.t(m.text).replace(/\s+/g, ' ');
        return [String(i + 1), m.from, m.at, text.length > 48 ? `${text.slice(0, 47)}…` : text];
      });
      yield out(table(['#', 'FROM', 'RECEIVED', 'TEXT'], rows).join('\n'));
      return 0;
    }
    const n = Number(arg);
    const m = Number.isInteger(n) ? messages[n - 1] : messages.find((x) => x.id === arg);
    if (!m) {
      yield err(`sms: ${arg}: no such message`);
      return 1;
    }
    ctx.emit({ type: 'SmsRead', sms: m.id });
    const text = ctx.t(m.text);
    const lines = [
      `From:      ${m.from}`,
      `Sender:    ${SENDER_NOTE[senderKind(m.from)]}`,
      `Received:  ${m.at}`,
      '',
      text,
    ];
    const links = linksIn(text);
    if (links.length) {
      lines.push('', 'Links:');
      for (const l of links) lines.push(`  ${l.url}`, `    opens: ${l.host}`);
    }
    yield out(lines.join('\n'));
    return 0;
  },
};

export const personalCommands: Command[] = [nmcli, sms, zbarimg, qr];
