import { type FormEvent, type ReactNode, useState } from 'react';
import { elapsed, touch, useGame } from '../session.ts';
import { useT } from '../ui.ts';

/** Show flags in the success colour. Anything else is plain text: content never becomes HTML. */
function rich(text: string): ReactNode[] {
  return text.split(/(FLAG\{[^}]*\})/).map((part, i) =>
    part.startsWith('FLAG{') ? (
      <b className="flag" key={i}>
        {part}
      </b>
    ) : (
      part
    ),
  );
}

interface Props {
  form: { to: string; label: string; button: string; name: string; placeholder?: string };
}

/**
 * A form of a simulated application. What the player types goes to the scripted character that
 * stands for the application, exactly as `curl -d` would send it, and the answer is shown as the
 * server sent it. No language model ever reads a form: the script decides alone.
 */
export function PageForm({ form }: Props) {
  const game = useGame();
  const t = useT();
  const [draft, setDraft] = useState('');
  const lines = game.state.chats[form.to] ?? [];
  const sent = lines.findLast((l) => l.from === 'player');
  const answer = lines.at(-1)?.from === 'npc' ? lines.at(-1) : undefined;
  const text = answer ? (answer.text ?? (answer.key ? game.t(answer.key) : '')) : '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    game.chat(form.to, value, 'browser', elapsed());
    touch();
    setDraft('');
  };

  return (
    <section className="page-form" data-form={form.to}>
      <form onSubmit={submit}>
        <label>
          <span>{game.t(form.label)}</span>
          <input
            name={form.name}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={form.placeholder ? game.t(form.placeholder) : undefined}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            maxLength={600}
          />
        </label>
        <button type="submit" className="btn" disabled={!draft.trim()}>
          {game.t(form.button)}
        </button>
      </form>
      {answer && (
        <output className="form-result" aria-live="polite">
          <small>
            {t('browser.form.sent')} <code>{`${form.name}=${sent?.text ?? ''}`}</code>
          </small>
          <pre>{rich(text)}</pre>
        </output>
      )}
    </section>
  );
}
