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
  | {
      type: 'FileWritten';
      host: string;
      path: string;
      content: string;
      append: boolean;
      /** Create the missing folders first (an archive extracted in place). */
      dirs?: boolean;
    }
  | { type: 'FileRemoved'; host: string; path: string }
  /** `sbom --vuln` matched a project's components against the published advisories. */
  | { type: 'SbomScanned'; target: string; components: number; findings: string[] }
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
      /** The variant of the route that answered, when the request carried its cookie or header. */
      variant?: string;
    }
  /** An AI agent ran one of its tools (in the simulated world). */
  | { type: 'ToolCall'; agent: string; tool: string; args: string; admin: boolean }
  /** A setting of the target changed: a defender's fix or a containment. */
  | { type: 'ConfigPatched'; key: string; value: string | number | boolean; by: string }
  | { type: 'AppOpened'; app: 'browser' | 'editor'; url: string }
  | {
      type: 'ChatSent';
      npc: string;
      text: string;
      via: 'browser' | 'api' | 'call';
      /** The number dialled, for a telephone call. */
      to?: string;
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
  /** A flag-shaped value appeared in an output, a page, a reply or a file the player opened. */
  | { type: 'FlagShown'; value: string }
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
  /** `decision` marks a question with no right option; `impact` is what that choice costs. */
  | { type: 'Answered'; question: string; option: string; correct: boolean; decision?: true; impact?: number }
  | {
      type: 'RuleTested';
      hunt: string;
      caught: number;
      missed: number;
      falsePositives: number;
      passed: boolean;
    }
  /** The player tried a guardrail against the cases of the mission. */
  | { type: 'EvalRun'; eval: string; blocked: number; missed: number; wrongly: number; passed: boolean }
  /** The player named a line of a code review as faulty. */
  | { type: 'Reviewed'; review: string; line: number; correct: boolean }
  /** `ps`, `ss`, `systemctl`, `journalctl` or `last` read what a host runs. */
  | {
      type: 'SystemRead';
      host: string;
      what: 'ps' | 'ss' | 'systemctl' | 'journalctl' | 'last';
      unit?: string;
    }
  /** `ldapsearch` read a directory. `bind` is the account used, empty for an anonymous search. */
  | {
      type: 'LdapSearch';
      host: string;
      base: string;
      filter: string;
      bind: string;
      entries: number;
      ok: boolean;
    }
  /** A version of a service went to production (`deploy`, `rollback`). */
  | { type: 'Deployed'; service: string; version: string; from: string; rollback: boolean; impact: number }
  /** A feature flag of the target was switched. */
  | { type: 'ToggleSet'; name: string; value: 'on' | 'off'; impact: number }
  /** The player put the events of a timeline in an order. `placed` counts those in the right place. */
  | { type: 'TimelineOrdered'; timeline: string; correct: boolean; placed: number }
  /** The player named the hosts of an attack path. */
  | { type: 'PathTraced'; path: string; correct: boolean }
  /** `verify` ran: which of the mission's checks hold now. */
  | { type: 'Verified'; passed: string[]; failed: string[] }
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
  | { type: 'MissionFailed'; key: string }
  /**
   * Missions finished in an earlier save, kept with their scores: the save could not be replayed
   * after an update changed its packs, or the player imported a progress file. Always the first event.
   */
  | {
      type: 'ProgressCarried';
      missions: Record<string, { score: number; defense?: number }>;
      source: 'update' | 'import';
    };

export type GameEvent = EventBody & { seq: number; t: number };
export type EventType = EventBody['type'];
