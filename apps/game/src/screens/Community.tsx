import { LEVEL_BONUS } from '@breach/engine';
import type { Catalog, CatalogEntry } from '@breach/pack-schema';
import { useEffect, useState } from 'react';
import { COMMUNITY_CATALOG_URL } from '../community.ts';
import { engineSatisfies, loadCommunityCatalog } from '../packs.ts';
import type { StartMode } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

const LEVELS = ['guided', 'standard', 'expert'] as const;
const CREATE_URL = 'https://github.com/breach-game/packs#readme';

/**
 * Community missions: the signed catalogue of `breach-game/packs`, downloaded only when the player
 * opens this screen. Each mission is played on its own, with its own save.
 */
export function Community({ onStart, onBack }: { onStart: (mode: StartMode) => void; onBack: () => void }) {
  const t = useT();
  const { locale } = useSettings();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CatalogEntry | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry button
  useEffect(() => {
    let live = true;
    setError(null);
    loadCommunityCatalog().then(
      (c) => live && setCatalog(c),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const missions = (catalog?.packs ?? []).filter((p) => p.kind === 'mission');
  const text = (v: { fr?: string; en?: string } | undefined) => (v ? (v[locale] ?? v.fr ?? v.en ?? '') : '');
  const host = new URL(COMMUNITY_CATALOG_URL, location.href).host;

  if (picked)
    return (
      <main className="title">
        <div className="title-inner">
          <div className="levels" role="group" aria-label={t('title.level')}>
            <div className="levels-title">{t('community.level', { title: text(picked.title) })}</div>
            {LEVELS.map((g, i) => (
              <button
                key={g}
                type="button"
                className="level"
                autoFocus={i === 0}
                onClick={() => {
                  updateSettings({ guidance: g });
                  onStart({ community: picked, catalog: catalog! });
                }}
              >
                <b>{t(`guidance.${g}` as UiKey)}</b>
                <span>{t(`guidance.${g}.desc` as UiKey)}</span>
                <i>{t('title.level.bonus', { factor: LEVEL_BONUS[g].toLocaleString(locale) })}</i>
              </button>
            ))}
          </div>
          <div className="title-actions">
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
        <h1 className="levels-title">{t('title.community')}</h1>
        <p className="community-intro">{t('community.intro')}</p>
        {error ? (
          <div className="community-state">
            <div className="title-error">
              {t('community.error')} {error}
            </div>
            <button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>
              {t('title.retry')}
            </button>
          </div>
        ) : !catalog ? (
          <p className="community-state" role="status">
            {t('community.loading')}
          </p>
        ) : missions.length === 0 ? (
          <p className="community-state">{t('community.empty')}</p>
        ) : (
          <div className="levels community-list">
            {missions.map((m, i) => {
              const blocked = !engineSatisfies(m.engine)
                ? t('community.engine')
                : !m.locales.includes(locale)
                  ? t('community.locale')
                  : null;
              const details = [
                m.authors?.length ? t('community.by', { authors: m.authors.join(', ') }) : null,
                m.locales.map((l) => l.toUpperCase()).join(' '),
                m.reviewed ? `✓ ${t('community.reviewed')}` : null,
                `${Math.max(1, Math.round(m.size / 1024))} KB`,
              ].filter(Boolean);
              return (
                <button
                  key={`${m.id}@${m.version}`}
                  type="button"
                  className="level"
                  autoFocus={i === 0}
                  disabled={!!blocked}
                  onClick={() => setPicked(m)}
                >
                  <b>{text(m.title)}</b>
                  <span>{blocked ?? text(m.summary)}</span>
                  <i>{details.join(' · ')}</i>
                </button>
              );
            })}
          </div>
        )}
        <div className="title-actions community-actions">
          <button type="button" className="btn" autoFocus={!missions.length} onClick={onBack}>
            {t('community.back')}
          </button>
          <a className="btn link" href={CREATE_URL} target="_blank" rel="noopener noreferrer">
            {t('community.create')} ↗
          </a>
        </div>
        <p className="levels-note community-note">{t('community.source', { host })}</p>
      </div>
    </main>
  );
}
