import type { Locale } from '@breach/pack-schema';
import type { FsDir } from './vfs.ts';

export type Scalar = string | number | boolean;

export interface Message {
  seq: number;
  t: number;
  npc: string;
  key: string;
  tone: 'info' | 'warn';
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
  notes: string[];
  messages: Message[];
  vars: Record<string, Scalar>;
  fired: Record<string, true>;
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
