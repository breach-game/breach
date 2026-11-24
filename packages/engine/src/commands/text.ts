import { basicRegExp, digest } from '../util.ts';
import { canWrite, lookup } from '../vfs.ts';
import { inputs, lines, readFile } from './files.ts';
import { type Command, err, getopt, out } from './types.ts';

const joined = (sources: { text: string }[]) =>
  sources.flatMap(({ text }) => (text === '' ? [] : lines(text)));

/** The regular expression is typed by the player and runs in the player's own tab. */
function playerRegExp(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch {
    return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
}

const sort: Command = {
  name: 'sort',
  summary: 'cmd.sort',
  group: 'files',
  async *run(ctx) {
    const { flags, values, rest } = getopt(ctx.args, ['k', 't']);
    const sources = yield* inputs(ctx, rest);
    const field = values.k ? Math.max(1, Number.parseInt(values.k, 10) || 1) : 0;
    const key = (line: string) => {
      if (!field) return line;
      const parts = values.t ? line.split(values.t) : line.trim().split(/\s+/);
      return parts[field - 1] ?? '';
    };
    const number = (text: string) => Number.parseFloat(text) || 0;
    let all = joined(sources).sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const order = flags.has('n') ? number(x) - number(y) : x < y ? -1 : x > y ? 1 : 0;
      return order || (a < b ? -1 : a > b ? 1 : 0);
    });
    if (flags.has('r')) all.reverse();
    if (flags.has('u')) all = all.filter((line, i) => i === 0 || line !== all[i - 1]);
    if (all.length) yield out(all.join('\n'));
    return 0;
  },
};

const uniq: Command = {
  name: 'uniq',
  summary: 'cmd.uniq',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    const sources = yield* inputs(ctx, rest.slice(0, 1));
    const groups: { line: string; count: number }[] = [];
    for (const line of joined(sources)) {
      const last = groups[groups.length - 1];
      if (last && last.line === line) last.count++;
      else groups.push({ line, count: 1 });
    }
    const shown = groups.filter((g) => !flags.has('d') || g.count > 1);
    if (shown.length)
      yield out(
        shown.map((g) => (flags.has('c') ? `${String(g.count).padStart(7)} ${g.line}` : g.line)).join('\n'),
      );
    return 0;
  },
};

/** Parse a cut list such as `1,3-5` or `2-` into a test on 1-based positions. */
function cutList(spec: string): ((n: number) => boolean) | null {
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : Number.POSITIVE_INFINITY) : from;
    ranges.push([from, to]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

const cut: Command = {
  name: 'cut',
  summary: 'cmd.cut',
  group: 'files',
  async *run(ctx) {
    const { values, rest } = getopt(ctx.args, ['d', 'f', 'c']);
    const pick = cutList(values.f ?? values.c ?? '');
    if (!pick) {
      yield err('cut: you must specify a list of bytes, characters, or fields');
      return 1;
    }
    const delimiter = values.d ?? '\t';
    const sources = yield* inputs(ctx, rest);
    const result = joined(sources).map((line) => {
      if (values.f === undefined) return [...line].filter((_, i) => pick(i + 1)).join('');
      if (!line.includes(delimiter)) return line;
      return line
        .split(delimiter)
        .filter((_, i) => pick(i + 1))
        .join(delimiter);
    });
    if (result.length) yield out(result.join('\n'));
    return 0;
  },
};

const CLASSES: Record<string, string> = {
  '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
  '[:digit:]': '0123456789',
  '[:space:]': ' \t\n',
};

function trSet(spec: string): string[] {
  let text = spec.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  for (const [name, chars] of Object.entries(CLASSES)) text = text.split(name).join(chars);
  const set: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const [a, b] = [chars[i]!, chars[i + 2]];
    if (chars[i + 1] === '-' && b !== undefined && b >= a) {
      for (let c = a.codePointAt(0)!; c <= b.codePointAt(0)! && set.length < 4096; c++)
        set.push(String.fromCodePoint(c));
      i += 2;
    } else set.push(a);
  }
  return set;
}

