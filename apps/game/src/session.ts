/**
 * The running game: packs, engine instance, save file. React components read the engine's state
 * through `useGame()`, which re-renders them whenever an event is appended to the log.
 */
import {
  type Completed,
  completedIn,
  ENGINE_VERSION,
  Game,
  type GameEvent,
  NOISE_DECAY_PER_MIN,
  type ProgressFile,
  parseProgressFile,
  planResume,
  progressFile,
  type ResumePlan,
  type SaveData,
} from '@breach/engine';
import { type Catalog, type CatalogEntry, isOfficialId, type Pack } from '@breach/pack-schema';
import { del, get, keys, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { type Career, career, everFinished, type Grade } from './career.ts';
import { CAMPAIGN, type Journey, type Season } from './journey.ts';
import { localSaveKey } from './local.ts';
import {
  type Campaign,
  loadCampaign,
  loadCatalog,
  loadCommunityMission,
  loadPack,
  loadSeason,
  loadSeasons,
  type PackProgress,
  seriesMissions,
} from './packs.ts';
import { getSettings } from './settings.ts';

const SAVE_KEY = 'save:campaign';

/**
 * How a game starts: the official campaign, new or resumed; one official mission the player has
 * already reached, replayed on its own; or one community mission.
 */
export type StartMode =
  | 'new'
  | 'continue'
  | { replay: string }
  | { community: CatalogEntry; catalog: Catalog; restart?: boolean }
  /** A mission or series imported from a file: its id, and the SHA-256 of that file. */
  | { local: string; bundle: string; restart?: boolean }
  | { season: string; restart?: boolean };

/** What is being played: the campaign, a season, a single mission, or one community mission. */
export type PlayKind = 'campaign' | 'season' | 'replay' | 'community';

/**
 * Where the running game is saved. A replayed or community mission has its own save, apart from
 * the campaign, so playing it never changes the campaign's progress or score.
 */
let saveKey = SAVE_KEY;
let kind: PlayKind = 'campaign';
/** The season being played: `campaign` (season 1), a season's id, or null for anything else. */
let seasonId: string | null = CAMPAIGN;

let game: Game | null = null;
let campaign: Campaign | null = null;
let version = 0;
let lastActivity = performance.now();
/** Last event of a resumed save. Messages up to it are shown without the typewriter effect. */
let resumedAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: GameEvent) => void>();

function notify() {
  version++;
  for (const l of listeners) l();
}

function persist() {
  clearTimeout(saveTimer);
  const [g, key] = [game, saveKey];
  saveTimer = setTimeout(() => {
    if (g) void set(key, g.save()).catch(() => {});
  }, 300);
}

/** Write the running game now, before the page goes away. */
export async function flushSave() {
  clearTimeout(saveTimer);
  if (game) await set(saveKey, game.save()).catch(() => {});
}

export async function hasSave(): Promise<boolean> {
  const save = await get<SaveData>(SAVE_KEY).catch(() => undefined);
  return Boolean(save?.log?.length);
}

export async function prepare(onProgress?: (p: PackProgress) => void): Promise<Campaign> {
  campaign ??= await loadCampaign(onProgress);
  return campaign;
}

export interface CampaignProgress {
  /** Score of each finished mission, by id, defence replay included (as the debrief shows it). */
  completed: Record<string, number>;
  /** The mission the campaign is on, if one was started and not finished. */
  current: string | null;
}

/** Progress of the saved campaign, read from its event log without starting a game. */
export async function campaignProgress(): Promise<CampaignProgress> {
  const save = await get<SaveData>(SAVE_KEY).catch(() => undefined);
  const log = Array.isArray(save?.log) ? save.log : [];
  // Missions carried over from an earlier save (after an update, or imported) count as finished.
  const completed = Object.fromEntries(
    Object.entries(completedIn(log)).map(([id, m]) => [id, m.score + (m.defense ?? 0)]),
  );
  let current: string | null = null;
  for (const e of log) {
    if (e.type === 'MissionStarted') current = e.mission;
    if (e.type === 'MissionCompleted' && current === e.mission) current = null;
  }
  return { completed, current };
}

