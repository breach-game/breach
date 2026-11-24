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
  /** Host the terminal runs on: the player's workstation, or a host reached by SSH. */
  host: string;
  /** User of the current session. */
  user: string;
  /** Sessions left open behind the current one, the most recent last. */
  sessions: { host: string; user: string; cwd: string; prevCwd: string }[];
  /** File system of the host the terminal runs on. */
  fs: FsDir;
  /** File systems of every host visited so far, by host id, the current one included. */
  filesystems: Record<string, FsDir>;
  /** Cloned repositories: absolute path of the working tree to its origin. */
  repos: Record<string, { host: string; repo: string }>;
  /** Hosts found by the player, with the ports seen open. */
  discovered: Record<string, number[]>;
  /** Hidden hosts unlocked by a rule. */
  revealed: Record<string, true>;
  objectives: Record<string, boolean>;
  flags: Record<string, true>;
  /** Flag-shaped values the target has shown the player so far: `submit` takes no other. */
  shown: string[];
  noise: number;
  hints: Record<string, number>;
  hintsUsed: number;
  detections: number;
  /** Questions Ada asked in this mission, with the option that settled each one. */
  asked: Record<string, string | null>;
  /** Decisions taken in this game, by question id: kept from one mission to the next. */
  choices: Record<string, string>;
  /** Faulty lines found so far in each code review of this mission. */
  reviewed: Record<string, number[]>;
  /** Versions deployed of each service of the mission, the running one last. */
  deployed: Record<string, string[]>;
  /** Feature flags of the target, by name. */
  toggles: Record<string, 'on' | 'off'>;
  /** Timelines and attack paths the player got right in this mission. */
  ordered: Record<string, true>;
  traced: Record<string, true>;
  /** Wrong answers given in this mission, and lines wrongly named in a review. */
  mistakes: number;
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
  completed: Record<string, { score: number; defense?: number }>;
  /** Settings of the target (world, then mission, then fixes and containments). */
  config: Record<string, Scalar>;
  /** Progress of the defence replay of the current mission. */
  defense: DefenseState | null;
  /** Defence missions: the scripted attacker. */
  adversary: { next: number; actions: number; stopped: boolean; blockedAt: string | null };
  /** Business impact of the containments ordered, out of 100. */
  impact: number;
  contained: Record<string, true>;
  answers: Record<string, true>;
  history: string[];
  /** What a page last put on the workstation's clipboard. */
  clipboard?: string;
  /** Answers kept by a web cache, by host id then path. */
  cache?: Record<
    string,
    Record<string, { status: number; body: string; headers: Record<string, string>; t: number }>
  >;
}

export interface DefenseState {
  found: boolean;
  wrongMarks: number;
  findTries: number;
  rule: string | null;
  ruleTries: number;
  fix: string | null;
  fixTries: number;
  done: boolean;
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
