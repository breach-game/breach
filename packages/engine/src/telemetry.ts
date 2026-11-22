import type { Detection, LogFields, LogSource, Pack, Where, World } from '@breach/pack-schema';
import type { GameEvent } from './events.ts';
import { matches } from './rules.ts';
import { rng } from './util.ts';

/**
 * Telemetry: what the target's logs record. Every line is derived from the event log, so the
 * player's actions, the scripted attacker's and the target's ordinary activity all go through the
 * same formats. Nothing here is written by hand in a pack, except the background's fields.
 */

export type Actor = 'player' | 'adversary' | 'background';

export interface LogLine {
  /** Stable id: `p<seq>` for the player, `a<seq>` for the attacker, `b<n>.<k>` for the background. */
  id: string;
  /** Game time, in ms since the world's start. */
  t: number;
  /** Host whose log holds the line (`ids` for the network sensor). */
  host: string;
  /** Hostname, as shown in the console. */
  hostname: string;
  source: LogSource;
  actor: Actor;
  /** The event behind it, for the player's and the attacker's lines. */
  seq?: number;
  fields: Record<string, string | number | boolean | string[]>;
  /** The line as the real tool writes it. */
  text: string;
}

/** Log file each source writes to, for the console and the `soc` command. */
export const LOG_FILES: Record<LogSource, string> = {
  access: '/var/log/nginx/access.log',
  auth: '/var/log/auth.log',
  chat: '/var/log/chat-gateway/conversations.log',
  agent: '/var/log/agent/tool-audit.log',
  dns: '/var/log/named/query.log',
  ids: '/var/log/suricata/fast.log',
  audit: '/var/log/audit/audit.log',
  git: '/var/log/gitea/gitea.log',
  db: '/var/log/postgresql/audit.log',
  flow: '/var/log/firewall/flows.log',
};

/* ---------- time formats ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

interface Stamp {
  clf: string;
  syslog: string;
  iso: string;
  gitea: string;
  time: string;
  epoch: number;
}

export function stamp(startTime: string, t: number): Stamp {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(startTime);
  const offset = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const utc = Date.parse(startTime) + t;
  const d = new Date(utc + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const off = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    clf: `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${hms} ${off}`,
    syslog: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${hms}`,
    iso: `${date}T${hms}${off.slice(0, 3)}:${off.slice(3)}`,
    gitea: `${date.replaceAll('-', '/')} ${hms}`,
    time: hms,
    epoch: Math.floor(utc / 1000),
  };
}

/* ---------- formats ---------- */

const str = (v: unknown, fallback = '-') =>
  v === undefined || v === null || v === '' ? fallback : Array.isArray(v) ? v.join(',') : String(v);
/** A small, stable number from a text: process ids, ports, sizes. */
function hashNum(text: string, mod: number, base = 0): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return base + ((h >>> 0) % mod);
}
const quote = (v: unknown) => JSON.stringify(str(v, ''));