/** Progress of a series save (`community` or `season`): finished missions and the one under way. */
async function savedProgress(key: string): Promise<CampaignProgress> {
  const save = await get<SaveData>(key).catch(() => undefined);
  const log = Array.isArray(save?.log) ? save.log : [];
  const completed = Object.fromEntries(
    Object.entries(completedIn(log)).map(([id, m]) => [id, m.score + (m.defense ?? 0)]),
  );
  let current: string | null = null;
  for (const e of log) {
    if (e.type === 'MissionStarted') current = e.mission;
    if (e.type === 'MissionCompleted' && current === e.mission) current = null;
  }
  return { completed, current };
}

/** Progress of a community series, read from its own save: finished missions and the one under way. */
export function seriesProgress(series: CatalogEntry): Promise<CampaignProgress> {
  return savedProgress(`save:community:${series.id}@${series.version}`);
}

/** Progress of a mission or series imported from a file, read from its own save. */
export function localProgress(entry: CatalogEntry, bundle: string): Promise<CampaignProgress> {
  return savedProgress(localSaveKey(entry, bundle));
}

/** Progress of an official season, read from its own save. */
export function seasonProgress(series: CatalogEntry): Promise<CampaignProgress> {
  return savedProgress(`save:season:${series.id}@${series.version}`);
}

/**
 * Every official season with the player's progress in it: the campaign as season 1, then the
 * catalogue's seasons, and the trainings. Read from the saves, without starting a game.
 */
export async function loadJourney(): Promise<Journey> {
  const catalog = await loadCatalog();
  const world = (id: string | undefined) =>
    catalog.packs.find((p) => p.id === id && p.kind === 'world')?.title;
  const missions = catalog.campaign
    .map((id) => catalog.packs.find((p) => p.id === id && p.kind === 'mission'))
    .filter((e): e is CatalogEntry => !!e);
  const seasons: Season[] = [
    {
      id: CAMPAIGN,
      number: 1,
      kind: 'campaign',
      world: world(missions[0]?.requires[0]),
      missions,
      progress: await campaignProgress(),
    },
  ];
  const { seasons: entries } = await loadSeasons();
  for (const [i, entry] of entries.entries())
    seasons.push({
      id: entry.id,
      number: i + 2,
      kind: 'season',
      entry,
      world: world(entry.requires[0]),
      missions: seriesMissions(entry, catalog),
      progress: await seasonProgress(entry),
    });
  const trainings = catalog.training
    .map((id) => catalog.packs.find((p) => p.id === id && p.kind === 'mission'))
    .filter((e): e is CatalogEntry => !!e);
  return { seasons, trainings };
}

const SEEN_KEY = 'news:seen';

/** What the title screen already announced on this computer, or null the first time. */
export async function readSeen(): Promise<string[] | null> {
  const seen = await get<unknown>(SEEN_KEY).catch(() => undefined);
  return Array.isArray(seen) ? seen.filter((k): k is string => typeof k === 'string') : null;
}

/** Remember more announced keys. Kept on this computer only, like the saves. */
export async function markSeen(keys: readonly string[]): Promise<void> {
  const seen = (await readSeen()) ?? [];
  const known = new Set(seen);
  const add = keys.filter((k) => !known.has(k));
  if (add.length) await set(SEEN_KEY, [...seen, ...add]).catch(() => {});
}

/** Overwrite what was announced (first look, or a season started by the player). */
export async function writeSeen(keys: readonly string[]): Promise<void> {
  await set(SEEN_KEY, [...keys]).catch(() => {});
}

const CAREER_KEY = 'career:done';

/** Seasons ever finished on this computer, or null before the career was first settled. */
export async function readCareer(): Promise<string[] | null> {
  const done = await get<unknown>(CAREER_KEY).catch(() => undefined);
  return Array.isArray(done) ? done.filter((k): k is string => typeof k === 'string') : null;
}

let gradeNow: Grade = 'junior';
const gradeListeners = new Set<() => void>();

/** The grade last read from the saves, for the workstation's looks and the status bar. */
export const currentGrade = (): Grade => gradeNow;

export function useGrade(): Grade {
  return useSyncExternalStore(
    (l) => {
      gradeListeners.add(l);
      return () => gradeListeners.delete(l);
    },
    () => gradeNow,
  );
}

