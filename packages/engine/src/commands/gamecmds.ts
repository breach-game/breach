import { evaluate } from '../rules.ts';
import { sha256, style } from '../util.ts';
import { canRead, canWrite, lookup } from '../vfs.ts';
import { investigate } from './defense.ts';
import { commands } from './index.ts';
import { type Command, type CommandCtx, err, out, type Run, wait } from './types.ts';

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
      for (const c of [...commands.values()]
        .filter((c) => c.group === group)
        .sort((a, b) => a.name.localeCompare(b.name)))
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
    const lines = [
      paint(ctx, style.bold, `${ctx.t('mission.label')} ${String(m.order).padStart(2, '0')} / ${title}`),
      '',
      ctx.t(m.briefing),
      '',
    ];
    for (const o of m.objectives) {
      const done = ctx.state.objectives[o.id];
      const mark = done ? paint(ctx, style.green, '[x]') : '[ ]';
      lines.push(
        `  ${mark} ${ctx.t(o.text)}${o.optional ? ` ${paint(ctx, style.dim, ctx.t('mission.optional'))}` : ''}`,
      );
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
    // `flag{...}` is the same flag: only the prefix is case-insensitive.
    const value = ctx.args
      .join(' ')
      .trim()
      .replace(/^flag(?=\{)/i, 'FLAG');
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
    if (!evaluate(flag.if, ctx.state)) {
      ctx.emit({ type: 'FlagSubmitted', flag: null, correct: false });
      yield err(ctx.t('submit.revoked'));
      return 1;
    }
    if (ctx.state.flags[flag.id]) {
      yield out(ctx.t('submit.already'));
      return 0;
    }
    // A flag is proof of what the player reached: one the target never showed them proves nothing.
    if (!ctx.game.sandbox && !ctx.game.wasShown(value)) {
      yield err(ctx.t('submit.unseen'));
      return 1;
    }
    ctx.emit({ type: 'FlagSubmitted', flag: flag.id, correct: true });
    yield out(`${paint(ctx, style.green, ctx.t('submit.ok'))} +${flag.points}`);
    if (flag.objective) ctx.game.completeObjective(flag.objective);
    return 0;
  },
};

const verify: Command = {
  name: 'verify',
  summary: 'cmd.verify',
  group: 'game',
  async *run(ctx): Run {
    if (!ctx.game.mission?.checks.length || ctx.state.missionDone) {
      yield out(ctx.t('verify.none'));
      return 0;
    }
    yield wait(400);
    const results = ctx.game.verify();
    for (const r of results)
      yield out(
        `  ${r.ok ? paint(ctx, style.green, '[ OK ]') : paint(ctx, style.yellow, '[FAIL]')} ${r.text}`,
      );
    const failed = results.filter((r) => !r.ok).length;
    yield out(failed ? ctx.t('verify.failed', { n: failed }) : paint(ctx, style.green, ctx.t('verify.ok')));
    return failed ? 1 : 0;
  },
};

const answer: Command = {
  name: 'answer',
  summary: 'cmd.answer',
  group: 'game',
  async *run(ctx): Run {
    // A defence investigation: `answer <id> <value>`, unless Ada is waiting for a letter.
    const investigation = ctx.game.mission?.investigation ?? [];
    const open = ctx.game.openQuestions();
    if (investigation.length && (!open.length || investigation.some((q) => q.id === ctx.args[0])))
      return yield* investigate(ctx);
    const question = open[0];
    if (!question) {
      yield out(ctx.t('answer.none'));
      // An objective answered by a value (an address, a name, a path) takes `submit`, not `answer`.
      if (ctx.game.mission?.flags.length) yield out(paint(ctx, style.dim, ctx.t('answer.submit')));
      return ctx.args.length ? 1 : 0;
    }
    const letter = (i: number) => String.fromCharCode(97 + i);
    const pick = (ctx.args[0] ?? '').toLowerCase();
    // Letters follow the order shown, which is not the order written in the pack.
    const options = ctx.game.optionsOf(question);
    const index = options.findIndex((o, i) => pick === letter(i) || pick === o.id);
    if (index < 0) {
      yield out(paint(ctx, style.magenta, `Ada: ${ctx.t(question.text)}`));
      for (const [i, o] of options.entries()) yield out(`  ${letter(i)}) ${ctx.t(o.text)}`);
      yield out(paint(ctx, style.dim, ctx.t('answer.usage')));
      return pick ? 1 : 0;
    }
    const result = ctx.game.answer(question.id, options[index]!.id);
    if (!result) return 1;
    if (result.decision) {
      // What it leads to arrives as a message from Ada, in the terminal and in the messenger alike.
      yield out(paint(ctx, style.cyan, ctx.t('answer.decided')));
      if (result.impact)
        yield out(paint(ctx, style.yellow, ctx.t('contain.impact', { impact: result.impact })));
      return 0;
    }
    yield out(
      result.correct
        ? paint(ctx, style.green, ctx.t('answer.right'))
        : paint(ctx, style.yellow, ctx.t('answer.wrong')),
    );
    if (result.why) yield out(result.why);
    return result.correct ? 0 : 1;
  },
};

