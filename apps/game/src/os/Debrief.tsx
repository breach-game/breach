import { LEVEL_BONUS, socView } from '@breach/engine';
import { useEffect, useRef } from 'react';
import { useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

/**
 * End-of-mission debrief: the defender's lesson, and the player's own commands as the target's
 * SOC saw them. The list comes straight from the event log.
 */
export function Debrief({ onNext, onClose }: { onNext(): void; onClose(): void }) {
  const game = useGame();
  const t = useT();
  const { locale } = useSettings();
  const mission = game.mission;
  const nextButton = useRef<HTMLButtonElement>(null);
  // Ready for Enter, without scrolling past the lesson.
  useEffect(() => nextButton.current?.focus({ preventScroll: true }), []);
  if (!mission || !game.state.mission) return null;
  const entries = socView(game);
  const next = game.nextMission();
  const score = game.state.completed[game.state.mission]?.score ?? game.score();
  const detail = game.scoreDetail();
  const factor = LEVEL_BONUS[detail.level].toLocaleString(locale);
  const campaign = Object.values(game.state.completed).reduce((sum, m) => sum + m.score, 0);
  return (
    <div className="debrief scroll">
      <div className="kicker">{t('debrief.complete')}</div>
      <h2>{game.t(mission.debrief.title)}</h2>
      <div className="stats">
        <span>
          {t('debrief.score')}
          <b>{score}</b>
        </span>
        <span>
          {t('debrief.detections')}
          <b>{game.state.detections}</b>
        </span>
        <span>
          {t('debrief.hints')}
          <b>{game.state.hintsUsed}</b>
        </span>
        <span>
          {t('debrief.level')}
          <b>{t(`guidance.${detail.level}` as UiKey)}</b>
        </span>
      </div>
      <div className="tally">
        <span>
          {t('debrief.tally.flags')} <b>+{detail.flags}</b>
        </span>
        <span>
          {t('debrief.tally.objectives')} <b>+{detail.objectives}</b>
        </span>
        <span>
          {t('debrief.tally.level', { level: t(`guidance.${detail.level}` as UiKey), factor })}{' '}
          <b>+{detail.bonus}</b>
        </span>
        {detail.hints > 0 && (
          <span>
            {t('debrief.hints')} <b>−{detail.hints}</b>
          </span>
        )}
        {detail.detections > 0 && (
          <span>
            {t('debrief.detections')} <b>−{detail.detections}</b>
          </span>
        )}
      </div>
      <p>{game.t(mission.debrief.lesson)}</p>
      <h3>{t('debrief.defense')}</h3>
      <ul>
        {mission.debrief.points.map((p) => (
          <li key={p}>{game.t(p)}</li>
        ))}
      </ul>
      {mission.debrief.reference && (
        <div className="fine">
          {t('debrief.reference')} : {mission.debrief.reference}
        </div>
      )}
      <h3>{t('debrief.soc')}</h3>
      {entries.length ? (
        <>
          <div className="soclog">
            <div className="lg head">
              <span>{t('debrief.soc.time')}</span>
              <span>{t('debrief.soc.source')}</span>
              <span>{t('debrief.soc.action')}</span>
              <span>{t('debrief.soc.noise')}</span>
            </div>
            {entries.map((e, i) => (
              <div className="lg" key={i}>
                <span>{e.time}</span>
                <span>{e.source}</span>
                <span title={e.action}>{e.action}</span>
                <span>+{Math.round(e.noise)}</span>
              </div>
            ))}
          </div>
          <div className="fine">{t('debrief.soc.note')}</div>
        </>
      ) : (
        <p className="fine">{t('debrief.soc.none')}</p>
      )}
      {!next && (
        <>
          <h3>{t('debrief.end.title')}</h3>
          <p>{t('debrief.end.body')}</p>
          <div className="stats">
            <span>
              {t('debrief.end.total')}
              <b>{campaign}</b>
            </span>
          </div>
        </>
      )}
      <div className="actions">
        {next && (
          <button type="button" className="btn defense" ref={nextButton} onClick={onNext}>
            {t('debrief.next')} →
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          {t('debrief.close')}
        </button>
      </div>
    </div>
  );
}
