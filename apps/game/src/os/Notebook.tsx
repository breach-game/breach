import { useEffect, useState } from 'react';
import { onGameEvent, terminalBridge, useGame } from '../session.ts';
import { useT } from '../ui.ts';

/** Objectives, flags, score and the player's notes. */
export function Notebook({ onDebrief }: { onDebrief(): void }) {
  const game = useGame();
  const t = useT();
  const [just, setJust] = useState<string | null>(null);
  const mission = game.mission;

  useEffect(
    () =>
      onGameEvent((e) => {
        if (e.type !== 'ObjectiveCompleted') return;
        setJust(e.objective);
        setTimeout(() => setJust(null), 900);
      }),
    [],
  );

  if (!mission) return null;
  const found = Object.keys(game.state.flags).length;
  return (
    <div className="notes scroll">
      {mission.objectives.map((o) => {
        const done = game.state.objectives[o.id];
        return (
          <div className={`task${done ? ' done' : ''}${just === o.id ? ' just' : ''}`} key={o.id}>
            <i className="box" aria-hidden="true" />
            <span>
              <span className="sr-only">{done ? '✓ ' : ''}</span>
              {game.t(o.text)}
              {o.optional && <small>{t('notes.optional')}</small>}
            </span>
          </div>
        );
      })}
      {game.state.notes.length > 0 && (
        <>
          <h3>{t('notes.notes')}</h3>
          {game.state.notes.map((n, i) => (
            <div className="note" key={i}>
              {n}
            </div>
          ))}
        </>
      )}
      <div className="score">
        {game.state.missionDone ? (
          <button type="button" className="link-btn" onClick={onDebrief}>
            {t('win.debrief')}
          </button>
        ) : (
          <button type="button" className="link-btn" onClick={() => terminalBridge.run?.('hint')}>
            {t('notes.hint')}
          </button>
        )}
        <span>
          {t('notes.flags')}{' '}
          <b>
            {found}/{mission.flags.length}
          </b>
          {'  ·  '}
          {t('notes.score')} <b>{game.score()}</b>
        </span>
      </div>
    </div>
  );
}
