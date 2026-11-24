import { basicRegExp, style } from '../util.ts';
import { canRead, type FsNode, globMatch, lookup, modeString } from '../vfs.ts';
import { type Command, type CommandCtx, err, getopt, out, type Run } from './types.ts';

/** Read a file for a command, reporting errors the way coreutils do. */
export function* readFile(ctx: CommandCtx, arg: string): Generator<ReturnType<typeof err>, string | null> {
  const abs = ctx.path(arg);
  const node = lookup(ctx.state.fs, abs);
  if (!node) {
    yield err(`${ctx.name}: ${arg}: No such file or directory`);
    return null;
  }
  if (node.t === 'd') {
    yield err(`${ctx.name}: ${arg}: Is a directory`);
    return null;
  }
  if (!canRead(node, ctx.game.currentUser)) {
    yield err(`${ctx.name}: ${arg}: Permission denied`);
    return null;
  }
  ctx.emit({ type: 'FileRead', host: ctx.state.host, path: abs });
  return node.content;
}

export const lines = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');

const pwd: Command = {
  name: 'pwd',
  summary: 'cmd.pwd',
  group: 'files',
  async *run(ctx) {
    yield out(ctx.state.cwd);
    return 0;
  },
};

const cd: Command = {
  name: 'cd',
  summary: 'cmd.cd',
  group: 'files',
  async *run(ctx) {
    const arg = ctx.args[0] ?? '~';
    const abs = arg === '-' ? ctx.state.prevCwd : ctx.path(arg);
    const node = lookup(ctx.state.fs, abs);
    if (!node) {
      yield err(`lrsh: cd: ${arg}: No such file or directory`);
      return 1;
    }
    if (node.t !== 'd') {
      yield err(`lrsh: cd: ${arg}: Not a directory`);
      return 1;
    }
    if (!canRead(node, ctx.game.currentUser)) {
      yield err(`lrsh: cd: ${arg}: Permission denied`);
      return 1;
    }
    ctx.emit({ type: 'CwdChanged', path: abs });
    if (arg === '-') yield out(abs);
    return 0;
  },
};

const ls: Command = {
  name: 'ls',
  summary: 'cmd.ls',
  group: 'files',
  async *run(ctx): Run {
    const { flags, rest } = getopt(ctx.args);
    const targets = rest.length ? rest : ['.'];
    const date = ctx.game.date().ls;
    let status = 0;
    const paint = (name: string, node: FsNode) => (ctx.tty && node.t === 'd' ? style.blue(name) : name);
    const long = (name: string, node: FsNode) => {
      const size = node.t === 'f' ? node.content.length : 4096;
      return `${modeString(node)} 1 ${node.owner.padEnd(8)} ${node.owner.padEnd(8)} ${String(size).padStart(6)} ${date} ${paint(name, node)}`;
    };
    for (const [i, target] of targets.entries()) {
      const node = lookup(ctx.state.fs, ctx.path(target));
      if (!node) {
        yield err(`ls: cannot access '${target}': No such file or directory`);
        status = 2;
        continue;
      }
      if (node.t === 'f') {
        yield out(flags.has('l') ? long(target, node) : target);
        continue;
      }
      if (!canRead(node, ctx.game.currentUser)) {
        yield err(`ls: cannot open directory '${target}': Permission denied`);
        status = 2;
        continue;
      }
      if (targets.length > 1) yield out(`${i ? '\n' : ''}${target}:`);
      const entries = Object.entries(node.c)
        .filter(([name]) => flags.has('a') || !name.startsWith('.'))
        .sort(([a], [b]) => a.localeCompare(b));
      if (flags.has('l')) {
        yield out(`total ${entries.length * 4}`);
        for (const [name, child] of entries) yield out(long(name, child));
      } else if (entries.length) {
        const sep = ctx.tty ? '  ' : '\n';
        yield out(entries.map(([name, child]) => paint(name, child)).join(sep));
      }
    }
    return status;
  },
};