const tr: Command = {
  name: 'tr',
  summary: 'cmd.tr',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    const [a, b] = rest;
    if (a === undefined || (!flags.has('d') && b === undefined)) {
      yield err("tr: missing operand\nTry 'tr --help' for more information.");
      return 1;
    }
    const from = trSet(a);
    const to = trSet(b ?? '');
    const text = [...(ctx.stdin ?? '')]
      .map((c) => {
        const i = from.indexOf(c);
        if (i < 0) return c;
        return flags.has('d') ? '' : (to[Math.min(i, to.length - 1)] ?? c);
      })
      .join('');
    if (text) yield { k: 'out', text };
    return 0;
  },
};

/** Line differences in the classic `diff` output: `2c2`, `< old`, `---`, `> new`. */
export function diffLines(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const result: string[] = [];
  const range = (start: number, count: number) =>
    count === 0 ? String(start) : count === 1 ? String(start + 1) : `${start + 1},${start + count}`;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const [i0, j0] = [i, j];
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) i++;
      else j++;
    }
    const [removed, added] = [i - i0, j - j0];
    result.push(`${range(i0, removed)}${removed && added ? 'c' : removed ? 'd' : 'a'}${range(j0, added)}`);
    for (let k = i0; k < i; k++) result.push(`< ${a[k]}`);
    if (removed && added) result.push('---');
    for (let k = j0; k < j; k++) result.push(`> ${b[k]}`);
  }
  return result;
}

const diff: Command = {
  name: 'diff',
  summary: 'cmd.diff',
  explain: 'explain.diff',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    if (rest.length !== 2) {
      yield err(`diff: missing operand after '${rest[0] ?? 'diff'}'`);
      return 2;
    }
    const a = yield* readFile(ctx, rest[0]!);
    const b = yield* readFile(ctx, rest[1]!);
    if (a === null || b === null) return 2;
    if (a === b) return 0;
    if (flags.has('q')) yield out(`Files ${rest[0]} and ${rest[1]} differ`);
    else {
      const [x, y] = [a, b].map((text) => (text === '' ? [] : lines(text))) as [string[], string[]];
      if (x.length * y.length > 4_000_000) yield out(`Files ${rest[0]} and ${rest[1]} differ`);
      else yield out(diffLines(x, y).join('\n'));
    }
    return 1;
  },
};

const base64: Command = {
  name: 'base64',
  summary: 'cmd.base64',
  explain: 'explain.base64',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    const [source] = yield* inputs(ctx, rest.slice(0, 1));
    if (!source) return 1;
    if (!flags.has('d') && !flags.has('decode')) {
      const bytes = new TextEncoder().encode(source.text);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const encoded = btoa(binary);
      yield out(encoded.replace(/(.{76})(?=.)/g, '$1\n'));
      return 0;
    }
    try {
      const binary = atob(source.text.replace(/\s+/g, ''));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      yield { k: 'out', text: new TextDecoder().decode(bytes) };
      return 0;
    } catch {
      yield err('base64: invalid input');
      return 1;
    }
  },
};

const sha256sum: Command = {
  name: 'sha256sum',
  summary: 'cmd.sha256sum',
  explain: 'explain.sha256sum',
  group: 'files',
  async *run(ctx) {
    const sources = yield* inputs(
      ctx,
      ctx.args.filter((a) => !a.startsWith('-')),
    );
    for (const { name, text } of sources)
      yield out(`${await digest('SHA-256', text)}  ${name === '(standard input)' ? '-' : name}`);
    return sources.length ? 0 : 1;
  },
};

