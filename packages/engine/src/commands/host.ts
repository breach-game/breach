import type { SystemView } from '../game.ts';
import { type Command, type CommandCtx, err, getopt, out, type Run } from './types.ts';

/**
 * What a host runs: processes, sockets, services, the service journal and past logins. The host
 * is the one the terminal runs on (the workstation, or a host reached by SSH), and its state is
 * data from the pack, which an attacker's step or a containment can change. Read only: on a machine
 * under investigation, a process is stopped by a containment order, not by hand.
 */

const shortHost = (ctx: CommandCtx) => ctx.game.currentHost.hostname.split('.')[0] ?? 'host';
const nameOf = (cmd: string) =>
  (cmd.split(/\s+/)[0] ?? cmd)
    .replace(/^\[|\]$/g, '')
    .split('/')
    .pop() ?? cmd;
const num = (seed: number, mod: number, base: number) => base + (((seed * 2654435761) >>> 0) % mod);

function read(ctx: CommandCtx, what: 'ps' | 'ss' | 'systemctl' | 'journalctl' | 'last', unit?: string) {
  ctx.emit({ type: 'SystemRead', host: ctx.state.host, what, ...(unit ? { unit } : {}) });
  return ctx.game.systemOf(ctx.state.host);
}

/** The shell the player types in, so that `ps` on a bare host still shows something true. */
function withShell(ctx: CommandCtx, sys: SystemView): SystemView['processes'] {
  const user = ctx.game.currentUser;
  // Pids the pack does not use, so that the player's shell never hides a declared process.
  const used = new Set(sys.processes.map((p) => p.pid));
  let shell = 4242;
  while (used.has(shell) || used.has(shell + 77)) shell += 1000;
  const own = [
    { pid: shell, ppid: shell - 1, user, start: '09:00', cpu: 0, mem: 0.1, cmd: '-bash' },
    {
      pid: shell + 77,
      ppid: shell,
      user,
      start: '09:00',
      cpu: 0,
      mem: 0.1,
      cmd: `ps ${ctx.args.join(' ')}`.trim(),
    },
  ];
  const init = sys.processes.some((p) => p.pid === 1)
    ? []
    : [{ pid: 1, ppid: 0, user: 'root', start: '08:00', cpu: 0, mem: 0.3, cmd: '/sbin/init' }];
  return [...init, ...sys.processes, ...own].sort((a, b) => a.pid - b.pid);
}

const ps: Command = {
  name: 'ps',
  summary: 'cmd.ps',
  explain: 'explain.ps',
  group: 'system',
  async *run(ctx): Run {
    const sys = read(ctx, 'ps');
    const all = withShell(ctx, sys);
    const raw = ctx.args.join(' ');
    const { values } = getopt(
      ctx.args.filter((a) => !/^aux/.test(a)),
      ['p', 'u'],
    );
    let list = all;
    if (values.p) {
      const pids = values.p.split(',').map(Number);
      list = list.filter((p) => pids.includes(p.pid));
    }
    if (values.u) list = list.filter((p) => p.user === values.u);
    if (/\baux/.test(raw)) {
      yield out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
      for (const p of list) {
        const vsz = num(p.pid, 400_000, 8_000);
        const rss = num(p.pid + 7, 90_000, 2_000);
        const tty = p.cmd === '-bash' || p.cmd.startsWith('ps') ? 'pts/0' : '?';
        yield out(
          `${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(vsz).padStart(6)} ${String(rss).padStart(5)} ${tty.padEnd(8)} ${tty === '?' ? 'Ss  ' : 'R+  '} ${p.start.padEnd(5)}   0:00 ${p.cmd}`,
        );
      }
      return 0;
    }
    if (/(^|\s)-[a-zA-Z]*[ef]/.test(raw) || values.p || values.u) {
      yield out('UID          PID    PPID  C STIME TTY          TIME CMD');
      for (const p of list) {
        const tty = p.cmd === '-bash' || p.cmd.startsWith('ps') ? 'pts/0' : '?';
        yield out(
          `${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  ${Math.round(p.cpu)} ${p.start.padEnd(5)} ${tty.padEnd(8)}     00:00:00 ${p.cmd}`,
        );
      }
      return 0;
    }
    // Plain `ps`: only the processes of this terminal.
    yield out('    PID TTY          TIME CMD');
    for (const p of all.slice(-2))
      yield out(`${String(p.pid).padStart(7)} pts/0    00:00:00 ${nameOf(p.cmd)}`);
    return 0;
  },
};

