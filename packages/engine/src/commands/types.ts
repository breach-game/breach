import type { World } from '@breach/pack-schema';
import type { EventBody, GameEvent } from '../events.ts';
import type { Game } from '../game.ts';
import type { GameState } from '../state.ts';

export type Chunk =
  | { k: 'out'; text: string }
  | { k: 'err'; text: string }
  /** The real tool would take this long here. The interface sleeps, tests do not. */
  | { k: 'wait'; ms: number }
  | { k: 'clear' };

export interface CommandCtx {
  game: Game;
  world: World;
  readonly state: GameState;
  name: string;
  args: string[];
  /** Output of the previous pipeline stage, or null when reading from the terminal. */
  stdin: string | null;
  /** True when the output goes to the terminal: colours are allowed. */
  tty: boolean;
  t(key: string, vars?: Record<string, string | number>): string;
  emit(body: EventBody): GameEvent;
  /** Resolve a path against the current directory. */
  path(p: string): string;
  /** Charge this command's noise cost. Call it once the target is known to be in scope. */
  noise(): void;
}

export type Run = AsyncGenerator<Chunk, number | undefined>;

export interface Command {
  name: string;
  /** Key of the one-line summary shown by `help`. */
  summary: string;
  /** Key of the `explain` text: what the tool does and how defenders spot it. */
  explain?: string;
  group: 'system' | 'files' | 'network' | 'game';
  run(ctx: CommandCtx): Run;
  complete?(words: string[], current: string): string[];
}

export const out = (text: string): Chunk => ({ k: 'out', text: text.endsWith('\n') ? text : `${text}\n` });
export const err = (text: string): Chunk => ({ k: 'err', text: text.endsWith('\n') ? text : `${text}\n` });
export const wait = (ms: number): Chunk => ({ k: 'wait', ms });

/** Split short options from operands: `-la` gives flags l and a. Options listed in `valued` take a value. */
export function getopt(args: string[], valued: string[] = []) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) values[k!] = v;
      else if (valued.includes(k!)) values[k!] = args[++i] ?? '';
      else flags.add(k!);
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j]!;
        if (valued.includes(f)) {
          values[f] = a.slice(j + 1) || args[++i] || '';
          break;
        }
        flags.add(f);
      }
    } else if (/^-\d+$/.test(a)) {
      values.n = a.slice(1);
    } else rest.push(a);
  }
  return { flags, values, rest };
}
