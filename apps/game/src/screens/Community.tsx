import { LEVEL_BONUS } from '@breach/engine';
import { type Catalog, type CatalogEntry, SKILLS, type Skill } from '@breach/pack-schema';
import { get, set } from 'idb-keyval';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { COMMUNITY_CATALOG_URL, UNSIGNED_COMMUNITY_CATALOG } from '../community.ts';
import { IMPORT_STEPS, ImportRefused, type ImportStep, localCatalog } from '../local.ts';
import { importBundle, localBundles, removeBundle } from '../localStore.ts';
import { engineSatisfies, loadCatalog, loadCommunityCatalog, seriesMissions } from '../packs.ts';
import { loadJourney, localProgress, type StartMode, seriesProgress, singleScores } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import {
  type Collection,
  collectionOf,
  type Filters,
  freshness,
  haystack,
  type Item,
  isFiltering,
  listed,
  matches,
  NO_FILTERS,
  type PathStep,
  pathProgress,
  progressOf,
  resolveSteps,
  SORTS,
  type Sort,
  sortItems,
} from '../store.ts';
import { translate, type UiKey, useT } from '../ui.ts';
import type { Go } from './Journey.tsx';

const LEVELS = ['guided', 'standard', 'expert'] as const;
type Level = (typeof LEVELS)[number];
const CREATE_URL = 'https://github.com/breach-game/packs#readme';
const SEEN_KEY = 'community:seen';
const COLLECTIONS: readonly (Collection | 'all')[] = [
  'all',
  'paths',
  'challenges',
  'real',
  'players',
  'examples',
  'local',
];
const STATUSES = ['any', 'todo', 'run', 'done'] as const;

// Kept while the game runs, so coming back from a mission finds the list as the player left it.
let kept: { filters: Filters; view: 'grid' | 'list' } = { filters: NO_FILTERS, view: 'grid' };

/**
 * Community missions, laid out as a store: search, filters and sorting over the signed catalogue of
 * `breach-game/packs`, the player's progress on each entry, and a detail panel to start or resume.
 * The catalogue is downloaded only when the player opens this screen; each mission or series is
 * played on its own, with its own save.
 */
