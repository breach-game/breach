import type { CatalogEntry } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import {
  allowedMap,
  allowedTerm,
  career,
  everFinished,
  finishedNow,
  GRADES,
  gradeFor,
  mapStyleOf,
  promotion,
  termStyleOf,
} from '../src/career.ts';
import type { Season } from '../src/journey.ts';

const entry = (id: string): CatalogEntry => ({
  id,
  version: '1.0.0',
  kind: 'mission',
  engine: '>=0.1 <1',
  requires: ['w'],
  title: { fr: id, en: id },
  locales: ['fr', 'en'],
  file: `${id}-1.0.0.breachpack`,
  sha256: '0'.repeat(64),
  size: 1,
  reviewed: true,
});

/** A season of two missions, finished or not. */
const season = (id: string, done: boolean, missions = ['a', 'b']): Season => ({
  id,
  number: 1,
  kind: 'season',
  missions: missions.map((m) => entry(`${id}.${m}`)),
  progress: {
    completed: done ? Object.fromEntries(['a', 'b'].map((m) => [`${id}.${m}`, 100])) : {},
    current: null,
  },
});

describe('grades', () => {
  it('climbs with the number of seasons finished', () => {
    expect(gradeFor(0)).toBe('junior');
    expect(gradeFor(2)).toBe('junior');
    expect(gradeFor(3)).toBe('senior');
    expect(gradeFor(6)).toBe('lead');
    expect(gradeFor(9)).toBe('principal');
    expect(gradeFor(40)).toBe('principal');
  });

  it('says what the next grade takes, and nothing at the top', () => {
    expect(career(4).next).toEqual({ grade: 'lead', missing: 2 });
    expect(career(0).next).toEqual({ grade: 'senior', missing: 3 });
    expect(career(11).next).toBeNull();
  });

  it('unlocks one terminal look and one map floor per grade', () => {
    expect(GRADES.map(termStyleOf)).toEqual(['lros', 'slate', 'frost', 'focus']);
    expect(GRADES.map(mapStyleOf)).toEqual(['grid', 'sonar', 'stars', 'relief']);
  });

  it('falls back to the default look when the grade does not reach the chosen one', () => {
    expect(allowedTerm('frost', 'lead')).toBe('frost');
    expect(allowedTerm('frost', 'senior')).toBe('lros');
    expect(allowedTerm('nonsense', 'principal')).toBe('lros');
    expect(allowedMap('sonar', 'junior')).toBe('grid');
    expect(allowedMap(undefined, 'lead')).toBe('grid');
    expect(allowedMap('relief', 'principal')).toBe('relief');
  });
});

describe('seasons finished', () => {
  it('counts only seasons whose every mission is done', () => {
    expect(finishedNow([season('s1', true), season('s2', false)])).toEqual(['s1']);
  });

  it('keeps a season once finished, even after it gains a mission', () => {
    const grown = season('s1', true, ['a', 'b', 'c']);
    expect(finishedNow([grown])).toEqual([]);
    expect(everFinished([grown], ['s1'])).toEqual(['s1']);
  });

  it('never counts a season twice', () => {
    expect(everFinished([season('s1', true)], ['s1', 's2'])).toEqual(['s1', 's2']);
  });
});

describe('promotion', () => {
  const two = ['s1', 's2'];
  it('promotes when the season just finished crosses a threshold', () => {
    const seasons = [season('s1', true), season('s2', true), season('s3', true)];
    expect(promotion(seasons, two, 's3')).toBe('senior');
  });

  it('says nothing when the grade stays the same', () => {
    const seasons = [season('s1', true), season('s2', true)];
    expect(promotion(seasons, ['s1'], 's2')).toBeNull();
  });

  it('does not promote a returning player for seasons finished before grades existed', () => {
    const seasons = [season('s1', true), season('s2', true), season('s3', true), season('s4', true)];
    expect(promotion(seasons, null, 's4')).toBeNull();
    // But the season that crosses the line still counts.
    expect(promotion(seasons.slice(0, 3), null, 's3')).toBe('senior');
  });
});