/**
 * Remember the seasons finished today, and return the career they make. Kept on this computer
 * only, like the saves; nothing is sent anywhere.
 */
export async function settleCareer(seasons: readonly Season[]): Promise<Career> {
  const stored = (await readCareer()) ?? [];
  const done = everFinished(seasons, stored);
  if (done.length !== stored.length) await set(CAREER_KEY, done).catch(() => {});
  const c = career(done.length);
  if (c.grade !== gradeNow) {
    gradeNow = c.grade;
    for (const l of gradeListeners) l();
  }
  return c;
}

/** Best known result of each mission played on its own (trainings, replays), by id: its last score. */
export async function singleScores(entries: CatalogEntry[]): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  for (const e of entries) {
    const save = await get<SaveData>(`save:replay:${e.id}@${e.version}`).catch(() => undefined);
    const done = Array.isArray(save?.log) ? save.log.findLast((x) => x.type === 'MissionCompleted') : null;
    if (done?.type === 'MissionCompleted') scores[e.id] = done.score;
  }
  return scores;
}

/** The missions a mode plays: the whole campaign, or just one mission. */
async function missionsFor(mode: StartMode, onProgress?: (p: PackProgress) => void): Promise<Campaign> {
  if (typeof mode !== 'object') return prepare(onProgress);
  if ('community' in mode) return loadCommunityMission(mode.community, mode.catalog, onProgress);
  if ('local' in mode) {
    const { loadLocalMission } = await import('./localStore.ts');
    return loadLocalMission(mode.local, mode.bundle, onProgress);
  }
  if ('season' in mode) return loadSeason(mode.season, onProgress);
  // A training: an official mission outside the campaign, played in whichever official world it names.
  const catalog = await loadCatalog();
  const training = catalog.training.includes(mode.replay)
    ? catalog.packs.find((p) => p.id === mode.replay && p.kind === 'mission')
    : undefined;
  if (training) {
    const world = catalog.packs.find((p) => p.id === training.requires[0] && p.kind === 'world');
    if (!world) throw new Error(`${training.id}: its world ${training.requires[0]} is not in the catalogue`);
    return {
      catalog,
      world: await loadPack(world, onProgress),
      missions: [await loadPack(training, onProgress)],
    };
  }
  const c = await prepare(onProgress);
  const mission = c.missions.find((m) => m.id === mode.replay);
  if (mission) return { ...c, missions: [mission] };
  throw new Error(`${mode.replay}: not a mission of this campaign`);
}

/** A save of the same single mission recorded on another version of it, which can no longer resume. */
async function outdatedSingleSave(prefix: string, current: string): Promise<boolean> {
  const all = await keys().catch(() => []);
  return all.some((k) => typeof k === 'string' && k.startsWith(prefix) && k !== current);
}

/** The first event of a save whose finished missions were kept, but whose log could not replay. */
const carried = (missions: Completed, source: 'update' | 'import'): GameEvent => ({
  type: 'ProgressCarried',
  missions,
  source,
  seq: 1,
  t: 0,
});

/**
 * Start a new campaign, or resume the saved one. A save resumes as it was when the update since it
 * was made left its world and its mission in progress alone. Otherwise the finished missions are
 * kept with their scores, the unfinished one starts again, and Ada says so. A single mission
 * (replayed or from the community) resumes where the player left it, unless it was finished or
 * updated since: then it starts over.
 */
