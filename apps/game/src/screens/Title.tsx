import { useEffect, useState } from 'react';
import { Wordmark } from '../brand.tsx';
import { eraseSave, hasSave } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { useT } from '../ui.ts';

const MIN_WIDTH = 900;

export function Title({ onStart }: { onStart: (mode: 'new' | 'continue') => void }) {
  const t = useT();
  const settings = useSettings();
  const [save, setSave] = useState<boolean | null>(null);
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
        {wide ? (
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
                    onStart('new');
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
                onClick={() => onStart('new')}
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
        </div>
      </div>
      <p className="legal">{t('title.legal')}</p>
    </main>
  );
}
