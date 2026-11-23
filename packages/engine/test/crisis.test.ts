import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { parseRule } from '../src/commands/defense.ts';
import { Game } from '../src/index.ts';
import { run } from './fixture.ts';

const CRON = '0 2 * * * /usr/local/bin/backup.sh\n12 6 * * 1 /var/tmp/locker\n';

function packs() {
  const world = parsePack({
    format: 0,
    id: 'test.town',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Town' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-09-13T06:12:00+02:00',
      mandate: 'T-4',
      scope: { domains: ['*.town.test'], networks: ['10.16.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      config: { 'job.removed': false, paid: false },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.16.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: { home: { kestrel: { 'notes.txt': 'x\n' } } },
        },
        {
          id: 'files',
          hostname: 'files.town.test',
          ip: '10.16.0.20',
          map: { x: 1, z: 1 },
          services: [{ port: 22, name: 'ssh' }],
          users: [
            { name: 'ir', home: '/home/ir' },
            { name: 'svc', home: '/home/svc' },
          ],
          ssh: [{ user: 'ir', from: ['me'] }],
          fs: {
            home: { ir: {} },
            var: { spool: { cron: { crontabs: { svc: CRON } } } },
            srv: { share: { 'plan.ods.locked': 'unreadable\n', 'note.txt': 'pay\n' } },
          },
        },
        { id: 'desk', hostname: 'desk.town.test', ip: '10.16.0.101', map: { x: 2, z: 2 } },
      ],
      dns: { 'files.town.test': { A: ['10.16.0.20'] } },
      noise: { ssh: 0 },
      telemetry: {
        background: [
          {
            host: 'files',
            source: 'auth',
            every: 5,
            offset: 1,
            fields: { user: 'svc', result: 'Accepted', method: 'publickey', src: '10.16.0.40' },
          },
        ],
      },
    },
    i18n: { en: {} },
  });
  const base = {
    format: 0,
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.town'],
    authors: ['test'],
    locales: ['en'],
  };
  const debrief = { title: 'd', lesson: 'd', points: ['d'] };
  const first = parsePack({
    ...base,
    id: 'test.c1',
    title: { en: 'Decide' },
    mission: {
      side: 'defense',
      order: 0,
      stage: 'crisis',
      briefing: 'b',
      objectives: [
        { id: 'ransom', text: 'o' },
        { id: 'clean', text: 'o' },
        { id: 'detect', text: 'o' },
      ],
      flags: [],
      files: { 'rules/svc.yml': 'title: backup account\nsource: auth\nuser: svc\n' },
      questions: [
        {
          id: 'ransom',
          text: 'q',
          objective: 'ransom',
          options: [
            { id: 'pay', text: 'pay', why: 'paid.why', impact: 25, sets: { paid: true } },
            { id: 'refuse', text: 'refuse' },
          ],
        },
      ],
      adversary: {
        id: 'locker',
        name: 'Intruder',
        from: 'desk',
        pace: 1,
        delay: 1,
        steps: [
          {
            id: 'login',
            host: 'files',
            source: 'auth',
            fields: { user: 'svc', result: 'Accepted', method: 'password', src: '10.16.0.101' },
          },
        ],
      },
      containment: [
        {
          id: 'remove-job',
          action: 'remove',
          target: 'job',
          text: 'removed',
          sets: { 'job.removed': true },
          writes: [{ host: 'files', path: '/var/spool/cron/crontabs/svc', content: 'clean\n' }],
          removes: [
            { host: 'files', path: '/srv/share/plan.ods.locked' },
            { host: 'files', path: '/srv/share/nothing-here' },
          ],
        },
      ],
      hunts: [
        {
          id: 'svc',
          file: 'rules/svc.yml',
          catch: { source: 'auth', where: { user: 'svc', method: 'password' } },
          objective: 'detect',
        },
      ],
      rules: [
        { on: { event: 'MissionStarted' }, do: [{ 'ada.ask': 'ransom' }] },
        { on: { event: 'Contained', containment: 'remove-job' }, do: [{ 'objective.complete': 'clean' }] },
      ],
      guide: { ransom: 'g', clean: 'g', detect: 'g' },
      debrief,
    },
    i18n: { en: { 'paid.why': 'No guarantee.' } },
  });
  const second = parsePack({
    ...base,
    id: 'test.c2',
    title: { en: 'After' },
    mission: {
      side: 'defense',
      order: 1,
      stage: 'after',
      briefing: 'b',
      objectives: [{ id: 'paid', text: 'o' }],
      flags: [],
      questions: [
        {
          id: 'x',
          text: 'q',
          options: [
            { id: 'a', text: 'a' },
            { id: 'b', text: 'b' },
          ],
        },
      ],
      rules: [
        {
          on: { event: 'MissionStarted' },
          if: { choice: 'ransom', eq: 'pay' },
          do: [{ 'objective.complete': 'paid' }],
        },
      ],
      guide: { paid: 'g' },
      debrief,
    },
    i18n: { en: {} },
  });
  return { world, first, second };
}

