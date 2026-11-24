export { GUIDANCE_LEVELS, type Guidance } from '@breach/pack-schema';
export { readQr } from './artifact.ts';
export {
  acceptWording,
  BrainError,
  type BrainInput,
  type BrainIssue,
  type HearInput,
  type NpcBrain,
  splitReply,
} from './brain.ts';
export { normalizeAnswer } from './commands/defense.ts';
export { commands } from './commands/index.ts';
export type { Chunk, Command } from './commands/types.ts';
export type { EventBody, EventType, GameEvent } from './events.ts';
export {
  allowedLevel,
  type BrowseResult,
  type ChatResult,
  ENGINE_VERSION,
  Game,
  type GameOptions,
  LEVEL_BONUS,
  type ReplayReport,
  type ReplayStep,
  type SaveData,
  type ScoreDetail,
} from './game.ts';
export { formatUrl, pageHtml, parseUrl } from './http.ts';
export { engineStrings, interpolate } from './i18n.ts';
export {
  acceptHearing,
  decide,
  detectFamilies,
  type Heard,
  inputShapes,
  normalizeText,
  versionAbove,
  versionIn,
  vocabulary,
} from './npc.ts';
export {
  type Completed,
  completedIn,
  MAX_PROGRESS_BYTES,
  type ProgressFile,
  ProgressFileError,
  parseProgressFile,
  planResume,
  progressFile,
  type ResumePlan,
} from './progress.ts';
export { qrMatrix } from './qr.ts';
export { pentestReport } from './report.ts';
export { type SocEntry, socView } from './soc.ts';
export {
  type ChatLine,
  type GameState,
  type Message,
  NOISE_DECAY_PER_MIN,
  NOISE_MAX,
  socLevel,
} from './state.ts';
export {
  backgroundLines,
  type DetectionResult,
  LOG_FILES,
  type LogLine,
  runDetection,
  selects,
  sigmaText,
  telemetry,
} from './telemetry.ts';
export { gameDate, sanitizeTerminal, sha256, stripAnsi } from './util.ts';
