import type { CatalogEntry } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import {
  collectionOf,
  freshness,
  haystack,
  type Item,
  isFiltering,
  matches,
  NO_FILTERS,
  normalize,
  pathProgress,
  progressOf,
  resolveSteps,
  sortItems,
} from '../src/store.ts';

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

const item = (e: CatalogEntry, more: Partial<Item> = {}): Item => ({
  entry: e,
  catalog: { format: 0, generatedAt: '', campaign: [], training: [], seasons: [], packs: [e] },
  missions: [e],
  collection: collectionOf(e),
  status: 'todo',
  completed: {},
  finished: 0,
  score: null,
  next: e.id,
  fresh: null,
  blocked: null,
  ...more,
});

describe('community store', () => {
  it('sorts entries into collections', () => {
    expect(collectionOf(entry('dossiers.x', { incident: 2023 }))).toBe('real');
    expect(collectionOf(entry('example.x'))).toBe('examples');
    expect(collectionOf(entry('jdoe.x'))).toBe('players');
    expect(collectionOf(entry('jdoe.x', { incident: 2020 }), true)).toBe('local');
  });

  it('reads progress from a save', () => {
    const missions = [entry('a'), entry('b'), entry('c')];
    expect(progressOf(missions, { completed: {}, current: null })).toMatchObject({
      status: 'todo',
      next: 'a',
    });
    expect(progressOf(missions, { completed: { a: 100 }, current: null })).toMatchObject({
      status: 'run',
      finished: 1,
      next: 'b',
      score: null,
    });
    expect(progressOf(missions, { completed: {}, current: 'a' })).toMatchObject({ status: 'run', next: 'a' });
    expect(progressOf(missions, { completed: { a: 100, b: 50, c: 25, other: 9 }, current: null })).toEqual({
      completed: { a: 100, b: 50, c: 25 },
      finished: 3,
      status: 'done',
      score: 175,
      next: null,
    });
  });

  it('flags what arrived or changed since the last visit, but nothing on the first one', () => {
    const list = [entry('a'), entry('b', { version: '1.1.0' }), entry('c')];
    expect(freshness(list, undefined).fresh).toEqual({});
    const { fresh, seen } = freshness(list, { a: '1.0.0', b: '1.0.0' });
    expect(fresh).toEqual({ b: 'updated', c: 'new' });
    expect(seen).toEqual({ a: '1.0.0', b: '1.1.0', c: '1.0.0' });
  });

  it('searches without accents or case, in titles, summaries, skills, years and missions', () => {
    const series = entry('dossiers.alouette', {
      kind: 'series',
      incident: 2023,
      title: { fr: 'Dossier 08 : la voiture à un euro', en: 'Case file 08: the one-euro car' },
      skills: ['llm', 'defense'],
    });
    const it1 = item(series, {
      missions: [entry('m1', { summary: { fr: 'Tu parles à Lulu', en: 'You talk to Lulu' } })],
    });
    const hay = haystack(it1, 'fr', (s) => (s === 'defense' ? 'Défense' : s));
    const q = (text: string) => matches(it1, { ...NO_FILTERS, q: text }, hay);
    expect(q('VOITURE euro')).toBe(true);
    expect(q('defense')).toBe(true);
    expect(q('2023')).toBe(true);
    expect(q('lulu')).toBe(true);
    expect(q('car')).toBe(false);
    expect(normalize('Équipe')).toBe('equipe');
  });

  it('filters by collection, skills, difficulty and status', () => {
    const a = item(entry('jdoe.a', { skills: ['web', 'defense'], difficulty: 1 }));
    const b = item(entry('dossiers.b', { incident: 2021, skills: ['llm'], difficulty: 2 }), {
      status: 'done',
    });
    const pick = (f: Partial<typeof NO_FILTERS>) =>
      [a, b].filter((i) => matches(i, { ...NO_FILTERS, ...f }, '')).map((i) => i.entry.id);
    expect(pick({ collection: 'real' })).toEqual(['dossiers.b']);
    expect(pick({ skills: ['web', 'defense'] })).toEqual(['jdoe.a']);
    expect(pick({ skills: ['web', 'llm'] })).toEqual([]);
    expect(pick({ difficulty: 2 })).toEqual(['dossiers.b']);
    expect(pick({ status: 'todo' })).toEqual(['jdoe.a']);
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, sort: 'title' })).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, q: '  ' })).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, status: 'run' })).toBe(true);
  });

  it('sorts: in progress first when recommended, then by date, title, length or incident year', () => {
    const done = item(entry('d', { title: { fr: 'Dossier 10' }, minutes: 20 }), { status: 'done' });
    const run = item(entry('r', { title: { fr: 'Dossier 9' }, updated: '2026-11-20' }), { status: 'run' });
    const fresh = item(entry('n', { title: { fr: 'Dossier 2' }, updated: '2026-11-23', incident: 2019 }), {
      fresh: 'new',
    });
    const blocked = item(entry('b', { title: { fr: 'Dossier 1' }, minutes: 10, incident: 2024 }), {
      blocked: 'engine',
    });
    const ids = (sort: Parameters<typeof sortItems>[1]) =>
      sortItems([done, run, fresh, blocked], sort, 'fr').map((i) => i.entry.id);
    expect(ids('recommended')).toEqual(['r', 'n', 'd', 'b']);
    expect(ids('title')).toEqual(['b', 'n', 'r', 'd']);
    expect(ids('newest')).toEqual(['n', 'r', 'b', 'd']);
    expect(ids('shortest')).toEqual(['b', 'd', 'n', 'r']);
    expect(ids('incident')).toEqual(['b', 'n', 'r', 'd']);
  });
});

