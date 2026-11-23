import type { CatalogEntry } from '@breach/pack-schema';
import { useEffect, useState } from 'react';
import { loadSeasons, seriesMissions } from '../packs.ts';
import { type CampaignProgress, type StartMode, seasonProgress } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';
import { Tags } from './Tags.tsx';

/**
 * Official seasons: series of official missions played after the campaign, each in its own world and
 * its own save. Listed from the game's own catalogue, like the campaign, so no download is needed.
 */
export function Seasons({ onStart, onBack }: { onStart: (mode: StartMode) => void; onBack: () => void }) {
  const t = useT();
  const { locale } = useSettings();
  const [seasons, setSeasons] = useState<CatalogEntry[] | null>(null);
  const [catalog, setCatalog] = useState<Parameters<typeof seriesMissions>[1] | null>(null);
  const [progress, setProgress] = useState<Record<string, CampaignProgress>>({});
  const [opened, setOpened] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    let live = true;
    void loadSeasons().then(async ({ catalog, seasons }) => {
      if (!live) return;
      setCatalog(catalog);
      setSeasons(seasons);
      const entries = await Promise.all(seasons.map((s) => seasonProgress(s)));
      if (live) setProgress(Object.fromEntries(seasons.map((s, i) => [s.id, entries[i]!])));
    });
    return () => {
      live = false;
    };
  }, []);

  const text = (v: { fr?: string; en?: string } | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');

  if (opened && catalog) {
    const prog = progress[opened.id] ?? { completed: {}, current: null };
    const list = seriesMissions(opened, catalog);
    const next = prog.current ?? list.find((m) => !(m.id in prog.completed))?.id;
    const started = Object.keys(prog.completed).length > 0 || prog.current !== null;
    return (
      <main className="title community">
        <div className="title-inner">
          <h1 className="levels-title">{text(opened.title)}</h1>
          <p className="community-intro">{text(opened.summary)}</p>
          <ol className="series-list">
            {list.map((m, i) => {
              const score = prog.completed[m.id];
              const open = score !== undefined || m.id === next;
              return (
                <li key={m.id} data-state={score !== undefined ? 'done' : m.id === next ? 'next' : 'locked'}>
                  <b>
                    {String(i + 1).padStart(2, '0')} · {text(m.title)}
                  </b>
                  <span>{open ? text(m.summary) : t('missions.lockedHint')}</span>
                  <i>
                    {score !== undefined
                      ? `✓ ${t('missions.done', { score })}`
                      : m.id === next
                        ? `▶ ${t(prog.current === m.id ? 'missions.current' : 'missions.next')}`
                        : `⊘ ${t('missions.locked')}`}
                  </i>
                </li>
              );
            })}
          </ol>
          <p className="levels-note">{t('season.levelNote')}</p>
          <div className="title-actions community-actions">
            <button
              type="button"
              className="btn primary"
              autoFocus
              onClick={() => onStart({ season: opened.id, restart: started && !next })}
            >
              {t(!started ? 'series.start' : next ? 'series.continue' : 'series.again')}
            </button>
            {started && next && (
              <button
                type="button"
                className="btn"
                onClick={() => onStart({ season: opened.id, restart: true })}
              >
                {t('series.restart')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setOpened(null)}>
              {t('community.back')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="title community">
      <div className="title-inner">
        <h1 className="levels-title">{t('season.title')}</h1>
        <p className="community-intro">{t('season.intro')}</p>
        {seasons === null ? (
          <p className="fine">{t('community.loading')}</p>
        ) : seasons.length === 0 ? (
          <p className="fine">{t('season.none')}</p>
        ) : (
          <div className="levels community-list">
            {seasons.map((s, i) => {
              const prog = progress[s.id] ?? { completed: {}, current: null };
              const done = catalog ? seriesMissions(s, catalog).length : 0;
              const got = Object.keys(prog.completed).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="level"
                  autoFocus={i === 0}
                  onClick={() => setOpened(s)}
                >
                  <b>{text(s.title)}</b>
                  <span>{text(s.summary)}</span>
                  <Tags entry={s} />
                  <i>
                    {t('series.count', { n: done })}
                    {got > 0 ? ` · ${got}/${done} ✓` : ` · ${t('season.new')}`}
                  </i>
                </button>
              );
            })}
          </div>
        )}
        <div className="title-actions community-actions">
          <button type="button" className="btn" onClick={onBack}>
            {t('community.back')}
          </button>
        </div>
      </div>
    </main>
  );
}