/** Write one line in the format of the real tool. */
export function formatLine(
  source: LogSource,
  hostname: string,
  t: Stamp,
  f: LogLine['fields'],
  key: string,
): string {
  const short = hostname.split('.')[0] ?? hostname;
  switch (source) {
    case 'access':
      return `${str(f.src)} - - [${t.clf}] "${str(f.method, 'GET')} ${str(f.path, '/')} HTTP/1.1" ${str(f.status, '200')} ${str(f.bytes, String(hashNum(key, 9000, 600)))} "-" "${str(f.ua, 'Mozilla/5.0')}"`;
    case 'auth': {
      const pid = hashNum(key, 8000, 1200);
      const port = hashNum(`${key}p`, 20000, 40000);
      const result = str(f.result, 'Accepted');
      const method = str(f.method, 'publickey');
      return result === 'Failed'
        ? `${t.syslog} ${short} sshd[${pid}]: Failed ${method} for ${str(f.user)} from ${str(f.src)} port ${port} ssh2`
        : `${t.syslog} ${short} sshd[${pid}]: Accepted ${method} for ${str(f.user)} from ${str(f.src)} port ${port} ssh2`;
    }
    case 'chat':
      return `${t.iso} ${short} chat-gateway: bot=${str(f.npc)} src=${str(f.src)} intent=${str(f.intent)} flags=${str(f.families, 'none')} msg=${quote(f.msg)}`;
    case 'agent':
      return `${t.iso} ${short} agent=${str(f.agent)} tool=${str(f.tool)} args=${quote(f.args)} role=${str(f.role, 'user')} confirmed=${str(f.confirmed, 'no')} requested_by=${str(f.src)}`;
    case 'dns':
      return `${t.syslog} ${short} named[${hashNum(short, 900, 300)}]: client ${str(f.src)}#${hashNum(key, 20000, 40000)}: query: ${str(f.name)} IN ${str(f.rtype, 'A')} +`;
    case 'ids':
      return `${t.clf.replace(/ [+-]\d{4}$/, '')}  [**] [1:${str(f.sid, '2010937')}:3] ${str(f.signature, 'ET SCAN Possible Nmap Scan')} [**] [Priority: ${str(f.priority, '2')}] {TCP} ${str(f.src)} -> ${str(f.dst)}`;
    case 'audit':
      return `type=EXECVE msg=audit(${t.epoch}.${pad(hashNum(key, 999), 3)}:${hashNum(key, 90000, 1000)}): host=${short} uid=${str(f.user)} exe=${quote(f.exe)} cmdline=${quote(f.cmd)}`;
    case 'git':
      return `${t.gitea} ...${str(f.where, 'routers/web/repo/http.go:118')} [I] ${str(f.user, 'anonymous')} ${str(f.action, 'clone')} ${str(f.repo)} from ${str(f.src)}`;
    case 'db':
      return `${t.iso} ${short} postgres[${hashNum(short, 9000, 1000)}]: AUDIT: user=${str(f.user)} db=${str(f.db, 'novamind')} src=${str(f.src)} statement=${quote(f.query)} rows=${str(f.rows, '0')}`;
    case 'flow':
      return `${t.iso} fw01 flow: ${str(f.action, 'allow')} proto=tcp src=${str(f.src)} dst=${str(f.dst)} dport=${str(f.dport)} bytes=${str(f.bytes, '0')}`;
  }
}

/* ---------- from events to lines ---------- */

export interface TelemetryOptions {
  /** First event to read (inclusive). Defaults to the start of the current mission. */
  from: number;
  /** Last event to read (inclusive). */
  to?: number;
  /** Add the target's ordinary activity over the same time span. */
  background?: boolean;
  /** Live logs (defence missions): the background stops at this time, and starts 40 minutes before. */
  until?: number;
}

/** The pieces of a game that telemetry reads, so a test can pass a plain log. */
export interface TelemetrySource {
  world: World;
  log: GameEvent[];
  mission: Pack['mission'] | null;
}

const UA_CURL = 'curl/8.5.0';
/** The game's own commands leave no trace on a target: they run in the player's head. */
const GAME_COMMANDS = new Set([
  'submit',
  'hint',
  'notes',
  'mission',
  'explain',
  'man',
  'help',
  'soc',
  'contain',
  'answer',
  'report',
  'clear',
  'history',
]);

/** Where a character answers: the host and its hostname. */
function chatHost(world: World, npc: string): { id: string; hostname: string } | null {
  for (const host of world.hosts)
    for (const route of Object.values(host.web ?? {}))
      if (route.chat === npc) return { id: host.id, hostname: host.hostname };
  return null;
}

