import { inputs } from './files.ts';
import { type Command, err, getopt, out } from './types.ts';

/* ---------- jq ---------- */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Step = { key: string } | { index: number } | { each: true } | { fn: 'keys' | 'length' };

/**
 * The small part of jq's language a pentester uses every day: paths (`.a.b`, `.a[0]`, `.a[]`),
 * `keys`, `length`, and `|` between them. Anything else is refused, as jq refuses a bad filter.
 */
function parseFilter(filter: string): Step[] | null {
  const steps: Step[] = [];
  for (const stage of filter.split('|').map((s) => s.trim())) {
    if (stage === 'keys' || stage === 'length') {
      steps.push({ fn: stage });
      continue;
    }
    if (!stage.startsWith('.')) return null;
    let rest = stage;
    while (rest.length) {
      let m: RegExpExecArray | null;
      if ((m = /^\.?\[\]/.exec(rest))) steps.push({ each: true });
      else if ((m = /^\.?\[(-?\d+)\]/.exec(rest))) steps.push({ index: Number(m[1]) });
      else if ((m = /^\.?\["([^"]*)"\]/.exec(rest))) steps.push({ key: m[1]! });
      else if ((m = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(rest))) steps.push({ key: m[1]! });
      else if ((m = /^\.$/.exec(rest))) {
        // Identity: nothing to do.
      } else return null;
      rest = rest.slice(m[0].length);
    }
  }
  return steps;
}

const kind = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function applyFilter(input: Json, steps: Step[]): Json[] {
  let values: Json[] = [input];
  for (const step of steps) {
    const next: Json[] = [];
    for (const v of values) {
      if ('key' in step) {
        if (v === null) next.push(null);
        else if (typeof v === 'object' && !Array.isArray(v)) next.push(v[step.key] ?? null);
        else throw new Error(`Cannot index ${kind(v)} with "${step.key}"`);
      } else if ('index' in step) {
        if (v === null) next.push(null);
        else if (Array.isArray(v)) next.push(v.at(step.index) ?? null);
        else throw new Error(`Cannot index ${kind(v)} with number`);
      } else if ('each' in step) {
        if (Array.isArray(v)) next.push(...v);
        else if (v !== null && typeof v === 'object') next.push(...Object.values(v));
        else throw new Error(`Cannot iterate over ${kind(v)}`);
      } else if (step.fn === 'keys') {
        if (Array.isArray(v)) next.push(v.map((_, i) => i));
        else if (v !== null && typeof v === 'object') next.push(Object.keys(v).sort());
        else throw new Error(`${kind(v)} has no keys`);
      } else {
        if (v === null) next.push(0);
        else if (typeof v === 'string' || Array.isArray(v)) next.push(v.length);
        else if (typeof v === 'object') next.push(Object.keys(v).length);
        else if (typeof v === 'number') next.push(Math.abs(v));
        else throw new Error(`${kind(v)} has no length`);
      }
    }
    values = next;
  }
  return values;
}

const jq: Command = {
  name: 'jq',
  summary: 'cmd.jq',
  explain: 'explain.jq',
  group: 'files',
  async *run(ctx) {
    const { flags, rest } = getopt(ctx.args);
    const filter = rest[0];
    if (filter === undefined) {
      yield err('Usage:\tjq [OPTIONS] FILTER [FILES...]');
      return 2;
    }
    const steps = parseFilter(filter);
    if (!steps) {
      yield err(`jq: error: syntax error in filter: ${filter}\njq: 1 compile error`);
      return 3;
    }
    const sources = yield* inputs(ctx, rest.slice(1, 2));
    const source = sources[0];
    if (!source) return 2;
    let parsed: Json;
    try {
      parsed = JSON.parse(source.text) as Json;
    } catch {
      yield err('jq: error (at <stdin>:1): Cannot parse input as JSON');
      return 2;
    }
    try {
      const raw = flags.has('r');
      const text = applyFilter(parsed, steps)
        .map((v) =>
          raw && typeof v === 'string' ? v : JSON.stringify(v, null, flags.has('c') ? undefined : 2),
        )
        .join('\n');
      if (text) yield out(text);
      return 0;
    } catch (e) {
      yield err(`jq: error (at <stdin>:1): ${(e as Error).message}`);
      return 5;
    }
  },
};

/* ---------- jwt ---------- */

/** Decode one part of a token: Base64 with the URL alphabet, holding JSON. */
function tokenPart(part: string): string | null {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/**
 * Reads a JSON Web Token. It only decodes: the two first parts of a token are Base64, readable by
 * anyone who holds it. It never signs or forges one.
 */
const jwt: Command = {
  name: 'jwt',
  summary: 'cmd.jwt',
  explain: 'explain.jwt',
  group: 'files',
  async *run(ctx) {
    const [action, given] = ctx.args;
    if (action !== 'decode') {
      yield err('usage: jwt decode <token>');
      return 2;
    }
    const token = (given ?? ctx.stdin ?? '').trim();
    const parts = token.split('.');
    const header = parts.length === 3 ? tokenPart(parts[0]!) : null;
    const claims = parts.length === 3 ? tokenPart(parts[1]!) : null;
    if (!header || !claims) {
      yield err('jwt: the token is not three Base64 parts separated by dots');
      return 1;
    }
    yield out(
      `\nToken header\n------------\n${header}\n\nToken claims\n------------\n${claims}\n\nSignature\n---------\n${parts[2] ? `${parts[2].length} characters (not checked: jwt decode only reads)` : '(empty)'}\n`,
    );
    return 0;
  },
};

export const dataCommands: Command[] = [jq, jwt];
