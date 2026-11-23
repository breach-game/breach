import { type Pack, parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/index.ts';
import { fixture, run } from './fixture.ts';

/** A mission with a file to repair and a question to answer. */
async function repairGame() {
  const { world } = await fixture();
  const mission: Pack = parsePack({
    format: 0,
    id: 'test.repair',
    version: '1.0.0',
    engine: '>=0.4',
    kind: 'mission',
    track: 'training',
    difficulty: 2,
    skills: ['defense', 'linux'],
    requires: ['test.world'],
    title: { en: 'Repair' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'defense',
      briefing: 'brief',
      files: { 'missions/app.conf': 'debug = on\nlisten = 443\n' },
      objectives: [
        { id: 'fix', text: 'o.fix' },
        { id: 'why', text: 'o.why' },
      ],
      checks: [
        {
          id: 'debug',
          text: 'c.debug',
          if: { file: '~/missions/app.conf', lacks: 'debug = on' },
          objective: 'fix',
        },
        { id: 'port', text: 'c.port', if: { file: '~/missions/app.conf', contains: 'listen = 443' } },
      ],
      questions: [
        {
          id: 'cause',
          text: 'q.cause',
          options: [
            { id: 'luck', text: 'q.luck', why: 'q.luck.why' },
            { id: 'config', text: 'q.config' },
          ],
          correct: 'config',
          objective: 'why',
        },
      ],
      rules: [{ on: { event: 'ObjectiveCompleted', objective: 'fix' }, do: [{ 'ada.ask': 'cause' }] }],
      debrief: { title: 'd', lesson: 'd', points: ['d'] },
    },
    i18n: {
      en: {
        brief: 'Brief',
        'c.debug': 'Debug mode is off',
        'c.port': 'Still listens on 443',
        'q.cause': 'What was wrong?',
        'q.luck': 'Bad luck',
        'q.luck.why': 'Luck is not a cause.',
        'q.config': 'A debug setting left on',
        d: 'D',
      },
    },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('repairs and questions', () => {
  it('verify judges the files as they stand', async () => {
    const g = await repairGame();
    const before = await run(g, 'verify');
    expect(before.status).toBe(1);
    expect(before.out).toContain('[FAIL] Debug mode is off');
    expect(before.out).toContain('[ OK ] Still listens on 443');
    expect(g.state.objectives.fix).toBe(false);
    await run(g, 'sed -i "s/debug = on/debug = off/" missions/app.conf');
    expect((await run(g, 'verify')).status).toBe(0);
    expect(g.state.objectives.fix).toBe(true);
  });

  it('a repair that breaks the file does not complete the objective', async () => {
    const g = await repairGame();
    g.writeFile('missions/app.conf', '# nothing left\n');
    const result = await run(g, 'verify');
    expect(result.out).toContain('[ OK ] Debug mode is off');
    expect(result.out).toContain('[FAIL] Still listens on 443');
    expect(g.state.objectives.fix).toBe(false);
  });

  it('the editor saves through the same event', async () => {
    const g = await repairGame();
    expect((await run(g, 'edit missions/app.conf')).status).toBe(0);
    expect(g.log.at(-1)).toMatchObject({
      type: 'AppOpened',
      app: 'editor',
      url: '/home/kestrel/missions/app.conf',
    });
    expect(g.writeFile('missions/app.conf', 'listen = 443\n')).toBe(true);
    expect(g.writeFile('/etc/shadow', 'x')).toBe(false);
    expect(g.verify().every((r) => r.ok)).toBe(true);
    expect((await run(g, 'edit /etc/shadow')).status).toBe(1);
  });

  it('a question is asked, a wrong answer costs points, the right one completes', async () => {
    const g = await repairGame();
    expect((await run(g, 'answer')).out).toContain('no open question');
    expect(g.answer('cause', 'config')).toBeNull();
    g.writeFile('missions/app.conf', 'listen = 443\n');
    await run(g, 'verify');
    expect(g.openQuestions().map((q) => q.id)).toEqual(['cause']);
    // Options are shown in a shuffled order that never changes for a given question.
    const question = g.openQuestions()[0]!;
    const shown = g.optionsOf(question).map((o) => o.id);
    expect([...shown].sort()).toEqual(question.options.map((o) => o.id).sort());
    expect(g.optionsOf(question).map((o) => o.id)).toEqual(shown);
    const letter = (id: string) => String.fromCharCode(97 + shown.indexOf(id));
    expect((await run(g, 'answer')).out).toContain(`${letter('luck')}) Bad luck`);
    const wrong = await run(g, `answer ${letter('luck')}`);
    expect(wrong.out).toContain('Luck is not a cause.');
    expect(g.state.mistakes).toBe(1);
    expect(g.state.missionDone).toBe(false);
    expect((await run(g, 'answer config')).status).toBe(0);
    expect(g.state.missionDone).toBe(true);
    expect(g.scoreDetail().mistakes).toBe(10);
    const again = new Game({
      world: g.worldPack,
      missions: [...g.missions.values()],
      locale: 'en',
      log: g.save().log,
    });
    expect(again.state.asked).toEqual({ cause: 'config' });
    expect(again.state.mistakes).toBe(1);
  });
});