describe('paths', () => {
  const catalog = (packs: CatalogEntry[], more = {}) => ({
    format: 0 as const,
    generatedAt: '',
    campaign: [],
    training: [],
    seasons: [],
    packs,
    ...more,
  });
  const path = entry('example.path', {
    kind: 'path',
    requires: [],
    steps: [
      { ref: 'breach.official.m01', note: { fr: 'Pourquoi', en: 'Why' } },
      { ref: 'breach.season3.s02' },
      { ref: 'breach.training.t01' },
      { ref: 'dossiers.x' },
      { ref: 'gone.mission' },
    ],
  });
  const official = catalog(
    [
      entry('breach.official.m01'),
      entry('breach.season3', { kind: 'series', missions: ['breach.season3.s01', 'breach.season3.s02'] }),
      entry('breach.season3.s02'),
      entry('breach.training.t01'),
    ],
    { campaign: ['breach.official.m01'], training: ['breach.training.t01'], seasons: ['breach.season3'] },
  );
  const community = catalog([entry('dossiers.x', { kind: 'series', missions: ['dossiers.x-1'] })]);

  it('finds where each step is played and what is done', () => {
    const steps = resolveSteps(path, official, community, new Set(['breach.season3.s02', 'dossiers.x']));
    expect(steps.map((s) => [s.where, s.done])).toEqual([
      ['campaign', false],
      ['season', true],
      ['training', false],
      ['community', true],
      ['missing', false],
    ]);
    expect(steps[1]?.season).toBe('breach.season3');
    expect(steps[1]?.seasonNumber).toBe(2);
    expect(steps[0]?.note?.fr).toBe('Pourquoi');
    expect(pathProgress(steps)).toMatchObject({ status: 'run', finished: 2, next: 'breach.official.m01' });
  });

  it('sorts paths and challenges into their own collections', () => {
    expect(collectionOf(path)).toBe('paths');
    expect(collectionOf(entry('jdoe.hard', { levels: ['expert'] }))).toBe('challenges');
    expect(collectionOf(entry('jdoe.soft', { levels: ['standard', 'expert'] }))).toBe('players');
  });
});
