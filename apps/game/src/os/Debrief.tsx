import { LEVEL_BONUS, pentestReport, socView } from '@breach/engine';
import { useEffect, useRef, useState } from 'react';
import { finishing, nextStep, type Season } from '../journey.ts';
import {
  type Go,
  playSeason,
  SeasonBar,
  SeasonKicker,
  SeasonMeta,
  StateChip,
  seasonSummary,
  seasonTitle,
  useText,
} from '../screens/Journey.tsx';
import { flushSave, loadJourney, playedSeason, playKind, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';
import { Defense } from './Defense.tsx';

/**
 * End-of-mission debrief: the defender's lesson, and the player's own commands as the target's
 * SOC saw them. The list comes straight from the event log.
 */
export function Debrief({
  onNext,
  onClose,
  onLeave,
}: {
  onNext(): void;
  onClose(): void;
  /** Leave the desktop for another screen, or start another season. */
  onLeave(to: Go): void;
}) {
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
  // The last debrief of a season says what comes next: the next season, or what else there is.
  const seasonEnd = defended && !game.nextMission() && playedSeason() !== null;
  const seasons = useJourneyAfter(seasonEnd);
  const thisSeason = seasons?.find((s) => s.id === playedSeason());
  const leave = (to: Go) => void flushSave().then(() => onLeave(to));
  // Ready for Enter, without scrolling past the lesson.
  useEffect(() => {
    if (defended && seasons !== null) nextButton.current?.focus({ preventScroll: true });
  }, [defended, seasons]);
  if (!mission || !game.state.mission) return null;
  const entries = socView(game);
  const next = game.nextMission();
  const defensePoints = done?.defense ?? 0;
  const score = (done?.score ?? game.score()) + defensePoints;
  const detail = game.scoreDetail();
  const factor = LEVEL_BONUS[detail.level].toLocaleString(locale);
  // A community series: several missions in one save, so the last debrief gives the total.
  const series = Object.keys(game.state.completed).length > 1;
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
        {detail.mistakes > 0 && (
          <span>
            {t('debrief.mistakes')} <b>−{detail.mistakes}</b>
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
      {mission.debrief.facts && (
        <>
          <h3>{game.t(mission.debrief.facts.title)}</h3>
          <ul>
            {mission.debrief.facts.points.map((p) => (
              <li key={p}>{game.t(p)}</li>
            ))}
          </ul>
          <div className="fine">
            {t('debrief.sources')}
            {mission.debrief.facts.sources.map((x) => (
              <div key={x.url}>
                {x.label} · {x.url}
              </div>
            ))}
          </div>
        </>
      )}
      {mission.side === 'defense' && <AttackerPath />}
      {!defense && mission.side !== 'defense' && (
        <h3>
          {t(playKind() === 'community' || playKind() === 'season' ? 'debrief.soc.community' : 'debrief.soc')}
        </h3>
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
      {!next && playKind() === 'community' && !series && (
        <>
          <h3>{t('debrief.community.title')}</h3>
          <p>{t('debrief.community.body')}</p>
        </>
      )}
      {!next && playKind() === 'community' && series && (
        <>
          <h3>{t('debrief.series.title')}</h3>
          <p>{t('debrief.series.body')}</p>
          <div className="stats">
            <span>
              {t('debrief.series.total')}
              <b>{campaign}</b>
            </span>
          </div>
        </>
      )}
      {!next && defended && playKind() === 'season' && (
        <>
          <h3>{t('debrief.season.title', { n: thisSeason?.number ?? '' })}</h3>
          <p>{t('debrief.season.body')}</p>
          <div className="stats">
            <span>
              {t('debrief.season.total')}
              <b>{campaign}</b>
            </span>
          </div>
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
          <div className="actions">
            <button type="button" className="btn" onClick={() => downloadReport(pentestReport(game), locale)}>
              {t('debrief.end.report')}
            </button>
          </div>
          <p className="fine">{t('debrief.end.reportHint')}</p>
        </>
      )}
      {seasonEnd && seasons && seasons.length > 0 && (
        <WhatNext seasons={seasons} go={leave} primary={nextButton} />
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

/**
 * Every season, read from the saves once the running one is written, with the season being played
 * counted as finished (its save may still be a few hundred milliseconds behind). Null while loading,
 * empty if the catalogue cannot be read.
 */
function useJourneyAfter(enabled: boolean): Season[] | null {
  const game = useGame();
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const id = playedSeason();
    const completed = Object.fromEntries(
      Object.entries(game.state.completed).map(([m, c]) => [m, c.score + (c.defense ?? 0)]),
    );
    flushSave()
      .then(loadJourney)
      .then(
        (j) => live && setSeasons(id ? finishing(j.seasons, id, completed) : j.seasons),
        () => live && setSeasons([]),
      );
    return () => {
      live = false;
    };
  }, [enabled, game]);
  return enabled ? seasons : null;
}

/**
 * After the last mission of a season: the next season, ready to start in one click, or, once
 * everything is finished, the other things to play. Never a dead end.
 */
function WhatNext({
  seasons,
  go,
  primary,
}: {
  seasons: readonly Season[];
  go: (to: Go) => void;
  primary: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const text = useText();
  const step = nextStep(seasons);
  if (step.kind === 'done')
    return (
      <section className="j-next">
        <h3>{t('debrief.next.done.title')}</h3>
        <p>{t('debrief.next.done.body')}</p>
        <div className="actions">
          <button
            type="button"
            className="btn defense"
            ref={primary}
            onClick={() => go({ screen: 'community' })}
          >
            {t('title.community')} →
          </button>
          <button type="button" className="btn" onClick={() => go({ screen: 'training' })}>
            {t('title.training')}
          </button>
          <button type="button" className="btn" onClick={() => go({ screen: 'seasons' })}>
            {t('debrief.next.all')}
          </button>
        </div>
      </section>
    );
  const { season } = step;
  return (
    <section className="j-next">
      <h3>{t('debrief.next.kicker')}</h3>
      <div className="j-step compact">
        <header>
          <SeasonKicker season={season} />
          <StateChip season={season} />
        </header>
        <h3>{seasonTitle(season, text, t)}</h3>
        <p className="j-summary">{seasonSummary(season, text, t)}</p>
        <div className="j-progress">
          <SeasonBar season={season} next={step.kind === 'resume' ? step.mission : null} />
          <SeasonMeta season={season} />
        </div>
        <div className="j-step-actions">
          <button type="button" className="btn defense" ref={primary} onClick={() => go(playSeason(season))}>
            {t(step.kind === 'start' ? 'debrief.next.start' : 'debrief.next.resume', { n: season.number })} →
          </button>
          <button type="button" className="btn" onClick={() => go({ screen: 'seasons' })}>
            {t('debrief.next.all')}
          </button>
        </div>
      </div>
    </section>
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

/** The pentest report as a Markdown file, built in the browser: nothing leaves the machine. */
function downloadReport(markdown: string, locale: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = locale === 'fr' ? 'rapport-NM-2026-114.md' : 'report-NM-2026-114.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