/**
 * A code review: `review <file>` prints the file with its line numbers, `review <file> <line>` names
 * a line as faulty. The mission's list of lines is the judge.
 */
const review: Command = {
  name: 'review',
  summary: 'cmd.review',
  group: 'game',
  async *run(ctx): Run {
    const [arg, given] = ctx.args;
    if (!arg) {
      yield err('usage: review <file> [line]');
      return 1;
    }
    const node = lookup(ctx.state.fs, ctx.path(arg));
    if (node?.t !== 'f' || !canRead(node, ctx.game.currentUser)) {
      yield err(`review: ${arg}: No such file`);
      return 1;
    }
    const rows = (node.content.endsWith('\n') ? node.content.slice(0, -1) : node.content).split('\n');
    const target = ctx.game.reviewOf(arg);
    const found = target ? (ctx.state.reviewed[target.id] ?? []) : [];
    if (given === undefined) {
      ctx.emit({ type: 'FileRead', host: ctx.state.host, path: ctx.path(arg) });
      yield out(
        rows
          .map((row, i) => {
            const text = `${String(i + 1).padStart(4)}  ${row}`;
            return found.includes(i + 1)
              ? paint(ctx, style.yellow, `${text}   <-- ${ctx.t('review.mark')}`)
              : text;
          })
          .join('\n'),
      );
      if (target)
        yield out(
          paint(
            ctx,
            style.dim,
            ctx.t('review.usage', { file: arg, found: found.length, total: target.lines.length }),
          ),
        );
      return 0;
    }
    const line = Number.parseInt(given, 10);
    if (!Number.isInteger(line) || line < 1 || line > rows.length) {
      yield err(ctx.t('review.range', { n: rows.length }));
      return 1;
    }
    const result = ctx.game.review(arg, line);
    if (!result) {
      yield out(ctx.t('review.none'));
      return 0;
    }
    if (result.again) yield out(ctx.t('review.again'));
    else if (!result.correct) yield out(paint(ctx, style.yellow, ctx.t('review.wrong', { line })));
    else
      yield out(
        paint(
          ctx,
          style.green,
          result.left ? ctx.t('review.right', { line, left: result.left }) : ctx.t('review.done', { line }),
        ),
      );
    return result.correct ? 0 : 1;
  },
};

const edit: Command = {
  name: 'edit',
  summary: 'cmd.edit',
  group: 'game',
  async *run(ctx): Run {
    const arg = ctx.args[0];
    if (!arg) {
      yield err('usage: edit <file>');
      return 1;
    }
    const abs = ctx.path(arg);
    const node = lookup(ctx.state.fs, abs);
    if (node?.t === 'd') {
      yield err(`edit: ${arg}: Is a directory`);
      return 1;
    }
    if (node ? !canRead(node, ctx.game.currentUser) || !canWrite(node, ctx.game.currentUser) : false) {
      yield err(`edit: ${arg}: Permission denied`);
      return 1;
    }
    if (!node && lookup(ctx.state.fs, abs.slice(0, abs.lastIndexOf('/')) || '/')?.t !== 'd') {
      yield err(`edit: ${arg}: No such file or directory`);
      return 1;
    }
    // The editor window reads and saves the file itself, through `game.writeFile`.
    ctx.emit({ type: 'AppOpened', app: 'editor', url: abs });
    yield out(ctx.t('engine.edit', { path: abs }));
    return 0;
  },
};

export const gameCommands: Command[] = [
  verify,
  review,
  answer,
  edit,
  { ...edit, name: 'nano', summary: 'cmd.nano' },
  help,
  explain,
  { ...explain, name: 'man', summary: 'cmd.man' },
  mission,
  hint,
  notes,
  submit,
];
