import { LEVEL_BONUS } from '@breach/engine';
import type { CatalogEntry } from '@breach/pack-schema';
import { useEffect, useState } from 'react';
import { loadCatalog } from '../packs.ts';
import { type StartMode, singleScores } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

const LEVELS = ['guided', 'standard', 'expert'] as const;

/**
 * Trainings: short official missions on one technique each, always open, played on their own like a
 * replayed mission. The list follows the catalogue, easiest first.
 */
export function Training({ onStart, onBack }: { onStart: (mode: StartMode) => void; onBack: () => void }) {
  const t = useT();
  const { locale } = useSettings();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    loadCatalog()
      .then(async (catalog) => {
        const list = catalog.training
          .map((id) => catalog.packs.find((e) => e.id === id))
          .filter((e): e is CatalogEntry => !!e);
        setScores(await singleScores(list));
        setEntries(list);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const text = (v: { fr?: string; en?: string } | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');

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
        <h1 className="levels-title">{t('training.title')}</h1>
        <p className="community-intro">{t('training.intro')}</p>
        {error ? (
          <div className="community-state title-error">
            {t('title.error')} {error}
          </div>
        ) : !entries ? (
          <p className="community-state" role="status">
            {t('community.loading')}
          </p>
        ) : (
          <div className="levels community-list">
            {entries.map((e, i) => {
              const score = scores[e.id];
              const difficulty = e.difficulty ?? 1;
              return (
                <button
                  key={e.id}
                  type="button"
                  className="level"
                  autoFocus={i === 0}
                  onClick={() => setPicked(e)}
                >
                  <b>{text(e.title)}</b>
                  <span>{text(e.summary)}</span>
                  <span className="tags">
                    <span className="difficulty" title={t(`difficulty.${difficulty}` as UiKey)}>
                      <span aria-hidden="true">{'●'.repeat(difficulty) + '○'.repeat(3 - difficulty)}</span>
                      {t(`difficulty.${difficulty}` as UiKey)}
                    </span>
                    {(e.skills ?? []).map((s) => (
                      <span className="tag" key={s}>
                        {t(`skill.${s}` as UiKey)}
                      </span>
                    ))}
                  </span>
                  <i>
                    {score === undefined ? `▶ ${t('training.todo')}` : `✓ ${t('missions.done', { score })}`}
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
