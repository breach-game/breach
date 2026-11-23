import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { parseRule } from '../src/commands/defense.ts';
import { Game } from '../src/index.ts';
import { run } from './fixture.ts';

function start() {
  const world = parsePack({
    format: 0,
    id: 'test.agents',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Agents' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2028-02-07T09:00:00+01:00',
      mandate: 'T-5',
      scope: { domains: ['*.agents.test'], networks: ['10.17.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.17.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: { home: { kestrel: {} } },
        },
      ],
      dns: {},
    },
    i18n: { en: {} },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.e1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.agents'],
    authors: ['test'],
    locales: ['en'],
    title: { en: 'Guardrail' },
    mission: {
      order: 0,
      stage: 'agents',
      briefing: 'b',
      objectives: [{ id: 'guard', text: 'o' }],
      flags: [],
      files: { 'guard/refund.yml': 'title: refunds\ntool: refund\n' },
      evals: [
        {
          id: 'refund',
          file: 'guard/refund.yml',
          objective: 'guard',
          cases: [
            {
              id: 'forged',
              text: 'case.forged',
              fields: { tool: 'refund', amount: 900, signed: false },
              expect: 'block',
            },
            {
              id: 'small',
              text: 'case.small',
              fields: { tool: 'refund', amount: 20, signed: true },
              expect: 'allow',
            },
            {
              id: 'big',
              text: 'case.big',
              fields: { tool: 'refund', amount: 700, signed: true },
              expect: 'allow',
            },
            { id: 'search', text: 'case.search', fields: { tool: 'search', signed: true }, expect: 'allow' },
          ],
        },
      ],
      debrief: { title: 'd', lesson: 'd', points: ['d'] },
    },
    i18n: { en: { 'case.forged': 'refund of 900 asked by an unsigned message' } },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('a guardrail file', () => {
  it('needs no source line, and reads thresholds', () => {
    expect(parseRule('tool: refund\namount|gte: 500\nsigned: false\n', { source: false })).toEqual({
      rule: { source: 'agent', where: { tool: 'refund', amount: { gte: 500 }, signed: false } },
    });
    expect(parseRule('tool: refund\n')).toEqual({ error: 'source:' });
    expect(parseRule('amount|gte: lots\n', { source: false })).toEqual({ error: 'amount|gte: lots' });
  });
});

describe('eval run', () => {
  it('refuses a guardrail that blocks legitimate requests, then accepts the precise one', async () => {
    const game = start();
    const naive = await run(game, 'eval run guard/refund.yml');
    expect(naive.status).toBe(1);
    expect(naive.out).toContain('result: 1/1 attacks blocked, 2/3 legitimate requests blocked');
    expect(naive.out).toContain('refund of 900 asked by an unsigned message');
    expect(game.state.objectives.guard).toBe(false);

    await run(game, 'echo "signed: false" >> guard/refund.yml');
    const precise = await run(game, 'eval run guard/refund.yml');
    expect(precise.status).toBe(0);
    expect(precise.out).toContain('result: 1/1 attacks blocked, 0/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(true);
    expect(game.log.filter((e) => e.type === 'EvalRun').at(-1)).toMatchObject({
      eval: 'refund',
      blocked: 1,
      missed: 0,
      wrongly: 0,
      passed: true,
    });
  });

  it('says when an attack still gets through', async () => {
    const game = start();
    await run(game, 'echo "amount|gte: 5000" >> guard/refund.yml');
    const r = await run(game, 'eval run guard/refund.yml');
    expect(r.status).toBe(1);
    expect(r.out).toContain('result: 0/1 attacks blocked, 0/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(false);
  });

  it('ignores a file no eval reads, and reports a syntax error', async () => {
    const game = start();
    await run(game, 'echo "tool: refund" > mine.yml');
    expect((await run(game, 'eval run mine.yml')).status).toBe(1);
    await run(game, 'echo "nonsense" > bad.yml');
    expect((await run(game, 'eval run bad.yml')).status).toBe(2);
    expect((await run(game, 'eval run missing.yml')).status).toBe(1);
    expect((await run(game, 'eval')).status).toBe(0);
  });
});