function start() {
  const { world, first, second } = packs();
  const game = new Game({ world, missions: [first, second], locale: 'en' });
  game.startMission(first.id);
  return game;
}

describe('decisions', () => {
  it('has no wrong option: the choice costs its impact, flips its settings and completes the objective', async () => {
    const game = start();
    const r = await run(game, 'answer pay');
    expect(r.status).toBe(0);
    // The consequence is told by Ada, before the story moves on.
    const told = game.log.findIndex((e) => e.type === 'NpcMessage' && e.key === 'paid.why');
    expect(told).toBeGreaterThan(-1);
    expect(told).toBeLessThan(game.log.findIndex((e) => e.type === 'Answered'));
    expect(game.state.objectives.ransom).toBe(true);
    expect(game.state.mistakes).toBe(0);
    expect(game.state.impact).toBe(25);
    expect(game.state.config.paid).toBe(true);
    expect(game.state.choices.ransom).toBe('pay');
  });

  it('a free option costs nothing', async () => {
    const game = start();
    await run(game, 'answer refuse');
    expect(game.state.impact).toBe(0);
    expect(game.state.config.paid).toBe(false);
    expect(game.state.objectives.ransom).toBe(true);
  });

  it('is remembered in the next mission, where a `choice` condition reads it', async () => {
    const paid = start();
    await run(paid, 'answer pay');
    paid.startMission('test.c2');
    expect(paid.state.objectives.paid).toBe(true);

    const refused = start();
    await run(refused, 'answer refuse');
    refused.startMission('test.c2');
    expect(refused.state.objectives.paid).toBe(false);
  });

  it('survives a save: replaying the journal gives the same choices', async () => {
    const game = start();
    await run(game, 'answer pay');
    const { world, first, second } = packs();
    const again = new Game({ world, missions: [first, second], locale: 'en', log: game.log });
    expect(again.state.choices).toEqual({ ransom: 'pay' });
    expect(again.state.impact).toBe(25);
  });

  it('the schema keeps sets and impact for decisions', () => {
    const { first } = packs();
    const raw = JSON.parse(JSON.stringify(first)) as { mission: { questions: { correct?: string }[] } };
    raw.mission.questions[0]!.correct = 'refuse';
    expect(() => parsePack(raw)).toThrow(/decision/);
  });
});

describe('crontab', () => {
  it('lists the jobs of an account on the machine of the session', async () => {
    const game = start();
    await run(game, 'ssh ir@files.town.test');
    const r = await run(game, 'crontab -l -u svc');
    expect(r.out).toContain('12 6 * * 1 /var/tmp/locker');
    expect((await run(game, 'crontab -l')).err).toContain('no crontab for ir');
    expect((await run(game, 'crontab -l -u nobody')).status).toBe(1);
  });

  it('only reads: editing and removing are refused', async () => {
    const game = start();
    await run(game, 'ssh ir@files.town.test');
    expect((await run(game, 'crontab -r')).status).toBe(1);
    expect((await run(game, 'crontab -e')).status).toBe(1);
    expect((await run(game, 'crontab -l -u svc')).out).toContain('locker');
  });
});

describe('containment orders that change files', () => {
  it('rewrite and delete files on a machine the player never opened', async () => {
    const game = start();
    const r = await run(game, 'contain remove job');
    expect(r.status).toBe(0);
    expect(game.state.objectives.clean).toBe(true);
    await run(game, 'ssh ir@files.town.test');
    expect((await run(game, 'crontab -l -u svc')).out.trim()).toBe('clean');
    expect((await run(game, 'ls /srv/share')).out.trim()).toBe('note.txt');
  });
});

describe('parseRule', () => {
  it('reads a source and fields, with their modifiers', () => {
    const parsed = parseRule(
      '# comment\ntitle: x\nlogsource: auth\nuser: svc   # the account\nmethod|contains: pass\nsrc|startswith: 10.16.\ndport: 22\nok: true\n',
    );
    expect(parsed).toEqual({
      rule: {
        source: 'auth',
        where: { user: 'svc', method: { contains: 'pass' }, src: { glob: '10.16.*' }, dport: 22, ok: true },
      },
    });
  });

  it('names the line it cannot read', () => {
    expect(parseRule('user: svc\n')).toEqual({ error: 'source:' });
    expect(parseRule('source: nothing\n')).toEqual({ error: 'source: nothing' });
    expect(parseRule('source: auth\nuser|regex: .*\n')).toEqual({ error: 'user|regex: .*' });
    expect(parseRule('source: auth\njust words\n')).toEqual({ error: 'just words' });
  });
});

