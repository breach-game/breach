import { type Command, err, out } from './types.ts';

const whoami: Command = {
  name: 'whoami',
  summary: 'cmd.whoami',
  group: 'system',
  async *run(ctx) {
    yield out(ctx.game.user);
    return 0;
  },
};

const id: Command = {
  name: 'id',
  summary: 'cmd.id',
  group: 'system',
  async *run(ctx) {
    const u = ctx.game.user;
    yield out(`uid=1000(${u}) gid=1000(${u}) groups=1000(${u}),27(pentest)`);
    return 0;
  },
};

const hostname: Command = {
  name: 'hostname',
  summary: 'cmd.hostname',
  group: 'system',
  async *run(ctx) {
    const h = ctx.game.playerHost;
    yield out(ctx.args.includes('-I') || ctx.args.includes('-i') ? h.ip : h.hostname.split('.')[0]!);
    return 0;
  },
};

const date: Command = {
  name: 'date',
  summary: 'cmd.date',
  group: 'system',
  async *run(ctx) {
    yield out(ctx.game.date().unix);
    return 0;
  },
};

const uname: Command = {
  name: 'uname',
  summary: 'cmd.uname',
  group: 'system',
  async *run(ctx) {
    yield out(ctx.args.includes('-a') ? `Linux ${ctx.game.playerHost.hostname.split('.')[0]} 6.12.0-lr-os #1 SMP x86_64 GNU/Linux` : 'Linux');
    return 0;
  },
};

const clear: Command = {
  name: 'clear',
  summary: 'cmd.clear',
  group: 'system',
  async *run() {
    yield { k: 'clear' };
    return 0;
  },
};

const history: Command = {
  name: 'history',
  summary: 'cmd.history',
  group: 'system',
  async *run(ctx) {
    const h = ctx.state.history;
    if (h.length) yield out(h.map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join('\n'));
    return 0;
  },
};

const sudo: Command = {
  name: 'sudo',
  summary: 'cmd.sudo',
  group: 'system',
  async *run(ctx) {
    yield err(`${ctx.game.user} is not in the sudoers file.\n${ctx.t('engine.sudo')}`);
    return 1;
  },
};

const exit: Command = {
  name: 'exit',
  summary: 'cmd.exit',
  group: 'system',
  async *run(ctx) {
    yield out(ctx.t('engine.exit'));
    return 0;
  },
};

export const systemCommands: Command[] = [whoami, id, hostname, date, uname, clear, history, sudo, exit];
