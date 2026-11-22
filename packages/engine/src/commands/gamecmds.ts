import { sha256, style } from '../util.ts';
import { type Command, type CommandCtx, err, out, type Run, wait } from './types.ts';
import { commands } from './index.ts';

const paint = (ctx: CommandCtx, fn: (s: string) => string, s: string) => (ctx.tty ? fn(s) : s);

const help: Command = {
  name: 'help',
  summary: 'cmd.help',
  group: 'game',
  async *run(ctx) {
    if (ctx.args[0]) return yield* explain.run({ ...ctx, name: 'explain' });
    const groups = ['game', 'files', 'network', 'system'] as const;
    const lines: string[] = [];
    for (const group of groups) {
      lines.push(paint(ctx, style.bold, ctx.t(`help.group.${group}`)));
      for (const c of [...commands.values()].filter((c) => c.group === group).sort((a, b) => a.name.localeCompare(b.name)))
        lines.push(`  ${paint(ctx, style.cyan, c.name.padEnd(9))} ${ctx.t(c.summary)}`);
      lines.push('');
    }
    lines.push(paint(ctx, style.dim, ctx.t('help.footer')));
    yield out(lines.join('\n'));
    return 0;
  },
};

const explain: Command = {
  name: 'explain',
  summary: 'cmd.explain',
  group: 'game',
  async *run(ctx) {
    const name = ctx.args[0];
    if (!name) {
      yield err(ctx.t('explain.usage'));
      return 1;
    }
    const command = commands.get(name);
    if (!command) {
      yield err(ctx.t('explain.unknown', { name }));
      return 1;
    }
    yield out(`${paint(ctx, style.bold, name)}  ${ctx.t(command.summary)}`);
    if (command.explain) {
      const [use, defense] = ctx.t(command.explain).split('\n---\n');
      yield out(`\n${use}`);
      if (defense) yield out(`\n${paint(ctx, style.cyan, ctx.t('explain.defense'))}\n${defense}`);
    }
    return 0;
  },
};

const mission: Command = {
  name: 'mission',
  summary: 'cmd.mission',
  group: 'game',
  async *run(ctx) {
    const m = ctx.game.mission;
    const pack = ctx.state.mission ? ctx.game.missions.get(ctx.state.mission) : undefined;
    if (!m || !pack) {
      yield out(ctx.t('mission.none'));
      return 0;
    }
    const title = pack.title[ctx.state.locale] ?? pack.title.fr ?? pack.title.en ?? pack.id;
    const lines = [paint(ctx, style.bold, `${ctx.t('mission.label')} ${String(m.order).padStart(2, '0')} / ${title}`), '', ctx.t(m.briefing), ''];
    for (const o of m.objectives) {
      const done = ctx.state.objectives[o.id];
      const mark = done ? paint(ctx, style.green, '[x]') : '[ ]';
      lines.push(`  ${mark} ${ctx.t(o.text)}${o.optional ? ` ${paint(ctx, style.dim, ctx.t('mission.optional'))}` : ''}`);
    }
    yield out(lines.join('\n'));
    return 0;
  },
};

const hint: Command = {
  name: 'hint',
  summary: 'cmd.hint',
  group: 'game',
  async *run(ctx) {
    const m = ctx.game.mission;
    const next = m?.objectives.find((o) => !ctx.state.objectives[o.id] && m.hints[o.id]);
    if (!m || !next || ctx.state.missionDone) {
      yield out(ctx.t('hint.none'));
      return 0;
    }
    const hints = m.hints[next.id]!;
    const level = Math.min((ctx.state.hints[next.id] ?? 0) + 1, hints.length);
    if (level > (ctx.state.hints[next.id] ?? 0)) ctx.emit({ type: 'HintUsed', objective: next.id, level });
    yield out(`${paint(ctx, style.magenta, `Ada (${level}/${hints.length})`)} ${ctx.t(hints[level - 1]!)}`);
    return 0;
  },
};

const notes: Command = {
  name: 'notes',
  summary: 'cmd.notes',
  group: 'game',
  async *run(ctx) {
    const [sub, ...rest] = ctx.args;
    if (sub === 'add' || (sub && sub !== 'list')) {
      const text = (sub === 'add' ? rest : ctx.args).join(' ').trim();
      if (!text) {
        yield err(ctx.t('notes.usage'));
        return 1;
      }
      ctx.emit({ type: 'NoteAdded', text: text.slice(0, 400) });
      yield out(ctx.t('notes.added'));
      return 0;
    }
    if (!ctx.state.notes.length) yield out(ctx.t('notes.empty'));
    else yield out(ctx.state.notes.map((n, i) => `${String(i + 1).padStart(2)}. ${n}`).join('\n'));
    return 0;
  },
};

const submit: Command = {
  name: 'submit',
  summary: 'cmd.submit',
  group: 'game',
  async *run(ctx): Run {
    const value = ctx.args.join(' ').trim();
    const m = ctx.game.mission;
    if (!value || !m) {
      yield err(ctx.t('submit.usage'));
      return 1;
    }
    // The judge is deterministic: a hash comparison, never a model's opinion.
    const digest = await sha256(value);
    yield wait(350);
    const flag = m.flags.find((f) => f.sha256 === digest);
    if (!flag) {
      ctx.emit({ type: 'FlagSubmitted', flag: null, correct: false });
      yield err(ctx.t('submit.wrong'));
      return 1;
    }
    if (ctx.state.flags[flag.id]) {
      yield out(ctx.t('submit.already'));
      return 0;
    }
    ctx.emit({ type: 'FlagSubmitted', flag: flag.id, correct: true });
    yield out(`${paint(ctx, style.green, ctx.t('submit.ok'))} +${flag.points}`);
    if (flag.objective) ctx.game.completeObjective(flag.objective);
    return 0;
  },
};

export const gameCommands: Command[] = [help, explain, { ...explain, name: 'man', summary: 'cmd.man' }, mission, hint, notes, submit];