const ss: Command = {
  name: 'ss',
  summary: 'cmd.ss',
  explain: 'explain.ss',
  group: 'system',
  async *run(ctx): Run {
    const { flags } = getopt(ctx.args);
    const sys = read(ctx, 'ss');
    const procs = new Map(sys.processes.map((p) => [p.pid, p]));
    const tcp = flags.has('t') || !flags.has('u');
    const udp = flags.has('u') || !flags.has('t');
    const listening = (s: { state: string }) => s.state === 'LISTEN' || s.state === 'UNCONN';
    const rows = sys.sockets.filter(
      (s) =>
        ((s.proto === 'tcp' && tcp) || (s.proto === 'udp' && udp)) &&
        (flags.has('a') || (flags.has('l') ? listening(s) : !listening(s))),
    );
    const head = `${'Netid'.padEnd(6)}${'State'.padEnd(11)}Recv-Q Send-Q ${'Local Address:Port'.padStart(24)} ${'Peer Address:Port'.padEnd(24)}`;
    yield out(flags.has('p') ? `${head}Process` : head.trimEnd());
    for (const s of rows) {
      const p = s.pid !== undefined ? procs.get(s.pid) : undefined;
      const proc =
        flags.has('p') && s.pid !== undefined
          ? `users:(("${p ? nameOf(p.cmd) : 'unknown'}",pid=${s.pid},fd=${num(s.pid, 20, 3)}))`
          : '';
      const line = `${s.proto.padEnd(6)}${s.state.padEnd(11)}${'0'.padEnd(7)}${(s.state === 'LISTEN' ? '128' : '0').padEnd(6)} ${s.local.padStart(24)} ${s.peer.padEnd(24)}${proc}`;
      yield out(line.trimEnd());
    }
    return 0;
  },
};

const READ_ONLY = new Set([
  'start',
  'stop',
  'restart',
  'reload',
  'kill',
  'enable',
  'disable',
  'mask',
  'unmask',
]);

const systemctl: Command = {
  name: 'systemctl',
  summary: 'cmd.systemctl',
  explain: 'explain.systemctl',
  group: 'system',
  async *run(ctx): Run {
    const args = ctx.args.filter((a) => !a.startsWith('--no-pager') && a !== '-l' && a !== '--full');
    const [verb = 'list-units', ...rest] = args;
    if (READ_ONLY.has(verb)) {
      yield err(ctx.t('host.readonly', { command: `systemctl ${verb}` }));
      return 1;
    }
    const unitName = (rest.find((a) => !a.startsWith('-')) ?? '').replace(/\.service$/, '');
    const sys = read(ctx, 'systemctl', unitName || undefined);
    const host = shortHost(ctx);
    if (verb === 'list-units' || verb === 'list-unit-files') {
      const only = (rest.find((a) => a.startsWith('--state=')) ?? '').slice(8);
      const shown = sys.services.filter(
        (u) => !only || only === u.state || (only === 'running' && u.state === 'active'),
      );
      yield out(`  ${'UNIT'.padEnd(34)} LOAD   ACTIVE   SUB     DESCRIPTION`);
      for (const u of shown) {
        const sub = u.state === 'active' ? 'running' : u.state === 'failed' ? 'failed ' : 'dead   ';
        const dot = u.state === 'failed' ? '●' : ' ';
        yield out(
          `${dot} ${`${u.name}.service`.padEnd(34)} loaded ${u.state.padEnd(8)} ${sub} ${u.description}`,
        );
      }
      yield out(`\n${shown.length} loaded units listed.`);
      return 0;
    }
    if (verb === 'is-active') {
      const u = sys.services.find((x) => x.name === unitName);
      yield out(u ? u.state : 'inactive');
      return u?.state === 'active' ? 0 : 3;
    }
    if (verb !== 'status' || !unitName) {
      yield err(
        'usage: systemctl status <unit> | systemctl list-units [--state=failed] | systemctl is-active <unit>',
      );
      return 1;
    }
    const u = sys.services.find((x) => x.name === unitName);
    if (!u) {
      yield err(`Unit ${unitName}.service could not be found.`);
      return 4;
    }
    const since = u.since ? ` since ${u.since}` : '';
    const active =
      u.state === 'active'
        ? `active (running)${since}`
        : u.state === 'failed'
          ? `failed (Result: exit-code)${since}`
          : `inactive (dead)${since}`;
    const lines = [
      `${u.state === 'active' ? '●' : u.state === 'failed' ? '×' : '○'} ${u.name}.service - ${u.description}`,
      `     Loaded: loaded (${u.unit ?? `/etc/systemd/system/${u.name}.service`}; ${u.enabled ? 'enabled' : 'disabled'}; preset: enabled)`,
      `     Active: ${active}`,
    ];
    if (u.state === 'active' && u.pid !== undefined) {
      const proc = sys.processes.find((p) => p.pid === u.pid);
      const cmd = proc?.cmd ?? u.exec ?? u.name;
      lines.push(
        `   Main PID: ${u.pid} (${nameOf(cmd)})`,
        '      Tasks: 1',
        `     CGroup: /system.slice/${u.name}.service`,
        `             └─${u.pid} ${cmd}`,
      );
    } else if (u.exec)
      lines.push(`    Process: ${u.pid ?? num(u.name.length, 900, 100)} ExecStart=${u.exec} (code=exited)`);
    const journal = sys.journal.filter((j) => j.unit === u.name).slice(-10);
    if (journal.length) {
      lines.push('');
      for (const j of journal) lines.push(`${j.at} ${host} ${j.unit}[${j.pid ?? u.pid ?? 1}]: ${j.text}`);
    }
    yield out(lines.join('\n'));
    return u.state === 'active' ? 0 : 3;
  },
};

