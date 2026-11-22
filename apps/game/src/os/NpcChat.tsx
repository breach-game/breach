import { gameDate } from '@breach/engine';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { activeBrain, BRAIN_CALL_LIMIT, BRAIN_USES, reportBrain, useBrain } from '../brain.ts';
import { elapsed, resumeSeq, touch, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

/** Show flags in the success colour and `code` spans. Anything else is plain text. */
function rich(text: string): ReactNode[] {
  return text.split(/(FLAG\{[^}]*\}|`[^`]*`)/).map((part, i) => {
    if (part.startsWith('FLAG{'))
      return (
        <b className="flag" key={i}>
          {part}
        </b>
      );
    if (part.startsWith('`') && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/**
 * A reply, with what the character pastes after its first blank line (a tool's output, a log, a
 * configuration) set in the machine's typeface, as the terminal would show it.
 */
function reply(text: string): ReactNode[] {
  const cut = text.indexOf('\n\n');
  if (cut < 0) return rich(text);
  return [
    ...rich(text.slice(0, cut)),
    <span className="paste" key="paste">
      {rich(text.slice(cut + 2))}
    </span>,
  ];
}

/**
 * A conversation with a character, embedded in a page. The engine's scripted brain decides the
 * answer at once; this component stages it (a pause, then the text typed out). When the player has
 * set their own API key, a model words that answer first, and the wait shows as the same pause.
 */
export function NpcChat({ npcId, active }: { npcId: string; active: boolean }) {
  const game = useGame();
  const t = useT();
  const { effects } = useSettings();
  const npc = game.npc(npcId);
  const lines = game.state.chats[npcId] ?? [];
  const [draft, setDraft] = useState('');
  // Number of lines fully shown. What was said before this window opened is shown at once.
  const [settled, setSettled] = useState(lines.length);
  const [typed, setTyped] = useState(-1);
  // Waiting for a model to word the reply.
  const [pending, setPending] = useState(false);
  const brain = useBrain();
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // A restore after detection rewinds the log, so the conversation can get shorter.
  if (settled > lines.length) setSettled(lines.length);
  const current = lines[settled];
  const text = (line: (typeof lines)[number]) => line.text ?? (line.key ? game.t(line.key) : '');
  const currentText = current ? text(current) : '';

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the line changes
  useEffect(() => {
    if (!current) return;
    if (current.from === 'player' || !effects || current.seq <= resumeSeq()) {
      setSettled((n) => n + 1);
      return;
    }
    setTyped(-1);
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      n = Math.min(currentText.length, n + 2);
      setTyped(n);
      if (n >= currentText.length) timer = setTimeout(() => setSettled((c) => c + 1), 250);
      else timer = setTimeout(step, '.!?:'.includes(currentText[n - 1] ?? '') ? 150 : 14);
    };
    // People take longer to start typing than machines.
    timer = setTimeout(step, npc?.kind === 'ai' ? 500 : 1100);
    return () => clearTimeout(timer);
  }, [settled, current?.seq, effects]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll as text arrives
  useEffect(() => {
    // Scroll the conversation itself, not the page around it.
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [typed, settled, lines.length, pending]);

  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
  }, [active]);

  if (!npc) return null;
  const busy = current !== undefined || pending;
  const time = (ms: number) => gameDate(game.world.startTime, ms).time.slice(0, 5);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    const model = activeBrain();
    if (model) {
      setPending(true);
      void game
        .converse(npcId, message, model, elapsed())
        .then((r) => {
          if (r.ok) reportBrain(r.issue ?? 'ok');
        })
        .finally(() => setPending(false));
    } else game.chat(npcId, message, 'browser', elapsed());
    box.current?.scrollIntoView({ block: 'nearest' });
    touch();
  };
  const initial = npc.name.slice(0, 1).toUpperCase();

  return (
    <section className="npc-chat" data-kind={npc.kind} aria-label={npc.name} ref={box}>
      <header>
        <span className="av" aria-hidden="true">
          {initial}
        </span>
        <span>
          <b>{npc.name}</b>
          <small>
            {npc.kind === 'ai' && <i className="tag">{t('chat.ai')}</i>}
            {game.t(npc.role)}
          </small>
        </span>
        {activeBrain() && (
          <span
            className="voice"
            data-tone={brain.last === null || brain.last === 'ok' ? 'on' : 'warn'}
            title={t(
              brain.last === null || brain.last === 'ok'
                ? 'brain.state.on'
                : (`brain.issue.${brain.last}` as UiKey),
              { limit: BRAIN_CALL_LIMIT },
            )}
          >
            {brain.last === null || brain.last === 'ok'
              ? t('chat.voice.on', {
                  uses: BRAIN_USES.filter((u) => brain.config[u].on)
                    .map((u) => t(`chat.use.${u}` as UiKey))
                    .join(' + '),
                })
              : t('chat.voice.script')}
          </span>
        )}
      </header>
      <div className="npc-log scroll" aria-live="polite" ref={log}>
        {npc.greeting && (
          <div className="msg npc">
            <p>{rich(game.t(npc.greeting))}</p>
          </div>
        )}
        {lines.slice(0, settled + 1).map((line, i) => {
          const isCurrent = i === settled;
          if (isCurrent && line.from === 'player') return null;
          const waiting = isCurrent && typed < 0;
          return (
            <div className={`msg ${line.from}`} key={line.seq}>
              <span className="who">
                {line.from === 'player' ? t('chat.you') : npc.name} · {time(line.t)}
              </span>
              {waiting ? (
                <p className="dots" role="status" aria-label={t('chat.typing', { name: npc.name })}>
                  <i />
                  <i />
                  <i />
                </p>
              ) : (
                <p>
                  {line.from === 'npc'
                    ? reply(isCurrent ? currentText.slice(0, typed) : text(line))
                    : rich(isCurrent ? currentText.slice(0, typed) : text(line))}
                  {isCurrent && <span className="caret" />}
                </p>
              )}
            </div>
          );
        })}
        {pending && settled >= lines.length && (
          <div className="msg npc">
            <span className="who">{npc.name}</span>
            <p className="dots" role="status" aria-label={t('chat.typing', { name: npc.name })}>
              <i />
              <i />
              <i />
            </p>
          </div>
        )}
      </div>
      <form onSubmit={send}>
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={600}
          placeholder={t('chat.placeholder', { name: npc.name })}
          aria-label={t('chat.placeholder', { name: npc.name })}
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={busy || !draft.trim()}>
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
