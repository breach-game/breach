import { LEVEL_BONUS } from '@breach/engine';
import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '../brand.tsx';
import {
  findNews,
  initialSeen,
  type Journey,
  type News,
  newsKeys,
  nextStep,
  returning,
  settleSeen,
} from '../journey.ts';
import { eraseSave, hasSave, loadJourney, markSeen, readSeen, writeSeen } from '../session.ts';
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
  const back = journey ? returning(journey.seasons) : Boolean(save);
  const step = journey && back ? nextStep(journey.seasons) : null;
  const allDone = step?.kind === 'done';
  const count = (kinds: News['kind'][]) => news.filter((n) => kinds.includes(n.kind)).length;

  return (
    <main className="title">
      {wide && !picking && (
        <NewsPanel
          news={news}
          go={follow}
          onDismiss={() => {
            void markSeen(news.flatMap(newsKeys));
            setNews([]);
          }}
        />
      )}
      <div className={`title-inner${wide && !picking && back && journey ? ' has-step' : ''}`}>
        <Wordmark className="wm" />
        <div className="tagline">
          {t('title.tagline')}
          <span className="cursor" />
        </div>
        {wide && picking ? (
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
        ) : wide ? (
          <div className="title-actions">
            {!ready ? (
              <button type="button" className="btn primary" disabled>
                {t('title.continue')}
              </button>
            ) : step && journey ? (
              <StepCard step={step} seasons={journey.seasons} news={news} go={follow} />
            ) : back ? (
              // The catalogue could not be read: the campaign can still resume.
              <button
                type="button"
                className="btn primary"
                autoFocus
                onClick={() => go({ start: 'continue' })}
              >
                {t('title.continue')}
              </button>
            ) : (
              <button type="button" className="btn primary" autoFocus onClick={() => setPicking(true)}>
                {t('title.new')}
              </button>
            )}
            <div className="title-grid">
              {/* Once everything is finished, the card above already offers the trainings and the store. */}
              <button
                type="button"
                className="btn"
                disabled={!ready}
                onClick={() => go({ screen: 'seasons' })}
              >
                {t('title.seasons')}
                <Badge n={count(['season', 'mission'])} />
              </button>
              <button
                type="button"
                className="btn"
                disabled={!ready}
                onClick={() => go({ screen: 'training' })}
              >
                {t('title.training')}
                <Badge n={count(['training'])} />
              </button>
              <button
                type="button"
                className="btn"
                disabled={!ready}
                onClick={() => go({ screen: 'community' })}
              >
                {t('title.community')}
              </button>
              {save && (
                <button type="button" className="btn" onClick={() => go({ screen: 'missions' })}>
                  {t('title.missions')}
                </button>
              )}
            </div>
            {save && (
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
          </div>
        ) : (
          <p className="small-screen">{t('title.desktop')}</p>
        )}
        {wide && !picking && save !== null && (
          <ProgressFile hasSave={save} onImported={() => void readSaves()} />
        )}
        <div className="title-options">
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {t('settings.sound')}
            <span className="seg">
              <button
                type="button"
                aria-pressed={settings.sound}
                onClick={() => updateSettings({ sound: true })}
              >
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
          </label>
        </div>
      </div>
      <p className="legal">{t('title.legal')}</p>
    </main>
  );
}

/** A count of news on a title button, read out with it. */
function Badge({ n }: { n: number }) {
  const t = useT();
  if (n === 0) return null;
  return (
    <span className="j-badge" title={t('news.count', { n })}>
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{t('news.count', { n })}</span>
    </span>
  );
}