/** Hostname of a log's host: a world host, the resolver (`dns`) or the network sensor (`ids`). */
function nameOf(world: World, id: string): string {
  const host = world.hosts.find((h) => h.id === id);
  if (host) return host.hostname;
  if (id === 'fw') return `fw01.${world.scope.domains[0]?.replace(/^\*\./, '') ?? 'test'}`;
  if (id === 'dns') return `ns1.${world.scope.domains[0]?.replace(/^\*\./, '') ?? 'test'}`;
  return id;
}

/** The host that answers DNS queries: the one at the resolver's address, or the resolver itself. */
function resolverHost(world: World): string {
  return world.hosts.find((h) => h.ip === world.resolver)?.id ?? 'dns';
}

export function telemetry(game: TelemetrySource, options: TelemetryOptions): LogLine[] {
  const { world } = game;
  const hosts = new Map(world.hosts.map((h) => [h.id, h]));
  const player = world.player.host;
  const lines: LogLine[] = [];
  const start = game.log.findIndex((e) => e.seq >= options.from);
  if (start < 0) return lines;
  // Where the terminal ran at each event: the source address of what it sent.
  const stack: { host: string; user: string }[] = [];
  let current = { host: player, user: world.player.user };
  // Rebuild the session stack up to the first event read.
  for (const e of game.log.slice(0, start)) track(e);
  function track(e: GameEvent) {
    if (e.type === 'MissionStarted') {
      stack.length = 0;
      current = { host: player, user: world.player.user };
    } else if (e.type === 'SessionOpened') {
      stack.push(current);
      current = { host: e.host, user: e.user };
    } else if (e.type === 'SessionClosed') current = stack.pop() ?? { host: player, user: world.player.user };
  }
  const ipOf = (id: string) => hosts.get(id)?.ip ?? id;
  const push = (e: GameEvent, actor: Actor, host: string, source: LogSource, fields: LogLine['fields']) => {
    const hostname = nameOf(world, host);
    const id = `${actor === 'adversary' ? 'a' : 'p'}${e.seq}`;
    const s = stamp(world.startTime, e.t);
    lines.push({
      id,
      t: e.t,
      host,
      hostname,
      source,
      actor,
      seq: e.seq,
      fields,
      text: formatLine(source, hostname, s, fields, id),
    });
  };
  const lastSent: Record<string, string> = {};
  const end = options.to ?? Number.POSITIVE_INFINITY;
  let firstT = Number.POSITIVE_INFINITY;
  let lastT = 0;
  for (const e of game.log.slice(start)) {
    if (e.seq > end) break;
    firstT = Math.min(firstT, e.t);
    lastT = Math.max(lastT, e.t);
    const src = ipOf(current.host);
    switch (e.type) {
      case 'HttpRequest':
        // A machine outside the target: only the target's firewall sees the connection leave.
        if (hosts.get(e.host)?.kind === 'unknown') {
          push(e, 'player', 'fw', 'flow', {
            src,
            dst: ipOf(e.host),
            dport: e.path ? (hosts.get(e.host)?.services[0]?.port ?? 443) : 443,
            bytes: e.bytes ?? 0,
            action: 'allow',
          });
          break;
        }
        push(e, 'player', e.host, 'access', {
          src,
          method: e.method,
          path: e.path,
          status: e.status,
          ua: e.ua ?? UA_CURL,
          ...(e.bytes !== undefined ? { bytes: e.bytes } : {}),
        });
        break;
      case 'ChatSent':
        lastSent[e.npc] = e.text;
        break;
      case 'ChatReply': {
        const at = chatHost(world, e.npc);
        if (!at) break;
        push(e, 'player', at.id, 'chat', {
          src,
          npc: e.npc,
          intent: e.intent,
          families: e.families.length ? e.families : ['none'],
          msg: (lastSent[e.npc] ?? '').slice(0, 160),
        });
        break;
      }
      case 'ToolCall': {
        const at = chatHost(world, e.agent);
        push(e, 'player', at?.id ?? e.agent, 'agent', {
          src,
          agent: e.agent,
          tool: e.tool,
          args: e.args,
          role: e.admin ? 'admin' : 'user',
          confirmed: 'no',
        });
        break;
      }
      case 'SessionOpened':
        push(e, 'player', e.host, 'auth', { src, user: e.user, result: 'Accepted', method: 'publickey' });
        break;
      case 'DnsQuery': {
        if (e.found !== undefined)
          push(e, 'player', resolverHost(world), 'dns', { src, name: e.name, rtype: e.rtype });
        break;
      }
      case 'Scan':
        push(e, 'player', 'ids', 'ids', {
          src,
          dst: e.target.split(' ').find((w) => /\d+\.\d+\.\d+\.\d+/.test(w)) ?? e.target,
          signature: e.intensity >= 4 ? 'ET SCAN Aggressive Nmap Scan' : 'ET SCAN Possible Nmap Scan',
          sid: e.intensity >= 4 ? 2009582 : 2010937,
          priority: e.intensity >= 4 ? 1 : 2,
        });
        break;
      case 'RepoCloned':
        push(e, 'player', e.host, 'git', { src, user: 'anonymous', action: 'clone', repo: e.repo });
        break;
      case 'CommandRun':
        // On someone else's machine, every command is audited.
        if (current.host !== player && e.command && !GAME_COMMANDS.has(e.command))
          push(e, 'player', current.host, 'audit', {
            user: current.user,
            exe: `/usr/bin/${e.command}`,
            cmd: [e.command, ...e.args].join(' ').slice(0, 160),
          });
        break;
      case 'AdversaryStep': {
        if (e.blocked) break;
        const step = game.mission?.adversary?.steps.find((s) => s.id === e.step);
        if (!step) break;
        const from = game.mission?.adversary?.from ?? '';
        push(e, 'adversary', step.host, step.source, { src: ipOf(from), ...step.fields });
        break;
      }
      default:
        break;
    }
    track(e);
  }
  if (options.background && options.until !== undefined) {
    const to = options.until;
    lines.push(...backgroundLines(world, to - 40 * 60_000, to, game.mission?.background ?? []));
  } else if (options.background && Number.isFinite(firstT)) {
    // At least half an hour of ordinary activity around the player's own.
    const from = Math.max(0, firstT - 10 * 60_000);
    const to = Math.max(lastT + 5 * 60_000, from + 30 * 60_000);
    lines.push(...backgroundLines(world, from, to, game.mission?.background ?? []));
  }
  return lines.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/** The target's ordinary activity between two times. The same for every player. */
export function backgroundLines(
  world: World,
  from: number,
  to: number,
  extra: World['telemetry']['background'] = [],
): LogLine[] {
  const out: LogLine[] = [];
  [...world.telemetry.background, ...extra].forEach((b, n) => {
    const every = b.every * 60_000;
    const first = Math.ceil((from - b.offset * 60_000) / every);
    for (let k = first; b.offset * 60_000 + k * every <= to; k++) {
      const random = rng(n * 7919 + k * 104729 + 17);
      const jitter = Math.floor((random() - 0.5) * every * 0.6);
      const t = b.offset * 60_000 + k * every + jitter;
      if (t < from || t > to) continue;
      const hostname = nameOf(world, b.host);
      const id = `b${n}.${k}`;
      const fields = b.fields as LogFields as LogLine['fields'];
      out.push({
        id,
        t,
        host: b.host,
        hostname,
        source: b.source,
        actor: 'background',
        fields,
        text: formatLine(b.source, hostname, stamp(world.startTime, t), fields, id),
      });
    }
  });
  return out;
}

/** True when a line is selected by a `where` clause: every field named must match. */
export function selects(line: LogLine, source: LogSource, where: Where): boolean {
  if (line.source !== source) return false;
  return Object.entries(where).every(([name, matcher]) => matches(matcher, line.fields[name]));
}

export interface DetectionResult {
  /** Lines that would have raised an alert. */
  alerts: LogLine[];
  /** Of those, the player's or the attacker's: what the rule was for. */
  caught: number;
  /** Of those, the target's ordinary activity: false positives. */
  falsePositives: number;
  /** Lines of the attack it did not catch, among the source it reads. */
  missed: number;
}

/**
 * Run a detection rule over log lines, deterministically. With a threshold, a line raises an
 * alert when `gte` matching lines from the same source address fall within `within` minutes.
 */
export function runDetection(
  rule: Pick<Detection, 'source' | 'where' | 'count'>,
  lines: LogLine[],
): DetectionResult {
  const matching = lines.filter((l) => selects(l, rule.source, rule.where));
  let alerts = matching;
  if (rule.count) {
    const { gte, within } = rule.count;
    const window = within * 60_000;
    const hit = new Set<LogLine>();
    const bySrc = new Map<string, LogLine[]>();
    for (const l of matching) {
      const key = String(l.fields.src ?? '');
      bySrc.set(key, [...(bySrc.get(key) ?? []), l]);
    }
    for (const group of bySrc.values()) {
      for (let i = 0; i < group.length; i++) {
        let j = i;
        while (j + 1 < group.length && group[j + 1]!.t - group[i]!.t <= window) j++;
        if (j - i + 1 >= gte) for (let k = i; k <= j; k++) hit.add(group[k]!);
      }
    }
    alerts = matching.filter((l) => hit.has(l));
  }
  const attack = (l: LogLine) => l.actor !== 'background';
  const caught = alerts.filter(attack).length;
  const missed = lines.filter((l) => attack(l) && l.source === rule.source && !alerts.includes(l)).length;
  return { alerts, caught, falsePositives: alerts.length - caught, missed };
}

const PRODUCTS: Record<LogSource, string> = {
  access: 'product: nginx',
  auth: 'product: linux\n  service: sshd',
  chat: 'product: chat-gateway',
  agent: 'product: agent\n  service: tool-audit',
  dns: 'product: bind',
  ids: 'product: suricata',
  audit: 'product: linux\n  service: auditd',
  git: 'product: gitea',
  db: 'product: postgresql',
  flow: 'product: firewall',
};

/** A detection rule written the way Sigma writes it, simplified. Shown to the player as is. */
export function sigmaText(rule: Pick<Detection, 'id' | 'source' | 'where' | 'count'>, title: string): string {
  const field = (name: string, m: Where[string]): string => {
    if (typeof m !== 'object') return `    ${name}: ${JSON.stringify(m)}`;
    if ('contains' in m) return `    ${name}|contains: ${JSON.stringify(m.contains)}`;
    if ('in' in m) return `    ${name}:\n${m.in.map((v) => `      - ${JSON.stringify(v)}`).join('\n')}`;
    if ('gte' in m) return `    ${name}|gte: ${m.gte}`;
    const glob = m.glob;
    if (/^[^*?]*\*$/.test(glob)) return `    ${name}|startswith: ${JSON.stringify(glob.slice(0, -1))}`;
    if (/^\*[^*?]*$/.test(glob)) return `    ${name}|endswith: ${JSON.stringify(glob.slice(1))}`;
    return `    ${name}|glob: ${JSON.stringify(glob)}`;
  };
  const selection = Object.entries(rule.where);
  const lines = [
    `title: ${title}`,
    `id: breach-${rule.id}`,
    'logsource:',
    `  ${PRODUCTS[rule.source]}`,
    'detection:',
    selection.length
      ? `  selection:\n${selection.map(([k, m]) => field(k, m)).join('\n')}`
      : '  selection: {}',
    rule.count ? `  condition: selection | count() by src >= ${rule.count.gte}` : '  condition: selection',
  ];
  if (rule.count) lines.push(`timeframe: ${rule.count.within}m`);
  return lines.join('\n');
}
