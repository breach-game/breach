import { FAMILIES, type Family, type InputShape, type Intent, type Npc } from '@breach/pack-schema';
import { evaluate, type Places } from './rules.ts';
import type { GameState, Scalar } from './state.ts';

/** Lower case, no accents, no punctuation: what the scripted characters actually read. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How a message tries to steer an assistant, in French or in English. These are the families the
 * OWASP LLM Top 10 describes for prompt injection, recognised by their wording: the game teaches
 * the idea behind each one, and a scripted character decides how it reacts to it.
 */
const FAMILY_PATTERNS: Record<Family, RegExp[]> = {
  override: [
    /\b(ignore|oublie|forget|disregard|annule|efface)\w*\b.{0,40}\b(instruction|consigne|regle|rule|prompt|precedent|previous|above|avant|tout)/,
    /\b(nouvelles? (instructions?|consignes?|regles?)|new (instructions?|rules?))\b/,
    /\b(a partir de maintenant|desormais|from now on)\b/,
  ],
  reveal: [
    /\b(prompt|instructions?|consignes?|regles?|rules?|configuration|directives?)\b.{0,30}\b(systeme|system|initiale?s?|initial|interne?s?|internal|secrete?s?|secret|cachee?s?|hidden|de depart)\b/,
    /\b(system|initial|internal|secret|hidden) (prompt|instructions?|rules?|directives?)\b/,
    /\b(prompt systeme|prompt initial|pre ?prompt)\b/,
    /\b(montre|affiche|donne|revele|repete|recite|ecris|dis|show|print|reveal|repeat|display|tell|give|what are|quelles sont|quelles etaient)\b.{0,40}\b(tes|your|vos|ton|ta)\b.{0,20}\b(instructions?|consignes?|regles?|rules?|prompt|directives?|configuration)\b/,
  ],
  roleplay: [
    /\b(fais comme si|fais semblant|joue le role|jeu de role|roleplay|role play|pretend|act as|agis comme|comporte toi comme)\b/,
    /\b(tu es (maintenant|desormais)|you are now|tu n es plus|you are no longer|incarne)\b/,
    /\b(imagine que tu es|imagine you are|imagine que vous etes)\b/,
  ],
  translation: [
    /\b(tradui\w*|translat\w*|traduction)\b/,
    /\b(en|in|to|into) (anglais|english|espagnol|spanish|allemand|german|italien|italian|francais|french|latin|chinois|chinese)\b/,
  ],
  encoding: [
    /\b(base ?64|rot ?13|hexa\w*|hex|binaire|binary|morse|leet|ascii)\b/,
    /\b(a l envers|backwards?|in reverse|epelle|spell|lettre par lettre|letter by letter|acrostiche|acrostic|verlan)\b/,
    /\b(encode\w*|chiffre\w*|cipher|code cesar|caesar)\b/,
    /\b(json|yaml|xml|csv)\b/,
  ],
  authority: [
    /\b(je suis|i am|i m|ici|this is)\b.{0,30}\b(admin\w*|develop\w*|ingenieur|engineer|directeur|director|ceo|cto|responsable|manager|support|technicien|maintenance|auditeur|auditor)\b/,
    /\b(mode|acces|access)\b.{0,12}\b(debug|maintenance|admin\w*|developpeur|developer|root)\b/,
    /\b(debug mode|admin mode|developer mode|maintenance mode|sudo)\b/,
  ],
  completion: [
    /\b(complete|continue|termine|finis|finish|poursuis)\b.{0,30}\b(phrase|sentence|texte|text|suite|following|ceci|this)\b/,
    /\b(commence|start|begin|debute)\b.{0,30}\b(reponse|reply|answer|response|message)\b.{0,12}\b(par|with)\b/,
    /\b(repete apres moi|repeat after me|la suite de|what comes after|mot pour mot|word for word|verbatim)\b/,
    /\b(resume\w*|summari[sz]e\w*|reformule\w*|rephrase\w*|paraphrase\w*)\b/,
  ],
  hypothetical: [
    /\b(hypothe\w*|theoriquement|theoretically|en theorie|in theory)\b/,
    /\b(si tu (pouvais|devais|avais)|if you (could|had to|were)|suppos\w*|admettons)\b/,
    /\b(histoire|story|poeme|poem|chanson|song|fiction|roman|novel|scenario|conte|fable)\b/,
  ],
};

export function detectFamilies(message: string): Family[] {
  const text = normalizeText(message);
  return (Object.keys(FAMILY_PATTERNS) as Family[]).filter((f) =>
    FAMILY_PATTERNS[f].some((re) => re.test(text)),
  );
}

/**
 * What a raw input looks like to an application that does not treat it as plain text. Each shape
 * stands for a class of flaw the game explains, and none of them is a working attack: a quote that
 * is not part of a word (the text ends a string early), an HTML tag (the text becomes markup), a number below zero.
 * An apostrophe inside a word ("l'avis", "don't") is ordinary text, not a quote left open.
 */