export async function start(mode: StartMode, onProgress?: (p: PackProgress) => void): Promise<Game> {
  kind =
    typeof mode !== 'object'
      ? 'campaign'
      : 'community' in mode || 'local' in mode
        ? 'community'
        : 'season' in mode
          ? 'season'
          : 'replay';
  const c = await missionsFor(mode, onProgress);
  seasonId =
    kind === 'campaign' ? CAMPAIGN : typeof mode === 'object' && 'season' in mode ? mode.season : null;
  const single = c.missions[0];
  // A community series or a season is a small campaign: one save for all its missions, resumed like
  // the campaign. A season is named by its id; its version comes from the catalogue it was loaded from.
  const seasonEntry =
    typeof mode === 'object' && 'season' in mode
      ? c.catalog.packs.find((p) => p.id === mode.season && p.kind === 'series')
      : undefined;
  // An imported file plays like a community mission, saved apart under the file's fingerprint.
  const local = typeof mode === 'object' && 'local' in mode ? mode : null;
  const localPack = local && 'pack' in c ? (c as Campaign & { pack: Pack }).pack : undefined;
  const series =
    (typeof mode === 'object' && 'community' in mode && mode.community.kind === 'series') ||
    !!seasonEntry ||
    localPack?.kind === 'series';
  const saved =
    typeof mode === 'object' && 'community' in mode && mode.community.kind === 'series'
      ? mode.community
      : (seasonEntry ?? localPack ?? single);
  saveKey =
    kind === 'campaign' || !saved
      ? SAVE_KEY
      : local
        ? localSaveKey(saved, local.bundle)
        : `save:${kind}:${saved.id}@${saved.version}`;
  const savePrefix = local ? `save:local:${single?.id}@` : `save:${kind}:${single?.id}@`;
  const alone = kind !== 'campaign' && !series;
  const options = {
    world: c.world,
    missions: c.missions,
    locale: getSettings().locale,
    guidance: getSettings().guidance,
  };
  let plan: ResumePlan = { kind: 'fresh' };
  let notice: string | null = null;
  if (mode !== 'new' && !(typeof mode === 'object' && 'restart' in mode && mode.restart)) {
    const save = await get<SaveData>(saveKey).catch(() => undefined);
    plan = planResume(save, c.world, c.missions);
    if (alone && single) {
      const finished = plan.kind === 'replay' && plan.log.some((e) => e.type === 'MissionCompleted');
      const outdated =
        plan.kind === 'carry' || (plan.kind === 'fresh' && (await outdatedSingleSave(savePrefix, saveKey)));
      if (outdated) notice = 'save.mission.restart';
      if (finished || plan.kind === 'carry') plan = { kind: 'fresh' };
    }
  }
  game = null;
  if (plan.kind === 'replay') {
    try {
      game = new Game({ ...options, log: plan.log });
      const first = plan.log[0];
      if (plan.log.length === 1 && first?.type === 'ProgressCarried' && first.source === 'import')
        notice = 'save.import';
    } catch {
      // A log the engine cannot replay: keep what it proves was finished, as after an update.
      const ids = new Set(c.missions.map((m) => m.id));
      const done = Object.entries(completedIn(plan.log)).filter(([id]) => ids.has(id));
      plan = alone
        ? { kind: 'fresh' }
        : { kind: 'carry', completed: Object.fromEntries(done), restarted: null };
      if (alone) notice = 'save.mission.restart';
    }
  }
  if (plan.kind === 'carry') {
    game = new Game({ ...options, log: [carried(plan.completed, 'update')] });
    notice = plan.restarted ? 'save.update.restart' : 'save.update.kept';
  }
  game ??= new Game(options);
  const g = game;
  resumedAt = g.log.at(-1)?.seq ?? 0;
  g.subscribe((event) => {
    for (const l of eventListeners) l(event);
    notify();
    persist();
  });
  if (notice) g.emit({ type: 'NpcMessage', npc: 'ada', key: notice, tone: 'info' });
  if (!g.state.mission) {
    const first = g.nextMission();
    if (first) g.startMission(first.id);
    // Ask the browser not to evict the save (Safari clears site data after seven idle days).
    void navigator.storage?.persist?.().catch(() => {});
  }
  // A carried save is written at once, so the notice is not repeated on the next start.
  if (notice) persist();
  lastActivity = performance.now();
  notify();
  return g;
}

/* ---------- progress file ---------- */

/** Finished official missions of a save, by id, with their scores. */
async function savedMissions(key: string): Promise<Completed | null> {
  const save = await get<SaveData>(key).catch(() => undefined);
  if (!Array.isArray(save?.log)) return null;
  return Object.fromEntries(Object.entries(completedIn(save.log)).filter(([id]) => isOfficialId(id)));
}

/**
 * The finished missions of the campaign and of every season, with their scores, ready to download.
 * Null without any save. Mission ids are unique across the official content, so one list is enough.
 */
