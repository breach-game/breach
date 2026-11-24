import { style } from '../util.ts';
import { type Command, type CommandCtx, err, out, type Run, wait } from './types.ts';

/**
 * Running the target, and putting an investigation in order: `deploy`, `rollback` and `flag` change
 * the target's settings the way a fix does; `timeline` and `path` are answers judged by id.
 */

const paint = (ctx: CommandCtx, fn: (s: string) => string, s: string) => (ctx.tty ? fn(s) : s);

const deploy: Command = {
  name: 'deploy',
  summary: 'cmd.deploy',
  explain: 'explain.deploy',
  group: 'game',
  async *run(ctx): Run {
    const releases = ctx.game.mission?.releases ?? [];
    if (!releases.length) {
      yield err(ctx.t('deploy.none'));
      return 1;
    }
    const [service, version] = ctx.args;
    if (!service || !version) {
      yield out(ctx.t('deploy.usage'));
      for (const r of releases) {
        const running = ctx.state.deployed[r.service]?.at(-1) ?? r.current;
        yield out(
          `  ${paint(ctx, style.cyan, r.service.padEnd(16))} ${r.versions
            .map((v) => (v.version === running ? paint(ctx, style.green, `${v.version}*`) : v.version))
            .join('  ')}`,
        );
      }
      return service ? 2 : 0;
    }
    yield wait(800);
    const result = ctx.game.deploy(service, version);
    if (typeof result === 'string') {
      yield err(`deploy: ${ctx.t(`deploy.${result}`, { service, version })}`);
      return 1;
    }
    yield out(`${paint(ctx, style.cyan, '✔')} ${service}: ${result.from} → ${result.to}`);
    const impact = ctx.game.mission?.releases
      .find((r) => r.service === service)
      ?.versions.find((v) => v.version === result.to)?.impact;
    if (impact) yield out(paint(ctx, style.yellow, ctx.t('contain.impact', { impact })));
    return 0;
  },
};

const rollback: Command = {
  name: 'rollback',
  summary: 'cmd.rollback',
  explain: 'explain.deploy',
  group: 'game',
  async *run(ctx): Run {
    const [service] = ctx.args;
    if (!service) {
      yield err('usage: rollback <service>');
      return 2;
    }
    yield wait(800);
    const result = ctx.game.deploy(service, null);
    if (typeof result === 'string') {
      yield err(`rollback: ${ctx.t(`deploy.${result}`, { service, version: '' })}`);
      return 1;
    }
    yield out(`${paint(ctx, style.cyan, '↩')} ${service}: ${result.from} → ${result.to}`);
    return 0;
  },
};

const flag: Command = {
  name: 'flag',
  summary: 'cmd.flag',
  explain: 'explain.flag',
  group: 'game',
  async *run(ctx): Run {
    const toggles = ctx.game.mission?.toggles ?? [];
    const [verb = 'list', name, value] = ctx.args;
    if (!toggles.length) {
      yield err(ctx.t('flag.none'));
      return 1;
    }
    if (verb === 'list') {
      for (const t of toggles) yield out(`${t.name.padEnd(32)} ${ctx.state.toggles[t.name] ?? t.value}`);
      return 0;
    }
    if (verb !== 'set' || !name || (value !== 'on' && value !== 'off')) {
      yield err('usage: flag list | flag set <name> on|off');
      return 2;
    }
    if (!ctx.game.setToggle(name, value)) {
      yield err(`flag: ${name}: ${ctx.t('flag.unknown')}`);
      return 1;
    }
    yield out(`${paint(ctx, style.cyan, '✔')} ${name} = ${value}`);
    const impact = toggles.find((t) => t.name === name)?.impact;
    if (impact) yield out(paint(ctx, style.yellow, ctx.t('contain.impact', { impact })));
    return 0;
  },
};

const timeline: Command = {
  name: 'timeline',
  summary: 'cmd.timeline',
  group: 'game',
  async *run(ctx): Run {
    const list = ctx.game.mission?.timelines ?? [];
    const [id, ...order] = ctx.args;
    if (!list.length) {
      yield err(ctx.t('timeline.none'));
      return 1;
    }
    const tl = list.find((t) => t.id === id);
    if (!id || !tl) {
      yield out(ctx.t('timeline.usage'));
      for (const t of list)
        yield out(
          `  ${paint(ctx, style.cyan, t.id.padEnd(16))} ${ctx.t(t.text)}${ctx.state.ordered[t.id] ? ` ${paint(ctx, style.green, '✔')}` : ''}`,
        );
      return id ? 1 : 0;
    }
    if (!order.length) {
      yield out(ctx.t(tl.text));
      for (const e of ctx.game.timelineEvents(tl.id) ?? [])
        yield out(`  ${paint(ctx, style.cyan, e.id.padEnd(14))} ${ctx.t(e.text)}`);
      yield out(paint(ctx, style.dim, ctx.t('timeline.how', { id: tl.id })));
      return 0;
    }
    const known = new Set(tl.events.map((e) => e.id));
    const unknown = order.filter((o) => !known.has(o));
    if (unknown.length) {
      yield err(ctx.t('timeline.unknown', { ids: unknown.join(', ') }));
      return 1;
    }
    const result = ctx.game.orderTimeline(tl.id, order);
    if (!result) {
      yield out(ctx.t('timeline.done'));
      return 0;
    }
    if (result.correct) {
      yield out(paint(ctx, style.green, ctx.t('timeline.right')));
      return 0;
    }
    yield out(
      paint(ctx, style.yellow, ctx.t('timeline.wrong', { placed: result.placed, total: result.total })),
    );
    return 1;
  },
};

const path: Command = {
  name: 'path',
  summary: 'cmd.path',
  group: 'game',
  async *run(ctx): Run {
    const list = ctx.game.mission?.paths ?? [];
    const [id, ...hosts] = ctx.args;
    if (!list.length) {
      yield err(ctx.t('path.none'));
      return 1;
    }
    const p = list.find((x) => x.id === id);
    if (!id || !p || !hosts.length) {
      yield out(ctx.t('path.usage'));
      for (const x of list)
        yield out(
          `  ${paint(ctx, style.cyan, x.id.padEnd(16))} ${ctx.t(x.text)}${ctx.state.traced[x.id] ? ` ${paint(ctx, style.green, '✔')}` : ''}`,
        );
      return id && !p ? 1 : 0;
    }
    const result = ctx.game.tracePath(p.id, hosts);
    if (!result) {
      yield out(ctx.t('path.done'));
      return 0;
    }
    if (result.unknown.length) {
      yield err(ctx.t('path.unknown', { hosts: result.unknown.join(', ') }));
      return 1;
    }
    if (result.correct) {
      yield out(paint(ctx, style.green, ctx.t('path.right')));
      return 0;
    }
    yield out(paint(ctx, style.yellow, ctx.t('path.wrong')));
    return 1;
  },
};

export const opsCommands: Command[] = [deploy, rollback, flag, timeline, path];