export function inputShapes(message: string): InputShape[] {
  const shapes: InputShape[] = [];
  if (message.replace(/(?<=\p{L})['’](?=\p{L})/gu, '').includes("'")) shapes.push('quote');
  if (/<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i.test(message)) shapes.push('markup');
  if (/(^|[\s=:(,])-\d/.test(message)) shapes.push('negative');
  return shapes;
}

/** True when every word of the group is in the message. Words of four letters or more match as prefixes. */
function groupMatches(group: string, words: string[]): boolean {
  const wanted = normalizeText(group).split(' ').filter(Boolean);
  return (
    wanted.length > 0 && wanted.every((w) => words.some((m) => m === w || (w.length >= 4 && m.startsWith(w))))
  );
}

/**
 * What a language model understood in the player's message, already checked: word groups taken
 * from the character's own vocabulary, and technique families from the engine's fixed list.
 * It can only contain what the player could have typed, so it never gives more than typing would.
 */
export interface Heard {
  words: string[];
  families: Family[];
}

/**
 * The word groups a model may recognise in a message, normalized, for one character. Intents marked
 * `literal` keep theirs out: those words (a name, a code word) must be found and typed by the player.
 */
export function vocabulary(npc: Npc): string[] {
  const groups = new Set<string>();
  for (const intent of npc.intents) {
    if (intent.literal) continue;
    for (const g of [...intent.words, ...intent.also]) {
      const n = normalizeText(g);
      if (n) groups.add(n);
    }
  }
  return [...groups];
}

/**
 * Deterministic check of what a model says it heard. Anything outside the character's vocabulary
 * or the engine's families is dropped, as is anything malformed. Returns null when nothing is left.
 */
export function acceptHearing(npc: Npc, raw: unknown): Heard | null {
  if (!raw || typeof raw !== 'object') return null;
  const { words, families } = raw as { words?: unknown; families?: unknown };
  const allowed = new Set(vocabulary(npc));
  const pick = (list: unknown, keep: (s: string) => boolean) =>
    Array.isArray(list)
      ? [...new Set(list.filter((x): x is string => typeof x === 'string').map(normalizeText))].filter(keep)
      : [];
  const heard: Heard = {
    words: pick(words, (w) => allowed.has(w)).slice(0, 12),
    families: pick(families, (f) => (FAMILIES as readonly string[]).includes(f)) as Family[],
  };
  return heard.words.length || heard.families.length ? heard : null;
}

function groupHeard(group: string, intent: Intent, heard: Heard | undefined): boolean {
  return !intent.literal && heard !== undefined && heard.words.includes(normalizeText(group));
}

const VERSION = /(?<![\w.])v?(\d{1,6}(?:\.\d{1,6}){0,3})(?![\w.]*\w)/i;

/** The version number a message gives: the first one after the word "version", else the first one. */
export function versionIn(message: string): number[] | null {
  const at = message.toLowerCase().indexOf('version');
  const match = (at >= 0 ? message.slice(at + 7) : message).match(VERSION);
  return match?.[1] ? match[1].split('.').map(Number) : null;
}

/** True when version `a` is strictly higher than `b`, part by part, missing parts counting as 0. */
export function versionAbove(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return false;
}

function intentMatches(
  intent: Intent,
  words: string[],
  families: Family[],
  state: GameState,
  heard: Heard | undefined,
  message: string,
  places?: Places,
): boolean {
  const any = (groups: string[]) =>
    groups.some((g) => groupMatches(g, words) || groupHeard(g, intent, heard));
  if (intent.words.length && !any(intent.words)) return false;
  if (intent.also.length && !any(intent.also)) return false;
  if (intent.families.length && !intent.families.some((f) => families.includes(f))) return false;
  if (intent.input.length) {
    const shapes = inputShapes(message);
    if (!intent.input.every((shape) => shapes.includes(shape))) return false;
  }
  if (intent.above !== undefined) {
    const given = versionIn(message);
    if (!given || !versionAbove(given, intent.above.split('.').map(Number))) return false;
  }
  return evaluate(intent.if, state, places);
}

export interface Decision {
  /** Id of the intent that answered, or `fallback`. */
  intent: string;
  /** Translation key of the scripted reply. */
  key: string;
  families: Family[];
  set: Record<string, Scalar>;
}

/**
 * The scripted brain. It is deterministic: the same conversation always gets the same replies,
 * and it alone decides what a character gives away, whatever writes the final wording. `heard`,
 * when a model interpreted the message, only adds words and families the player could have typed.
 */
export function decide(
  npc: Npc,
  message: string,
  state: GameState,
  heard?: Heard,
  places?: Places,
): Decision {
  const words = normalizeText(message).split(' ').filter(Boolean);
  const detected = detectFamilies(message);
  const families = [...new Set([...detected, ...(heard?.families ?? [])])];
  const said = (id: string) =>
    (state.chats[npc.id] ?? []).filter((l) => l.from === 'npc' && l.intent === id).length;
  const intent = npc.intents.find((i) => intentMatches(i, words, families, state, heard, message, places));
  if (!intent) {
    const key = npc.fallback[said('fallback') % npc.fallback.length]!;
    return { intent: 'fallback', key, families, set: {} };
  }
  const key = intent.reply[Math.min(said(intent.id), intent.reply.length - 1)]!;
  return { intent: intent.id, key, families, set: intent.set ?? {} };
}
