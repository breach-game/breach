import { useEffect, useRef, useState } from 'react';
import { useGame } from '../session.ts';
import { useT } from '../ui.ts';

/**
 * The workstation's text editor, opened by `edit <file>`. It reads and saves through the engine, so a
 * saved file is an event like any other and a mission's checks see it.
 */
export function Editor({
  path,
  nonce,
  active,
  onVerify,
}: {
  path: string;
  nonce: number;
  active: boolean;
  /** Bring the terminal forward and run `verify` there, as if the player typed it. */
  onVerify: () => void;
}) {
  const game = useGame();
  const t = useT();
  const [text, setText] = useState<string | null>('');
  const [status, setStatus] = useState<'clean' | 'modified' | 'saved' | 'denied'>('clean');
  const area = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per `edit` command
  useEffect(() => {
    setText(game.readFile(path));
    setStatus('clean');
  }, [path, nonce]);

  useEffect(() => {
    if (active) area.current?.focus();
  }, [active]);

  if (text === null) return <p className="editor-msg">{t('editor.unreadable')}</p>;
  const save = () => {
    const ok = game.writeFile(path, text.endsWith('\n') || !text ? text : `${text}\n`);
    setStatus(ok ? 'saved' : 'denied');
    return ok;
  };
  // Only a mission judged by `verify` gets the shortcut; elsewhere the button would say nothing.
  const checks = !!game.mission?.checks.length && !game.state.missionDone;
  const lines = text.split('\n').length;
  return (
    <div className="editor">
      <div className="editor-body">
        <pre className="editor-gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
        </pre>
        <textarea
          ref={area}
          aria-label={t('editor.label')}
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          maxLength={64000}
          onChange={(e) => {
            setText(e.target.value);
            setStatus('modified');
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="editor-bar">
        <span className="editor-hint">{t(checks ? 'editor.hintVerify' : 'editor.hint')}</span>
        <span className="editor-status" data-status={status} role="status">
          {status === 'modified' && `● ${t('editor.modified')}`}
          {status === 'saved' && `✓ ${t('editor.saved')}`}
          {status === 'denied' && `! ${t('editor.denied')}`}
        </span>
        <button type="button" className="btn defense" onClick={save} disabled={status !== 'modified'}>
          {t('editor.save')}
        </button>
        {checks && (
          <button
            type="button"
            className="btn defense"
            onClick={() => {
              if (status !== 'modified' || save()) onVerify();
            }}
          >
            {t(status === 'modified' ? 'editor.saveVerify' : 'editor.verify')}
          </button>
        )}
      </div>
    </div>
  );
}
