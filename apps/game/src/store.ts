/**
 * The community store: what the list shows for each catalogue entry, and how the player searches,
 * filters and sorts it. Pure functions, without React or storage, so they are tested on their own.
 */
import type { Catalog, CatalogEntry, Locale, Skill } from '@breach/pack-schema';

/** Where an entry belongs. `real` packs retell a real incident; `local` ones were imported from a file. */
export type Collection = 'real' | 'players' | 'examples' | 'local';
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
  if (entry.incident) return 'real';
  if (entry.id.startsWith('example.')) return 'examples';
  return 'players';
}

/** Lower case, without accents: "Défense" and "defense" match. */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The entries the store lists: series first, and missions that belong to no series. */
export function listed(catalog: Catalog): CatalogEntry[] {
  const series = catalog.packs.filter((p) => p.kind === 'series');
  const inSeries = new Set(series.flatMap((s) => s.missions ?? []));
  return [...series, ...catalog.packs.filter((p) => p.kind === 'mission' && !inSeries.has(p.id))];
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
