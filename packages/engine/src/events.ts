/**
 * Everything that happens in the game is an event appended to the log.
 * State is rebuilt by applying the log, so the log is also the save file, the SOC's view of the
 * player, and the material for the Blue Team debrief.
 */
export type EventBody =
  | { type: 'MissionStarted'; mission: string }
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
  | { type: 'MissionCompleted'; mission: string; score: number };

export type GameEvent = EventBody & { seq: number; t: number };
export type EventType = EventBody['type'];
