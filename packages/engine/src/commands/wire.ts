import type { CapturePacket } from '@breach/pack-schema';
import { readCapture } from '../artifact.ts';
import { lookup } from '../vfs.ts';
import { type Command, err, out, type Run } from './types.ts';

/*
 * `tshark -r` reads a capture the pack describes: what someone on the same network would have seen.
 * There is no live capture: the game never listens to anything, it only reads a file. Encrypted
 * records exist only as a size, so there is nothing to decrypt either.
 */

const hash = (text: string, mod: number, base = 0) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return base + ((h >>> 0) % mod);
};
const hex = (seed: string, n: number) => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += hash(`${seed}:${i}`, 0xffff).toString(16).padStart(4, '0');
  return s.slice(0, n);
};

/** One line of the capture as `tshark` lists it, with what `-V` would unfold. */
export interface Frame {
  no: number;
  time: number;
  src: string;
  dst: string;
  proto: string;
  /** Lower-case layer names this frame matches in a display filter (`dns`, `tcp`, `http`…). */
  layers: string[];
  len: number;
  info: string;
  /** Fields a display filter can test, besides the addresses. */
  fields: Record<string, string>;
  detail: string[];
  sport: number;
  dport: number;
}

/** The frames a capture's packets stand for: a DNS exchange is a query and its answer, and so on. */
export function framesOf(packets: CapturePacket[]): Frame[] {
  const frames: Frame[] = [];
  const add = (f: Omit<Frame, 'no'>) => frames.push({ ...f, no: frames.length + 1 });
  for (const [k, p] of packets.entries()) {
    const sport = hash(`${k}${p.src}`, 20000, 40000);
    const key = `${k}${p.proto}${p.src}${p.dst}`;
    if (p.proto === 'dns') {
      const id = `0x${hex(key, 4)}`;
      const rtype = p.rtype ?? 'A';
      const base = { layers: ['dns', 'udp', 'ip'], fields: { 'dns.qry.name': p.query } };
      add({
        ...base,
        time: p.t,
        src: p.src,
        dst: p.dst,
        proto: 'DNS',
        len: 60 + p.query.length,
        info: `Standard query ${id} ${rtype} ${p.query}`,
        sport,
        dport: 53,
        detail: ['Domain Name System (query)', '    Queries', `        ${p.query}: type ${rtype}, class IN`],
      });
      add({
        ...base,
        time: p.t + 0.012,
        src: p.dst,
        dst: p.src,
        proto: 'DNS',
        len: 76 + p.query.length,
        info: `Standard query response ${id} ${rtype} ${p.query}${p.answer ? ` ${rtype} ${p.answer}` : ' No such name'}`,
        sport: 53,
        dport: sport,
        detail: [
          'Domain Name System (response)',
          '    Answers',
          p.answer ? `        ${p.query}: type ${rtype}, class IN, addr ${p.answer}` : '        (no answer)',
        ],
      });
    } else if (p.proto === 'tls' || p.proto === 'quic') {
      const quic = p.proto === 'quic';
      const label = quic ? 'QUIC' : 'TLSv1.3';
      const layers = quic ? ['quic', 'udp', 'ip'] : ['tls', 'tcp', 'ip'];
      const fields: Record<string, string> = p.sni ? { 'tls.handshake.extensions_server_name': p.sni } : {};
      const hello = [
        quic ? 'QUIC IETF' : 'Transport Layer Security',
        `    ${quic ? 'TLSv1.3 Handshake (in CRYPTO frames)' : 'TLSv1.3 Record Layer: Handshake Protocol: Client Hello'}`,
        '        Handshake Type: Client Hello (1)',
        ...(p.sni
          ? [`        Extension: server_name (len=${p.sni.length + 5})`, `            Server Name: ${p.sni}`]
          : []),
        ...(p.ech
          ? [
              `        Extension: encrypted_client_hello (len=${hash(key, 120, 200)})`,
              '            Client Hello type: Outer Client Hello (0)',
              `            Payload: ${hex(`${key}e`, 32)}…`,
            ]
          : []),
      ];
      add({
        time: p.t,
        src: p.src,
        dst: p.dst,
        proto: label,
        layers,
        fields,
        len: quic ? 1292 : 517 + (p.sni?.length ?? 0),
        info: quic
          ? `Initial, DCID=${hex(key, 16)}, PKN: 0, CRYPTO, PADDING${p.sni ? ` (SNI=${p.sni})` : ''}`
          : `Client Hello${p.sni ? ` (SNI=${p.sni})` : ''}`,
        sport,
        dport: 443,
        detail: hello,
      });
      add({
        time: p.t + 0.031,
        src: p.dst,
        dst: p.src,
        proto: label,
        layers,
        fields: {},
        len: 1514,
        info: quic ? 'Handshake, SCID=…, CRYPTO' : 'Server Hello, Change Cipher Spec, Application Data',
        sport: 443,
        dport: sport,
        detail: [quic ? 'QUIC IETF' : 'Transport Layer Security', '    Handshake Type: Server Hello (2)'],
      });
      const records = p.records ?? 2;
      const total = p.bytes ?? 4200;
      for (let r = 0; r < records; r++) {
        const up = r % 2 === 0;
        const size = Math.max(
          80,
          Math.min(1514, Math.floor(total / Math.max(1, records)) + hash(`${key}${r}`, 90)),
        );
        add({
          time: p.t + 0.06 + r * 0.04,
          src: up ? p.src : p.dst,
          dst: up ? p.dst : p.src,
          proto: label,
          layers,
          fields: {},
          len: size,
          info: quic ? 'Protected Payload (KP0)' : 'Application Data',
          sport: up ? sport : 443,
          dport: up ? 443 : sport,
          detail: [
            quic ? 'QUIC IETF' : 'Transport Layer Security',
            `    ${quic ? 'Protected Payload' : 'TLSv1.3 Record Layer: Application Data Protocol: Hypertext Transfer Protocol'}`,
            `        Encrypted Application Data: ${hex(`${key}${r}d`, 40)}…`,
          ],
        });
      }
    } else if (p.proto === 'http') {
      const method = p.method ?? 'GET';
      const form = p.body?.includes('=') ?? false;
      const fields = { 'http.host': p.host, 'http.request.method': method, 'http.request.uri': p.path };
      add({
        time: p.t,
        src: p.src,
        dst: p.dst,
        proto: 'HTTP',
        layers: ['http', 'tcp', 'ip', 'http.request'],
        fields,
        len: 180 + p.path.length + (p.body?.length ?? 0),
        info: `${method} ${p.path} HTTP/1.1 ${form ? ' (application/x-www-form-urlencoded)' : ''}`.trimEnd(),
        sport,
        dport: 80,
        detail: [
          'Hypertext Transfer Protocol',
          `    ${method} ${p.path} HTTP/1.1\\r\\n`,
          `    Host: ${p.host}\\r\\n`,
          ...(p.body
            ? form
              ? [
                  'HTML Form URL Encoded: application/x-www-form-urlencoded',
                  ...p.body.split('&').map((kv) => {
                    const [name, value = ''] = kv.split('=');
                    return `    Form item: "${name}" = "${value}"`;
                  }),
                ]
              : ['Line-based text data: text/plain', `    ${p.body}`]
            : []),
        ],
      });
      const status = p.status ?? 200;
      add({
        time: p.t + 0.045,
        src: p.dst,
        dst: p.src,
        proto: 'HTTP',
        layers: ['http', 'tcp', 'ip', 'http.response'],
        fields: { 'http.host': p.host },
        len: 412,
        info: `HTTP/1.1 ${status} ${status === 200 ? 'OK' : status === 302 ? 'Found' : status === 401 ? 'Unauthorized' : 'Error'}  (text/html)`,
        sport: 80,
        dport: sport,
        detail: ['Hypertext Transfer Protocol', `    HTTP/1.1 ${status}\\r\\n`],
      });
    } else {
      const o = p as Extract<CapturePacket, { info: string }>;
      const name = p.proto === 'smb' ? 'SMB2' : p.proto.toUpperCase();
      const udp = p.proto === 'dhcp' || p.proto === 'udp';
      const layers = [
        p.proto === 'smb' ? 'smb2' : p.proto,
        ...(p.proto === 'arp' ? [] : [udp ? 'udp' : 'tcp', 'ip']),
      ];
      add({
        time: p.t,
        src: p.src,
        dst: p.dst,
        proto: name,
        layers,
        fields: {},
        len: p.proto === 'arp' ? 42 : 60 + o.info.length,
        info: o.info,
        sport,
        dport: o.dport ?? (p.proto === 'smb' ? 445 : p.proto === 'dhcp' ? 67 : 0),
        detail: [name, `    ${o.info}`],
      });
    }
  }
  return frames.sort((a, b) => a.time - b.time || a.no - b.no).map((f, i) => ({ ...f, no: i + 1 }));
}

