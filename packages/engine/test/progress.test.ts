import type { Pack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import {
  completedIn,
  Game,
  type GameEvent,
  MAX_PROGRESS_BYTES,
  ProgressFileError,
  parseProgressFile,
  planResume,
  progressFile,
} from '../src/index.ts';
import { fixture, run } from './fixture.ts';

async function campaign() {
  const { world, mission } = await fixture();
  const m2: Pack = { ...mission, id: 'test.m2', mission: { ...mission.mission!, order: 2 } };
  return { world, missions: [mission, m2] };
}

/** Finish test.m1, then start test.m2 and leave it half done. */
async function savedMidway() {
  const { world, missions } = await campaign();
  const game = new Game({ world, missions, locale: 'en' });
  game.startMission('test.m1');
  await run(game, 'nmap 10.13.0.0/24');
  await run(game, 'cat /srv/loot.txt');
  await run(game, 'submit FLAG{x}');
  expect(game.state.completed['test.m1']).toBeDefined();
  game.startMission('test.m2');
  await run(game, 'nmap 10.13.0.0/24');
  return { world, missions, game, save: game.save() };
}

const bump = (p: Pack, version: string): Pack => ({ ...p, version });

describe('resuming a save after an update', () => {
  it('records the version of every mission pack in the save', async () => {
    const { save } = await savedMidway();
    expect(save.missions).toEqual({ 'test.m1': '1.0.0', 'test.m2': '1.0.0' });
  });

  it('replays the save when neither the world nor the mission in progress changed', async () => {
    const { world, missions, game, save } = await savedMidway();
    // A finished mission was updated: it does not matter to the mission in progress.
    const plan = planResume(save, world, [bump(missions[0]!, '1.1.0'), missions[1]!]);
    expect(plan.kind).toBe('replay');
    const resumed = new Game({ world, missions, locale: 'en', log: plan.kind === 'replay' ? plan.log : [] });
    expect(resumed.state.objectives).toEqual(game.state.objectives);
  });

  it('replays a save from before mission versions were recorded when its world matches', async () => {
    const { world, missions, save } = await savedMidway();
    const { missions: _, ...old } = save;
    expect(planResume(old, world, missions).kind).toBe('replay');
  });

  it('keeps finished missions and restarts the one in progress when that mission changed', async () => {
    const { world, missions, save } = await savedMidway();
    const plan = planResume(save, world, [missions[0]!, bump(missions[1]!, '2.0.0')]);
    expect(plan).toEqual({
      kind: 'carry',
      completed: { 'test.m1': { score: save.log.find((e) => e.type === 'MissionCompleted')!.score } },
      restarted: 'test.m2',
    });
  });

  it('keeps finished missions when the world changed', async () => {
    const { world, missions, save } = await savedMidway();
    const plan = planResume(save, bump(world, '1.1.0'), missions);
    expect(plan.kind).toBe('carry');
    expect(plan.kind === 'carry' && Object.keys(plan.completed)).toEqual(['test.m1']);
  });

  it('drops missions the campaign no longer has', async () => {
    const { world, missions, save } = await savedMidway();
    const plan = planResume(save, bump(world, '2.0.0'), [missions[1]!]);
    expect(plan).toEqual({ kind: 'carry', completed: {}, restarted: 'test.m2' });
  });

  it('starts fresh without a save', async () => {
    const { world, missions } = await campaign();
    expect(planResume(undefined, world, missions)).toEqual({ kind: 'fresh' });
    expect(planResume({ log: 'nope' }, world, missions)).toEqual({ kind: 'fresh' });
  });

  it('carries progress into a new game: finished missions count, the next one starts', async () => {
    const { world, missions } = await campaign();
    const game = new Game({
      world,
      missions,
      locale: 'en',
      log: [
        { type: 'ProgressCarried', missions: { 'test.m1': { score: 150 } }, source: 'update', seq: 1, t: 0 },
      ],
    });
    expect(game.state.completed).toEqual({ 'test.m1': { score: 150 } });
    expect(game.state.mission).toBeNull();
    expect(game.nextMission()?.id).toBe('test.m2');
    // The carried log itself always replays, whatever version it was saved with.
    game.startMission('test.m2');
    expect(planResume({ ...game.save(), world: { id: 'x', version: '9' } }, world, missions).kind).toBe(
      'carry',
    );
    expect(planResume({ log: game.log.slice(0, 1) }, world, missions).kind).toBe('replay');
  });

  it('stays on the last debrief when every mission was already finished', async () => {
    const { world, missions } = await campaign();
    const game = new Game({
      world,
      missions,
      locale: 'en',
      log: [
        {
          type: 'ProgressCarried',
          missions: { 'test.m1': { score: 150 }, 'test.m2': { score: 90 }, 'other.m': { score: 5 } },
          source: 'import',
          seq: 1,
          t: 0,
        },
      ],
    });
    expect(Object.keys(game.state.completed)).toEqual(['test.m1', 'test.m2']);
    expect(game.state.mission).toBe('test.m2');
    expect(game.state.missionDone).toBe(true);
  });

  it('reads finished missions from a log, carried ones included', () => {
    const log = [
      {
        type: 'ProgressCarried',
        missions: { a: { score: 10 }, b: { score: -1 } },
        source: 'import',
        seq: 1,
        t: 0,
      },
      { type: 'MissionCompleted', mission: 'c', score: 20, seq: 2, t: 0 },
      { type: 'MissionCompleted', mission: 'd', score: 'x', seq: 3, t: 0 },
      'junk',
    ] as unknown as GameEvent[];
    expect(completedIn(log)).toEqual({ a: { score: 10 }, c: { score: 20 } });
  });

  it('keeps the points of the defence replay with the mission they belong to', async () => {
    const log = [
      {
        type: 'ProgressCarried',
        missions: { a: { score: 10, defense: 80 } },
        source: 'update',
        seq: 1,
        t: 0,
      },
      { type: 'MissionCompleted', mission: 'c', score: 20, seq: 2, t: 0 },
      { type: 'DefenseCompleted', mission: 'c', points: 140, seq: 3, t: 0 },
      { type: 'DefenseCompleted', mission: 'unknown', points: 140, seq: 4, t: 0 },
    ] as unknown as GameEvent[];
    expect(completedIn(log)).toEqual({ a: { score: 10, defense: 80 }, c: { score: 20, defense: 140 } });
    // Carried into a new game, they still count in the total.
    const { world, missions } = await campaign();
    const game = new Game({
      world,
      missions,
      locale: 'en',
      log: [
        {
          type: 'ProgressCarried',
          missions: { 'test.m1': { score: 200, defense: 140 } },
          source: 'import',
          seq: 1,
          t: 0,
        },
      ],
    });
    expect(game.state.completed['test.m1']).toEqual({ score: 200, defense: 140 });
  });
});

describe('progress file', () => {
  const good = () =>
    progressFile({ 'breach.official.m00': { score: 150 } }, new Date('2026-11-22T20:00:00Z'));

  it('round-trips', () => {
    expect(parseProgressFile(JSON.stringify(good()))).toEqual(good());
    const withDefense = progressFile({ 'breach.official.m01': { score: 150, defense: 140 } });
    expect(parseProgressFile(JSON.stringify(withDefense))).toEqual(withDefense);
  });

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['another format', JSON.stringify({ ...good(), format: 'other' })],
    ['a future version', JSON.stringify({ ...good(), version: 2 })],
    ['an unknown field', JSON.stringify({ ...good(), log: [] })],
    ['a bad date', JSON.stringify({ ...good(), exportedAt: 'yesterday' })],
    ['a community mission', JSON.stringify({ ...good(), missions: { 'example.m': { score: 1 } } })],
    [
      'a prototype key',
      '{"format":"breach-progress","version":1,"exportedAt":"2026-11-22T20:00:00Z","missions":{"__proto__":{"score":1}}}',
    ],
    ['a negative score', JSON.stringify({ ...good(), missions: { 'breach.official.m00': { score: -5 } } })],
    [
      'a fractional score',
      JSON.stringify({ ...good(), missions: { 'breach.official.m00': { score: 1.5 } } }),
    ],
    ['a huge score', JSON.stringify({ ...good(), missions: { 'breach.official.m00': { score: 1e12 } } })],
    [
      'an extra field in a mission',
      JSON.stringify({ ...good(), missions: { 'breach.official.m00': { score: 1, flags: [] } } }),
    ],
    [
      'bad defence points',
      JSON.stringify({ ...good(), missions: { 'breach.official.m00': { score: 1, defense: -3 } } }),
    ],
    ['too large a file', ' '.repeat(MAX_PROGRESS_BYTES + 1)],
  ])('refuses %s', (_, text) => {
    expect(() => parseProgressFile(text)).toThrow(ProgressFileError);
  });
});