const journalctl: Command = {
  name: 'journalctl',
  summary: 'cmd.journalctl',
  explain: 'explain.journalctl',
  group: 'system',
  async *run(ctx): Run {
    const { flags, values } = getopt(ctx.args, ['u', 'n', 'g', 'grep', 'unit', 'lines', 'since']);
    const unit = (values.u ?? values.unit ?? '').replace(/\.service$/, '');
    const sys = read(ctx, 'journalctl', unit || undefined);
    const host = shortHost(ctx);
    const needle = (values.g ?? values.grep ?? '').toLowerCase();
    let rows = sys.journal.filter(
      (j) => (!unit || j.unit === unit) && (!needle || j.text.toLowerCase().includes(needle)),
    );
    const n = Number(values.n ?? values.lines ?? Number.NaN);
    if (Number.isInteger(n) && n >= 0) rows = rows.slice(Math.max(0, rows.length - n));
    if (flags.has('r') || flags.has('reverse')) rows = [...rows].reverse();
    if (!rows.length) {
      yield out('-- No entries --');
      return 0;
    }
    const pid = (name: string) => sys.services.find((s) => s.name === name)?.pid;
    for (const j of rows) yield out(`${j.at} ${host} ${j.unit}[${j.pid ?? pid(j.unit) ?? 1}]: ${j.text}`);
    return 0;
  },
};

const last: Command = {
  name: 'last',
  summary: 'cmd.last',
  explain: 'explain.last',
  group: 'system',
  async *run(ctx): Run {
    const { values, rest } = getopt(ctx.args, ['n']);
    const sys = read(ctx, 'last');
    let rows = sys.logins.filter((l) => !rest.length || rest.includes(l.user));
    const n = Number(values.n ?? Number.NaN);
    if (Number.isInteger(n) && n >= 0) rows = rows.slice(0, n);
    for (const l of rows) {
      const until = l.until === 'still logged in' ? '  still logged in' : ` - ${l.until}`;
      yield out(
        `${l.user.slice(0, 8).padEnd(8)} ${l.tty.padEnd(12)} ${l.from.slice(0, 16).padEnd(16)} ${l.at}${until}`,
      );
    }
    yield out(`\nwtmp begins ${sys.logins.at(-1)?.at ?? ctx.game.date().unix.slice(0, 16)}`);
    return 0;
  },
};

export const hostCommands: Command[] = [ps, ss, systemctl, journalctl, last];
