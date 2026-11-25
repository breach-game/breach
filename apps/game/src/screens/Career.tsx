import {
  allowedMap,
  allowedTerm,
  type Career,
  GRADE_AT,
  GRADES,
  type Grade,
  gradeIndex,
  MAP_STYLES,
  mapStyleOf,
  TERM_STYLES,
  termStyleOf,
} from '../career.ts';
import { useGrade } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

/** Four pips, filled up to the grade: the grade's rank told by shape as well as by its name. */
export function GradePips({ grade }: { grade: Grade }) {
  const i = gradeIndex(grade);
  return (
    <span className="grade-pips" aria-hidden="true">
      {GRADES.map((g, k) => (
        <i key={g} className={k <= i ? 'on' : undefined} />
      ))}
    </span>
  );
}

/** The grade in the LR-OS status bar. */
export function GradeChip() {
  const t = useT();
  const grade = useGrade();
  const name = t(`grade.${grade}` as UiKey);
  return (
    <span
      className="grade-chip"
      title={t('career.pips', { grade: name, i: gradeIndex(grade) + 1, total: GRADES.length })}
    >
      <GradePips grade={grade} />
      {name}
    </span>
  );
}

/** The player's grade on the title screen: where they stand and what the next grade takes. */
export function CareerCard({ career }: { career: Career }) {
  const t = useT();
  const name = t(`grade.${career.grade}` as UiKey);
  const n = career.finished;
  const missing = career.next?.missing ?? 0;
  return (
    <section className="career" aria-label={t('career.kicker')}>
      <GradePips grade={career.grade} />
      <div>
        <span className="career-kicker">{t('career.kicker')}</span>
        <b className="career-grade">
          {name}
          <span className="sr-only">
            {' '}
            ({t('career.pips', { grade: name, i: gradeIndex(career.grade) + 1, total: GRADES.length })})
          </span>
        </b>
        <span className="career-meta">
          {t(n === 0 ? 'career.done.zero' : n === 1 ? 'career.done.one' : 'career.done.many', { n })}
          {' · '}
          {career.next
            ? t(missing === 1 ? 'career.next.one' : 'career.next.many', {
                grade: t(`grade.${career.next.grade}` as UiKey),
                n: missing,
              })
            : t('career.top')}
        </span>
      </div>
    </section>
  );
}

/** The looks a grade unlocks, in the settings. A locked look says which grade opens it. */
export function LooksPicker() {
  const t = useT();
  const settings = useSettings();
  const grade = useGrade();
  const term = allowedTerm(settings.termStyle, grade);
  const map = allowedMap(settings.mapStyle, grade);
  const row = <S extends string>(
    label: UiKey,
    styles: readonly S[],
    chosen: S,
    prefix: string,
    pick: (s: S) => void,
  ) => (
    <span className="home-option looks">
      {t(label)}
      <span className="seg" role="group" aria-label={t(label)}>
        {styles.map((s, i) => {
          const locked = i > gradeIndex(grade);
          const at = t(`grade.${GRADES[i]}` as UiKey);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={chosen === s}
              disabled={locked}
              title={locked ? t('career.locked', { grade: at }) : undefined}
              onClick={() => pick(s)}
            >
              {locked && <Lock />}
              {t(`${prefix}.${s}` as UiKey)}
              {locked && <span className="sr-only"> ({t('career.locked', { grade: at })})</span>}
            </button>
          );
        })}
      </span>
    </span>
  );
  return (
    <>
      <span className="home-label">{t('career.looks')}</span>
      {row('career.term', TERM_STYLES, term, 'look.term', (s) => updateSettings({ termStyle: s }))}
      {row('career.map', MAP_STYLES, map, 'look.map', (s) => updateSettings({ mapStyle: s }))}
      <p className="career-note">{t('career.note')}</p>
    </>
  );
}

/** The debrief of a season that crosses a grade: Ada announces it, and the new looks are one click away. */
export function Promotion({ grade, finished }: { grade: Grade; finished: number }) {
  const t = useT();
  const settings = useSettings();
  const term = termStyleOf(grade);
  const map = mapStyleOf(grade);
  const applied = settings.termStyle === term && settings.mapStyle === map;
  const name = t(`grade.${grade}` as UiKey);
  return (
    <section className="promotion" aria-live="polite">
      <GradePips grade={grade} />
      <div>
        <span className="career-kicker">{t('career.promo.kicker')}</span>
        <h3>{t('career.promo.title', { grade: name })}</h3>
        <p>
          {t('career.promo.body', {
            n: Math.max(finished, GRADE_AT[grade]),
            grade: name,
            term: t(`look.term.${term}` as UiKey),
            map: t(`look.map.${map}` as UiKey),
          })}
        </p>
        <button
          type="button"
          className="btn"
          disabled={applied}
          onClick={() => updateSettings({ termStyle: term, mapStyle: map })}
        >
          {applied ? `✓ ${t('career.promo.done')}` : t('career.promo.try')}
        </button>
      </div>
    </section>
  );
}

function Lock() {
  return (
    <svg
      className="lock"
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}
