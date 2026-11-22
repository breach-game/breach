import { Component, type ReactNode } from 'react';
import { flushSave } from '../session.ts';
import { getSettings } from '../settings.ts';
import { translate } from '../ui.ts';

/**
 * A page loaded before the site was updated asks for scripts that the new version no longer has:
 * the browser refuses to load a module, or the packs no longer match the ones this page knows.
 */
export function isOutdated(error: unknown): boolean {
  if (error instanceof Error && error.name === 'OutdatedBuildError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|importing a module script failed|module script|preload css/i.test(
    message,
  );
}

export async function reload() {
  await flushSave();
  window.location.reload();
}

/** What the player sees instead of a blank page: what happened, and a way back. */
export function RecoverScreen({ outdated }: { outdated: boolean }) {
  const locale = getSettings().locale;
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <main className="title">
      <div className="title-inner" role="alert">
        <h1 className="recover-title">{t(outdated ? 'outdated.title' : 'crash.title')}</h1>
        <p className="recover-body">{t(outdated ? 'outdated.body' : 'crash.body')}</p>
        <button type="button" className="btn primary" autoFocus onClick={() => void reload()}>
          {t('reload')}
        </button>
      </div>
    </main>
  );
}

/** Catches what a screen throws while it loads or draws, so the page never goes blank. */
export class Recover extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown') };
  }

  override render() {
    if (this.state.error) return <RecoverScreen outdated={isOutdated(this.state.error)} />;
    return this.props.children;
  }
}