/* ---------- display filters: a small part of Wireshark's language ---------- */

type Test = (f: Frame) => boolean;

function primitive(expr: string): Test | null {
  const e = expr.trim();
  if (!e) return null;
  if (e.startsWith('!')) {
    const inner = primitive(e.slice(1));
    return inner && ((f) => !inner(f));
  }
  if (/^not\s+/i.test(e)) {
    const inner = primitive(e.replace(/^not\s+/i, ''));
    return inner && ((f) => !inner(f));
  }
  const cmp = /^([a-z0-9_.]+)\s*(==|!=|contains)\s*"?([^"]*)"?$/i.exec(e);
  if (cmp) {
    const [, field, op, raw] = cmp;
    const value = raw!.trim();
    const get = (f: Frame): string[] => {
      if (field === 'ip.addr') return [f.src, f.dst];
      if (field === 'ip.src') return [f.src];
      if (field === 'ip.dst') return [f.dst];
      if (field === 'tcp.port' || field === 'udp.port') return [String(f.sport), String(f.dport)];
      if (field === 'tcp.dstport' || field === 'udp.dstport') return [String(f.dport)];
      if (field === 'frame.number') return [String(f.no)];
      return f.fields[field!] !== undefined ? [f.fields[field!]!] : [];
    };
    if (op === 'contains') return (f) => get(f).some((v) => v.includes(value));
    if (op === '==') return (f) => get(f).some((v) => v === value);
    return (f) => get(f).length > 0 && get(f).every((v) => v !== value);
  }
  if (/^[a-z0-9_.]+$/i.test(e)) {
    const name = e.toLowerCase();
    return (f) => f.layers.includes(name) || f.fields[name] !== undefined;
  }
  return null;
}

