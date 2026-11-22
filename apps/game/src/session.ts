/**
 * The running game: packs, engine instance, save file. React components read the engine's state
 * through `useGame()`, which re-renders them whenever an event is appended to the log.
 */
import { Game, type GameEvent, NOISE_DECAY_PER_MIN, type SaveData } from '@breach/engine';
import type { Catalog, CatalogEntry } from '@breach/pack-schema';
import { del, get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { type Campaign, loadCampaign, loadCommunityMission, type PackProgress } from './packs.ts';
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
  | { community: CatalogEntry; catalog: Catalog };

/** What is being played: the campaign, or a single mission outside it. */
export type PlayKind = 'campaign' | 'replay' | 'community';

/**
 * Where the running game is saved. A replayed or community mission has its own save, apart from
 * the campaign, so playing it never changes the campaign's progress or score.
 */
let saveKey = SAVE_KEY;
let kind: PlayKind = 'campaign';

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

export async function hasSave(): Promise<boolean> {
  const save = await get<SaveData>(SAVE_KEY).catch(() => undefined);
  return Boolean(save?.log?.length);
}

export async function prepare(onProgress?: (p: PackProgress) => void): Promise<Campaign> {
  campaign ??= await loadCampaign(onProgress);
  return campaign;
}

export interface CampaignProgress {
  /** Score of each finished mission, by id. */
  completed: Record<string, number>;
  /** The mission the campaign is on, if one was started and not finished. */
  current: string | null;
}

/** Progress of the saved campaign, read from its event log without starting a game. */
export async function campaignProgress(): Promise<CampaignProgress> {
  const save = await get<SaveData>(SAVE_KEY).catch(() => undefined);
  const completed: Record<string, number> = {};
  let current: string | null = null;
  for (const e of save?.log ?? []) {
    if (e.type === 'MissionStarted') current = e.mission;
    if (e.type === 'MissionCompleted') {
      completed[e.mission] = e.score;
      if (current === e.mission) current = null;
    }
  }
  return { completed, current };
}

/** The missions a mode plays: the whole campaign, or just one mission. */
async function missionsFor(mode: StartMode, onProgress?: (p: PackProgress) => void): Promise<Campaign> {
  if (typeof mode !== 'object') return prepare(onProgress);
  if ('community' in mode) return loadCommunityMission(mode.community, mode.catalog, onProgress);
  const c = await prepare(onProgress);
  const mission = c.missions.find((m) => m.id === mode.replay);
  if (!mission) throw new Error(`${mode.replay}: not a mission of this campaign`);
  return { ...c, missions: [mission] };
}

/**
 * Start a new campaign, or resume the saved one. A single mission (replayed or from the community)
 * resumes where the player left it, unless it was finished: then it starts over.
 */
export async function start(mode: StartMode, onProgress?: (p: PackProgress) => void): Promise<Game> {
  kind = typeof mode !== 'object' ? 'campaign' : 'community' in mode ? 'community' : 'replay';
  const c = await missionsFor(mode, onProgress);
  const single = c.missions[0];
  saveKey = kind === 'campaign' || !single ? SAVE_KEY : `save:${kind}:${single.id}@${single.version}`;
  const community = kind !== 'campaign';
  const locale = getSettings().locale;
  let log: GameEvent[] | undefined;
  if (mode !== 'new') {
    const save = await get<SaveData>(saveKey).catch(() => undefined);
    // A save only replays on the world version it was recorded with.
    if (save && save.world.id === c.world.id && save.world.version === c.world.version) log = save.log;
    if (community && log?.some((e) => e.type === 'MissionCompleted')) log = undefined;
  }
  game = new Game({ world: c.world, missions: c.missions, locale, guidance: getSettings().guidance, log });
  resumedAt = game.log.at(-1)?.seq ?? 0;
  game.subscribe((event) => {
    for (const l of eventListeners) l(event);
    notify();
    persist();
  });
  if (!game.state.mission) {
    const first = game.nextMission();
    if (first) game.startMission(first.id);
    // Ask the browser not to evict the save (Safari clears site data after seven idle days).
    void navigator.storage?.persist?.().catch(() => {});
  }
  lastActivity = performance.now();
  notify();
  return game;
}

/** What the running game is: the campaign, a replayed mission or a community mission. */
export const playKind = (): PlayKind => kind;

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
