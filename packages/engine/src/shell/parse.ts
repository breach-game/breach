/**
 * Shell grammar for v1: quotes and escapes, pipes, `>` and `>>`, `&&`, `||` and `;`.
 * No variables beyond $HOME, $USER and $PWD, no subshells, no scripts.
 */
export interface Word {
  text: string;
  /** True when any part of the word was quoted: no glob expansion, no tilde expansion. */
  quoted: boolean;
}
export interface Stage {
  argv: Word[];
  redirect?: { path: Word; append: boolean };
}
export interface Pipeline {
  stages: Stage[];
  /** How this pipeline is chained to the previous one. */
  op: ';' | '&&' | '||';
}

export class ShellSyntaxError extends Error {}

type Token = { kind: 'word'; word: Word } | { kind: 'op'; op: string };

const UNSUPPORTED = ['$(', '`', '<<', '<', '&'];

export function tokenize(line: string, env: Record<string, string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let cur = '';
  let has = false;
  let quoted = false;
  const push = () => {
    if (has) tokens.push({ kind: 'word', word: { text: cur, quoted } });
    cur = '';
    has = false;
    quoted = false;
  };
  const variable = (): string | null => {
    const m = /^\$(\w+|\{\w+\})/.exec(line.slice(i));
    if (!m) return null;
    i += m[0].length;
    return env[m[1]!.replace(/[{}]/g, '')] ?? '';
  };
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === '\\') {
      if (i + 1 < line.length) cur += line[i + 1];
      has = true;
      quoted = true;
      i += 2;
    } else if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      cur += line.slice(i + 1, end);
      has = true;
      quoted = true;
      i = end + 1;
    } else if (ch === '"') {
      i++;
      let closed = false;
      while (i < line.length) {
        const c = line[i]!;
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1]!)) {
          cur += line[i + 1];
          i += 2;
        } else if (c === '$') {
          const v = variable();
          if (v === null) {
            cur += c;
            i++;
          } else cur += v;
        } else {
          cur += c;
          i++;
        }
      }
      if (!closed) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'');
      has = true;
      quoted = true;
    } else if (ch === ' ' || ch === '\t') {
      push();
      i++;
    } else if (ch === '#' && !has) {
      break;
    } else if (line.startsWith('&&', i) || line.startsWith('||', i) || line.startsWith('>>', i)) {
      push();
      tokens.push({ kind: 'op', op: line.slice(i, i + 2) });
      i += 2;
    } else if (ch === '|' || ch === ';' || ch === '>') {
      push();
      tokens.push({ kind: 'op', op: ch });
      i++;
    } else if (UNSUPPORTED.some((u) => line.startsWith(u, i))) {
      const u = UNSUPPORTED.find((s) => line.startsWith(s, i))!;
      throw new ShellSyntaxError(`syntax error near unexpected token \`${u}'`);
    } else if (ch === '$') {
      const v = variable();
      if (v === null) {
        cur += ch;
        i++;
      } else cur += v;
      has = true;
    } else {
      cur += ch;
      has = true;
      i++;
    }
  }
  push();
  return tokens;
}

export function parse(line: string, env: Record<string, string>): Pipeline[] {
  const tokens = tokenize(line, env);
  const pipelines: Pipeline[] = [];
  let stages: Stage[] = [];
  let stage: Stage = { argv: [] };
  let op: Pipeline['op'] = ';';
  const unexpected = (t: string) => new ShellSyntaxError(`syntax error near unexpected token \`${t}'`);
  const endStage = (after: string) => {
    if (stage.argv.length === 0) throw unexpected(after);
    stages.push(stage);
    stage = { argv: [] };
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind === 'word') {
      stage.argv.push(tok.word);
    } else if (tok.op === '|') {
      endStage('|');
    } else if (tok.op === '>' || tok.op === '>>') {
      const next = tokens[++i];
      if (!next || next.kind !== 'word') throw unexpected('newline');
      stage.redirect = { path: next.word, append: tok.op === '>>' };
    } else {
      if (stage.argv.length === 0 && stages.length === 0) {
        if (tok.op === ';' && pipelines.length > 0 && i === tokens.length - 1) break;
        throw unexpected(tok.op);
      }
      endStage(tok.op);
      pipelines.push({ stages, op });
      stages = [];
      op = tok.op as Pipeline['op'];
    }
  }
  if (stage.argv.length > 0) stages.push(stage);
  else if (stages.length > 0) throw unexpected('newline');
  else if (op !== ';' && pipelines.length > 0) throw unexpected('newline');
  if (stages.length > 0) pipelines.push({ stages, op });
  return pipelines;
}
