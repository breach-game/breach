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
  | {
      type: 'CommandRun';
      line: string;
      command: string;
      args: string[];
      cwd: string;
      dt: number;
      /** First command of a line the player typed: the unit the defence replay plays again. */
      input?: boolean;
    }
  | { type: 'ClockAdvanced'; ms: number }
  | { type: 'CwdChanged'; path: string }
  | { type: 'FileRead'; host: string; path: string }
  | { type: 'FileWritten'; host: string; path: string; content: string; append: boolean }
  | { type: 'DnsQuery'; name: string; rtype: string; found: boolean }
  | { type: 'WhoisQuery'; domain: string }
  | { type: 'Scan'; target: string; intensity: number }
  | { type: 'HostDiscovered'; host: string }
  | { type: 'ServiceDiscovered'; host: string; port: number }
  | {
      type: 'HttpRequest';
      host: string;
      path: string;
      method: string;
      status: number;
      /** User agent, for the target's access log. */
      ua?: string;
      bytes?: number;
    }
  /** An AI agent ran one of its tools (in the simulated world). */
  | { type: 'ToolCall'; agent: string; tool: string; args: string; admin: boolean }
  /** A setting of the target changed: a defender's fix or a containment. */
  | { type: 'ConfigPatched'; key: string; value: string | number | boolean; by: string }
  | { type: 'AppOpened'; app: 'browser'; url: string }
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
  | { type: 'MissionCompleted'; mission: string; score: number }
  /* Defence replay at the end of an attack mission. */
  | { type: 'DefenseStarted'; mission: string }
  /** The player marked log lines as theirs. `missing` lists the kinds of lines not found yet. */
  | { type: 'DefenseFound'; marked: string[]; wrong: string[]; missing: number[] }
  | { type: 'DefenseRuleChosen'; rule: string; correct: boolean }
  /** A fix was tried: the engine replayed the attack against the fixed target. */
  | { type: 'DefenseFixApplied'; fix: string; correct: boolean; blocked: boolean }
  | { type: 'DefenseCompleted'; mission: string; points: number }
  /* Defence missions. */
  | {
      type: 'AdversaryStep';
      actor: string;
      step: string;
      host: string;
      blocked: boolean;
      /** A blocked step stops the attacker, unless the step says it tries another way. */
      stop?: boolean;
    }
  | { type: 'Contained'; containment: string; impact: number }
  | { type: 'AnswerSubmitted'; question: string | null; correct: boolean }
  /** The attacker reached its goal in a defence mission. */
  | { type: 'MissionFailed'; key: string };

export type GameEvent = EventBody & { seq: number; t: number };
export type EventType = EventBody['type'];
