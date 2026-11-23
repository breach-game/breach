import type { Detection, LogSource, Where } from '@breach/pack-schema';
import { LOG_SOURCES } from '@breach/pack-schema';
import { pentestReport } from '../report.ts';
import { LOG_FILES, runDetection } from '../telemetry.ts';
import { sha256, style } from '../util.ts';
import { canRead, lookup } from '../vfs.ts';
import { type Command, type CommandCtx, err, out, type Run, wait } from './types.ts';

/**
 * Defence missions: the SOC console (`soc`), containment orders (`contain`) and the answers of the
 * investigation (`answer`). They only work while the player defends a target.
 */

const paint = (ctx: CommandCtx, fn: (s: string) => string, s: string) => (ctx.tty ? fn(s) : s);

function* defending(ctx: CommandCtx): Generator<ReturnType<typeof err>, boolean> {
  if (ctx.game.mission?.side === 'defense') return true;
  yield err(ctx.t('soc.unavailable'));
  return false;
}

const soc: Command = {
  name: 'soc',
  summary: 'cmd.soc',
  explain: 'explain.soc',
  group: 'game',
  async *run(ctx): Run {
    if (!(yield* defending(ctx))) return 1;
    const [sub = 'help', ...rest] = ctx.args;
    const lines = ctx.game.socLines();
    yield wait(250);
    if (sub === 'logs') {
      const [hostArg, sourceArg] = rest;
      const source = LOG_SOURCES.find((s) => s === sourceArg || s === hostArg);
      const host = hostArg && hostArg !== source ? hostArg.toLowerCase() : undefined;
      const shown = lines.filter(
        (l) => (!host || l.host === host || l.hostname.startsWith(host)) && (!source || l.source === source),
      );
      if (!shown.length) {
        yield err('soc: no matching log lines');
        return 1;
      }
      let last = '';
      for (const l of shown) {
        const file = `${l.hostname}:${LOG_FILES[l.source]}`;
        if (file !== last) yield out(paint(ctx, style.dim, `==> ${file} <==`));
        last = file;
        yield out(l.text);
      }
      return 0;
    }
    if (sub === 'search') {
      const needle = rest.join(' ').toLowerCase();
      if (!needle) {
        yield err('usage: soc search <text>');
        return 2;
      }
      const shown = lines.filter((l) => l.text.toLowerCase().includes(needle));
      for (const l of shown) yield out(`${paint(ctx, style.dim, `${l.hostname}:`)} ${l.text}`);
      if (!shown.length) yield err(`soc: no line contains "${rest.join(' ')}"`);
      return shown.length ? 0 : 1;
    }
    if (sub === 'sources') {
      const seen = new Map<string, number>();
      for (const l of lines) {
        const key = `${l.hostname.padEnd(24)} ${l.source.padEnd(7)} ${LOG_FILES[l.source as LogSource]}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      yield out(`${'HOST'.padEnd(24)} ${'SOURCE'.padEnd(7)} FILE (LINES)`);
      for (const [k, n] of [...seen].sort()) yield out(`${k} (${n})`);
      return 0;
    }
    if (sub === 'alerts') {
      const rules = ctx.game.mission?.alerts ?? [];
      let any = false;
      for (const rule of rules) {
        const result = runDetection(rule, lines);
        if (!result.alerts.length) continue;
        any = true;
        yield out(
          `${paint(ctx, style.yellow, `[${rule.id}]`)} ${ctx.t(rule.title)} ${paint(ctx, style.dim, `(${result.alerts.length})`)}`,
        );
        for (const l of result.alerts.slice(-3)) yield out(`  ${l.hostname}: ${l.text}`);
      }
      if (!any) yield out(paint(ctx, style.dim, 'soc: no open alert'));
      return 0;
    }
    yield out(ctx.t('soc.usage'));
    return sub === 'help' ? 0 : 2;
  },
  complete(words, current) {
    if (words.length === 0)
      return ['logs', 'search', 'sources', 'alerts'].filter((w) => w.startsWith(current));
    if (words[0] === 'logs') return LOG_SOURCES.filter((s) => s.startsWith(current));
    return [];
  },
};

const contain: Command = {
  name: 'contain',
  summary: 'cmd.contain',
  explain: 'explain.contain',
  group: 'game',
  async *run(ctx): Run {
    if (!(yield* defending(ctx))) return 1;
    const options = ctx.game.mission?.containment ?? [];
    const [action, ...rest] = ctx.args;
    const target = rest.join(' ');
    if (!action || !target) {
      yield out(ctx.t('contain.usage'));
      for (const c of options)
        yield out(
          `  ${paint(ctx, style.cyan, `contain ${c.action} ${c.target}`.padEnd(40))} ${ctx.t(c.text)}`,
        );
      return action ? 2 : 0;
    }
    const order = options.find((c) => c.action === action && c.target.toLowerCase() === target.toLowerCase());
    if (!order) {
      yield err(`contain: ${action} ${target}: ${ctx.t('contain.unknown')}`);
      return 1;
    }
    if (ctx.state.contained[order.id]) {
      yield out(ctx.t('contain.already'));
      return 0;
    }
    yield wait(600);
    ctx.game.contain(order.id);
    yield out(`${paint(ctx, style.cyan, '✔')} ${ctx.t(order.text)}`);
    if (order.impact > 0)
      yield out(paint(ctx, style.yellow, ctx.t('contain.impact', { impact: order.impact })));
    return 0;
  },
};

/** Normalised answer: trimmed, lower case, inner spaces collapsed. The CLI hashes it the same way. */
export const normalizeAnswer = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Investigation questions of a defence mission: `answer <id> <value>`, judged like a flag, by hash.
 * Called by `answer`, which keeps Ada's multiple-choice questions. Returns null when it does not apply.
 */
export async function* investigate(ctx: CommandCtx): Run {
  const m = ctx.game.mission;
  const list = m?.investigation ?? [];
  const [id, ...rest] = ctx.args;
  const question = list.find((q) => q.id === id);
  if (!question || !rest.length) {
    yield out(ctx.t('investigation.usage'));
    for (const q of list)
      yield out(
        `  ${ctx.state.answers[q.id] ? paint(ctx, style.green, '✔') : '·'} ${paint(ctx, style.cyan, q.id.padEnd(10))} ${ctx.t(q.text)}`,
      );
    return question ? 2 : id ? 1 : 0;
  }
  if (ctx.state.answers[question.id]) {
    yield out(ctx.t('submit.already'));
    return 0;
  }
  // Judged like a flag: a hash comparison, never a model's opinion.
  const correct = (await sha256(normalizeAnswer(rest.join(' ')))) === question.sha256;
  yield wait(350);
  ctx.emit({ type: 'AnswerSubmitted', question: correct ? question.id : null, correct });
  if (!correct) {
    yield err(ctx.t('investigation.wrong'));
    return 1;
  }
  yield out(`${paint(ctx, style.green, ctx.t('investigation.ok'))} +${question.points}`);
  if (question.objective) ctx.game.completeObjective(question.objective);
  return 0;
}

/* ---------- rule ---------- */

export type PlayerRule = Pick<Detection, 'source' | 'where' | 'count'>;

/** Words a rule file may carry around its selection, as Sigma does, and that select nothing. */
const RULE_NOISE = new Set(['title', 'id', 'description', 'where', 'detection', 'selection', 'condition']);

/**
 * Read a detection rule written by the player: `source: auth`, then one `field: value` per line.
 * A field may end with `|contains`, `|startswith`, `|endswith` or `|gte`. Returns the rule, or the line that
 * could not be read. Plain text only: nothing here is evaluated.
 */
export function parseRule(
  text: string,
  options: { source?: boolean } = {},
): { rule: PlayerRule } | { error: string } {
  const needsSource = options.source ?? true;
  let source: LogSource | undefined;
  const where: Where = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf(':');
    if (cut < 0) return { error: raw.trim() };
    const key = line.slice(0, cut).trim().toLowerCase();
    const value = line
      .slice(cut + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
    if (key === 'source' || key === 'logsource') {
      const found = LOG_SOURCES.find((s) => s === value.toLowerCase());
      if (!found) return { error: raw.trim() };
      source = found;
      continue;
    }
    if (RULE_NOISE.has(key)) continue;
    const [name = '', modifier, ...more] = key.split('|');
    if (!/^[a-z_]{1,20}$/.test(name) || more.length || !value || Object.keys(where).length >= 8)
      return { error: raw.trim() };
    if (modifier === undefined)
      where[name] = /^\d{1,9}$/.test(value)
        ? Number(value)
        : value === 'true'
          ? true
          : value === 'false'
            ? false
            : value;
    else if (modifier === 'contains') where[name] = { contains: value };
    else if (modifier === 'startswith') where[name] = { glob: `${value.replace(/[*?]/g, '')}*` };
    else if (modifier === 'endswith') where[name] = { glob: `*${value.replace(/[*?]/g, '')}` };
    else if (modifier === 'gte' && /^\d{1,9}$/.test(value)) where[name] = { gte: Number(value) };
    else return { error: raw.trim() };
  }
  if (!source && needsSource) return { error: 'source:' };
  return { rule: { source: source ?? 'agent', where } };
}

/**
 * `rule test <file>`: try a detection rule written on the workstation against the logs of the
 * mission. The engine counts what it catches and what it raises by mistake; nothing else judges it.
 */
const rule: Command = {
  name: 'rule',
  summary: 'cmd.rule',
  explain: 'explain.rule',
  group: 'game',
  async *run(ctx): Run {
    const [sub, file] = ctx.args;
    if (sub !== 'test' || !file) {
      yield out(ctx.t('rule.usage'));
      return sub ? 2 : 0;
    }
    const node = lookup(ctx.state.fs, ctx.path(file));
    if (node?.t !== 'f' || !canRead(node, ctx.game.currentUser)) {
      yield err(`rule: ${file}: No such file`);
      return 1;
    }
    const parsed = parseRule(node.content);
    if ('error' in parsed) {
      yield err(ctx.t('rule.syntax', { line: parsed.error }));
      return 2;
    }
    yield wait(400);
    const r = ctx.game.testRule(file, parsed.rule);
    const selection = Object.entries(parsed.rule.where)
      .map(([k, m]) => `${k}=${typeof m === 'object' ? JSON.stringify(m) : JSON.stringify(m)}`)
      .join(' ');
    yield out(paint(ctx, style.dim, `rule: source=${parsed.rule.source} ${selection}`.trimEnd()));
    yield out(`alerts: ${r.alerts.length}  (attack: ${r.caught}, ordinary activity: ${r.falsePositives})`);
    for (const l of r.alerts.slice(0, 4))
      yield out(`  ${l.actor === 'background' ? '?' : '!'} ${l.hostname}: ${l.text}`);
    if (r.alerts.length > 4) yield out(paint(ctx, style.dim, `  … ${r.alerts.length - 4} more`));
    if (!r.hunt) {
      yield out(paint(ctx, style.dim, ctx.t('rule.nohunt')));
      return 0;
    }
    if (r.passed) {
      yield out(paint(ctx, style.green, ctx.t('rule.pass', { n: r.caughtWanted })));
      return 0;
    }
    if (r.falsePositives > 0)
      yield out(paint(ctx, style.yellow, ctx.t('rule.false', { n: r.falsePositives })));
    if (r.wanted === 0) yield out(paint(ctx, style.dim, ctx.t('rule.early')));
    else if (r.missed > 0) yield out(paint(ctx, style.yellow, ctx.t('rule.missed', { n: r.missed })));
    return 1;
  },
  complete(words, current) {
    return words.length === 0 ? ['test'].filter((w) => w.startsWith(current)) : [];
  },
};

/**
 * `eval run <file>`: try a guardrail written on the workstation against the cases of the mission.
 * A guardrail is one condition per line (`field: value`, same modifiers as a detection rule); a
 * request that meets them all is blocked. The engine counts, nothing else judges.
 */
const evalCmd: Command = {
  name: 'eval',
  summary: 'cmd.eval',
  explain: 'explain.eval',
  group: 'game',
  async *run(ctx): Run {
    const [sub, file] = ctx.args;
    if (sub !== 'run' || !file) {
      yield out(ctx.t('eval.usage'));
      return sub ? 2 : 0;
    }
    const node = lookup(ctx.state.fs, ctx.path(file));
    if (node?.t !== 'f' || !canRead(node, ctx.game.currentUser)) {
      yield err(`eval: ${file}: No such file`);
      return 1;
    }
    const parsed = parseRule(node.content, { source: false });
    if ('error' in parsed) {
      yield err(ctx.t('rule.syntax', { line: parsed.error }));
      return 2;
    }
    yield wait(400);
    const r = ctx.game.runEval(file, parsed.rule.where);
    if (!r) {
      yield out(paint(ctx, style.dim, ctx.t('eval.none')));
      return 1;
    }
    const conditions = Object.entries(parsed.rule.where)
      .map(([k, m]) => {
        if (typeof m !== 'object') return `${k}=${String(m)}`;
        if ('gte' in m) return `${k}>=${m.gte}`;
        if ('contains' in m) return `${k}~${m.contains}`;
        if ('glob' in m) return `${k}=${m.glob}`;
        return `${k}=${JSON.stringify(m)}`;
      })
      .join(' ');
    yield out(paint(ctx, style.dim, `guardrail: ${conditions || '(no condition: blocks everything)'}`));
    for (const c of r.cases) {
      const right = c.blocked === (c.expect === 'block');
      const verdict = `${c.blocked ? 'BLOCK' : 'ALLOW'}${right ? ' ' : '!'}`;
      const kind = c.expect === 'block' ? 'attack' : 'legit ';
      const line = `  ${verdict} ${kind}  ${ctx.t(c.text)}`;
      yield out(right ? line : paint(ctx, style.yellow, line));
    }
    yield out(
      `result: ${r.blocked}/${r.attacks} attacks blocked, ${r.wrongly}/${r.legit} legitimate requests blocked`,
    );
    if (r.passed) {
      yield out(paint(ctx, style.green, ctx.t('eval.pass')));
      return 0;
    }
    if (r.wrongly > 0) yield out(paint(ctx, style.yellow, ctx.t('eval.wrongly', { n: r.wrongly })));
    if (r.missed > 0) yield out(paint(ctx, style.yellow, ctx.t('eval.missed', { n: r.missed })));
    return 1;
  },
  complete(words, current) {
    return words.length === 0 ? ['run'].filter((w) => w.startsWith(current)) : [];
  },
};

/** The pentest report, from the journal. `report > rapport.md` keeps a copy on the workstation. */
const report: Command = {
  name: 'report',
  summary: 'cmd.report',
  group: 'game',
  async *run(ctx): Run {
    yield wait(300);
    yield out(pentestReport(ctx.game).trimEnd());
    return 0;
  },
};

export const defenseCommands: Command[] = [soc, contain, rule, evalCmd, report];
