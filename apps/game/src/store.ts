/**
 * The community store: what the list shows for each catalogue entry, and how the player searches,
 * filters and sorts it. Pure functions, without React or storage, so they are tested on their own.
 */
import type { Catalog, CatalogEntry, Locale, Skill } from '@breach/pack-schema';

/**
 * Where an entry belongs. `real` packs retell a real incident; `local` ones were imported from a file;
 * `paths` suggest an order through missions; `challenges` are played at Expert only.
 */
export type Collection = 'paths' | 'challenges' | 'real' | 'players' | 'examples' | 'local';
export type Status = 'todo' | 'run' | 'done';
export type Sort = 'recommended' | 'newest' | 'title' | 'shortest' | 'incident';
export const SORTS: readonly Sort[] = ['recommended', 'newest', 'title', 'shortest', 'incident'];

/** Saved progress of an entry: finished missions with their score, and the one under way. */
export interface Saved {
  completed: Record<string, number>;
  current: string | null;
}

export interface Item {
  entry: CatalogEntry;
  /** The catalogue the entry comes from: the signed one, or the one an imported file makes. */
  catalog: Catalog;
  /** SHA-256 of the file an imported entry came from. */
  bundle?: string;
  /** What the player plays, in order: the missions of a series, or the mission itself. */
  missions: CatalogEntry[];
  collection: Collection;
  status: Status;
  /** Score of each finished mission, by id. */
  completed: Record<string, number>;
  finished: number;
  /** Total score once every mission is finished. */
  score: number | null;
  /** The mission to play next, if any is left. */
  next: string | null;
  /** First seen since the last visit, or a new version of a pack seen before. */
  fresh: 'new' | 'updated' | null;
  /** Why it cannot be played in this game, if it cannot. */
  blocked: 'engine' | 'locale' | null;
  /** A path: its steps, where each one is played and whether it is done. */
  steps?: PathStep[];
}

/** Where a step of a path is played. */
export type Where = 'campaign' | 'season' | 'training' | 'community' | 'missing';

export interface PathStep {
  ref: string;
  note?: { fr?: string; en?: string };
  where: Where;
  title?: { fr?: string; en?: string };
  done: boolean;
  /** The season to open, for a step that is a season or one of its missions. */
  season?: string;
  /** Its number as players know it: the campaign is season 1, the catalogue's first season is 2. */
  seasonNumber?: number;
}

export interface Filters {
  q: string;
  collection: Collection | 'all';
  skills: Skill[];
  difficulty: 0 | 1 | 2 | 3;
  status: Status | 'any';
  sort: Sort;
}

export const NO_FILTERS: Filters = {
  q: '',
  collection: 'all',
  skills: [],
  difficulty: 0,
  status: 'any',
  sort: 'recommended',
};

export const isFiltering = (f: Filters) =>
  !!f.q.trim() || f.collection !== 'all' || f.skills.length > 0 || f.difficulty > 0 || f.status !== 'any';

export function collectionOf(entry: CatalogEntry, local = false): Collection {
  if (local) return 'local';
  if (entry.kind === 'path') return 'paths';
  if (entry.levels?.length === 1 && entry.levels[0] === 'expert') return 'challenges';
  if (entry.incident) return 'real';
  if (entry.id.startsWith('example.')) return 'examples';
  return 'players';
}

/** Lower case, without accents: "Défense" and "defense" match. */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The entries the store lists: paths, series, and missions that belong to no series. */
export function listed(catalog: Catalog): CatalogEntry[] {
  const series = catalog.packs.filter((p) => p.kind === 'series');
  const inSeries = new Set(series.flatMap((s) => s.missions ?? []));
  return [
    ...catalog.packs.filter((p) => p.kind === 'path'),
    ...series,
    ...catalog.packs.filter((p) => p.kind === 'mission' && !inSeries.has(p.id)),
  ];
}

/**
 * The steps of a path: where each one is played, in the official game or in the community catalogue,
 * and whether the player has done it. `done` holds the ids of every finished mission, and of every
 * series or season finished whole, whatever save they were played in.
 */
export function resolveSteps(
  path: CatalogEntry,
  official: Catalog | null,
  community: Catalog | null,
  done: ReadonlySet<string>,
): PathStep[] {
  return (path.steps ?? []).map(({ ref, note }) => {
    const base = { ref, ...(note ? { note } : {}), done: done.has(ref) };
    const own = official?.packs.find((p) => p.id === ref && p.kind !== 'world');
    if (official && own) {
      if (official.campaign.includes(ref)) return { ...base, where: 'campaign', title: own.title };
      if (official.training.includes(ref)) return { ...base, where: 'training', title: own.title };
      const season = official.seasons.includes(ref)
        ? ref
        : official.packs.find((p) => official.seasons.includes(p.id) && p.missions?.includes(ref))?.id;
      if (season)
        return {
          ...base,
          where: 'season',
          title: own.title,
          season,
          seasonNumber: official.seasons.indexOf(season) + 2,
        };
    }
    const shared = community?.packs.find((p) => p.id === ref && p.kind !== 'world');
    if (shared) return { ...base, where: 'community', title: shared.title };
    return { ...base, where: 'missing' };
  });
}