export function Community({
  onStart,
  onBack,
  go,
}: {
  onStart: (mode: StartMode) => void;
  onBack: () => void;
  go: (to: Go) => void;
}) {
  const t = useT();
  const { locale } = useSettings();
  const text = useText();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFiltersState] = useState<Filters>(kept.filters);
  const [view, setViewState] = useState(kept.view);
  const [railOpen, setRailOpen] = useState(false);
  const [opened, setOpened] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const [reload, setReload] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const openAfter = useRef<string | null>(null);

  const setFilters = (patch: Partial<Filters>) =>
    setFiltersState((f) => {
      const next = { ...f, ...patch };
      kept = { ...kept, filters: next };
      return next;
    });
  const setView = (v: 'grid' | 'list') => {
    kept = { ...kept, view: v };
    setViewState(v);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry button, `reload` follows an import
  useEffect(() => {
    let live = true;
    setError(null);
    const itemOf = async (
      entry: CatalogEntry,
      c: Catalog,
      fresh: Item['fresh'],
      bundle?: string,
    ): Promise<Item> => {
      const missions = entry.kind === 'series' ? seriesMissions(entry, c) : [entry];
      const saved = bundle ? await localProgress(entry, bundle) : await seriesProgress(entry);
      return {
        entry,
        catalog: c,
        ...(bundle ? { bundle } : {}),
        missions,
        collection: collectionOf(entry, !!bundle),
        ...progressOf(missions, saved),
        fresh,
        blocked:
          !engineSatisfies(entry.engine) || !missions.length
            ? 'engine'
            : !entry.locales.includes(locale)
              ? 'locale'
              : null,
      };
    };
    (async () => {
      const built: Item[] = [];
      // Missions imported on this computer are listed even when the catalogue cannot be reached.
      for (const b of await localBundles()) {
        const c = localCatalog(b);
        for (const entry of listed(c)) built.push(await itemOf(entry, c, null, b.sha256));
      }
      let failure: string | null = null;
      const c = await loadCommunityCatalog().catch((e: Error) => {
        failure = e.message;
        return null;
      });
      if (c) {
        const entries = listed(c);
        const seen = await get<Record<string, string>>(SEEN_KEY).catch(() => undefined);
        const { fresh, seen: nowSeen } = freshness(entries, seen);
        for (const entry of entries)
          if (entry.kind !== 'path') built.push(await itemOf(entry, c, fresh[entry.id] ?? null));
        // The badges stay for this visit; the next one only flags what arrives in between.
        void set(SEEN_KEY, nowSeen).catch(() => {});
        const paths = entries.filter((e) => e.kind === 'path');
        if (paths.length) {
          const { official, done } = await finished(built);
          for (const entry of paths) {
            const steps = resolveSteps(entry, official, c, done);
            built.unshift({
              entry,
              catalog: c,
              missions: [],
              collection: collectionOf(entry),
              ...pathProgress(steps),
              fresh: fresh[entry.id] ?? null,
              blocked: !engineSatisfies(entry.engine)
                ? 'engine'
                : !entry.locales.includes(locale)
                  ? 'locale'
                  : null,
              steps,
            });
          }
        }
      }
      if (!live) return;
      setCatalog(c);
      setItems(built);
      setError(failure);
      return built;
    })()
      .then((built) => {
        // After an import, open what was just added.
        const id = openAfter.current;
        openAfter.current = null;
        const added = id && built?.find((i) => i.bundle && i.entry.id === id);
        if (live && added) setOpened(added);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [attempt, reload, locale]);

  const skillLabel = (s: Skill) => t(`skill.${s}` as UiKey);
  const hays = useMemo(
    () =>
      new Map(
        (items ?? []).map((i) => [
          i.entry.id,
          haystack(i, locale, (s) => translate(locale, `skill.${s}` as UiKey)),
        ]),
      ),
    [items, locale],
  );
  const shown = sortItems(
    (items ?? []).filter((i) => matches(i, filters, hays.get(i.entry.id) ?? '')),
    filters.sort,
    locale,
  );
  const filtering = isFiltering(filters);
  const running = (items ?? []).filter((i) => i.status === 'run' && !i.blocked && !i.steps);
  const usedSkills = SKILLS.filter((s) => (items ?? []).some((i) => i.entry.skills?.includes(s)));
  const host = new URL(COMMUNITY_CATALOG_URL, location.href).host;

  const open = (item: Item, from: HTMLElement) => {
    opener.current = from;
    setOpened(item);
  };
  const close = () => {
    setOpened(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  /** A step of a path: open it where it lives, here in the store or in the official screens. */
  const visit = (step: PathStep) => {
    if (step.where === 'training') go({ screen: 'training' });
    else if (step.where === 'campaign') go({ screen: 'missions' });
    else if (step.where === 'season')
      go({ screen: 'seasons', ...(step.season ? { open: step.season } : {}) });
    else if (step.where === 'community') {
      const target = (items ?? []).find(
        (i) => !i.steps && (i.entry.id === step.ref || i.missions.some((m) => m.id === step.ref)),
      );
      if (target) setOpened(target);
    }
  };
  const play = (item: Item, restart: boolean, level?: Level) => {
    if (level) updateSettings({ guidance: level });
    if (item.bundle) onStart({ local: item.entry.id, bundle: item.bundle, restart });
    else onStart({ community: item.entry, catalog: item.catalog, restart });
  };
  const forget = async (item: Item) => {
    if (!item.bundle) return;
    await removeBundle(item.bundle);
    setOpened(null);
    setReload((r) => r + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (importing) setImporting(false);
      else if (opened) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const count = (c: Collection | 'all') =>
    (items ?? []).filter((i) => c === 'all' || i.collection === c).length;
  const countStatus = (s: (typeof STATUSES)[number]) =>
    (items ?? []).filter((i) => s === 'any' || i.status === s).length;

  const active: { key: string; label: string; clear: () => void }[] = [];
  if (filters.q.trim())
    active.push({ key: 'q', label: `« ${filters.q.trim()} »`, clear: () => setFilters({ q: '' }) });
  if (filters.collection !== 'all')
    active.push({
      key: 'c',
      label: t(`store.collection.${filters.collection}` as UiKey),
      clear: () => setFilters({ collection: 'all' }),
    });
  for (const s of filters.skills)
    active.push({
      key: `s:${s}`,
      label: skillLabel(s),
      clear: () => setFilters({ skills: filters.skills.filter((x) => x !== s) }),
    });
  if (filters.difficulty)
    active.push({
      key: 'd',
      label: t(`difficulty.${filters.difficulty}` as UiKey),
      clear: () => setFilters({ difficulty: 0 }),
    });
  if (filters.status !== 'any')
    active.push({
      key: 'st',
      label: t(`store.status.${filters.status}` as UiKey),
      clear: () => setFilters({ status: 'any' }),
    });

  return (
    <main className="title store">
      <div className="store-win">
        <div className="store-bar">
          <button type="button" className="store-back" onClick={onBack}>
            ← {t('community.back')}
          </button>
          <h1 id="store-title" className="store-name">
            {t('title.community')}
          </h1>
          <span className="store-sig">
            {UNSIGNED_COMMUNITY_CATALOG ? (
              <>⚠ {t('store.unsigned')}</>
            ) : catalog ? (
              <>
                <b aria-hidden="true">✓</b>{' '}
                {t('store.signed', { date: new Date(catalog.generatedAt).toLocaleDateString(locale) })}
              </>
            ) : null}
          </span>
        </div>
        <div className="store-body">
          <aside
            className={`store-rail${railOpen ? ' open' : ''}`}
            id="store-rail"
            aria-label={t('store.filters')}
          >
            <RailGroup title={t('store.collections')}>
              <div className="store-choices">
                {COLLECTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={filters.collection === c}
                    onClick={() => setFilters({ collection: c })}
                  >
                    <span>{t(`store.collection.${c}` as UiKey)}</span>
                    <small>{count(c)}</small>
                  </button>
                ))}
              </div>
            </RailGroup>
            {usedSkills.length > 0 && (
              <RailGroup title={t('store.skills')}>
                <div className="store-chips">
                  {usedSkills.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="store-chip"
                      data-skill={s}
                      aria-pressed={filters.skills.includes(s)}
                      onClick={() =>
                        setFilters({
                          skills: filters.skills.includes(s)
                            ? filters.skills.filter((x) => x !== s)
                            : [...filters.skills, s],
                        })
                      }
                    >
                      {skillLabel(s)}
                    </button>
                  ))}
                </div>
              </RailGroup>
            )}
            <RailGroup title={t('store.difficulty')}>
              <div className="store-seg">
                {([0, 1, 2, 3] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={filters.difficulty === d}
                    aria-label={d ? t(`difficulty.${d}` as UiKey) : t('store.difficulty.any')}
                    title={d ? t(`difficulty.${d}` as UiKey) : undefined}
                    onClick={() => setFilters({ difficulty: d })}
                  >
                    {d ? '●'.repeat(d) : t('store.difficulty.any')}
                  </button>
                ))}
              </div>
            </RailGroup>
            <RailGroup title={t('store.status')}>
              <div className="store-choices">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={filters.status === s}
                    onClick={() => setFilters({ status: s })}
                  >
                    <span>{t(`store.status.${s}` as UiKey)}</span>
                    <small>{countStatus(s)}</small>
                  </button>
                ))}
              </div>
            </RailGroup>
            <p className="store-rail-note">{t('store.note')}</p>
          </aside>

          <section className="store-main">
            <div className="store-toolbar">
              <label className="store-search">
                <span className="sr-only">{t('store.search.label')}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={filters.q}
                  placeholder={t('store.search')}
                  onChange={(e) => setFilters({ q: e.target.value })}
                  autoFocus
                />
              </label>
              <button
                type="button"
                className="store-tool store-filters"
                aria-expanded={railOpen}
                aria-controls="store-rail"
                onClick={() => setRailOpen(!railOpen)}
              >
                {t('store.filters')}
              </button>
              <label className="store-sort">
                <span className="sr-only">{t('store.sort')}</span>
                <select value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as Sort })}>
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`store.sort.${s}` as UiKey)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="store-view" role="group" aria-label={t('store.view')}>
                {(['grid', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    title={t(`store.view.${v}`)}
                    aria-label={t(`store.view.${v}`)}
                    onClick={() => setView(v)}
                  >
                    <span aria-hidden="true">{v === 'grid' ? '▦' : '☰'}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="store-tool" onClick={() => setImporting(true)}>
                <span aria-hidden="true">⤓</span> {t('store.import')}
              </button>
            </div>

            <div className="store-scroll">
              {error && items?.length ? (
                <div className="store-warning" role="status">
                  <span>
                    {t('community.error')} {error}
                  </span>
                  <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
                    {t('title.retry')}
                  </button>
                </div>
              ) : null}
              {error && !items?.length ? (
                <div className="store-state">
                  <div className="title-error">
                    {t('community.error')} {error}
                  </div>
                  <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
                    {t('title.retry')}
                  </button>
                </div>
              ) : !items ? (
                <p className="store-state" role="status">
                  {t('community.loading')}
                </p>
              ) : items.length === 0 ? (
                <p className="store-state">{t('community.empty')}</p>
              ) : (
                <>
                  {!filtering && running.length > 0 && (
                    <section className="store-shelf" aria-labelledby="store-resume">
                      <h2 id="store-resume" className="store-h">
                        {t('store.resume')}
                      </h2>
                      <div className="store-shelf-row">
                        {running.map((i) => {
                          const at = Math.max(
                            0,
                            i.missions.findIndex((m) => m.id === i.next),
                          );
                          return (
                            <button
                              key={i.entry.id}
                              type="button"
                              className="store-resume"
                              onClick={(e) => open(i, e.currentTarget)}
                            >
                              <Tile item={i} />
                              <span className="store-resume-text">
                                <b>{text(i.entry.title)}</b>
                                <small>
                                  {t('store.resume.at', {
                                    n: at + 1,
                                    total: i.missions.length,
                                    title: inSeries(text(i.missions[at]?.title)),
                                  })}
                                </small>
                                <span className="store-bar-track" aria-hidden="true">
                                  <span style={{ width: `${(i.finished / i.missions.length) * 100}%` }} />
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  <div className="store-results">
                    <h2 className="store-h" aria-live="polite">
                      {filtering
                        ? t('store.count', { n: shown.length, total: items.length })
                        : t('store.count.all', { n: items.length })}
                    </h2>
                    {active.length > 0 && (
                      <div className="store-active">
                        {active.map((a) => (
                          <button
                            key={a.key}
                            type="button"
                            aria-label={t('store.remove', { name: a.label })}
                            onClick={a.clear}
                          >
                            {a.label} <span aria-hidden="true">✕</span>
                          </button>
                        ))}
                        {active.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setFilters({ ...NO_FILTERS, sort: filters.sort })}
                          >
                            {t('store.clear')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {shown.length ? (
                    <ul className={`store-grid ${view}`}>
                      {shown.map((i) => (
                        <li key={`${i.entry.id}@${i.entry.version}`}>
                          <Card item={i} onOpen={(el) => open(i, el)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="store-empty">
                      {filters.collection === 'players' && count('players') === 0
                        ? t('store.none.players')
                        : t('store.none')}
                    </p>
                  )}
                </>
              )}
              <footer className="store-foot">
                <p>{t('community.source', { host })}</p>
                <a className="btn link" href={CREATE_URL} target="_blank" rel="noopener noreferrer">
                  {t('community.create')} ↗
                </a>
              </footer>
            </div>
          </section>

          {opened && !importing && (
            <>
              <div className="store-scrim" onClick={close} aria-hidden="true" />
              {opened.steps ? (
                <PathDetail
                  key={opened.entry.id}
                  item={opened}
                  steps={opened.steps}
                  onClose={close}
                  onVisit={visit}
                />
              ) : (
                <Detail
                  key={`${opened.entry.id}@${opened.bundle ?? ''}`}
                  item={opened}
                  onClose={close}
                  onPlay={(restart, level) => play(opened, restart, level)}
                  onForget={() => void forget(opened)}
                />
              )}
            </>
          )}
          {importing && (
            <>
              <div className="store-scrim" onClick={() => setImporting(false)} aria-hidden="true" />
              <ImportDialog
                onClose={() => setImporting(false)}
                onDone={(id) => {
                  openAfter.current = id;
                  setImporting(false);
                  setFilters({ collection: 'all' });
                  setReload((r) => r + 1);
                }}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

type Text = (v: { fr?: string; en?: string } | undefined) => string;

function useText(): Text {
  const { locale } = useSettings();
  return (v) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');
}

function kicker(t: ReturnType<typeof useT>, item: Item): string {
  return t(`store.kicker.${item.collection}` as UiKey);
}

/** "Dossier 04 · 2. La fatigue" inside its own series reads "2. La fatigue". */
function inSeries(title: string): string {
  const at = title.lastIndexOf(' · ');
  return at < 0 ? title : title.slice(at + 3);
}

const pips = (d: number) => '●'.repeat(d) + '○'.repeat(3 - d);

function Card({ item, onOpen }: { item: Item; onOpen: (el: HTMLElement) => void }) {
  const t = useT();
  const text = useText();
  const e = item.entry;
  return (
    <button
      type="button"
      className="store-card"
      data-collection={item.collection}
      data-blocked={item.blocked ? 'true' : undefined}
      onClick={(ev) => onOpen(ev.currentTarget)}
    >
      <span className="store-card-top">
        <Tile item={item} />
        <span className="store-card-head">
          <small className="store-kicker">{kicker(t, item)}</small>
          <b>{text(e.title)}</b>
        </span>
      </span>
      <span className="store-hook">{item.blocked ? t(`community.${item.blocked}`) : text(e.summary)}</span>
      <SkillTags skills={e.skills ?? []} />
      <span className="store-meta">
        <span>
          {item.steps
            ? t('store.steps', { n: item.steps.length })
            : item.missions.length > 1
              ? t('store.missions', { n: item.missions.length })
              : t('store.mission')}
          {e.minutes ? ` · ${t('store.minutes', { n: e.minutes })}` : ''}
          {e.difficulty ? (
            <>
              {' · '}
              <span title={t(`difficulty.${e.difficulty}` as UiKey)}>
                <span aria-hidden="true">{pips(e.difficulty)}</span>
                <span className="sr-only">{t(`difficulty.${e.difficulty}` as UiKey)}</span>
              </span>
            </>
          ) : null}
        </span>
        <Badge item={item} />
      </span>
    </button>
  );
}

function Badge({ item }: { item: Item }) {
  const t = useT();
  if (item.bundle && item.status === 'todo')
    return <span className="store-pill local">⚠ {t('store.local.badge')}</span>;
  if (item.steps && item.status !== 'todo')
    return (
      <span className={`store-pill ${item.status}`}>
        {item.status === 'done' ? '✓' : '▶'}{' '}
        {t('store.path.progress', { n: item.finished, total: item.steps.length })}
      </span>
    );
  if (item.status === 'done')
    return <span className="store-pill done">✓ {t('store.score', { score: item.score ?? 0 })}</span>;
  if (item.status === 'run')
    return (
      <span className="store-pill run">
        ▶ {Math.min(item.finished + 1, item.missions.length)}/{item.missions.length}
      </span>
    );
  if (item.fresh) return <span className="store-pill fresh">{t(`store.${item.fresh}`)}</span>;
  return null;
}

function Tile({ item }: { item: Item }) {
  const t = useT();
  const [big, small] =
    item.collection === 'paths'
      ? [String(item.steps?.length ?? 0), t('store.tile.paths')]
      : item.collection === 'challenges'
        ? ['◆', t('store.tile.challenges')]
        : item.collection === 'real'
          ? [String(item.entry.incident), t('store.tile.real')]
          : item.collection === 'examples'
            ? ['EX', t('store.tile.examples')]
            : item.collection === 'local'
              ? ['⤓', t('store.tile.local')]
              : [String(item.missions.length), t('store.tile.players')];
  return (
    <span className="store-tile" data-collection={item.collection} aria-hidden="true">
      <b>{big}</b>
      <small>{small}</small>
    </span>
  );
}

function SkillTags({ skills }: { skills: Skill[] }) {
  const t = useT();
  if (!skills.length) return null;
  return (
    <span className="store-tags">
      {skills.map((s) => (
        <span key={s} className="store-tag" data-skill={s}>
          {t(`skill.${s}` as UiKey)}
        </span>
      ))}
    </span>
  );
}

function Trust({ item }: { item: Item }) {
  const t = useT();
  return (
    <p className="store-trust" data-collection={item.collection}>
      {item.bundle ? (
        <>
          <b>⚠ {t('store.local.trust')}</b> {t('store.local.trust.detail')}
        </>
      ) : (
        <>
          <b>✓ {t('store.reviewed')}</b> {t('store.reviewed.detail')}
        </>
      )}
    </p>
  );
}

function Detail({
  item,
  onClose,
  onPlay,
  onForget,
}: {
  item: Item;
  onClose: () => void;
  onPlay: (restart: boolean, level?: Level) => void;
  onForget: () => void;
}) {
  const t = useT();
  const text = useText();
  const { locale, guidance } = useSettings();
  const e = item.entry;
  // A challenge allows only some levels: the picker offers those, and the setting stays the player's.
  const allowed = LEVELS.filter((g) => !e.levels || e.levels.includes(g));
  const locked = allowed.length < LEVELS.length;
  const [level, setLevel] = useState<Level>(allowed.includes(guidance) ? guidance : allowed.at(-1)!);
  const [restarting, setRestarting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const series = e.kind === 'series';
  const missions = series ? seriesMissions(e, item.catalog) : [e];
  const resume = item.status === 'run' && !restarting;
  const label: UiKey =
    item.status === 'todo'
      ? series
        ? 'series.start'
        : 'store.mission.start'
      : item.status === 'done'
        ? series
          ? 'series.again'
          : 'store.mission.again'
        : 'series.restart';
  return (
    <aside className="store-detail" aria-labelledby="store-detail-title" data-collection={item.collection}>
      <button
        ref={closeRef}
        type="button"
        className="store-close"
        aria-label={t('store.close')}
        onClick={onClose}
      >
        ✕
      </button>
      <div className="store-detail-head">
        <Tile item={item} />
        <small className="store-kicker">
          {kicker(t, item)} · v{e.version}
        </small>
      </div>
      <h2 id="store-detail-title">{text(e.title)}</h2>
      <p className="store-detail-lead">{item.blocked ? t(`community.${item.blocked}`) : text(e.summary)}</p>
      <SkillTags skills={e.skills ?? []} />
      <Trust item={item} />
      <h3 className="store-h">
        {missions.length > 1 ? t('store.detail.missions', { n: missions.length }) : t('store.detail.mission')}
      </h3>
      <ol className="store-missions">
        {missions.map((m, i) => {
          const score = item.completed[m.id];
          const state =
            score !== undefined ? 'done' : m.id === item.next || (!series && i === 0) ? 'next' : 'locked';
          return (
            <li key={m.id} data-state={state}>
              <span className="store-missions-n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                <b>{series ? inSeries(text(m.title)) : text(m.title)}</b>
                <span>{text(m.summary)}</span>
              </span>
              <i>
                {state === 'done'
                  ? `✓ ${t('missions.done', { score: score ?? 0 })}`
                  : state === 'next'
                    ? `▶ ${t(item.status === 'run' && m.id === item.next ? 'missions.current' : 'missions.next')}`
                    : `⊘ ${t('missions.locked')}`}
              </i>
            </li>
          );
        })}
      </ol>
      <dl className="store-facts">
        {e.minutes ? (
          <>
            <dt>{t('store.fact.minutes')}</dt>
            <dd>{t('store.fact.minutes.value', { n: e.minutes })}</dd>
          </>
        ) : null}
        {e.difficulty ? (
          <>
            <dt>{t('store.difficulty')}</dt>
            <dd>
              <span aria-hidden="true">{pips(e.difficulty)}</span> {t(`difficulty.${e.difficulty}` as UiKey)}
            </dd>
          </>
        ) : null}
        <dt>{t('store.fact.locales')}</dt>
        <dd>{e.locales.map((l) => l.toUpperCase()).join(' · ')}</dd>
        {e.authors?.length ? (
          <>
            <dt>{t('store.fact.authors')}</dt>
            <dd>{e.authors.join(', ')}</dd>
          </>
        ) : null}
        {e.updated ? (
          <>
            <dt>{t('store.fact.updated')}</dt>
            <dd>{new Date(`${e.updated}T12:00:00Z`).toLocaleDateString(locale)}</dd>
          </>
        ) : null}
      </dl>
      {!item.blocked &&
        (resume ? (
          <div className="store-detail-actions">
            <button type="button" className="btn primary" onClick={() => onPlay(false)}>
              {t(series ? 'series.continue' : 'store.mission.continue')}
            </button>
            <button type="button" className="btn" onClick={() => setRestarting(true)}>
              {t('series.restart')}
            </button>
          </div>
        ) : (
          <>
            <h3 className="store-h">{t('store.level')}</h3>
            <div className="store-levels" role="group" aria-label={t('store.level')}>
              {allowed.map((g) => (
                <button key={g} type="button" aria-pressed={level === g} onClick={() => setLevel(g)}>
                  <b>{t(`guidance.${g}` as UiKey)}</b>
                  <small>{t('title.level.bonus', { factor: LEVEL_BONUS[g].toLocaleString(locale) })}</small>
                </button>
              ))}
            </div>
            <p className="store-level-desc">
              {locked ? t('store.level.locked') : t(`guidance.${level}.desc` as UiKey)}
            </p>
            <div className="store-detail-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => onPlay(item.status !== 'todo', locked ? undefined : level)}
              >
                {t(label)}
              </button>
            </div>
          </>
        ))}
      {item.bundle && (
        <div className="store-detail-actions">
          <button type="button" className="btn" onClick={onForget}>
            {t('store.local.remove')}
          </button>
          <a className="btn link" href={CREATE_URL} target="_blank" rel="noopener noreferrer">
            {t('store.local.propose')} ↗
          </a>
        </div>
      )}
    </aside>
  );
}

/**
 * What the player has finished, whatever save it was played in: missions of the campaign and of each
 * season, trainings and replays, community series and missions. Series and seasons finished whole
 * count under their own id too, so that a path can name them.
 */
async function finished(items: Item[]): Promise<{ official: Catalog | null; done: Set<string> }> {
  const done = new Set<string>();
  for (const i of items) {
    for (const id of Object.keys(i.completed)) done.add(id);
    if (i.status === 'done') done.add(i.entry.id);
  }
  const official = await loadCatalog().catch(() => null);
  if (!official) return { official, done };
  const journey = await loadJourney().catch(() => null);
  for (const season of journey?.seasons ?? []) {
    for (const id of Object.keys(season.progress.completed)) done.add(id);
    if (season.missions.length && season.missions.every((m) => m.id in season.progress.completed))
      done.add(season.id);
  }
  const singles = official.packs.filter(
    (p) => p.kind === 'mission' && (official.training.includes(p.id) || official.campaign.includes(p.id)),
  );
  for (const id of Object.keys(await singleScores(singles))) done.add(id);
  return { official, done };
}

function PathDetail({
  item,
  steps,
  onClose,
  onVisit,
}: {
  item: Item;
  steps: PathStep[];
  onClose: () => void;
  onVisit: (step: PathStep) => void;
}) {
  const t = useT();
  const text = useText();
  const e = item.entry;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <aside className="store-detail" aria-labelledby="store-detail-title" data-collection={item.collection}>
      <button
        ref={closeRef}
        type="button"
        className="store-close"
        aria-label={t('store.close')}
        onClick={onClose}
      >
        ✕
      </button>
      <div className="store-detail-head">
        <Tile item={item} />
        <small className="store-kicker">
          {kicker(t, item)} · v{e.version}
        </small>
      </div>
      <h2 id="store-detail-title">{text(e.title)}</h2>
      <p className="store-detail-lead">{item.blocked ? t(`community.${item.blocked}`) : text(e.summary)}</p>
      <SkillTags skills={e.skills ?? []} />
      <h3 className="store-h">
        {t('store.path.title')} · {t('store.path.progress', { n: item.finished, total: steps.length })}
      </h3>
      <p className="store-level-desc">{t('store.path.intro')}</p>
      <ol className="store-missions store-path">
        {steps.map((st, i) => (
          <li key={st.ref} data-state={st.done ? 'done' : st.ref === item.next ? 'next' : 'todo'}>
            <span className="store-missions-n" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>
              <b>{st.title ? text(st.title) : st.ref}</b>
              {st.note && <span>{text(st.note)}</span>}
              <small className="store-where" data-where={st.where}>
                {st.where === 'missing'
                  ? t('store.path.missing')
                  : t(`store.path.where.${st.where}` as UiKey, { n: st.seasonNumber ?? 1 })}
              </small>
            </span>
            <i>
              {st.done ? (
                `✓ ${t('store.path.done')}`
              ) : st.where === 'missing' ? null : (
                <button type="button" className="btn" onClick={() => onVisit(st)}>
                  {t('store.path.open')}
                </button>
              )}
            </i>
          </li>
        ))}
      </ol>
      <dl className="store-facts">
        {e.minutes ? (
          <>
            <dt>{t('store.fact.minutes')}</dt>
            <dd>{t('store.fact.minutes.value', { n: e.minutes })}</dd>
          </>
        ) : null}
        <dt>{t('store.fact.locales')}</dt>
        <dd>{e.locales.map((l) => l.toUpperCase()).join(' · ')}</dd>
        {e.authors?.length ? (
          <>
            <dt>{t('store.fact.authors')}</dt>
            <dd>{e.authors.join(', ')}</dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const t = useT();
  const [step, setStep] = useState<ImportStep | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'refused'>('idle');
  const [problems, setProblems] = useState<string[]>([]);
  const [failedAt, setFailedAt] = useState<ImportStep | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  useEffect(() => pickRef.current?.focus(), []);

  const run = async (file: File) => {
    setState('running');
    setProblems([]);
    setFailedAt(null);
    let at: ImportStep = 'read';
    try {
      const bundle = await importBundle(file, (s) => {
        at = s;
        setStep(s);
      });
      const main =
        bundle.packs.find((p) => p.kind === 'series') ?? bundle.packs.find((p) => p.kind === 'mission');
      setAdded(main?.id ?? null);
      setState('done');
    } catch (error) {
      setFailedAt(error instanceof ImportRefused ? error.step : at);
      setProblems(error instanceof ImportRefused ? error.problems : [(error as Error).message]);
      setState('refused');
    }
  };

  const mark = (s: ImportStep) => {
    const i = IMPORT_STEPS.indexOf(s);
    const now = step ? IMPORT_STEPS.indexOf(step) : -1;
    if (state === 'refused' && failedAt === s) return { icon: '✗', cls: 'fail' };
    if (state === 'done' || i < now || (state === 'refused' && i < IMPORT_STEPS.indexOf(failedAt ?? 'read')))
      return { icon: '✓', cls: 'ok' };
    if (state === 'running' && i === now) return { icon: '…', cls: 'run' };
    return { icon: '○', cls: '' };
  };

  return (
    <div className="store-import" role="dialog" aria-modal="true" aria-labelledby="store-import-title">
      <h2 id="store-import-title">{t('store.import.title')}</h2>
      <p>{t('store.import.intro')}</p>
      <label className={`store-drop${state === 'running' ? ' busy' : ''}`}>
        <input
          ref={pickRef}
          type="file"
          accept=".breachbundle"
          disabled={state === 'running'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(file);
          }}
        />
        <span className="btn">{t(state === 'idle' ? 'store.import.pick' : 'store.import.again')}</span>
        <code>.breachbundle</code>
      </label>
      {state !== 'idle' && (
        <ol className="store-steps">
          {IMPORT_STEPS.map((s) => {
            const m = mark(s);
            return (
              <li key={s} className={m.cls}>
                <span aria-hidden="true">{m.icon}</span> {t(`store.import.step.${s}`)}
              </li>
            );
          })}
        </ol>
      )}
      {state === 'refused' && (
        <div className="store-refused" role="alert">
          <b>{t('store.import.refused')}</b>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {state === 'done' && (
        <p className="store-trust" data-collection="local" role="status">
          <b>⚠ {t('store.local.badge')}.</b> {t('store.import.ok')}
        </p>
      )}
      <div className="store-detail-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('store.close')}
        </button>
        {state === 'done' && added && (
          <button type="button" className="btn primary" autoFocus onClick={() => onDone(added)}>
            {t('store.import.open')}
          </button>
        )}
      </div>
    </div>
  );
}

function RailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="store-group">
      <h2 className="store-h">{title}</h2>
      {children}
    </div>
  );
}
