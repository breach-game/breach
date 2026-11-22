import { LEVEL_BONUS, socView } from '@breach/engine';
import { useEffect, useRef, useState } from 'react';
import { playKind, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';
import { Defense } from './Defense.tsx';

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
  // The switch to defence rewinds the session like a tape, the first time only.
  const [rewind, setRewind] = useState(() => Boolean(game.mission?.defense) && !game.state.defense);
  useEffect(() => {
    if (!rewind) return;
    const timer = setTimeout(() => setRewind(false), 1200);
    return () => clearTimeout(timer);
  }, [rewind]);
  // The defence replay opens with the debrief (also for a mission finished before it existed).
  useEffect(() => game.startDefense(), [game]);
  const defense = mission?.defense;
  const done = game.state.mission ? game.state.completed[game.state.mission] : undefined;
  const defended = !defense || done?.defense !== undefined;
  // Ready for Enter, without scrolling past the lesson.
  useEffect(() => {
    if (defended) nextButton.current?.focus({ preventScroll: true });
  }, [defended]);
  if (!mission || !game.state.mission) return null;
  const entries = socView(game);
  const next = game.nextMission();
  const defensePoints = done?.defense ?? 0;
  const score = (done?.score ?? game.score()) + defensePoints;
  const detail = game.scoreDetail();
  const factor = LEVEL_BONUS[detail.level].toLocaleString(locale);
  const campaign = Object.values(game.state.completed).reduce(
    (sum, m) => sum + m.score + (m.defense ?? 0),
    0,
  );
  return (
    <div className={`debrief scroll${rewind ? ' rewind' : ''}`}>
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
        {mission.flags.length > 0 && (
          <span>
            {t('debrief.tally.flags')} <b>+{detail.flags}</b>
          </span>
        )}
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
        {detail.answers > 0 && (
          <span>
            {t('debrief.tally.answers')} <b>+{detail.answers}</b>
          </span>
        )}
        {detail.impact > 0 && (
          <span>
            {t('debrief.tally.impact', { impact: game.state.impact })} <b>−{detail.impact}</b>
          </span>
        )}
        {defensePoints > 0 && (
          <span>
            {t('debrief.tally.defense')} <b>+{defensePoints}</b>
          </span>
        )}
      </div>
      {defense && <Defense />}
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
      {mission.side === 'defense' && <AttackerPath />}
      {!defense && mission.side !== 'defense' && (
        <h3>{t(playKind() === 'community' ? 'debrief.soc.community' : 'debrief.soc')}</h3>
      )}
      {defense || mission.side === 'defense' ? null : entries.length ? (
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
      {!next && playKind() === 'community' && (
        <>
          <h3>{t('debrief.community.title')}</h3>
          <p>{t('debrief.community.body')}</p>
        </>
      )}
      {!next && playKind() === 'replay' && (
        <>
          <h3>{t('debrief.replay.title')}</h3>
          <p>{t('debrief.replay.body')}</p>
        </>
      )}
      {!next && defended && playKind() === 'campaign' && (
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
        {next && defended && (
          <button type="button" className="btn defense" ref={nextButton} onClick={onNext}>
            {t('debrief.next')} →
          </button>
        )}
        {!defended && <span className="fine">{t('defense.pending')}</span>}
        <button type="button" className="btn" onClick={onClose}>
          {t('debrief.close')}
        </button>
      </div>
    </div>
  );
}

/** Defence missions: what the attacker did on the target, and where the containment stopped it. */
function AttackerPath() {
  const game = useGame();
  const t = useT();
  const adversary = game.mission?.adversary;
  if (!adversary) return null;
  const lines = game.socLines().filter((l) => l.actor === 'adversary');
  const blocked = game.state.adversary.blockedAt;
  const step = adversary.steps.find((s) => s.id === blocked);
  const hostname = step ? (game.world.hosts.find((h) => h.id === step.host)?.hostname ?? step.host) : '';
  return (
    <>
      <h3>{t('debrief.attacker', { name: adversary.name })}</h3>
      <ol className="def-path">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="host">{l.hostname.split('.')[0]}</span>
            <span className="text">{l.text}</span>
          </li>
        ))}
        {step && (
          <li className="stopped">
            <span className="host" aria-hidden="true">
              ✓
            </span>
            <span className="text">{t('debrief.attacker.stopped', { host: hostname })}</span>
          </li>
        )}
      </ol>
    </>
  );
}