/** `a && b || c`, `and`/`or`, `!` and `not`: enough for the questions a capture asks. */
export function displayFilter(expr: string): Test | null {
  const alternatives = expr.split(/\s*(?:\|\||\bor\b)\s*/i);
  const tests: Test[][] = [];
  for (const alt of alternatives) {
    const parts = alt.split(/\s*(?:&&|\band\b)\s*/i).map(primitive);
    if (parts.some((p) => !p)) return null;
    tests.push(parts as Test[]);
  }
  return (f) => tests.some((all) => all.every((t) => t(f)));
}

/* ---------- the command ---------- */

const time = (t: number) => t.toFixed(6).padStart(11);
const human = (bytes: number) =>
  bytes >= 1_000_000
    ? `${Math.round(bytes / 1_000_000)} MB`
    : bytes >= 1000
      ? `${Math.round(bytes / 1000)} kB`
      : `${bytes} bytes`;

function conversations(frames: Frame[], tcp: boolean): string[] {
  const conv = new Map<
    string,
    { a: string; b: string; frames: number; bytes: number; start: number; end: number }
  >();
  for (const f of frames) {
    if (tcp && !f.layers.includes('tcp')) continue;
    const a = tcp ? `${f.src}:${f.sport}` : f.src;
    const b = tcp ? `${f.dst}:${f.dport}` : f.dst;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}|${y}`;
    const c = conv.get(k) ?? { a: x, b: y, frames: 0, bytes: 0, start: f.time, end: f.time };
    c.frames++;
    c.bytes += f.len;
    c.end = Math.max(c.end, f.time);
    conv.set(k, c);
  }
  const rows = [...conv.values()].sort((p, q) => q.bytes - p.bytes);
  const w = tcp ? 22 : 16;
  return [
    '================================================================================',
    tcp ? 'TCP Conversations' : 'IPv4 Conversations',
    'Filter:<No Filter>',
    `${''.padEnd(w * 2 + 5)}| Total          | Relative Start | Duration`,
    `${''.padEnd(w * 2 + 5)}| Frames  Bytes  |                |`,
    ...rows.map(
      (c) =>
        `${c.a.padEnd(w)} <-> ${c.b.padEnd(w)}| ${String(c.frames).padStart(6)}  ${human(c.bytes).padEnd(7)}| ${c.start.toFixed(6).padStart(14)} | ${(c.end - c.start).toFixed(4)}`,
    ),
    '================================================================================',
  ];
}

const tshark: Command = {
  name: 'tshark',
  summary: 'cmd.tshark',
  explain: 'explain.tshark',
  group: 'network',
  async *run(ctx): Run {
    let file: string | undefined;
    let filter = '';
    let verbose = false;
    let quiet = false;
    let stats = '';
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === '-r') file = ctx.args[++i];
      else if (a === '-Y' || a === '-R') filter = ctx.args[++i] ?? '';
      else if (a === '-V') verbose = true;
      else if (a === '-q') quiet = true;
      else if (a === '-z') stats = ctx.args[++i] ?? '';
      else if (a === '-n' || a === '-N') continue;
      else if (a === '-i' || a === '-w' || a === '-I' || a === '-D') {
        yield err(ctx.t('tshark.live'));
        return 2;
      } else {
        yield err(ctx.t('tshark.usage'));
        return 2;
      }
    }
    if (!file) {
      yield err(ctx.t('tshark.live'));
      return 2;
    }
    const abs = ctx.path(file);
    const node = lookup(ctx.state.fs, abs);
    if (!node || node.t !== 'f') {
      yield err(`tshark: The file "${file}" doesn't exist.`);
      return 2;
    }
    const capture = readCapture(node.content);
    if (!capture) {
      yield err(`tshark: The file "${file}" isn't a capture file in a format TShark understands.`);
      return 2;
    }
    const test = filter ? displayFilter(filter) : () => true;
    if (!test) {
      yield err(
        `tshark: "${filter}" is neither a field nor a protocol name.\n    (This game knows protocol names, ip.addr, ip.src, ip.dst, dns.qry.name, http.host,\n    http.request.method, tls.handshake.extensions_server_name, ==, !=, contains, &&, ||, !.)`,
      );
      return 4;
    }
    const all = framesOf(capture.packets);
    const frames = all.filter(test);
    ctx.emit({ type: 'CaptureRead', file: abs, filter, frames: frames.length });
    if (stats) {
      if (stats !== 'conv,ip' && stats !== 'conv,tcp') {
        yield err(`tshark: Invalid -z argument "${stats}"; this game knows conv,ip and conv,tcp.`);
        return 2;
      }
      yield out(conversations(frames, stats === 'conv,tcp').join('\n'));
      if (quiet) return 0;
    } else if (quiet) return 0;
    const iface = capture.iface ?? 'wlan0';
    const lines: string[] = [];
    for (const f of frames) {
      if (verbose) {
        lines.push(
          `Frame ${f.no}: ${f.len} bytes on wire (${f.len * 8} bits), ${f.len} bytes captured (${f.len * 8} bits) on interface ${iface}, id 0`,
        );
        if (f.proto !== 'ARP') {
          lines.push(`Internet Protocol Version 4, Src: ${f.src}, Dst: ${f.dst}`);
          const udp = f.layers.includes('udp');
          lines.push(
            `${udp ? 'User Datagram Protocol' : 'Transmission Control Protocol'}, Src Port: ${f.sport}, Dst Port: ${f.dport}`,
          );
        }
        lines.push(...f.detail, '');
      } else
        lines.push(
          `${String(f.no).padStart(5)} ${time(f.time)} ${f.src.padStart(15)} → ${f.dst.padEnd(15)} ${f.proto} ${f.len} ${f.info}`,
        );
    }
    if (lines.length) yield out(lines.join('\n'));
    return 0;
  },
};

export const wireCommands: Command[] = [tshark];
