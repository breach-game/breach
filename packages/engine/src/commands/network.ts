import type { Host } from '@breach/pack-schema';
import { resolveName, resolveTarget, type Target } from '../net.ts';
import { rng, style } from '../util.ts';
import { type Chunk, type Command, type CommandCtx, err, getopt, out, type Run, wait } from './types.ts';

/**
 * The scope gate. Every network command calls it before doing anything, so no simulated packet
 * ever leaves for a target outside the mandate.
 */
function* gate(
  ctx: CommandCtx,
  raw: string,
): Generator<Chunk, Exclude<Target, { kind: 'out-of-scope' }> | null> {
  const target = resolveTarget(ctx.world, raw);
  if (target.kind !== 'out-of-scope') return target;
  ctx.emit({ type: 'OutOfScope', target: raw, command: ctx.name });
  yield err(`${ctx.name}: ${ctx.t('engine.outOfScope', { target: raw })}`);
  return null;
}

const visible = (ctx: CommandCtx, host: Host) =>
  host.kind !== 'player' && (!host.hidden || ctx.state.revealed[host.id] === true);

/* ---------- dig ---------- */

const dig: Command = {
  name: 'dig',
  summary: 'cmd.dig',
  explain: 'explain.dig',
  group: 'network',
  async *run(ctx): Run {
    let name = '';
    let rtype = 'A';
    let short = false;
    for (const a of ctx.args) {
      if (a === '+short') short = true;
      else if (a.startsWith('@') || a.startsWith('+') || a.startsWith('-')) continue;
      else if (/^(A|AAAA|MX|NS|TXT|CNAME|ANY|AXFR|SOA)$/i.test(a)) rtype = a.toUpperCase();
      else name = a;
    }
    if (!name) {
      yield err('usage: dig [@server] name [type] [+short]');
      return 1;
    }
    const target = yield* gate(ctx, name);
    if (!target) return 9;
    const fqdn = `${name.toLowerCase().replace(/\.$/, '')}.`;
    const records = ctx.world.dns[fqdn.slice(0, -1)] ?? {};
    const answers: [string, string][] = [];
    if (rtype === 'AXFR') {
      ctx.noise();
      ctx.emit({ type: 'DnsQuery', name, rtype, found: false });
      yield wait(600);
      yield out(
        `\n; <<>> DiG 9.20.4 <<>> ${ctx.args.join(' ')}\n;; global options: +cmd\n; Transfer failed.`,
      );
      return 0;
    }
    for (const [type, values] of Object.entries(records) as [string, string[]][]) {
      if (rtype !== 'ANY' && rtype !== type) continue;
      for (const v of values)
        answers.push([
          type,
          type === 'TXT' ? `"${v}"` : type === 'MX' ? `10 ${v}.` : type === 'A' ? v : `${v}.`,
        ]);
    }
    ctx.noise();
    ctx.emit({ type: 'DnsQuery', name, rtype, found: answers.length > 0 });
    yield wait(250);
    if (short) {
      if (answers.length) yield out(answers.map(([, v]) => v).join('\n'));
      return 0;
    }
    const rand = rng(ctx.state.clock + name.length);
    const id = Math.floor(rand() * 65535);
    const known = fqdn.slice(0, -1) in ctx.world.dns;
    const status = known ? 'NOERROR' : 'NXDOMAIN';
    const text = [
      '',
      `; <<>> DiG 9.20.4 <<>> ${ctx.args.join(' ')}`,
      ';; global options: +cmd',
      ';; Got answer:',
      `;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: ${id}`,
      `;; flags: qr rd ra; QUERY: 1, ANSWER: ${answers.length}, AUTHORITY: 0, ADDITIONAL: 1`,
      '',
      ';; QUESTION SECTION:',
      `;${fqdn}\t\t\tIN\t${rtype}`,
      '',
      ...(answers.length
        ? [';; ANSWER SECTION:', ...answers.map(([type, v]) => `${fqdn}\t\t300\tIN\t${type}\t${v}`), '']
        : []),
      `;; Query time: ${8 + Math.floor(rand() * 20)} msec`,
      `;; SERVER: ${ctx.world.resolver}#53(${ctx.world.resolver}) (UDP)`,
      `;; WHEN: ${ctx.game.date().unix}`,
      `;; MSG SIZE  rcvd: ${44 + answers.length * 16}`,
      '',
    ];
    yield out(text.join('\n'));
    return 0;
  },
};

/* ---------- whois ---------- */

const whois: Command = {
  name: 'whois',
  summary: 'cmd.whois',
  explain: 'explain.whois',
  group: 'network',
  async *run(ctx): Run {
    const domain = ctx.args.find((a) => !a.startsWith('-'));
    if (!domain) {
      yield err('usage: whois DOMAIN');
      return 1;
    }
    const target = yield* gate(ctx, domain);
    if (!target) return 9;
    ctx.emit({ type: 'WhoisQuery', domain });
    yield wait(400);
    const key = Object.keys(ctx.world.whois).find(
      (d) => domain.toLowerCase() === d || domain.toLowerCase().endsWith(`.${d}`),
    );
    yield out(key ? ctx.world.whois[key]! : `No match for domain "${domain.toUpperCase()}".`);
    return key ? 0 : 1;
  },
};

