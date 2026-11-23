import { type LogLine, type ReplayReport, sigmaText } from '@breach/engine';
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';

type Step = 'find' | 'detect' | 'fix';

/** Cards in a stable order that does not depend on the pack: the right answer is not always first. */
function shuffled<T extends { id: string }>(items: T[], seed: string): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return [...items].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));
}

/**
 * The defence replay that ends an attack mission, in three steps: find your own lines in the
 * target's logs, pick the rule that catches them, then fix the target and watch your own attack
 * fail when the engine replays it. Everything is judged by the engine.
 */
export function Defense() {
  const game = useGame();
  const t = useT();
  const { guidance } = useSettings();
  const defense = game.mission?.defense;
  const state = game.state.defense;
  // The game object is mutable: the logs change with each mission, so the mission start is the key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute when a new mission starts
  const lines = useMemo(() => game.socLines(), [game, game.state.missionStartSeq]);
  if (!defense || !state) return null;
  const step: Step = !state.found ? 'find' : !state.rule || !defense.fixes.length ? 'detect' : 'fix';
  const rule = defense.rules.find((r) => r.id === state.rule);
  const steps: { id: Step; label: string; done: boolean }[] = [
    { id: 'find', label: t('defense.step.find'), done: state.found },
    { id: 'detect', label: t('defense.step.detect'), done: state.rule !== null },
    ...(defense.fixes.length
      ? [{ id: 'fix' as Step, label: t('defense.step.fix'), done: state.fix !== null }]
      : []),
  ];
  return (
    <section className="defense" aria-label={t('defense.title')}>
      <div className="kicker">{t('defense.kicker')}</div>
      <p>{game.t(defense.intro)}</p>
      <ol className="def-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'done' : s.id === step ? 'now' : ''}>
            <span aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            {s.label}
            {s.done && <span className="sr-only">{t('defense.step.done')}</span>}
          </li>
        ))}
      </ol>
      {state.found && step !== 'find' && (
        <p className="def-feedback ok">
          <b>✓ {t('defense.find.ok')}</b>
        </p>
      )}
      {rule && (
        <p className="def-feedback ok">
          <b>✓ {game.t(rule.title)}</b> {game.t(rule.why)}
        </p>
      )}
      {step === 'find' && <Find lines={lines} guided={guidance === 'guided'} />}
      {step === 'detect' && !rule && <Detect lines={lines} preview={guidance !== 'expert'} />}
      {step === 'fix' && <FixStep />}
      {state.done && defense.lesson && <p className="def-lesson">{game.t(defense.lesson)}</p>}
    </section>
  );
}