/** One sed command: `s/a/b/flags` or `/re/d`. Returns the edit and where the command ends. */
function sedCommand(
  script: string,
  start: number,
  extended: boolean,
): { edit: (line: string) => string | null; end: number } | null {
  const regex = (source: string, flags: string) =>
    playerRegExp(extended ? source : basicRegExp(source), flags);
  if (script[start] === '/') {
    const close = script.indexOf('/', start + 1);
    if (close < 0 || script[close + 1] !== 'd') return null;
    const re = regex(script.slice(start + 1, close), '');
    return { edit: (line) => (re.test(line) ? null : line), end: close + 2 };
  }
  if (script[start] !== 's' || script.length < start + 4) return null;
  const sep = script[start + 1]!;
  const parts: string[] = [];
  let part = '';
  let i = start + 2;
  for (; i < script.length && parts.length < 2; i++) {
    const c = script[i]!;
    if (c === '\\' && script[i + 1] === sep) part += script[++i];
    else if (c === sep) {
      parts.push(part);
      part = '';
    } else part += c;
  }
  if (parts.length !== 2 || !parts[0]) return null;
  const flagsMatch = /^[gi]*/.exec(script.slice(i))!;
  const re = regex(parts[0], flagsMatch[0]);
  // `&` is the whole match in sed, `$&` in JavaScript; a literal `$` must not start a JS pattern.
  const replacement = parts[1]!
    .replace(/\$/g, '$$$$')
    .replace(/(^|[^\\])&/g, '$1$$&')
    .replace(/\\&/g, '&')
    .replace(/\\([1-9])/g, '$$$1');
  return { edit: (line) => line.replace(re, replacement), end: i + flagsMatch[0].length };
}

/** A sed script: one or more commands separated by `;`. */
function sedScript(script: string, extended = false): ((line: string) => string | null) | null {
  const edits: ((line: string) => string | null)[] = [];
  let at = 0;
  while (at < script.length) {
    while (script[at] === ' ') at++;
    const command = sedCommand(script, at, extended);
    if (!command) return null;
    edits.push(command.edit);
    at = command.end;
    while (script[at] === ' ') at++;
    if (at < script.length && script[at++] !== ';') return null;
  }
  if (!edits.length) return null;
  return (line) => {
    let current: string | null = line;
    for (const edit of edits) if (current !== null) current = edit(current);
    return current;
  };
}

const sed: Command = {
  name: 'sed',
  summary: 'cmd.sed',
  explain: 'explain.sed',
  group: 'files',
  async *run(ctx) {
    const { flags, values, rest } = getopt(ctx.args, ['e']);
    const script = values.e ?? rest.shift();
    const edit = script === undefined ? null : sedScript(script, flags.has('E') || flags.has('r'));
    if (!edit) {
      yield err(
        script === undefined
          ? 'Usage: sed [OPTION]... {script} [input-file]...'
          : `sed: -e expression #1, char 1: unknown command: \`${script[0] ?? ''}'`,
      );
      return 1;
    }
    const apply = (text: string) => {
      const kept = (text === '' ? [] : lines(text)).map(edit).filter((l): l is string => l !== null);
      return kept.length ? `${kept.join('\n')}\n` : '';
    };
    if (!flags.has('i')) {
      const sources = yield* inputs(ctx, rest);
      for (const { text } of sources) {
        const result = apply(text);
        if (result) yield { k: 'out', text: result };
      }
      return sources.length === Math.max(rest.length, 1) ? 0 : 1;
    }
    if (!rest.length) {
      yield err('sed: no input files');
      return 1;
    }
    let status = 0;
    for (const file of rest) {
      const text = yield* readFile(ctx, file);
      const abs = ctx.path(file);
      const node = lookup(ctx.state.fs, abs);
      if (text === null || !node) status = 1;
      else if (!canWrite(node, ctx.game.currentUser)) {
        yield err(`sed: couldn't open temporary file ${file}: Permission denied`);
        status = 1;
      } else
        ctx.emit({
          type: 'FileWritten',
          host: ctx.state.host,
          path: abs,
          content: apply(text),
          append: false,
        });
    }
    return status;
  },
};

export const textCommands: Command[] = [sort, uniq, cut, tr, diff, base64, sha256sum, sed];