describe('rule test', () => {
  it('waits for the attack to be in the logs', async () => {
    const game = start();
    const r = await run(game, 'rule test rules/svc.yml');
    expect(r.status).toBe(1);
    expect(r.out).toContain('No line of the attack');
    expect(game.state.objectives.detect).toBe(false);
  });

  it('refuses a rule that also rings on ordinary activity, then accepts the precise one', async () => {
    const game = start();
    await run(game, 'pwd');
    await run(game, 'pwd');
    const naive = await run(game, 'rule test rules/svc.yml');
    expect(naive.status).toBe(1);
    expect(naive.out).toMatch(/attack: 1, ordinary activity: [1-9]/);
    expect(naive.out).toContain('false alert');
    expect(game.state.objectives.detect).toBe(false);

    await run(game, 'echo "method: password" >> rules/svc.yml');
    const precise = await run(game, 'rule test rules/svc.yml');
    expect(precise.status).toBe(0);
    expect(precise.out).toContain('attack: 1, ordinary activity: 0');
    expect(game.state.objectives.detect).toBe(true);
    const tested = game.log.filter((e) => e.type === 'RuleTested');
    expect(tested.at(-1)).toMatchObject({
      hunt: 'svc',
      caught: 1,
      missed: 0,
      falsePositives: 0,
      passed: true,
    });
  });

  it('says what still escapes a rule that is too narrow', async () => {
    const game = start();
    await run(game, 'pwd');
    await run(game, 'pwd');
    await run(game, 'echo "src: 10.16.0.9" >> rules/svc.yml');
    const r = await run(game, 'rule test rules/svc.yml');
    expect(r.status).toBe(1);
    expect(r.out).toContain('still escape');
  });

  it('gives the result of any other rule file for information, and reports a syntax error', async () => {
    const game = start();
    await run(game, 'echo "source: auth" > mine.yml');
    expect((await run(game, 'rule test mine.yml')).out).toContain('does not expect this rule');
    await run(game, 'echo "nonsense" > bad.yml');
    expect((await run(game, 'rule test bad.yml')).status).toBe(2);
    expect((await run(game, 'rule test missing.yml')).status).toBe(1);
  });
});

describe('mission start time', () => {
  it('moves the clock forward to the time the mission takes place, never backward', async () => {
    const { world, first, second } = packs();
    const later = parsePack({
      ...(JSON.parse(JSON.stringify(second)) as object),
      mission: { ...second.mission, startTime: '2027-09-13T09:30:00+02:00' },
    });
    const game = new Game({ world, missions: [first, later], locale: 'en' });
    game.startMission(first.id);
    expect((await run(game, 'date')).out).toContain('06:12');
    game.startMission(later.id);
    expect((await run(game, 'date')).out).toContain('09:30');
    // Going back to an earlier mission does not rewind the clock.
    game.startMission(first.id);
    expect((await run(game, 'date')).out).toContain('09:3');
  });
});

describe('a failed defence', () => {
  it('goes back to the checkpoint, on the workstation, and keeps the explanation in the journal', async () => {
    const { world, first, second } = packs();
    const raw = JSON.parse(JSON.stringify(first)) as { mission: { rules: unknown[] } };
    raw.mission.rules.push(
      { on: { event: 'SessionOpened', host: 'files' }, do: [{ 'checkpoint.save': 'inside' }] },
      { on: { event: 'CommandRun', command: 'whoami' }, once: false, do: [{ 'mission.fail': 'too.late' }] },
    );
    const game = new Game({ world, missions: [parsePack(raw), second], locale: 'en' });
    game.startMission(first.id);
    await run(game, 'ssh ir@files.town.test');
    expect(game.state.host).toBe('files');
    const r = await run(game, 'whoami');
    expect(r.status).toBe(130);
    expect(game.state.host).toBe('me');
    expect(game.state.detections).toBe(1);
    const last = game.log.filter((e) => e.type === 'NpcMessage').at(-1);
    expect(last).toMatchObject({ key: 'too.late', tone: 'warn' });
    // The save replays to the same place.
    const again = new Game({ world, missions: [parsePack(raw), second], locale: 'en', log: game.log });
    expect(again.state.host).toBe('me');
  });
});
