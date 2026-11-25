/**
 * Career grades at Ligne Rouge. A grade is a title and a few looks for the workstation, earned by
 * finishing official seasons (the campaign counts as season 1). It never opens or closes content:
 * every season stays playable whatever the grade.
 *
 * Everything here is pure. The seasons the player ever finished are remembered on this computer
 * (`career:done`), so a season that gains a new mission does not take a grade back.
 */
import { type Season, seasonState } from './journey.ts';

export const GRADES = ['junior', 'senior', 'lead', 'principal'] as const;
export type Grade = (typeof GRADES)[number];

/** Seasons to finish for each grade. Counts, never "all of them": a new season demotes nobody. */
export const GRADE_AT: Record<Grade, number> = { junior: 0, senior: 3, lead: 6, principal: 9 };

/** Looks of the terminal, one more per grade. The colours that carry meaning never change. */
export const TERM_STYLES = ['lros', 'slate', 'frost', 'focus'] as const;
export type TermStyle = (typeof TERM_STYLES)[number];

/** Floors of the network map, the desktop wallpaper, one more per grade. */
export const MAP_STYLES = ['grid', 'sonar', 'stars', 'relief'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const gradeIndex = (g: Grade): number => GRADES.indexOf(g);

export function gradeFor(finished: number): Grade {
  let grade: Grade = 'junior';
  for (const g of GRADES) if (finished >= GRADE_AT[g]) grade = g;
  return grade;
}

/** The style a grade unlocks: the n-th style for the n-th grade. */
export const termStyleOf = (g: Grade): TermStyle => TERM_STYLES[gradeIndex(g)] ?? 'lros';
export const mapStyleOf = (g: Grade): MapStyle => MAP_STYLES[gradeIndex(g)] ?? 'grid';

/** A chosen style, or the default one if the grade does not reach it (another computer, a reset). */
export function allowedTerm(style: string | undefined, g: Grade): TermStyle {
  const i = TERM_STYLES.indexOf(style as TermStyle);
  return i >= 0 && i <= gradeIndex(g) ? (TERM_STYLES[i] ?? 'lros') : 'lros';
}
export function allowedMap(style: string | undefined, g: Grade): MapStyle {
  const i = MAP_STYLES.indexOf(style as MapStyle);
  return i >= 0 && i <= gradeIndex(g) ? (MAP_STYLES[i] ?? 'grid') : 'grid';
}

/** Seasons finished today: every mission they list is done. */
export const finishedNow = (seasons: readonly Season[]): string[] =>
  seasons.filter((s) => seasonState(s) === 'done').map((s) => s.id);

/** Seasons ever finished: what this computer remembers, plus what the saves show today. */
export function everFinished(seasons: readonly Season[], remembered: readonly string[]): string[] {
  return [...new Set([...remembered, ...finishedNow(seasons)])];
}

export interface Career {
  grade: Grade;
  /** Seasons ever finished. */
  finished: number;
  /** The grade after this one, and how many more seasons it takes. Null at the top. */
  next: { grade: Grade; missing: number } | null;
}

export function career(finished: number): Career {
  const grade = gradeFor(finished);
  const up = GRADES[gradeIndex(grade) + 1];
  return {
    grade,
    finished,
    next: up ? { grade: up, missing: GRADE_AT[up] - finished } : null,
  };
}

/**
 * The grade a finished season gives, if it is a promotion. `before` is what this computer
 * remembered before the season ended (null the very first time: then every season finished today
 * but this one counts as known, so a returning player is not promoted for old seasons).
 */
export function promotion(
  seasons: readonly Season[],
  before: readonly string[] | null,
  seasonId: string,
): Grade | null {
  const after = everFinished(seasons, before ?? []);
  const known = before ?? after.filter((id) => id !== seasonId);
  const was = gradeFor(new Set(known).size);
  const now = gradeFor(after.length);
  return gradeIndex(now) > gradeIndex(was) ? now : null;
}
