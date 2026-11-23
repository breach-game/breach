/**
 * The player's journey through the official seasons: season 1 is the NovaMind campaign, the next
 * ones are the catalogue's `seasons`. Everything here is pure, so the title screen, the seasons
 * screen and the last debrief of a season agree on what comes next, and the tests can check it.
 *
 * "What's new" is decided on this computer only: the game remembers which seasons, missions and
 * trainings it has already announced (`news:seen`), and nothing is sent anywhere.
 */
import type { CatalogEntry } from '@breach/pack-schema';

export interface Localized {
  fr?: string;
  en?: string;
}

/** Progress of one save: score of each finished mission by id, and the mission under way. */
export interface SeasonProgress {
  completed: Record<string, number>;
  current: string | null;
}

export interface Season {
  /** `campaign` for season 1, otherwise the id of the season's series pack. */
  id: string;
  /** 1 for the campaign, then 2, 3… in catalogue order. */
  number: number;
  kind: 'campaign' | 'season';
  /** The series pack of a season. The campaign has none. */
  entry?: CatalogEntry;
  /** Title of the world the season is played in (the company), for the kicker. */
  world?: Localized;
  missions: CatalogEntry[];
  progress: SeasonProgress;
}

export interface Journey {
  seasons: Season[];
  trainings: CatalogEntry[];
}

export type SeasonState = 'fresh' | 'started' | 'done';

export const CAMPAIGN = 'campaign';

/** Finished missions of a season, among those the catalogue lists today. */
export const doneCount = (s: Season): number => s.missions.filter((m) => m.id in s.progress.completed).length;

/** Points of a season: the finished missions it lists, defence replay included. */
export const seasonScore = (s: Season): number =>
  s.missions.reduce((sum, m) => sum + (s.progress.completed[m.id] ?? 0), 0);

/**
 * A season is done when every mission it lists is finished. A season that gained a mission after the
 * player finished it is under way again: the new mission is what comes next.
 */
export function seasonState(s: Season): SeasonState {
  const n = doneCount(s);
  if (s.missions.length > 0 && n === s.missions.length) return 'done';
  return n > 0 || s.progress.current !== null ? 'started' : 'fresh';
}

/** The mission a season resumes on: the one under way, or else the first one not finished. */
export function upNext(s: Season): CatalogEntry | null {
  const current = s.progress.current ? s.missions.find((m) => m.id === s.progress.current) : undefined;
  return current ?? s.missions.find((m) => !(m.id in s.progress.completed)) ?? null;
}

/** The number a mission shows: the campaign keeps its story numbers (from 00), a season counts from 01. */
export function missionLabel(s: Season, m: CatalogEntry): string {
  const n = s.kind === CAMPAIGN ? (m.order ?? s.missions.indexOf(m)) : s.missions.indexOf(m) + 1;
  return String(Math.max(n, 0)).padStart(2, '0');
}

export type Step =
  /** A season was started and is not finished (or gained a mission since): resume it. */
  | { kind: 'resume'; season: Season; mission: CatalogEntry }
  /** Nothing is under way, and this season was never played. */
  | { kind: 'start'; season: Season }
  /** Every season the game knows is finished. */
  | { kind: 'done' };

/**
 * What the player should do next. A season under way comes first, in season order; then the first
 * season never played; otherwise everything is done. Seasons with no mission are ignored.
 */
export function nextStep(seasons: readonly Season[]): Step {
  const playable = seasons.filter((s) => s.missions.length > 0);
  for (const season of playable) {
    if (seasonState(season) !== 'started') continue;
    const mission = upNext(season);
    if (mission) return { kind: 'resume', season, mission };
  }
  const fresh = playable.find((s) => seasonState(s) === 'fresh');
  return fresh ? { kind: 'start', season: fresh } : { kind: 'done' };
}

/** Has the player played anything at all, in any season? */
export const returning = (seasons: readonly Season[]): boolean =>
  seasons.some((s) => seasonState(s) !== 'fresh');

/** The same journey, with one season counted as finished: the debrief of its last mission. */
export function finishing(
  seasons: readonly Season[],
  id: string,
  completed: Record<string, number>,
): Season[] {
  return seasons.map((s) =>
    s.id === id
      ? { ...s, progress: { completed: { ...s.progress.completed, ...completed }, current: null } }
      : s,
  );
}

/* ---------- what's new ---------- */

export type News =
  | { key: string; kind: 'season'; season: Season }
  | { key: string; kind: 'mission'; season: Season; entry: CatalogEntry }
  | { key: string; kind: 'training'; entry: CatalogEntry };

export const seasonKey = (s: Season) => `season:${s.id}`;
export const missionKey = (m: CatalogEntry) => `mission:${m.id}`;
export const trainingKey = (m: CatalogEntry) => `training:${m.id}`;

/** Every key a journey can announce. */
export function allKeys(j: Journey): string[] {
  return [
    ...j.seasons.flatMap((s) => [seasonKey(s), ...s.missions.map(missionKey)]),
    ...j.trainings.map(trainingKey),
  ];
}

/** The keys a season news stands for: the season and its missions, so they are not announced again. */
export function newsKeys(n: News): string[] {
  return n.kind === 'season' ? [n.key, ...n.season.missions.map(missionKey)] : [n.key];
}

/**
 * The first time the game looks for news on this computer. A new player has nothing to catch up on:
 * everything counts as seen. A returning player (a save from before this screen existed) is told
 * about the seasons they never opened, and only about those.
 */
export function initialSeen(j: Journey): string[] {
  if (!returning(j.seasons)) return allKeys(j);
  const fresh = new Set(
    j.seasons.filter((s) => s.kind === 'season' && seasonState(s) === 'fresh').map(seasonKey),
  );
  return allKeys(j).filter((k) => !fresh.has(k));
}

/**
 * A season the player started by themselves is no news, nor are its missions: add them to what was
 * seen. Returns the same array when nothing changed.
 */
export function settleSeen(j: Journey, seen: readonly string[]): readonly string[] {
  const known = new Set(seen);
  const add = j.seasons
    .filter((s) => seasonState(s) !== 'fresh' && !known.has(seasonKey(s)))
    .flatMap((s) => [seasonKey(s), ...s.missions.map(missionKey)]);
  return add.length ? [...seen, ...add.filter((k) => !known.has(k))] : seen;
}

/**
 * What is new since the player last looked: seasons never announced and never played, missions added
 * to a season the player already knows (unless already finished), trainings never announced.
 */
export function findNews(j: Journey, seen: readonly string[]): News[] {
  const known = new Set(seen);
  const out: News[] = [];
  for (const season of j.seasons) {
    if (season.missions.length === 0) continue;
    if (!known.has(seasonKey(season))) {
      if (seasonState(season) === 'fresh') out.push({ key: seasonKey(season), kind: 'season', season });
      continue;
    }
    for (const entry of season.missions)
      if (!known.has(missionKey(entry)) && !(entry.id in season.progress.completed))
        out.push({ key: missionKey(entry), kind: 'mission', season, entry });
  }
  for (const entry of j.trainings)
    if (!known.has(trainingKey(entry))) out.push({ key: trainingKey(entry), kind: 'training', entry });
  return out;
}

/**
 * A title without its "Saison 2 :" prefix (and a mission's "Saison 2 · 1." one), which the kicker
 * and the mission number already say.
 */
export function bareTitle(title: string): string {
  const bare = title.replace(/^\s*(saison|season)\s+\d+\s*[:·—–-]\s*(\d+\s*[.·:]\s*)?/i, '');
  return bare ? bare.charAt(0).toLocaleUpperCase() + bare.slice(1) : title;
}
