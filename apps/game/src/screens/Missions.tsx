import { LEVEL_BONUS } from '@breach/engine';
import type { CatalogEntry } from '@breach/pack-schema';
import { useEffect, useState } from 'react';
import { loadCatalog } from '../packs.ts';
import { type CampaignProgress, campaignProgress, type StartMode } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';
import { Tags } from './Tags.tsx';

const LEVELS = ['guided', 'standard', 'expert'] as const;

/**
 * The official campaign, mission by mission. A finished mission can be replayed on its own, at any
 * level, without touching the campaign; the current one resumes the campaign; the others stay locked.
 * The list follows the catalogue, so a new official mission appears here by itself.
 */
export function Missions({ onStart, onBack }: { onStart: (mode: StartMode) => void; onBack: () => void }) {
  const t = useT();
  const { locale } = useSettings();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    Promise.all([loadCatalog(), campaignProgress()]).then(
      ([catalog, p]) => {
        setEntries(
          catalog.campaign
            .map((id) => catalog.packs.find((e) => e.id === id))
            .filter((e): e is CatalogEntry => !!e),
        );
        setProgress(p);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const text = (v: { fr?: string; en?: string } | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');
  const number = (e: CatalogEntry, i: number) => String(e.order ?? i).padStart(2, '0');

  if (picked)
    return (
      <main className="title">
        <div className="title-inner">
          <div className="levels" role="group" aria-label={t('title.level')}>
            <div className="levels-title">{t('missions.level', { title: text(picked.title) })}</div>
            {LEVELS.map((g, i) => (
              <button
                key={g}
                type="button"
                className="level"
                autoFocus={i === 0}
                onClick={() => {
                  updateSettings({ guidance: g });
                  onStart({ replay: picked.id });
                }}
              >
                <b>{t(`guidance.${g}` as UiKey)}</b>
                <span>{t(`guidance.${g}.desc` as UiKey)}</span>
                <i>{t('title.level.bonus', { factor: LEVEL_BONUS[g].toLocaleString(locale) })}</i>
              </button>
            ))}
          </div>
          <div className="title-actions community-actions">
            <button type="button" className="btn" onClick={() => setPicked(null)}>
              {t('community.back')}
            </button>
          </div>
        </div>
      </main>
    );

  return (
    <main className="title community">
      <div className="title-inner">
        <h1 className="levels-title">{t('missions.title')}</h1>
        <p className="community-intro">{t('missions.intro')}</p>
        {error ? (
          <div className="community-state title-error">
            {t('title.error')} {error}
          </div>
        ) : !entries || !progress ? (
          <p className="community-state" role="status">
            {t('community.loading')}
          </p>
        ) : (
          <div className="levels community-list">
            {entries.map((e, i) => {
              const score = progress.completed[e.id];
              const done = score !== undefined;
              // The campaign's next step: the mission in progress, or else the first one not finished.
              const next = progress.current ?? entries.find((x) => !(x.id in progress.completed))?.id;
              const current = !done && next === e.id;
              const status = done
                ? `✓ ${t('missions.done', { score })}`
                : current
                  ? `▶ ${t(progress.current === e.id ? 'missions.current' : 'missions.next')}`
                  : `⊘ ${t('missions.locked')}`;
              return (
                <button
                  key={e.id}
                  type="button"
                  className="level"
                  disabled={!done && !current}
                  autoFocus={i === 0}
                  onClick={() => (done ? setPicked(e) : onStart('continue'))}
                >
                  <b>
                    {number(e, i)} · {text(e.title)}
                  </b>
                  <span>
                    {done || current ? text(e.summary) : t('missions.lockedHint')}
                    {current && <> {t('missions.resume')}</>}
                  </span>
                  <Tags entry={e} />
                  <i>{status}</i>
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
