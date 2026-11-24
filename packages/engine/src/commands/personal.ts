import type { SmsMessage, WifiNetwork } from '@breach/pack-schema';
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

export const personalCommands: Command[] = [nmcli, sms];