const cat: Command = {
  name: 'cat',
  summary: 'cmd.cat',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    if (!rest.length) {
      if (ctx.stdin !== null) yield { k: 'out', text: ctx.stdin };
      return 0;
    }
    let status = 0;
    for (const arg of rest) {
      const content = yield* readFile(ctx, arg);
      if (content === null) status = 1;
      else if (flags.has('n'))
        yield out(
          lines(content)
            .map((l, i) => `${String(i + 1).padStart(6)}\t${l}`)
            .join('\n'),
        );
      else if (content) yield { k: 'out', text: content.endsWith('\n') ? content : `${content}\n` };
    }
    return status;
  },
};

const echo: Command = {
  name: 'echo',
  summary: 'cmd.echo',
  group: 'files',
  async *run(ctx) {
    const args = ctx.args[0] === '-n' ? ctx.args.slice(1) : ctx.args;
    yield { k: 'out', text: args.join(' ') + (ctx.args[0] === '-n' ? '' : '\n') };
    return 0;
  },
};

/** Collect the text inputs of a filter: files given as arguments, or the pipe. */
export async function* inputs(
  ctx: CommandCtx,
  files: string[],
): AsyncGenerator<ReturnType<typeof err>, { name: string; text: string }[]> {
  if (!files.length) return [{ name: '(standard input)', text: ctx.stdin ?? '' }];
  const result: { name: string; text: string }[] = [];
  for (const file of files) {
    const text = yield* readFile(ctx, file);
    if (text !== null) result.push({ name: file, text });
  }
  return result;
}

function collectFiles(ctx: CommandCtx, arg: string): string[] {
  const node = lookup(ctx.state.fs, ctx.path(arg));
  if (!node || node.t === 'f') return [arg];
  const found: string[] = [];
  const walk = (dir: FsNode, prefix: string) => {
    if (dir.t !== 'd') return;
    for (const [name, child] of Object.entries(dir.c).sort(([a], [b]) => a.localeCompare(b))) {
      const path = `${prefix}/${name}`.replace(/^\.\//, '');
      if (child.t === 'd') walk(child, path);
      else if (canRead(child, ctx.game.currentUser)) found.push(path);
    }
  };
  walk(node, arg.replace(/\/$/, ''));
  return found;
}

const grep: Command = {
  name: 'grep',
  summary: 'cmd.grep',
  explain: 'explain.grep',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args, ['e']);
    const pattern = rest.shift();
    if (pattern === undefined) {
      yield err('Usage: grep [OPTION]... PATTERNS [FILE]...');
      return 2;
    }
    const recursive = flags.has('r') || flags.has('R');
    if (recursive && !rest.length) rest.push('.');
    const files = recursive ? rest.flatMap((f) => collectFiles(ctx, f)) : rest;
    if (!files.length && ctx.stdin === null) return 1;
    // The pattern is typed by the player and runs in the player's own tab. Fixed strings by default
    // would be safer but less true to grep, so fall back to a literal match on an invalid expression.
    let test: (line: string) => RegExpExecArray | null;
    const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const re = new RegExp(
        flags.has('F') ? literal : flags.has('E') || flags.has('P') ? pattern : basicRegExp(pattern),
        flags.has('i') ? 'i' : '',
      );
      test = (line) => re.exec(line);
    } catch {
      const re = new RegExp(literal, flags.has('i') ? 'i' : '');
      test = (line) => re.exec(line);
    }
    const sources = yield* inputs(ctx, files);
    const showName = files.length > 1;
    let matched = false;
    for (const { name, text } of sources) {
      let count = 0;
      for (const [i, line] of lines(text).entries()) {
        const m = test(line);
        if (Boolean(m) === flags.has('v')) continue;
        count++;
        matched = true;
        if (flags.has('c') || flags.has('l') || flags.has('q')) continue;
        let shown = line;
        if (ctx.tty && m && m[0])
          shown = line.slice(0, m.index) + style.red(m[0]) + line.slice(m.index + m[0].length);
        const prefix =
          (showName ? `${ctx.tty ? style.magenta(name) : name}:` : '') + (flags.has('n') ? `${i + 1}:` : '');
        yield out(prefix + shown);
      }
      if (flags.has('c')) yield out(showName ? `${name}:${count}` : String(count));
      if (flags.has('l') && count) yield out(name);
    }
    return matched ? 0 : 1;
  },
};

