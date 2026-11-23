/**
 * Keeping a player's progress across game updates, and in a file they can carry to another browser.
 *
 * A save is the event log, and a log only replays faithfully on the packs it was recorded with.
 * When an update changes the world, or the mission the player was in the middle of, the log is not
 * replayed: the missions already finished are carried over with their scores, and the unfinished
 * one starts again from its beginning. An update that touches neither keeps the save as it is.
 */
import type { Pack } from '@breach/pack-schema';
import type { GameEvent } from './events.ts';

/** Finished missions and their scores, by mission id. */
export type Completed = Record<string, { score: number; defense?: number }>;

/** What a save looks like on disk, as far as resuming needs to know. Older saves lack `missions`. */
export interface SavedVersions {
  world?: { id?: unknown; version?: unknown };
  /** Version of each mission pack the log was recorded with. */
  missions?: Record<string, unknown>;
  log?: unknown;
}

export type ResumePlan =
  /** Nothing to resume. */
  | { kind: 'fresh' }
  /** The packs are the ones the log was recorded with: replay it. */
  | { kind: 'replay'; log: GameEvent[] }
  /**
   * The packs changed under the save: keep the finished missions, restart the unfinished one.
   * `restarted` is the mission that was in progress and starts over, if there was one.
   */
  | { kind: 'carry'; completed: Completed; restarted: string | null };

const isEvent = (e: unknown): e is GameEvent =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as GameEvent).type === 'string' &&
  Number.isSafeInteger((e as GameEvent).seq);

const validScore = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** The missions finished in a log, with their scores, including those carried over from an earlier save. */
export function completedIn(log: readonly unknown[]): Completed {
  const out: Completed = {};
  for (const e of log) {
    if (!isEvent(e)) continue;
    if (e.type === 'ProgressCarried' && typeof e.missions === 'object' && e.missions !== null)
      for (const [id, m] of Object.entries(e.missions)) {
        if (validScore(m?.score))
          out[id] = { score: m.score, ...(validScore(m.defense) ? { defense: m.defense } : {}) };
      }
    if (e.type === 'MissionCompleted' && typeof e.mission === 'string' && validScore(e.score))
      out[e.mission] = { score: e.score };
    // The defence replay of a finished mission adds its own points, kept apart from its score.
    if (e.type === 'DefenseCompleted' && typeof e.mission === 'string' && validScore(e.points)) {
      const done = out[e.mission];
      if (done) done.defense = e.points;
    }
  }
  return out;
}

/** The mission the log was last in, and whether it was finished. */
function lastMission(log: readonly GameEvent[]): { id: string; done: boolean } | null {
  let current: { id: string; done: boolean } | null = null;
  for (const e of log) {
    if (e.type === 'MissionStarted') current = { id: e.mission, done: false };
    else if (e.type === 'MissionCompleted' && current?.id === e.mission) current.done = true;
  }
  return current;
}

/**
 * Decide how to resume a save with the packs at hand. Replay when the world and the mission in
 * progress are the versions the log was recorded with, otherwise carry the finished missions over.
 * A save from before mission versions were recorded replays when its world matches, as it always did.
 */
export function planResume(
  save: SavedVersions | undefined,
  world: Pack,
  missions: readonly Pack[],
): ResumePlan {
  const raw = Array.isArray(save?.log) ? save.log : [];
  if (!raw.length) return { kind: 'fresh' };
  const log = raw.filter(isEvent);
  const known = new Map(missions.map((m) => [m.id, m.version]));
  const completed = Object.fromEntries(
    Object.entries(completedIn(log)).filter(([id]) => known.has(id)),
  ) as Completed;
  const current = lastMission(log);
  // A log that never entered a mission (an imported progress file) holds nothing tied to a version.
  if (!current && log.length === raw.length) return { kind: 'replay', log };
  const sameWorld = save?.world?.id === world.id && save?.world?.version === world.version;
  const recorded = save?.missions?.[current?.id ?? ''];
  const sameMission =
    current !== null &&
    known.has(current.id) &&
    (recorded === undefined || recorded === known.get(current.id));
  if (sameWorld && sameMission && log.length === raw.length) return { kind: 'replay', log };
  const restarted = current && !current.done && known.has(current.id) ? current.id : null;
  return { kind: 'carry', completed, restarted };
}

/* ---------- progress file ---------- */

export const PROGRESS_FORMAT = 'breach-progress';
export const PROGRESS_VERSION = 1;
/** A progress file is a few hundred bytes. Anything much larger is not one. */
export const MAX_PROGRESS_BYTES = 64 * 1024;
const MAX_MISSIONS = 200;
const MAX_SCORE = 1_000_000;
/** Official mission ids only: a progress file speaks for the campaign, never for community packs. */
const MISSION_ID = /^breach\.[a-z0-9][a-z0-9.-]{0,80}$/;

export interface ProgressFile {
  format: typeof PROGRESS_FORMAT;
  version: typeof PROGRESS_VERSION;
  exportedAt: string;
  missions: Completed;
}

export function progressFile(completed: Completed, now = new Date()): ProgressFile {
  return {
    format: PROGRESS_FORMAT,
    version: PROGRESS_VERSION,
    exportedAt: now.toISOString(),
    missions: completed,
  };
}

export class ProgressFileError extends Error {}

/**
 * Read a progress file chosen by the player. It is untrusted: every field is checked, anything
 * unexpected is refused as a whole rather than half-imported.
 */
export function parseProgressFile(text: string): ProgressFile {
  const fail = (why: string): never => {
    throw new ProgressFileError(why);
  };
  if (text.length > MAX_PROGRESS_BYTES) fail('too large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail('not JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('not an object');
  const file = data as Record<string, unknown>;
  for (const key of Object.keys(file))
    if (!['format', 'version', 'exportedAt', 'missions'].includes(key)) fail(`unexpected field ${key}`);
  if (file.format !== PROGRESS_FORMAT) fail('not a BREACH progress file');
  if (file.version !== PROGRESS_VERSION) fail('unsupported version');
  const exportedAt = file.exportedAt;
  if (typeof exportedAt !== 'string' || exportedAt.length > 40 || Number.isNaN(Date.parse(exportedAt)))
    fail('bad date');
  const missions = file.missions;
  if (typeof missions !== 'object' || missions === null || Array.isArray(missions)) fail('bad missions');
  const entries = Object.entries(missions as Record<string, unknown>);
  if (entries.length > MAX_MISSIONS) fail('too many missions');
  const out: Completed = {};
  for (const [id, value] of entries) {
    if (!MISSION_ID.test(id)) fail(`bad mission id`);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`bad entry for ${id}`);
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some((k) => k !== 'score' && k !== 'defense')) fail(`unexpected field in ${id}`);
    if (!validScore(entry.score) || entry.score > MAX_SCORE) fail(`bad score for ${id}`);
    if (entry.defense !== undefined && (!validScore(entry.defense) || entry.defense > MAX_SCORE))
      fail(`bad defence points for ${id}`);
    out[id] = {
      score: entry.score as number,
      ...(entry.defense === undefined ? {} : { defense: entry.defense as number }),
    };
  }
  return {
    format: PROGRESS_FORMAT,
    version: PROGRESS_VERSION,
    exportedAt: exportedAt as string,
    missions: out,
  };
}
