import type { Family, Locale } from '@breach/pack-schema';

/**
 * A language model that helps a character, in up to two ways the player chooses. It never decides
 * anything: the scripted brain picks the reply.
 * - `hear` interprets the player's message: it names which of the character's own word groups and
 *   which technique families the message means, even when worded freely. The engine keeps only
 *   what is in those closed lists, so a model can never give more than the player could type.
 * - `reply` says the reply the script chose, in other words.
 */
export interface NpcBrain {
  id: 'webllm' | 'gateway' | 'byok';
  isAvailable(): Promise<boolean>;
  hear?(input: HearInput): Promise<{ words: unknown; families: unknown }>;
  reply?(input: BrainInput): Promise<{ text: string }>;
}

export interface HearInput {
  npcId: string;
  name: string;
  role: string;
  kind: 'human' | 'ai';
  /** The last lines of the conversation, oldest first, without the new message. */
  history: { from: 'player' | 'npc'; text: string }[];
  message: string;
  locale: Locale;
  /** The word groups the character listens for, normalized (lower case, no accents). */
  vocabulary: string[];
  /** The technique families the engine knows. */
  families: readonly Family[];
}

export interface BrainInput {
  npcId: string;
  name: string;
  /** The character's job, in the game's language. */
  role: string;
  kind: 'human' | 'ai';
  /** How the character talks. A sheet never holds a secret. */
  sheet?: string;
  /** The conversation so far, oldest first, without the new message. */
  history: { from: 'player' | 'npc'; text: string }[];
  message: string;
  locale: Locale;
  /** What the script decided to answer. The model says this, and nothing more. */
  scripted: string;
}

export type BrainIssue =
  | 'auth'
  | 'quota'
  | 'limit'
  | 'network'
  | 'refusal'
  | 'timeout'
  | 'rejected'
  | 'error';

/** Why a model could not answer. The game then uses the scripted reply as it is. */
export class BrainError extends Error {
  readonly issue: BrainIssue;
  constructor(issue: BrainIssue, message?: string) {
    super(message ?? issue);
    this.name = 'BrainError';
    this.issue = issue;
  }
}

const FLAG = /FLAG\{[^}]*\}/g;
const CODE = /`[^`]+`/g;

/**
 * A scripted reply is a spoken part, then sometimes a block the character pastes (a configuration,
 * a record). Only the spoken part may be reworded: the block is always added back as written.
 */
export function splitReply(scripted: string): { spoken: string; block: string } {
  const cut = scripted.indexOf('\n\n');
  return cut < 0
    ? { spoken: scripted, block: '' }
    : { spoken: scripted.slice(0, cut), block: scripted.slice(cut) };
}

/**
 * Deterministic check of a model's wording against the scripted reply. The model must carry every
 * flag and every `code` span of the script, unchanged, and must not make up a flag of its own.
 * Returns the cleaned text, or null when the scripted reply has to be used instead.
 */
export function acceptWording(spoken: string, candidate: string): string | null {
  const text = candidate.trim();
  if (!text || text.length > Math.max(600, spoken.length * 3)) return null;
  const flags = (s: string) => [...new Set(s.match(FLAG) ?? [])].sort().join('\n');
  if (flags(text) !== flags(spoken)) return null;
  // A flag cut in half would not match the pattern above.
  if (text.replace(FLAG, '').includes('FLAG{')) return null;
  for (const span of spoken.match(CODE) ?? []) if (!text.includes(span)) return null;
  return text;
}