/* ---------- nmap ---------- */

const NMAP_OPTIONS_WITH_VALUE = ['p', 'T', 'o'];

const nmap: Command = {
  name: 'nmap',
  summary: 'cmd.nmap',
  explain: 'explain.nmap',
  group: 'network',
  async *run(ctx): Run {
    const { flags, values, rest } = getopt(
      ctx.args.map((a) => (/^-(sn|sV|sS|sT|sC|Pn|A|O|F|v|vv)$/.test(a) ? `--${a.slice(1)}` : a)),
      NMAP_OPTIONS_WITH_VALUE,
    );
    if (!rest.length) {
      yield out(
        'Nmap 7.95 ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n  -sn: Ping Scan - disable port scan\n  -sV: Probe open ports to determine service/version info\n  -p <port ranges>: Only scan specified ports\n  -T<0-5>: Set timing template (higher is faster)\n  -A: Enable OS detection, version detection',
      );
      return 1;
    }
    const targets: Exclude<Target, { kind: 'out-of-scope' }>[] = [];
    for (const raw of rest) {
      const target = yield* gate(ctx, raw);
      if (!target) return 9;
      targets.push(target);
    }
    const pingOnly = flags.has('sn');
    const versions = flags.has('sV') || flags.has('A');
    const timing = Number(values.T ?? 3);
    const speed = [4, 3, 2, 1, 0.5, 0.3][Math.max(0, Math.min(5, timing))] ?? 1;
    let wanted: Set<number> | null = null;
    if (values.p && values.p !== '-') {
      wanted = new Set();
      for (const part of values.p.split(',')) {
        const [a, b] = part.split('-').map(Number);
        if (!a) continue;
        for (let p = a; p <= Math.min(b ?? a, a + 2000); p++) wanted.add(p);
      }
    }
    ctx.noise();
    ctx.emit({ type: 'Scan', target: rest.join(' '), intensity: timing });
    yield out(`Starting Nmap 7.95 ( https://nmap.org ) at ${ctx.game.date().iso}`);
    yield wait(500 * speed);
    const rand = rng(ctx.state.clock);
    let addresses = 0;
    let up = 0;
    let elapsed = 0.5 * speed;
    for (const target of targets) {
      const hosts = target.kind === 'range' ? target.hosts : target.kind === 'host' ? [target.host] : [];
      addresses += target.kind === 'range' ? target.size : 1;
      if (target.kind === 'unknown') yield err(`Failed to resolve "${target.name}".`);
      for (const host of [...hosts].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }))) {
        if (!visible(ctx, host)) continue;
        up++;
        yield wait(700 * speed);
        elapsed += 0.7 * speed;
        ctx.emit({ type: 'HostDiscovered', host: host.id });
        const latency = (0.004 + rand() * 0.02).toFixed(4);
        const title = style.bold(`Nmap scan report for ${host.hostname} (${host.ip})`);
        yield out(
          `${ctx.tty ? title : `Nmap scan report for ${host.hostname} (${host.ip})`}\nHost is up (${latency}s latency).`,
        );
        if (pingOnly) continue;
        const open = host.services.filter((s) => !wanted || wanted.has(s.port));
        const scanned = wanted ? wanted.size : 1000;
        if (!open.length) {
          yield out(
            `All ${scanned} scanned ports on ${host.hostname} (${host.ip}) are in ignored states.\nNot shown: ${scanned} closed tcp ports (conn-refused)\n`,
          );
          continue;
        }
        if (scanned > open.length)
          yield out(`Not shown: ${scanned - open.length} closed tcp ports (conn-refused)`);
        const portCol = Math.max(...open.map((s) => `${s.port}/${s.proto}`.length), 4);
        const svcCol = Math.max(...open.map((s) => s.name.length), 7);
        yield out(
          `${'PORT'.padEnd(portCol)} STATE SERVICE${versions ? `${' '.repeat(svcCol - 7)} VERSION` : ''}`,
        );
        for (const s of open) {
          yield wait(180 * speed);
          elapsed += 0.18 * speed;
          ctx.emit({ type: 'ServiceDiscovered', host: host.id, port: s.port });
          const state = ctx.tty ? style.green('open ') : 'open ';
          yield out(
            `${`${s.port}/${s.proto}`.padEnd(portCol)} ${state} ${versions ? `${s.name.padEnd(svcCol)} ${s.product ?? ''}`.trimEnd() : s.name}`,
          );
        }
        if (flags.has('A') && host.os) yield out(`OS details: ${host.os}`);
        yield out('');
      }
    }
    if (versions)
      yield out(
        'Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .',
      );
    yield out(
      `Nmap done: ${addresses} IP address${addresses > 1 ? 'es' : ''} (${up} host${up === 1 ? '' : 's'} up) scanned in ${elapsed.toFixed(2)} seconds`,
    );
    return 0;
  },
};

