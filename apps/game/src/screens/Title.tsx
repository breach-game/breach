import { LEVEL_BONUS } from '@breach/engine';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Wordmark } from '../brand.tsx';
import {
  findNews,
  initialSeen,
  type Journey,
  type News,
  newsKeys,
  nextStep,
  seasonState,
  settleSeen,
} from '../journey.ts';
import { eraseSave, hasSave, loadJourney, markSeen, readSeen, singleScores, writeSeen } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';
import { type Go, NewsPanel, StepCard } from './Journey.tsx';
import { ProgressFile } from './ProgressFile.tsx';

const LEVELS = ['guided', 'standard', 'expert'] as const;

const MIN_WIDTH = 900;

export function Title({ go, picking: initialPicking = false }: { go: (to: Go) => void; picking?: boolean }) {
  const t = useT();
  const settings = useSettings();
  const [save, setSave] = useState<boolean | null>(null);
  const [journey, setJourney] = useState<Journey | null | undefined>(undefined);
  const [news, setNews] = useState<News[]>([]);
  const [picking, setPicking] = useState(initialPicking);
  const [wide, setWide] = useState(window.innerWidth >= MIN_WIDTH);
  const [panel, setPanel] = useState<'progress' | 'settings' | null>(null);
  const [trainingsDone, setTrainingsDone] = useState(0);

  // Every save, read at once: what comes next, and what is new since the last visit. Read again
  // after a progress file was imported.
  const readSaves = useCallback(async () => {
    setSave(await hasSave());
    try {
      const [j, stored] = await Promise.all([loadJourney(), readSeen()]);
      const seen = settleSeen(j, stored ?? initialSeen(j));
      if (seen !== stored) await writeSeen(seen);
      setJourney(j);
      setNews(findNews(j, seen));
      setTrainingsDone(Object.keys(await singleScores(j.trainings)).length);
    } catch {
      setJourney(null);
    }
  }, []);

  useEffect(() => {
    void readSaves();
    const onResize = () => setWide(window.innerWidth >= MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [readSaves]);

  const follow = (to: Go, seen?: readonly News[]) => {
    if (seen?.length) void markSeen(seen.flatMap(newsKeys));
    if ('screen' in to && to.screen === 'newGame') setPicking(true);
    else go(to);
  };
  const ready = save !== null && journey !== undefined;
  const count = (kinds: News['kind'][]) => news.filter((n) => kinds.includes(n.kind)).length;

  const seasonsDone = journey ? journey.seasons.filter((x) => seasonState(x) === 'done').length : 0;
  const options = (
    <>
      <span className="home-option">
        {t('title.effects')}
        <span className="seg">
          <button
            type="button"
            aria-pressed={settings.effects}
            onClick={() => updateSettings({ effects: true })}
          >
            {t('on')}
          </button>
          <button
            type="button"
            aria-pressed={!settings.effects}
            onClick={() => updateSettings({ effects: false })}
          >
            {t('off')}
          </button>
        </span>
      </span>
      <span className="home-option">
        {t('settings.sound')}
        <span className="seg">
          <button type="button" aria-pressed={settings.sound} onClick={() => updateSettings({ sound: true })}>
            {t('sound.on')}
          </button>
          <button
            type="button"
            aria-pressed={!settings.sound}
            onClick={() => updateSettings({ sound: false })}
          >
            {t('sound.off')}
          </button>
        </span>
      </span>
    </>
  );
  const language = (
    <div className="seg" role="group" aria-label="Language">
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={settings.locale === l}
          onClick={() => updateSettings({ locale: l })}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );

  // Choosing a level, or a screen too narrow for the desktop: the centred title, as before.
  if (!wide || picking)
    return (
      <main className="title">
        <div className="title-inner">
          <Wordmark className="wm" />
          <div className="tagline">
            {t('title.tagline')}
            <span className="cursor" />
          </div>
          {wide ? (
            <div className="levels" role="group" aria-label={t('title.level')}>
              <div className="levels-title">{t('title.level')}</div>
              {LEVELS.map((g, i) => (
                <button
                  key={g}
                  type="button"
                  className="level"
                  autoFocus={i === 0}
                  onClick={() => {
                    updateSettings({ guidance: g });
                    go({ start: 'new' });
                  }}
                >
                  <b>{t(`guidance.${g}` as UiKey)}</b>
                  <span>{t(`guidance.${g}.desc` as UiKey)}</span>
                  <i>{t('title.level.bonus', { factor: LEVEL_BONUS[g].toLocaleString(settings.locale) })}</i>
                </button>
              ))}
              <div className="levels-note">{t('title.level.note')}</div>
            </div>
          ) : (
            <p className="small-screen">{t('title.desktop')}</p>
          )}
          <div className="title-options">{language}</div>
        </div>
        <p className="legal">{t('title.legal')}</p>
      </main>
    );

  return (
    <main className="title home">
      <div className="home-grid">
        <div className="home-main">
          <Wordmark className="wm" />
          <div className="tagline">
            {t('title.tagline')}
            <span className="cursor" />
          </div>
          {!ready ? (
            <div className="j-step pending" aria-busy="true" />
          ) : journey ? (
            <StepCard step={nextStep(journey.seasons)} seasons={journey.seasons} news={news} go={follow} />
          ) : (
            // The catalogue could not be read: the campaign can still start or resume.
            <button
              type="button"
              className="btn primary"
              autoFocus
              onClick={() => (save ? go({ start: 'continue' }) : setPicking(true))}
            >
              {t(save ? 'title.continue' : 'title.new')}
            </button>
          )}
        </div>
        <nav className="home-side" aria-label={t('home.where')}>
          <NewsPanel
            news={news}
            go={follow}
            onDismiss={() => {
              void markSeen(news.flatMap(newsKeys));
              setNews([]);
            }}
          />
          <span className="home-label">
            {panel ? t(panel === 'progress' ? 'home.progress' : 'home.settings') : t('home.where')}
          </span>
          {panel === 'progress' ? (
            <div className="home-panel">
              <ProgressFile hasSave={Boolean(save)} onImported={() => void readSaves()} />
              <button type="button" className="btn" autoFocus onClick={() => setPanel(null)}>
                ← {t('community.back')}
              </button>
            </div>
          ) : panel === 'settings' ? (
            <div className="home-panel">
              <div className="home-options">{options}</div>
              <button type="button" className="btn" autoFocus onClick={() => setPanel(null)}>
                ← {t('community.back')}
              </button>
            </div>
          ) : (
            <div className="home-tiles">
              <Tile
                icon="seasons"
                title={t('title.seasons')}
                desc={
                  journey ? t('home.seasons.desc', { done: seasonsDone, total: journey.seasons.length }) : ''
                }
                fresh={count(['season', 'mission'])}
                disabled={!ready}
                onClick={() => go({ screen: 'seasons' })}
              />
              <Tile
                icon="training"
                title={t('title.training')}
                desc={
                  journey
                    ? t('home.training.desc', { done: trainingsDone, total: journey.trainings.length })
                    : ''
                }
                fresh={count(['training'])}
                disabled={!ready}
                onClick={() => go({ screen: 'training' })}
              />
              <Tile
                icon="community"
                title={t('title.community')}
                desc={t('home.community.desc')}
                disabled={!ready}
                onClick={() => go({ screen: 'community' })}
              />
              <Tile
                icon="replay"
                title={t('title.missions')}
                desc={t(save ? 'home.missions.desc' : 'home.missions.locked')}
                disabled={!save}
                onClick={() => go({ screen: 'missions' })}
              />
              <Tile
                icon="progress"
                title={t('home.progress')}
                desc={t('home.progress.desc')}
                disabled={save === null}
                onClick={() => setPanel('progress')}
              />
              <Tile
                icon="settings"
                title={t('home.settings')}
                desc={t('home.settings.desc')}
                onClick={() => setPanel('settings')}
              />
            </div>
          )}
          {save && !panel && (
            <button
              type="button"
              className="btn quiet"
              onClick={async () => {
                await eraseSave();
                setSave(false);
                setPicking(true);
              }}
            >
              {t('title.restart')}
            </button>
          )}
        </nav>
      </div>
      <footer className="home-foot">
        {language}
        <span className="legal">{t('title.legal')}</span>
      </footer>
    </main>
  );
}

type Icon = 'seasons' | 'training' | 'community' | 'replay' | 'progress' | 'settings';

/** Pictograms of the menu, drawn as strokes in the text colour: neutral, the label carries the meaning. */
const ICONS: Record<Icon, ReactNode> = {
  seasons: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>
  ),
  training: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  community: (
    <>
      <path d="M4 9h16l-1.2 10.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8L4 9Z" />
      <path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2" />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
      <path d="m10 9 5 3-5 3V9Z" />
    </>
  ),
  progress: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
};

/** One entry of the menu: a pictogram, its name, and one line on where it stands. */
function Tile({
  icon,
  title,
  desc,
  fresh = 0,
  disabled,
  onClick,
}: {
  icon: Icon;
  title: string;
  desc: string;
  fresh?: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button type="button" className="home-tile" disabled={disabled} onClick={onClick}>
      <span className="home-ico">
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[icon]}
        </svg>
      </span>
      {fresh > 0 && (
        <span className="j-chip new home-new">
          ● {t('season.new')}
          <span className="sr-only">{t('news.count', { n: fresh })}</span>
        </span>
      )}
      <b>{title}</b>
      <span>{desc}</span>
    </button>
  );
}
