import type { CatalogEntry } from '@breach/pack-schema';
import {
  bareTitle,
  doneCount,
  type Localized,
  missionLabel,
  type News,
  type Season,
  type Step,
  seasonScore,
  seasonState,
} from '../journey.ts';
import type { StartMode } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';

/** Where a button of the journey takes the player. */
export type Go =
  | { screen: 'seasons'; open?: string }
  | { screen: 'training' | 'community' | 'missions' | 'title' | 'newGame' }
  | { start: StartMode };

/** How a season starts or resumes: the campaign is the main save, a season has its own. */
export const playSeason = (s: Season): Go =>
  s.kind === 'campaign'
    ? seasonState(s) === 'fresh'
      ? { screen: 'newGame' }
      : { start: 'continue' }
    : { start: { season: s.id } };

export function useText() {
  const { locale } = useSettings();
  return (v: Localized | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');
}

/** "Season 2 · Halcyon": the kicker of every season card. */
export function SeasonKicker({ season }: { season: Season }) {
  const t = useT();
  const text = useText();
  const world = text(season.world);
  return (
    <span className="j-kicker">
      {t('season.kicker', { n: season.number })}
      {world && <> · {world}</>}
    </span>
  );
}

/** A season's own title: the campaign's from the interface, a season's from its pack. */
export function seasonTitle(
  season: Season,
  text: (v: Localized | undefined) => string,
  t: ReturnType<typeof useT>,
) {
  return season.kind === 'campaign' ? t('season.one.title') : bareTitle(text(season.entry?.title));
}

export function seasonSummary(
  season: Season,
  text: (v: Localized | undefined) => string,
  t: ReturnType<typeof useT>,
) {
  return season.kind === 'campaign' ? t('season.one.summary') : text(season.entry?.summary);
}

/** One segment per mission: finished, the one up next, or still ahead. Doubled by a text count. */
export function SeasonBar({ season, next }: { season: Season; next?: CatalogEntry | null }) {
  const t = useT();
  const done = doneCount(season);
  return (
    <div
      className="j-bar"
      role="img"
      aria-label={t('season.progress', { done, total: season.missions.length })}
    >
      {season.missions.map((m) => (
        <i
          key={m.id}
          data-state={m.id in season.progress.completed ? 'done' : m.id === next?.id ? 'next' : 'todo'}
        />
      ))}
    </div>
  );
}

/** The chip of a season: new, not started, in progress, complete. Always a word, never a colour alone. */
export function StateChip({ season, fresh }: { season: Season; fresh?: boolean }) {
  const t = useT();
  const state = seasonState(season);
  if (fresh) return <span className="j-chip new">● {t('season.new')}</span>;
  return (
    <span className={`j-chip ${state}`}>
      {state === 'done' ? '✓ ' : state === 'started' ? '▶ ' : ''}
      {t(`season.state.${state}`)}
    </span>
  );
}

/** "4/10 missions · 1 870 pts". */
export function SeasonMeta({ season }: { season: Season }) {
  const t = useT();
  const { locale } = useSettings();
  const done = doneCount(season);
  return (
    <span className="j-meta">
      {t('season.count', { done, total: season.missions.length })}
      {done > 0 && <> · {t('season.points', { score: seasonScore(season).toLocaleString(locale) })}</>}
    </span>
  );
}

/**
 * The title screen's main card: what to do next, worked out from every save. It replaces a bare
 * "Continue", which used to open an empty desktop once the campaign was over.
 */
export function StepCard({
  step,
  seasons,
  news,
  go,
}: {
  step: Step;
  seasons: readonly Season[];
  news: readonly News[];
  go: (to: Go, seen?: readonly News[]) => void;
}) {
  const t = useT();
  const text = useText();
  const { locale } = useSettings();
  if (step.kind === 'done') {
    const total = seasons.reduce((sum, s) => sum + seasonScore(s), 0);
    return (
      <section className="j-step done" aria-labelledby="j-step-title">
        <header>
          <span className="j-kicker">✓ {t('step.done.kicker')}</span>
          <span className="j-meta">
            {t('step.done.total', { n: seasons.length, score: total.toLocaleString(locale) })}
          </span>
        </header>
        <h2 id="j-step-title">{t('step.done.title')}</h2>
        <p>{t('step.done.body')}</p>
        <div className="j-step-actions">
          <button type="button" className="btn primary" autoFocus onClick={() => go({ screen: 'community' })}>
            {t('title.community')} →
          </button>
        </div>
      </section>
    );
  }
  const { season } = step;
  const seasonNews = news.filter((n) => n.kind !== 'training' && n.season.id === season.id);
  const fresh = seasonNews.some((n) => n.kind === 'season');
  const newMission =
    step.kind === 'resume' && seasonNews.some((n) => n.kind === 'mission' && n.entry.id === step.mission.id);
  // The season just before, when it is finished: "Season 1 complete. What comes next is waiting."
  const before = seasons.find((s) => s.number === season.number - 1);
  const after = step.kind === 'start' && before && seasonState(before) === 'done' ? before : null;
  return (
    <section className={`j-step ${step.kind}`} aria-labelledby="j-step-title">
      <header>
        <SeasonKicker season={season} />
        <StateChip season={season} fresh={fresh || newMission} />
      </header>
      {step.kind === 'resume' ? (
        <>
          <h2 id="j-step-title">
            {t('step.mission', {
              n: missionLabel(season, step.mission),
              title: bareTitle(text(step.mission.title)),
            })}
          </h2>
          <p>
            {newMission
              ? t('step.newMission', { n: season.number })
              : text(step.mission.summary) || seasonSummary(season, text, t)}
          </p>
        </>
      ) : (
        <>
          <h2 id="j-step-title">{seasonTitle(season, text, t)}</h2>
          {after && (
            <p className="j-after">
              ✓ {t('step.after', { n: after.number, score: seasonScore(after).toLocaleString(locale) })}
            </p>
          )}
          <p className="j-summary">{seasonSummary(season, text, t)}</p>
        </>
      )}
      <div className="j-progress">
        <SeasonBar season={season} next={step.kind === 'resume' ? step.mission : null} />
        <SeasonMeta season={season} />
      </div>
      <div className="j-step-actions">
        <button
          type="button"
          className="btn primary"
          autoFocus
          onClick={() => go(playSeason(season), seasonNews)}
        >
          {step.kind === 'resume' ? t('title.continue') : t('step.start', { n: season.number })} →
        </button>
      </div>
    </section>
  );
}

/**
 * What's new, as a notification of LR-OS in the corner of the title screen. Each line opens what it
 * announces; "mark as read" files them all. Decided on this computer only.
 */
export function NewsPanel({
  news,
  go,
  onDismiss,
}: {
  news: readonly News[];
  go: (to: Go, seen?: readonly News[]) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const text = useText();
  if (news.length === 0) return null;
  return (
    <aside className="j-news" aria-label={t('news.count', { n: news.length })}>
      <header>
        <span className="j-news-title">
          <span className="j-dot" aria-hidden="true" />
          {t('news.title')}
          <span className="j-news-count">{news.length}</span>
        </span>
        <button type="button" className="j-news-dismiss" onClick={onDismiss}>
          {t('news.dismiss')}
        </button>
      </header>
      <ul>
        {news.slice(0, 4).map((n) => (
          <li key={n.key}>
            <button
              type="button"
              onClick={() =>
                go(
                  n.kind === 'training' ? { screen: 'training' } : { screen: 'seasons', open: n.season.id },
                  [n],
                )
              }
            >
              <span className="j-news-kind">
                {n.kind === 'season'
                  ? `${t('news.season')} · ${t('season.kicker', { n: n.season.number })}`
                  : n.kind === 'mission'
                    ? t('news.mission', { n: n.season.number })
                    : t('news.training')}
              </span>
              <b>{n.kind === 'season' ? seasonTitle(n.season, text, t) : bareTitle(text(n.entry.title))}</b>
              <span className="j-news-go" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