export async function exportProgress(): Promise<ProgressFile | null> {
  const all: IDBValidKey[] = await keys().catch(() => []);
  const seasonKeys: string[] = all.filter(
    (k): k is string => typeof k === 'string' && k.startsWith('save:season:'),
  );
  const saves = await Promise.all([SAVE_KEY, ...seasonKeys].map((k) => savedMissions(k)));
  if (saves.every((s) => s === null)) return null;
  return progressFile(Object.assign({}, ...saves.filter((s) => s !== null)));
}

/** A save holding only finished missions: it replays on any world, nothing in it depends on a version. */
const carriedSave = (missions: Completed): SaveData => ({
  engine: ENGINE_VERSION,
  world: { id: '', version: '' },
  locale: getSettings().locale,
  log: [carried(missions, 'import')],
});

/**
 * Replace the campaign save by the missions of a progress file. The file is untrusted: it is read
 * strictly, and only its list of finished missions and scores is kept. Throws on a bad file.
 * Missions of a season go to that season's own save, which they replace; the rest is the campaign.
 */
export async function importProgress(text: string): Promise<{ missions: number; score: number }> {
  const file = parseProgressFile(text);
  clearTimeout(saveTimer);
  game = null;
  const campaignMissions = { ...file.missions };
  const { catalog, seasons } = await loadSeasons().catch(() => ({ catalog: null, seasons: [] }));
  for (const season of catalog ? seasons : []) {
    const ids = seriesMissions(season, catalog!).map((m) => m.id);
    const mine = Object.fromEntries(
      ids.filter((id) => id in campaignMissions).map((id) => [id, campaignMissions[id]!]),
    );
    if (Object.keys(mine).length === 0) continue;
    for (const id of ids) delete campaignMissions[id];
    await set(`save:season:${season.id}@${season.version}`, carriedSave(mine));
  }
  await set(SAVE_KEY, carriedSave(campaignMissions));
  notify();
  const scores = Object.values(file.missions);
  return { missions: scores.length, score: scores.reduce((sum, m) => sum + m.score, 0) };
}

/** What the running game is: the campaign, a replayed mission or a community mission. */
export const playKind = (): PlayKind => kind;

/** The season being played (`campaign` for season 1), or null outside the seasons. */
export const playedSeason = (): string | null => seasonId;

/**
 * The number shown for the mission being played. The campaign keeps the numbers of its story
 * (its mandate is mission 00). A season or a community series counts its missions from 01, as its
 * screen lists them, whatever `order` its packs start from.
 */
export function missionNumber(g: Game): string {
  const pack = g.state.mission ? g.missions.get(g.state.mission) : undefined;
  const n =
    kind === 'season' || kind === 'community'
      ? g.campaign.findIndex((m) => m.id === pack?.id) + 1
      : (pack?.mission?.order ?? 0);
  return String(Math.max(n, 0)).padStart(2, '0');
}

export async function eraseSave() {
  clearTimeout(saveTimer);
  game = null;
  await del(SAVE_KEY).catch(() => {});
  notify();
}

export const resumeSeq = () => resumedAt;

export function currentGame(): Game {
  if (!game) throw new Error('no game running');
  return game;
}

export function onGameEvent(listener: (e: GameEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/** Subscribe a component to the game. Returns the engine; the component re-renders on every event. */
export function useGame(): Game {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return currentGame();
}

/** Real milliseconds since the last command finished: sent to the engine as `dt`. */
export function elapsed(): number {
  return performance.now() - lastActivity;
}

export function touch() {
  lastActivity = performance.now();
}

/** Noise as the gauge should show it right now, with decay since the last command. */
export function liveNoise(g: Game): number {
  return Math.max(0, g.state.noise - (NOISE_DECAY_PER_MIN * Math.min(elapsed(), 5 * 60_000)) / 60_000);
}

export function liveClock(g: Game): number {
  return g.state.clock + Math.min(elapsed(), 5 * 60_000);
}

/** Lets other windows type a command into the terminal (the notebook's "hint" button). */
export const terminalBridge: { run?: (line: string) => void; focus?: () => void } = {};