/* ---------- curl ---------- */

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  301: 'Moved Permanently',
  302: 'Found',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};

const curl: Command = {
  name: 'curl',
  summary: 'cmd.curl',
  explain: 'explain.curl',
  group: 'network',
  async *run(ctx): Run {
    const { flags, values, rest } = getopt(ctx.args, ['X', 'd', 'H', 'o', 'A', 'u']);
    const raw = rest[0];
    if (!raw) {
      yield err("curl: try 'curl --help' for more information");
      return 2;
    }
    const m = /^(?:(https?):\/\/)?([^/:?#]+)(?::(\d+))?([^?#]*)/.exec(raw);
    if (!m) {
      yield err('curl: (3) URL rejected: Malformed input to a URL function');
      return 3;
    }
    const scheme = m[1] ?? 'http';
    const hostname = m[2]!;
    const port = Number(m[3] ?? (scheme === 'https' ? 443 : 80));
    const path = m[4] || '/';
    const target = yield* gate(ctx, hostname);
    if (!target) return 9;
    if (target.kind !== 'host') {
      yield err(`curl: (6) Could not resolve host: ${hostname}`);
      return 6;
    }
    const host = target.host;
    ctx.noise();
    yield wait(300);
    if (!host.services.some((s) => s.port === port) || !host.web) {
      yield err(
        `curl: (7) Failed to connect to ${hostname} port ${port} after 12 ms: Could not connect to server`,
      );
      return 7;
    }
    const method = values.X ?? (values.d !== undefined ? 'POST' : flags.has('I') ? 'HEAD' : 'GET');
    const route = host.web[path] ?? host.web[path.replace(/\/$/, '') || '/'];
    const status = route?.status ?? 404;
    ctx.emit({ type: 'HttpRequest', host: host.id, path, method, status });
    const product = host.services.find((s) => s.port === port)?.product ?? 'nginx';
    const body = route
      ? route.bodyKey
        ? ctx.t(route.bodyKey)
        : (route.body ?? '')
      : `<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>${product.split(' ')[0]}</center>\n</body>\n</html>\n`;
    if (flags.has('I') || flags.has('i')) {
      const headers = {
        server: product.replace(' ', '/'),
        date: ctx.game.date().unix,
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(new TextEncoder().encode(body).length),
        ...(route?.headers ?? {}),
      };
      yield out(
        `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ''}\n${Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')}\n`,
      );
      if (flags.has('I')) return 0;
    }
    if (body) yield out(body);
    return 0;
  },
};

/* ---------- ping, ssh ---------- */

const ping: Command = {
  name: 'ping',
  summary: 'cmd.ping',
  explain: 'explain.ping',
  group: 'network',
  async *run(ctx): Run {
    const { rest } = getopt(ctx.args, ['c', 'i', 'W']);
    const name = rest[0];
    if (!name) {
      yield err('ping: usage error: Destination address required');
      return 1;
    }
    const target = yield* gate(ctx, name);
    if (!target) return 9;
    if (target.kind !== 'host' || !visible(ctx, target.host)) {
      yield err(`ping: ${name}: Name or service not known`);
      return 2;
    }
    ctx.noise();
    const { ip, id } = target.host;
    ctx.emit({ type: 'HostDiscovered', host: id });
    const rand = rng(ctx.state.clock);
    yield out(`PING ${name} (${ip}) 56(84) bytes of data.`);
    const times: number[] = [];
    for (let i = 1; i <= 3; i++) {
      yield wait(400);
      const time = 8 + rand() * 14;
      times.push(time);
      yield out(`64 bytes from ${ip}: icmp_seq=${i} ttl=63 time=${time.toFixed(1)} ms`);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    yield out(
      `\n--- ${name} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss, time 2003ms\nrtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)}/2.114 ms`,
    );
    return 0;
  },
};

const ssh: Command = {
  name: 'ssh',
  summary: 'cmd.ssh',
  explain: 'explain.ssh',
  group: 'network',
  async *run(ctx): Run {
    const { rest } = getopt(ctx.args, ['p', 'i', 'l', 'o']);
    const dest = rest[0];
    if (!dest) {
      yield err('usage: ssh [-p port] [user@]hostname');
      return 255;
    }
    const [user, hostname] = dest.includes('@')
      ? (dest.split('@') as [string, string])
      : [ctx.game.user, dest];
    const target = yield* gate(ctx, hostname);
    if (!target) return 9;
    if (target.kind !== 'host') {
      yield err(`ssh: Could not resolve hostname ${hostname}: Name or service not known`);
      return 255;
    }
    ctx.noise();
    yield wait(900);
    if (!target.host.services.some((s) => s.name === 'ssh')) {
      yield err(`ssh: connect to host ${hostname} port 22: Connection refused`);
      return 255;
    }
    yield err(`${user}@${hostname}: Permission denied (publickey).`);
    return 255;
  },
};

export const networkCommands: Command[] = [dig, whois, nmap, curl, ping, ssh];
export { resolveName };
