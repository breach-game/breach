import type { Guidance } from '@breach/pack-schema';
/**
 * Everything that happens in the game is an event appended to the log.
 * State is rebuilt by applying the log, so the log is also the save file, the SOC's view of the
 * player, and the material for the Blue Team debrief.
 */
export type EventBody =
  | { type: 'MissionStarted'; mission: string }
  /** The most helpful guidance level used so far in the mission: it sets the score bonus. */
  | { type: 'GuidanceChanged'; level: Guidance }
  | { type: 'CommandRun'; line: string; command: string; args: string[]; cwd: string; dt: number }
  | { type: 'ClockAdvanced'; ms: number }
  | { type: 'CwdChanged'; path: string }
  | { type: 'FileRead'; host: string; path: string }
  | { type: 'FileWritten'; host: string; path: string; content: string; append: boolean }
  | { type: 'DnsQuery'; name: string; rtype: string; found: boolean }
  | { type: 'WhoisQuery'; domain: string }
  | { type: 'Scan'; target: string; intensity: number }
  | { type: 'HostDiscovered'; host: string }
  | { type: 'ServiceDiscovered'; host: string; port: number }
  | { type: 'HttpRequest'; host: string; path: string; method: string; status: number }
  | { type: 'AppOpened'; app: 'browser' | 'editor'; url: string }
  | {
      type: 'ChatSent';
      npc: string;
      text: string;
      via: 'browser' | 'api';
      /** What a language model understood in the message, already checked, when it interpreted it. */
      heard?: { words: string[]; families: string[] };
    }
  | {
      type: 'ChatReply';
      npc: string;
      /** Translation key of a scripted reply. */
      key?: string;
      /** Literal reply, when a language model wrote it. */
      text?: string;
      /** The scripted intent that decided what this reply may contain. */
      intent: string;
      families: string[];
      brain: string;
    }
  /** The terminal now runs on another host, reached by SSH. */
  | { type: 'SessionOpened'; host: string; user: string }
  /** `exit` from an SSH session: back to the host it was opened from. */
  | { type: 'SessionClosed'; host: string }
  | { type: 'RepoCloned'; host: string; repo: string; path: string }
  | { type: 'CommitViewed'; host: string; repo: string; commit: string }
  | { type: 'OutOfScope'; target: string; command: string }
  | { type: 'FlagSubmitted'; flag: string | null; correct: boolean }
  | {
      type: 'NpcMessage';
      npc: string;
      key: string;
      tone: 'info' | 'warn';
      /** Set on guidance: which objective it helps with, and how far along. */
      guide?: { objective: string; step: number };
    }
  | { type: 'ObjectiveCompleted'; objective: string }
  | { type: 'NoiseChanged'; delta: number; value: number; cause: string }
  | { type: 'HintUsed'; objective: string; level: number }
  | { type: 'NoteAdded'; text: string }
  | { type: 'CheckpointSaved'; name: string }
  | { type: 'Detected' }
  | { type: 'Restored'; checkpoint: string; detections: number }
  | { type: 'RuleFired'; rule: string }
  | { type: 'VarSet'; name: string; value: string | number | boolean }
  | { type: 'HostRevealed'; host: string }
  /** Ada put a question of the mission to the player. */
  | { type: 'Asked'; question: string }
  | { type: 'Answered'; question: string; option: string; correct: boolean }
  /** `verify` ran: which of the mission's checks hold now. */
  | { type: 'Verified'; passed: string[]; failed: string[] }
  | { type: 'MissionCompleted'; mission: string; score: number }
  /**
   * Missions finished in an earlier save, kept with their scores: the save could not be replayed
   * after an update changed its packs, or the player imported a progress file. Always the first event.
   */
  | { type: 'ProgressCarried'; missions: Record<string, { score: number }>; source: 'update' | 'import' };

export type GameEvent = EventBody & { seq: number; t: number };
export type EventType = EventBody['type'];