/** Progress of a path, from its steps: no score, the first step not done comes next. */
export function pathProgress(steps: PathStep[]) {
  const finished = steps.filter((s) => s.done).length;
  const done = steps.length > 0 && finished === steps.length;
  return {
    completed: {},
    finished,
    status: (done ? 'done' : finished > 0 ? 'run' : 'todo') as Status,
    score: null,
    next: steps.find((s) => !s.done)?.ref ?? null,
  };
}

/** Progress of an entry, from its save. */
export function progressOf(missions: CatalogEntry[], saved: Saved) {
  const finished = missions.filter((m) => m.id in saved.completed).length;
  const done = missions.length > 0 && finished === missions.length;
  const next = saved.current ?? missions.find((m) => !(m.id in saved.completed))?.id ?? null;
  return {
    completed: Object.fromEntries(
      missions.filter((m) => m.id in saved.completed).map((m) => [m.id, saved.completed[m.id]!]),
    ),
    finished,
    status: (done ? 'done' : finished > 0 || saved.current ? 'run' : 'todo') as Status,
    score: done ? missions.reduce((sum, m) => sum + (saved.completed[m.id] ?? 0), 0) : null,
    next: done ? null : next,
  };
}

/**
 * What is new since the last visit: an id never seen, or a version that changed. On the very first
 * visit nothing is flagged, otherwise the whole catalogue would be "new".
 */
export function freshness(
  entries: CatalogEntry[],
  seen: Record<string, string> | undefined,
): { fresh: Record<string, 'new' | 'updated'>; seen: Record<string, string> } {
  const fresh: Record<string, 'new' | 'updated'> = {};
  if (seen)
    for (const e of entries) {
      if (!Object.hasOwn(seen, e.id)) fresh[e.id] = 'new';
      else if (seen[e.id] !== e.version) fresh[e.id] = 'updated';
    }
  return { fresh, seen: Object.fromEntries(entries.map((e) => [e.id, e.version])) };
}

/** Everything a search can find in an entry: titles, summaries, authors, skills and the incident year. */
export function haystack(item: Item, locale: Locale, label: (skill: Skill) => string): string {
  const text = (v: { fr?: string; en?: string } | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');
  return normalize(
    [
      text(item.entry.title),
      text(item.entry.summary),
      ...(item.entry.authors ?? []),
      ...(item.entry.skills ?? []).map(label),
      item.entry.incident ?? '',
      ...item.missions.flatMap((m) => [text(m.title), text(m.summary)]),
      ...(item.steps ?? []).map((st) => text(st.title)),
    ].join(' '),
  );
}

export function matches(item: Item, f: Filters, hay: string): boolean {
  const words = normalize(f.q).split(/\s+/).filter(Boolean);
  return (
    (f.collection === 'all' || item.collection === f.collection) &&
    f.skills.every((s) => item.entry.skills?.includes(s)) &&
    (!f.difficulty || item.entry.difficulty === f.difficulty) &&
    (f.status === 'any' || item.status === f.status) &&
    words.every((w) => hay.includes(w))
  );
}

/** What the player probably wants first: what they are playing, what is new, then the rest. */
function rank(item: Item): number {
  if (item.blocked) return 6;
  if (item.collection === 'paths' && item.status !== 'done') return 0;
  if (item.status === 'run') return 0;
  if (item.collection === 'local') return 1;
  if (item.fresh) return 2;
  if (item.status === 'done') return 5;
  if (item.collection === 'examples') return 4;
  return 3;
}

export function sortItems(items: Item[], sort: Sort, locale: Locale): Item[] {
  const title = (i: Item) => i.entry.title[locale] ?? i.entry.title.fr ?? i.entry.title.en ?? '';
  const byTitle = (a: Item, b: Item) => title(a).localeCompare(title(b), locale, { numeric: true });
  const last = Number.MAX_SAFE_INTEGER;
  const compare: Record<Sort, (a: Item, b: Item) => number> = {
    recommended: (a, b) => rank(a) - rank(b) || byTitle(a, b),
    newest: (a, b) =>
      (b.entry.updated ?? b.entry.added ?? '').localeCompare(a.entry.updated ?? a.entry.added ?? '') ||
      byTitle(a, b),
    title: byTitle,
    shortest: (a, b) => (a.entry.minutes ?? last) - (b.entry.minutes ?? last) || byTitle(a, b),
    incident: (a, b) => (b.entry.incident ?? 0) - (a.entry.incident ?? 0) || byTitle(a, b),
  };
  return [...items].sort(compare[sort]);
}
