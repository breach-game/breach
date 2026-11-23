import { useEffect, useState } from 'react';
import {
  bareTitle,
  findNews,
  type Journey,
  missionKey,
  missionLabel,
  nextStep,
  type Season,
  seasonKey,
  seasonState,
  upNext,
} from '../journey.ts';
import { loadJourney, markSeen, readSeen } from '../session.ts';
import { useT } from '../ui.ts';
import {
  type Go,
  playSeason,
  SeasonBar,
  SeasonKicker,
  SeasonMeta,
  StateChip,
  seasonSummary,
  seasonTitle,
  useText,
} from './Journey.tsx';
import { Tags } from './Tags.tsx';

/**
 * Every official season as a progress card: season 1 is the NovaMind campaign, the next ones are the
 * catalogue's seasons, each in its own world and its own save. Listed from the game's own catalogue,
 * so no download is needed, and a new season shows up here by itself.
 */
export function Seasons({ open, go }: { open?: string; go: (to: Go) => void }) {
  const t = useT();
  const text = useText();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(open ?? null);

  useEffect(() => {
    let live = true;
    Promise.all([loadJourney(), readSeen()]).then(
      ([j, seen]) => {
        if (!live) return;
        setJourney(j);
        // Seasons the title screen announces as new, marked the same way here.
        setFresh(new Set(seen ? findNews(j, seen).map((n) => n.key) : []));
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);

  const season = journey?.seasons.find((s) => s.id === opened);
  // Opening a season files its news.
  useEffect(() => {
    if (season) void markSeen([seasonKey(season), ...season.missions.map(missionKey)]);
  }, [season]);

  if (season) return <SeasonDetail season={season} go={go} onBack={() => setOpened(null)} />;

  const all = journey ? nextStep(journey.seasons).kind === 'done' : false;
  return (
    <main className="title community">
      <div className="title-inner">
        <h1 className="levels-title">{t('season.title')}</h1>
        <p className="community-intro">{t('season.intro')}</p>
        {error ? (
          <div className="community-state title-error">
            {t('title.error')} {error}
          </div>
        ) : !journey ? (
          <p className="community-state" role="status">
            {t('community.loading')}
          </p>
        ) : (
          <div className="j-seasons">
            {journey.seasons.map((s, i) => {
              const before = journey.seasons[i - 1];
              const early = before && seasonState(s) === 'fresh' && seasonState(before) !== 'done';
              return (
                <button
                  key={s.id}
                  type="button"
                  className="j-season"
                  data-state={seasonState(s)}
                  autoFocus={i === 0}
                  onClick={() => setOpened(s.id)}
                >
                  <header>
                    <SeasonKicker season={s} />
                    <StateChip season={s} fresh={fresh.has(seasonKey(s))} />
                  </header>
                  <b>{seasonTitle(s, text, t)}</b>
                  <span className="j-summary">{seasonSummary(s, text, t)}</span>
                  {s.entry && <Tags entry={s.entry} />}
                  <div className="j-progress">
                    <SeasonBar season={s} next={seasonState(s) === 'started' ? upNext(s) : null} />
                    <SeasonMeta season={s} />
                  </div>
                  {early && <i className="j-note">{t('season.after', { n: before.number })}</i>}
                </button>
              );
            })}
          </div>
        )}
        {all && (
          <div className="j-meanwhile">
            <p>{t('season.allDone')}</p>
            <div className="title-actions community-actions">
              <button type="button" className="btn" onClick={() => go({ screen: 'training' })}>
                {t('title.training')}
              </button>
              <button type="button" className="btn" onClick={() => go({ screen: 'community' })}>
                {t('title.community')}
              </button>
            </div>
          </div>
        )}
        <div className="title-actions community-actions">
          <button type="button" className="btn" onClick={() => go({ screen: 'title' })}>
            {t('community.back')}
          </button>
        </div>
      </div>
    </main>
  );
}

/** One season, mission by mission, with what can be done with it. */
function SeasonDetail({ season, go, onBack }: { season: Season; go: (to: Go) => void; onBack: () => void }) {
  const t = useT();
  const text = useText();
  const state = seasonState(season);
  const next = upNext(season);
  const campaign = season.kind === 'campaign';
  const restart: Go = { start: { season: season.id, restart: true } };
  return (
    <main className="title community">
      <div className="title-inner">
        <div className="j-detail-head">
          <SeasonKicker season={season} />
          <StateChip season={season} />
        </div>
        <h1 className="j-detail-title">{seasonTitle(season, text, t)}</h1>
        <p className="community-intro">{seasonSummary(season, text, t)}</p>
        <div className="j-progress wide">
          <SeasonBar season={season} next={state === 'started' ? next : null} />
          <SeasonMeta season={season} />
        </div>
        <ol className="series-list">
          {season.missions.map((m) => {
            const score = season.progress.completed[m.id];
            const isNext = score === undefined && m.id === next?.id;
            return (
              <li key={m.id} data-state={score !== undefined ? 'done' : isNext ? 'next' : 'locked'}>
                <b>
                  {missionLabel(season, m)} · {bareTitle(text(m.title))}
                </b>
                <span>{score !== undefined || isNext ? text(m.summary) : t('missions.lockedHint')}</span>
                <i>
                  {score !== undefined
                    ? `✓ ${t('missions.done', { score })}`
                    : isNext
                      ? `▶ ${t(season.progress.current === m.id ? 'missions.current' : 'missions.next')}`
                      : `⊘ ${t('missions.locked')}`}
                </i>
              </li>
            );
          })}
        </ol>
        {!campaign && <p className="levels-note">{t('season.levelNote')}</p>}
        <div className="title-actions community-actions">
          {state !== 'done' ? (
            <button type="button" className="btn primary" autoFocus onClick={() => go(playSeason(season))}>
              {state === 'fresh'
                ? campaign
                  ? t('title.new')
                  : t('step.start', { n: season.number })
                : campaign
                  ? t('title.continue')
                  : t('series.continue')}{' '}
              →
            </button>
          ) : campaign ? (
            <button
              type="button"
              className="btn primary"
              autoFocus
              onClick={() => go({ screen: 'missions' })}
            >
              {t('title.missions')}
            </button>
          ) : (
            <button type="button" className="btn primary" autoFocus onClick={() => go(restart)}>
              {t('series.again')}
            </button>
          )}
          {campaign && state === 'started' && (
            <button type="button" className="btn" onClick={() => go({ screen: 'missions' })}>
              {t('title.missions')}
            </button>
          )}
          {!campaign && state === 'started' && (
            <button type="button" className="btn" onClick={() => go(restart)}>
              {t('series.restart')}
            </button>
          )}
          <button type="button" className="btn" onClick={onBack}>
            {t('community.back')}
          </button>
        </div>
      </div>
    </main>
  );
}
