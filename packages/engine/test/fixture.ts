import { type Pack, parsePack } from '@breach/pack-schema';
import { type Chunk, Game, sha256, stripAnsi } from '../src/index.ts';

export async function fixture(): Promise<{ world: Pack; mission: Pack }> {
  const world = parsePack({
    format: 0,
    id: 'test.world',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Test world' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2026-11-23T09:00:00+01:00',
      mandate: 'T-1',
      scope: { domains: ['*.corp.test'], networks: ['10.13.0.0/16'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.13.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: {
            home: {
              kestrel: {
                'a.txt': 'alpha\nbeta\ngamma\n',
                'b.txt': 'Beta again\n',
                docs: { 'note.md': 'secret token\n' },
                '.hidden': 'x\n',
              },
            },
            etc: { shadow: { $content: 'root:!\n', $mode: '600' } },
          },
        },
        {
          id: 'web',
          hostname: 'www.corp.test',
          ip: '10.13.0.10',
          map: { x: 1, z: 1 },
          services: [
            { port: 80, name: 'http', product: 'nginx 1.27' },
            { port: 443, name: 'https', product: 'nginx 1.27' },
          ],
          web: { '/': { body: '<h1>hello</h1>\n' } },
          repos: {
            'corp/app': {
              commits: [
                {
                  id: 'abc1234',
                  author: 'A <a@corp.test>',
                  date: 'Mon',
                  message: 'fix',
                  diff: '-KEY=FLAG{x}\n',
                },
              ],
              tree: { 'README.md': 'app\n' },
            },
          },
        },
        {
          id: 'db',
          hostname: 'db.corp.test',
          ip: '10.13.0.50',
          map: { x: 2, z: 2 },
          services: [{ port: 5432, name: 'postgresql' }],
        },
        { id: 'ghost', hostname: 'ghost.corp.test', ip: '10.13.0.99', hidden: true, map: { x: 3, z: 3 } },
      ],
      dns: {
        'corp.test': { A: ['10.13.0.10'], MX: ['mail.corp.test'] },
        'www.corp.test': { A: ['10.13.0.10'] },
      },
      noise: { nmap: { base: 30, flags: { '-sn': -20, '-T5': 40 } }, curl: 2 },
      rules: [{ on: { event: 'OutOfScope' }, once: false, do: [{ 'ada.warn': 'law' }] }],
    },
    i18n: { en: { law: 'Out of scope.' } },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.world'],
    title: { en: 'Test mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      objectives: [
        { id: 'scan', text: 'o.scan' },
        { id: 'key', text: 'o.key' },
        { id: 'bonus', text: 'o.bonus', optional: true },
      ],
      flags: [{ id: 'k', sha256: await sha256('FLAG{x}'), points: 100, objective: 'key' }],
      rules: [
        { on: { event: 'MissionStarted' }, do: [{ 'ada.say': 'hello' }] },
        {
          on: { event: 'HostDiscovered' },
          if: { discovered: { gte: 2 } },
          do: [{ 'objective.complete': 'scan' }, { 'checkpoint.save': 'scanned' }],
        },
        { on: { event: 'CommandRun', command: 'whoami' }, do: [{ 'objective.complete': 'bonus' }] },
      ],
      hints: { scan: ['h1', 'h2'] },
      debrief: { title: 'd.t', lesson: 'd.l', points: ['d.p'] },
    },
    i18n: { en: { brief: 'Brief', hello: 'Hello', h1: 'Hint one', h2: 'Hint two' } },
  });
  return { world, mission };
}

export async function newGame() {
  const { world, mission } = await fixture();
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

export async function run(game: Game, line: string, dt = 1000) {
  const chunks: Chunk[] = [];
  const gen = game.exec(line, dt);
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  const text = (k: 'out' | 'err') =>
    stripAnsi(
      chunks
        .filter((c) => c.k === k)
        .map((c) => (c as { text: string }).text)
        .join(''),
    );
  return { status: step.value, out: text('out'), err: text('err'), chunks };
}
