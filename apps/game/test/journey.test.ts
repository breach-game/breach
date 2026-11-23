import type { CatalogEntry } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import {
  allKeys,
  bareTitle,
  findNews,
  finishing,
  initialSeen,
  type Journey,
  missionLabel,
  newsKeys,
  nextStep,
  returning,
  type Season,
  seasonScore,
  seasonState,
  settleSeen,
  upNext,
} from '../src/journey.ts';

const entry = (id: string, more: Partial<CatalogEntry> = {}): CatalogEntry => ({
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
  ...more,
});

const season = (
  id: string,
  number: number,
  missions: string[],
  completed: Record<string, number> = {},
  current: string | null = null,
): Season => ({
  id,
  number,
  kind: number === 1 ? 'campaign' : 'season',
  missions: missions.map((m, i) => entry(m, { order: i })),
  progress: { completed, current },
});

const journey = (...seasons: Season[]): Journey => ({ seasons, trainings: [entry('t1'), entry('t2')] });

describe('season state', () => {
  it('reads fresh, started and done from the save', () => {
    expect(seasonState(season('campaign', 1, ['a', 'b']))).toBe('fresh');
    expect(seasonState(season('campaign', 1, ['a', 'b'], {}, 'a'))).toBe('started');
    expect(seasonState(season('campaign', 1, ['a', 'b'], { a: 10 }))).toBe('started');
    expect(seasonState(season('campaign', 1, ['a', 'b'], { a: 10, b: 20 }))).toBe('done');
  });

  it('opens a finished season again when a mission is added to it', () => {
    const s = season('campaign', 1, ['a', 'b', 'c'], { a: 10, b: 20 });
    expect(seasonState(s)).toBe('started');
    expect(upNext(s)?.id).toBe('c');
  });

  it('ignores scores of missions the catalogue no longer lists', () => {
    const s = season('campaign', 1, ['a'], { a: 10, gone: 999 });
    expect(seasonState(s)).toBe('done');
    expect(seasonScore(s)).toBe(10);
  });

  it('numbers campaign missions by their story order and season missions from 01', () => {
    const c = season('campaign', 1, ['a', 'b']);
    const s2 = season('s2', 2, ['x', 'y']);
    expect(missionLabel(c, c.missions[0]!)).toBe('00');
    expect(missionLabel(s2, s2.missions[1]!)).toBe('02');
  });
});

describe('next step', () => {
  const s1 = (done: Record<string, number> = {}, current: string | null = null) =>
    season('campaign', 1, ['a', 'b'], done, current);
  const s2 = (done: Record<string, number> = {}) => season('s2', 2, ['x', 'y'], done);

  it('resumes the season under way, on its current mission', () => {
    const step = nextStep([s1({ a: 1 }, 'b'), s2()]);
    expect(step.kind).toBe('resume');
    expect(step.kind === 'resume' && [step.season.id, step.mission.id]).toEqual(['campaign', 'b']);
  });

  it('offers the next season once the first one is finished', () => {
    const step = nextStep([s1({ a: 1, b: 2 }), s2()]);
    expect(step.kind === 'start' && step.season.id).toBe('s2');
  });

  it('prefers a season under way over a season never played', () => {
    const step = nextStep([s1(), s2({ x: 1 })]);
    expect(step.kind === 'resume' && step.season.id).toBe('s2');
  });

  it('says everything is done, and changes its mind when a new season arrives', () => {
    const done = [s1({ a: 1, b: 2 }), s2({ x: 1, y: 2 })];
    expect(nextStep(done).kind).toBe('done');
    const step = nextStep([...done, season('s3', 3, ['z'])]);
    expect(step.kind === 'start' && step.season.id).toBe('s3');
  });

  it('skips a season with no mission', () => {
    expect(nextStep([s1({ a: 1, b: 2 }), season('s2', 2, [])]).kind).toBe('done');
  });

  it('counts the running season as finished at its last debrief', () => {
    const seasons = finishing([s1({ a: 1 }, 'b'), s2()], 'campaign', { a: 1, b: 2 });
    expect(seasonState(seasons[0]!)).toBe('done');
    expect(nextStep(seasons).kind).toBe('start');
  });
});

describe("what's new", () => {
  const s1done = season('campaign', 1, ['a', 'b'], { a: 1, b: 2 });
  const s2 = season('s2', 2, ['x', 'y']);

  it('has nothing to announce to a new player', () => {
    const j = journey(season('campaign', 1, ['a', 'b']), s2);
    expect(returning(j.seasons)).toBe(false);
    expect(findNews(j, initialSeen(j))).toEqual([]);
  });

  it('tells a returning player about the seasons they never opened, and only those', () => {
    const j = journey(s1done, s2);
    const news = findNews(j, initialSeen(j));
    expect(news.map((n) => n.key)).toEqual(['season:s2']);
  });

  it('announces a season added after the last visit, then forgets it once read', () => {
    const before = journey(s1done);
    const seen = initialSeen(before);
    const after = journey(s1done, season('s3', 3, ['z']));
    const news = findNews(after, seen);
    expect(news.map((n) => n.key)).toEqual(['season:s3']);
    const read = [...seen, ...news.flatMap(newsKeys)];
    expect(findNews(after, read)).toEqual([]);
    // Its missions are filed with it: starting it later does not announce them one by one.
    const started = journey(s1done, season('s3', 3, ['z'], {}, 'z'));
    expect(findNews(started, read)).toEqual([]);
  });

  it('announces a mission added to a season the player knows, unless already finished', () => {
    const seen = allKeys(journey(s1done));
    const grown = journey(season('campaign', 1, ['a', 'b', 'c'], { a: 1, b: 2 }));
    expect(findNews(grown, seen).map((n) => n.key)).toEqual(['mission:c']);
  });

  it('announces new trainings', () => {
    const j = journey(s1done);
    const seen = allKeys(j).filter((k) => k !== 'training:t2');
    expect(findNews(j, seen).map((n) => n.key)).toEqual(['training:t2']);
  });

  it('files a season the player started by themselves, with its missions', () => {
    const j = journey(s1done, season('s2', 2, ['x', 'y'], { x: 1 }));
    const seen = allKeys(journey(s1done)).concat('training:t1', 'training:t2');
    const settled = settleSeen(j, seen);
    expect(settled).toContain('season:s2');
    expect(settled).toContain('mission:y');
    expect(findNews(j, settled)).toEqual([]);
    expect(settleSeen(j, settled)).toBe(settled);
  });
});

describe('bare titles', () => {
  it('drops the season prefix the kicker already gives', () => {
    expect(bareTitle('Saison 2 : la chaîne de fabrication')).toBe('La chaîne de fabrication');
    expect(bareTitle('Season 2: the build chain')).toBe('The build chain');
    expect(bareTitle('Saison 2 · 1. À livre ouvert')).toBe('À livre ouvert');
    expect(bareTitle('Le mandat')).toBe('Le mandat');
  });
});
