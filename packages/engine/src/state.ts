import type { Guidance, Locale } from '@breach/pack-schema';
import type { FsDir } from './vfs.ts';

export type Scalar = string | number | boolean;

export interface Message {
  seq: number;
  t: number;
  npc: string;
  key: string;
  tone: 'info' | 'warn';
}

export interface ChatLine {
  seq: number;
  t: number;
  from: 'player' | 'npc';
  /** What the player typed, or what a language model answered. */
  text?: string;
  /** Translation key of a scripted reply. */
  key?: string;
  intent?: string;
}

export interface GameState {
  locale: Locale;
  mission: string | null;
  /** Game time in milliseconds since the world's start date. */
  clock: number;
  cwd: string;
  prevCwd: string;
  /** File system of the player's workstation. */
  fs: FsDir;
  /** Cloned repositories: absolute path of the working tree to its origin. */
  repos: Record<string, { host: string; repo: string }>;
  /** Hosts found by the player, with the ports seen open. */
  discovered: Record<string, number[]>;
  /** Hidden hosts unlocked by a rule. */
  revealed: Record<string, true>;
  objectives: Record<string, boolean>;
  flags: Record<string, true>;
  noise: number;
  hints: Record<string, number>;
  hintsUsed: number;
  detections: number;
  /** Most helpful guidance level used in this mission. Null on saves made before levels were scored. */
  level: Guidance | null;
  notes: string[];
  messages: Message[];
  /** Conversations of the current mission, by character. */
  chats: Record<string, ChatLine[]>;
  vars: Record<string, Scalar>;
  fired: Record<string, true>;
  /** Furthest guidance step already given for each objective. */
  guided: Record<string, number>;
  checkpoint: { name: string; seq: number } | null;
  missionStartSeq: number;
  missionDone: boolean;
  completed: Record<string, { score: number }>;
  history: string[];
}

/** Noise points lost per minute of game time. */
export const NOISE_DECAY_PER_MIN = 4;
export const NOISE_MAX = 100;
export const NOISE_AFTER_RESTORE = 25;

export function socLevel(noise: number): 'watch' | 'alert' | 'hunt' {
  if (noise >= 70) return 'hunt';
  if (noise >= 40) return 'alert';
  return 'watch';
}