function Find({ lines, guided }: { lines: LogLine[]; guided: boolean }) {
  const game = useGame();
  const t = useT();
  const defense = game.mission!.defense!;
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<{ wrong: string[]; missing: number[] } | null>(null);
  const shown = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : lines;
  const toggle = (id: string) => {
    setResult(null);
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const sources = [
    ...new Set(
      lines
        .filter((l) => l.actor === 'player')
        .map((l) => l.fields.src)
        .filter(Boolean),
    ),
  ];
  return (
    <div className="def-body">
      <p className="def-ask">{t('defense.find.ask')}</p>
      <ul className="def-targets">
        {defense.find.map((f, i) => (
          <li key={f.text} className={result?.missing.includes(i) ? 'missing' : ''}>
            {game.t(f.text)}
          </li>
        ))}
      </ul>
      {guided && <p className="fine">{t('defense.find.guided', { ip: sources.join(', ') })}</p>}
      <label className="def-filter">
        <span>{t('defense.find.filter')}</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={String(sources[0] ?? '')}
          spellCheck={false}
        />
      </label>
      <ul className="def-console" aria-label={t('defense.find.console')}>
        {shown.map((l) => {
          const on = marked.has(l.id);
          const wrong = result?.wrong.includes(l.id);
          return (
            <li key={l.id}>
              <button
                type="button"
                aria-pressed={on}
                className={`def-line${on ? ' on' : ''}${wrong ? ' wrong' : ''}`}
                onClick={() => toggle(l.id)}
              >
                <span className="mark" aria-hidden="true">
                  {wrong ? '!' : on ? '◆' : '◇'}
                </span>
                <span className="host">{l.hostname.split('.')[0]}</span>
                <span className="text">{l.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {result && (result.wrong.length > 0 || result.missing.length > 0) && (
        <p className="def-feedback warn" role="status">
          {result.wrong.length > 0 && t('defense.find.wrong', { n: result.wrong.length })}{' '}
          {result.missing.length > 0 && t('defense.find.missing')}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn defense"
          disabled={!marked.size}
          onClick={() => setResult(game.markLines([...marked]))}
        >
          {t('defense.find.check', { n: marked.size })}
        </button>
      </div>
    </div>
  );
}

function Detect({ lines, preview }: { lines: LogLine[]; preview: boolean }) {
  const game = useGame();
  const t = useT();
  const defense = game.mission!.defense!;
  const [tried, setTried] = useState<string[]>([]);
  const last = tried[tried.length - 1];
  const lastRule = defense.rules.find((r) => r.id === last);
  return (
    <div className="def-body">
      <p className="def-ask">{t(preview ? 'defense.detect.ask' : 'defense.detect.askExpert')}</p>
      <div className="def-cards">
        {shuffled(defense.rules, game.state.mission ?? '').map((r) => {
          const result = preview || tried.includes(r.id) ? game.previewRule(r.id) : null;
          const wrong = tried.includes(r.id) && !r.correct;
          return (
            <button
              type="button"
              key={r.id}
              className={`def-card${wrong ? ' wrong' : ''}`}
              disabled={wrong}
              onClick={() => {
                setTried((x) => [...x, r.id]);
                game.chooseRule(r.id);
              }}
            >
              <span className="def-title">{game.t(r.title)}</span>
              <pre className="sigma">{sigmaText(r, game.t(r.title), game.world)}</pre>
              {result && (
                <span className="def-hits">
                  <span className="caught">{t('defense.detect.caught', { n: result.caught })}</span>
                  <span className="fp">{t('defense.detect.fp', { n: result.falsePositives })}</span>
                </span>
              )}
              {wrong && <span className="why">✗ {game.t(r.why)}</span>}
            </button>
          );
        })}
      </div>
      {lastRule && !lastRule.correct && (
        <p className="def-feedback warn" role="status">
          {t('defense.detect.again')}
        </p>
      )}
      <p className="fine">{t('defense.detect.note', { n: lines.length })}</p>
    </div>
  );
}

function FixStep() {
  const game = useGame();
  const t = useT();
  const defense = game.mission!.defense!;
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  return (
    <div className="def-body">
      <p className="def-ask">{t('defense.fix.ask', { target: game.target })}</p>
      <div className="def-cards fixes">
        {shuffled(defense.fixes, game.state.mission ?? '').map((f) => {
          const wrong = tried.includes(f.id) && !f.correct;
          return (
            <button
              type="button"
              key={f.id}
              className={`def-card${wrong ? ' wrong' : ''}`}
              disabled={busy !== null || wrong}
              onClick={async () => {
                setBusy(f.id);
                setReport(null);
                const r = await game.applyFix(f.id);
                setTried((x) => [...x, f.id]);
                setReport(r);
                setBusy(null);
              }}
            >
              <span className="def-title">{game.t(f.title)}</span>
              {busy === f.id && <span className="fine">{t('defense.fix.running')}</span>}
              {wrong && <span className="why">✗ {game.t(f.why)}</span>}
            </button>
          );
        })}
      </div>
      {report && <Replay report={report} />}
    </div>
  );
}

/** The player's own attack, played again against the fixed target, step by step. */
function Replay({ report }: { report: ReplayReport }) {
  const game = useGame();
  const t = useT();
  const fix = game.mission?.defense?.fixes.find((f) => f.id === report.fix);
  const [shown, setShown] = useState(0);
  const { effects } = useSettings();
  // The replay scrolls past like a tape: one step at a time, unless effects are off.
  useEffect(() => {
    if (!effects) {
      setShown(report.steps.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => setShown((n) => (n >= report.steps.length ? n : n + 1)), 260);
    return () => clearInterval(timer);
  }, [report, effects]);
  return (
    <div className="def-replay" aria-live="polite">
      <h3>{t('defense.replay.title')}</h3>
      <ol>
        {report.steps.slice(0, shown).map((s, i) => {
          const text = s.input.kind === 'line' ? `$ ${s.input.line}` : `» ${s.input.text}`;
          const status = s.lost.length ? 'lost' : s.changed ? 'changed' : 'same';
          return (
            <li key={i} className={status}>
              <span className="icon" aria-hidden="true">
                {status === 'lost' ? '✗' : status === 'changed' ? '≠' : '='}
              </span>
              <span className="cmd">{text}</span>
              <span className="what">{t(`defense.replay.${status}`)}</span>
              {s.changed && s.after && <pre className="after">{s.after.slice(0, 240)}</pre>}
            </li>
          );
        })}
      </ol>
      {shown >= report.steps.length && (
        <p className={`def-feedback ${report.blocked && fix?.correct ? 'ok' : 'warn'}`} role="status">
          <b>
            {report.blocked
              ? t('defense.replay.blocked', { n: (report.firstBlocked ?? 0) + 1 })
              : t('defense.replay.passes')}
          </b>{' '}
          {fix && game.t(fix.why)}
        </p>
      )}
    </div>
  );
}
