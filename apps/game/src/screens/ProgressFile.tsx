import { MAX_PROGRESS_BYTES } from '@breach/engine';
import { useRef, useState } from 'react';
import { exportProgress, importProgress } from '../session.ts';
import { useT } from '../ui.ts';

type Status =
  | { kind: 'idle' }
  | { kind: 'confirm'; text: string }
  | { kind: 'done'; missions: number; score: number }
  | { kind: 'empty' }
  | { kind: 'invalid' };

/** Hand the player a file with their progress, without building any HTML. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download the campaign's finished missions and scores to a file, or bring them back from one.
 * The file is the player's: nothing leaves the browser except through their own download.
 */
export function ProgressFile({ hasSave, onImported }: { hasSave: boolean; onImported: () => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const apply = async (text: string) => {
    try {
      const result = await importProgress(text);
      setStatus({ kind: 'done', ...result });
      onImported();
    } catch {
      setStatus({ kind: 'invalid' });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (file.size > MAX_PROGRESS_BYTES) return setStatus({ kind: 'invalid' });
    const text = await file.text().catch(() => null);
    if (text === null) return setStatus({ kind: 'invalid' });
    // Importing replaces the current game: ask first when there is one.
    if (hasSave) setStatus({ kind: 'confirm', text });
    else await apply(text);
  };

  return (
    <div className="progress-file">
      <div className="progress-actions" role="group" aria-label={t('progress.title')}>
        {hasSave && (
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              const file = await exportProgress();
              if (!file || !Object.keys(file.missions).length) return setStatus({ kind: 'empty' });
              download(
                `breach-progress-${file.exportedAt.slice(0, 10)}.json`,
                `${JSON.stringify(file, null, 2)}\n`,
              );
              setStatus({ kind: 'idle' });
            }}
          >
            ⤓ {t('progress.export')}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => input.current?.click()}>
          ⤒ {t('progress.import')}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      <div className="progress-status" role="status">
        {status.kind === 'confirm' ? (
          <span className="progress-confirm">
            {t('progress.confirm')}
            <button type="button" className="btn" onClick={() => void apply(status.text)}>
              {t('progress.replace')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setStatus({ kind: 'idle' })}>
              {t('progress.cancel')}
            </button>
          </span>
        ) : status.kind === 'done' ? (
          <span className="ok">
            ✓ {t('progress.imported', { missions: status.missions, score: status.score })}
          </span>
        ) : status.kind === 'invalid' ? (
          <span className="title-error">⚠ {t('progress.invalid')}</span>
        ) : status.kind === 'empty' ? (
          <span>{t('progress.empty')}</span>
        ) : (
          <span>{t('progress.note')}</span>
        )}
      </div>
    </div>
  );
}