function headTail(which: 'head' | 'tail'): Command {
  return {
    name: which,
    summary: `cmd.${which}`,
    group: 'files',
    async *run(ctx) {
      const { values, rest } = getopt(ctx.args, ['n']);
      const n = Math.max(0, Number.parseInt(values.n ?? '10', 10) || 0);
      const sources = yield* inputs(ctx, rest);
      for (const [i, { name, text }] of sources.entries()) {
        if (rest.length > 1) yield out(`${i ? '\n' : ''}==> ${name} <==`);
        const all = text === '' ? [] : lines(text);
        const part = which === 'head' ? all.slice(0, n) : all.slice(Math.max(0, all.length - n));
        if (part.length) yield out(part.join('\n'));
      }
      return sources.length === Math.max(rest.length, 1) ? 0 : 1;
    },
  };
}

const wc: Command = {
  name: 'wc',
  summary: 'cmd.wc',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    const sources = yield* inputs(ctx, rest);
    for (const { name, text } of sources) {
      const l = (text.match(/\n/g) ?? []).length + (text && !text.endsWith('\n') ? 1 : 0);
      const w = text.split(/\s+/).filter(Boolean).length;
      const c = new TextEncoder().encode(text).length;
      const cols = [flags.has('l') && l, flags.has('w') && w, flags.has('c') && c].filter((v) => v !== false);
      const shown = cols.length ? cols : [l, w, c];
      const label = rest.length ? ` ${name}` : '';
      yield out(
        shown.length === 1 ? `${shown[0]}${label}` : shown.map((v) => String(v).padStart(7)).join('') + label,
      );
    }
    return 0;
  },
};

const find: Command = {
  name: 'find',
  summary: 'cmd.find',
  group: 'files',
  async *run(ctx) {
    const args = [...ctx.args];
    const start = args.length && !args[0]!.startsWith('-') ? args.shift()! : '.';
    let name: string | null = null;
    let type: string | null = null;
    let insensitive = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-name' || args[i] === '-iname') {
        insensitive = args[i] === '-iname';
        name = args[++i] ?? '';
      } else if (args[i] === '-type') type = args[++i] ?? '';
      else {
        yield err(`find: unknown predicate \`${args[i]}'`);
        return 1;
      }
    }
    const root = lookup(ctx.state.fs, ctx.path(start));
    if (!root) {
      yield err(`find: '${start}': No such file or directory`);
      return 1;
    }
    const results: string[] = [];
    const visit = (node: FsNode, path: string, base: string) => {
      const a = insensitive ? base.toLowerCase() : base;
      const p = insensitive && name ? name.toLowerCase() : name;
      if ((!p || globMatch(p, a)) && (!type || type === node.t)) results.push(path);
      if (node.t === 'd' && canRead(node, ctx.game.currentUser))
        for (const [n, child] of Object.entries(node.c).sort(([x], [y]) => x.localeCompare(y)))
          visit(child, `${path.replace(/\/$/, '')}/${n}`, n);
    };
    visit(root, start, start.split('/').pop() || start);
    if (results.length) yield out(results.join('\n'));
    return 0;
  },
};

export const fileCommands: Command[] = [
  pwd,
  cd,
  ls,
  cat,
  echo,
  grep,
  headTail('head'),
  headTail('tail'),
  wc,
  find,
];
