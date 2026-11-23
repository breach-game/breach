import { gameDate } from '@breach/engine';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { playSfx } from '../audio.ts';
import { resumeSeq, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';
import { Typing, textOf } from './typewriter.tsx';

/** Render `code` spans. Anything else is plain text: content never becomes HTML. */
function rich(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

/** Messages from Ada. New ones are typed out one after the other. */
export function Messenger({ paused, onTyping }: { paused: boolean; onTyping(typing: boolean): void }) {
  const game = useGame();
  const t = useT();
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
  // Typing counts the characters shown on screen, so a `code` span never shows its backticks.
  const plain = textOf(rich(text));

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
      n = Math.min(plain.length, n + 2);
      setTyped(n);
      if (n >= plain.length) timer = setTimeout(() => setSettled((c) => c + 1), 450);
      else timer = setTimeout(step, '.!?:'.includes(plain[n - 1] ?? '') ? 170 : 16);
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
              {isCurrent ? <Typing shown={typed}>{rich(text)}</Typing> : <p>{rich(game.t(m.key))}</p>}
            </div>
          </div>
        );
      })}
      <Questions hidden={current !== undefined} />
      <p className="chat-hint">{t('win.ada.reply')}</p>
      <div ref={end} />
    </div>
  );
}

/** Ada's open question, as buttons. The engine judges the answer against the pack. */
function Questions({ hidden }: { hidden: boolean }) {
  const game = useGame();
  const t = useT();
  const [feedback, setFeedback] = useState<{ question: string; option: string; why?: string } | null>(null);
  const question = game.openQuestions()[0];
  if (!question) return null;
  return (
    <fieldset className="ask" hidden={hidden}>
      <legend>{t(question.correct === undefined ? 'ask.decision' : 'ask.title')}</legend>
      <p>{rich(game.t(question.text))}</p>
      {game.optionsOf(question).map((o, i) => (
        <button
          type="button"
          key={o.id}
          data-wrong={feedback?.question === question.id && feedback.option === o.id}
          onClick={() => {
            const result = game.answer(question.id, o.id);
            if (!result) return;
            playSfx(result.correct ? 'objective' : 'wrong');
            setFeedback(result.correct ? null : { question: question.id, option: o.id, why: result.why });
          }}
        >
          <i aria-hidden="true">{String.fromCharCode(65 + i)}</i>
          <span>{rich(game.t(o.text))}</span>
        </button>
      ))}
      {feedback?.question === question.id && (
        <p className="ask-why" role="status">
          <b>{t('ask.wrong')}</b> {feedback.why ? rich(feedback.why) : null}
        </p>
      )}
    </fieldset>
  );
}
