import { gameDate } from '@breach/engine';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { resumeSeq, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';

/** Render `code` spans. Anything else is plain text: content never becomes HTML. */
function rich(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

/** Messages from Ada. New ones are typed out one after the other. */
export function Messenger({ paused, onTyping }: { paused: boolean; onTyping(typing: boolean): void }) {
  const game = useGame();
  const { effects } = useSettings();
  const messages = game.state.messages;
  // Number of messages fully shown. A resumed save shows its history at once.
  const [settled, setSettled] = useState(() => messages.filter((m) => m.seq <= resumeSeq()).length);
  const [typed, setTyped] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  // A restore after detection rewinds the log, so the list can get shorter.
  if (settled > messages.length) setSettled(messages.length);
  const current = messages[settled];
  const text = current ? game.t(current.key) : '';

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the message changes
  useEffect(() => {
    if (!current || paused) return;
    onTyping(true);
    if (!effects) {
      setSettled((n) => n + 1);
      return;
    }
    setTyped(0);
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      n = Math.min(text.length, n + 2);
      setTyped(n);
      if (n >= text.length) timer = setTimeout(() => setSettled((c) => c + 1), 450);
      else timer = setTimeout(step, '.!?:'.includes(text[n - 1] ?? '') ? 170 : 16);
    };
    timer = setTimeout(step, 300);
    return () => clearTimeout(timer);
  }, [settled, current?.seq, paused, effects]);

  useEffect(() => {
    if (!current) onTyping(false);
  }, [current, onTyping]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll as text arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [typed, settled, messages.length]);

  const time = (t: number) => gameDate(game.world.startTime, t).time.slice(0, 5);

  return (
    <div className="chat scroll" aria-live="polite">
      {messages.slice(0, settled + 1).map((m, i) => {
        const isCurrent = i === settled;
        if (isCurrent && paused) return null;
        return (
          <div className={`ada${m.tone === 'warn' ? ' warn' : ''}`} key={m.seq}>
            <div className="av" aria-hidden="true">
              {m.tone === 'warn' ? '!' : 'A'}
            </div>
            <div>
              <div className="t">ADA · {time(m.t)}</div>
              <p>
                {rich(isCurrent ? text.slice(0, typed) : game.t(m.key))}
                {isCurrent && <span className="caret" />}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
