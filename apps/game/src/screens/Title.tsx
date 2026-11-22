import { LEVEL_BONUS } from '@breach/engine';
import { useEffect, useState } from 'react';
import { Wordmark } from '../brand.tsx';
import { eraseSave, hasSave } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

const LEVELS = ['guided', 'standard', 'expert'] as const;

const MIN_WIDTH = 900;

export function Title({ onStart }: { onStart: (mode: 'new' | 'continue') => void }) {
  const t = useT();
  const settings = useSettings();
  const [save, setSave] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const [wide, setWide] = useState(window.innerWidth >= MIN_WIDTH);

  useEffect(() => {
    void hasSave().then(setSave);
    const onResize = () => setWide(window.innerWidth >= MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <main className="title">
      <div className="title-inner">
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
                  onStart('new');
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
            {save ? (
              <>
                <button type="button" className="btn primary" autoFocus onClick={() => onStart('continue')}>
                  {t('title.continue')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await eraseSave();
                    setSave(false);
                    setPicking(true);
                  }}
                >
                  {t('title.restart')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn primary"
                autoFocus
                disabled={save === null}
                onClick={() => setPicking(true)}
              >
                {t('title.new')}
              </button>
            )}
          </div>
        ) : (
          <p className="small-screen">{t('title.desktop')}</p>
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
