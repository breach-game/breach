import type { Condition, Matcher, Rule } from '@breach/pack-schema';
import type { GameEvent } from './events.ts';
import type { GameState } from './state.ts';
import { globMatch, lookup } from './vfs.ts';

function matches(matcher: Matcher, actual: unknown): boolean {
  const value = Array.isArray(actual) ? actual.join(' ') : actual;
  if (typeof matcher !== 'object') return value === matcher;
  if ('glob' in matcher) return typeof value === 'string' && globMatch(matcher.glob, value);
  if ('in' in matcher) return matcher.in.includes(value as never);
  if ('contains' in matcher) return typeof value === 'string' && value.includes(matcher.contains);
  if ('gte' in matcher) return typeof value === 'number' && value >= matcher.gte;
  return false;
}

export function triggerMatches(rule: Rule, event: GameEvent): boolean {
  const { event: type, ...fields } = rule.on;
  if (type !== event.type) return false;
  const record = event as unknown as Record<string, unknown>;
  return Object.entries(fields).every(([name, matcher]) => matches(matcher as Matcher, record[name]));
}

/** What `evaluate` needs to know beyond the state: where the player's files are. */
export interface Places {
  playerHost: string;
  home: string;
}

export function evaluate(cond: Condition | undefined, state: GameState, places?: Places): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evaluate(c, state, places));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, state, places));
  if ('not' in cond) return !evaluate(cond.not, state, places);
  if ('file' in cond) {
    const fs = state.filesystems[cond.host ?? places?.playerHost ?? ''];
    const path = cond.file.startsWith('~') ? (places?.home ?? '') + cond.file.slice(1) : cond.file;
    const node = fs && lookup(fs, path);
    if (!node || node.t !== 'f') return false;
    if (cond.contains !== undefined && !node.content.includes(cond.contains)) return false;
    return cond.lacks === undefined || !node.content.includes(cond.lacks);
  }
  if ('answer' in cond) return state.asked[cond.answer] === cond.eq;
  if ('objective' in cond) return state.objectives[cond.objective] === true;
  if ('flag' in cond) return state.flags[cond.flag] === true;
  if ('discovered' in cond) {
    if (typeof cond.discovered === 'string') return cond.discovered in state.discovered;
    return Object.keys(state.discovered).length >= cond.discovered.gte;
  }
  if ('noise' in cond) {
    const { gte, lt } = cond.noise;
    return (gte === undefined || state.noise >= gte) && (lt === undefined || state.noise < lt);
  }
  if ('var' in cond) return state.vars[cond.var] === cond.eq;
  return false;
}
