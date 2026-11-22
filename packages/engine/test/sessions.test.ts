import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { Game, stripAnsi } from '../src/index.ts';
import { run } from './fixture.ts';

/** A small network: the workstation, a forge that trusts the player while a variable holds, and a
 * database reachable from the forge only, with a key found there. */
function packs() {
  const world = parsePack({
    format: 0,
    id: 'test.net',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Net' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2026-11-23T09:00:00+01:00',
      mandate: 'T-2',
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
          fs: { home: { kestrel: { 'note.txt': 'mine\n' } } },
        },
        {
          id: 'forge',
          hostname: 'git.corp.test',
          ip: '10.13.0.21',
          os: 'Linux 6.8 (Debian 12)',
          map: { x: 1, z: 1 },
          services: [{ port: 22, name: 'ssh' }],
          users: [
            { name: 'ir', home: '/home/ir' },
            { name: 'deploy', home: '/home/deploy' },
          ],
          ssh: [{ user: 'ir', from: ['me'], if: { var: 'access', eq: true } }],
          fs: {
            var: { log: { 'auth.log': 'Accepted publickey for deploy from 10.13.0.99\n' } },
            home: { deploy: { '.ssh': { id_db: 'KEY\n' } }, ir: { 'README.txt': { $t: 'file.readme' } } },
            root: { 'secret.txt': { $content: 'no\n', $mode: '600' } },
          },
        },
        {
          id: 'db',
          hostname: 'db.corp.test',
          ip: '10.13.0.50',
          hidden: true,
          map: { x: 2, z: 2 },
          services: [{ port: 22, name: 'ssh' }],
          users: [{ name: 'backup', home: '/home/backup' }],
          ssh: [{ user: 'backup', from: ['forge'], key: '/home/deploy/.ssh/id_db' }],
          fs: { var: { log: { syslog: 'COPY clients\n' } } },
        },
      ],
      dns: {},
      noise: { ssh: 5 },
    },
    i18n: { en: { 'file.readme': 'Read only.\n' } },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.ir',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.net'],
    title: { en: 'IR' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'lateral',
      briefing: 'brief',
      files: { 'missions/order.txt': 'm.order', 'missions/plain.txt': 'Plain text.\n' },
      objectives: [{ id: 'db', text: 'o.db' }],
      rules: [
        { on: { event: 'MissionStarted' }, do: [{ 'var.set': { name: 'access', value: true } }] },
        {
          on: { event: 'FileRead', host: 'db', path: '/var/log/syslog' },
          do: [{ 'objective.complete': 'db' }],
        },
      ],
      debrief: { title: 'd.t', lesson: 'd.l', points: ['d.p'] },
    },
    i18n: { en: { brief: 'Brief', 'm.order': 'Amendment: read only.\n' } },
  });
  const other = parsePack({ ...structuredClone(mission), id: 'test.other' }) as typeof mission;
  other.mission!.order = 2;
  other.mission!.rules = [];
  other.mission!.files = {};
  return { world, missions: [mission, other] };
}

function play() {
  const { world, missions } = packs();
  const game = new Game({ world, missions, locale: 'en' });
  game.startMission('test.ir');
  return game;
}

describe('SSH sessions', () => {
  it('logs in only when the world allows it, and moves the terminal to the host', async () => {
    const game = play();
    expect((await run(game, 'ssh deploy@git.corp.test')).err).toContain('Permission denied (publickey)');
    const login = await run(game, 'ssh ir@git.corp.test');
    expect(login.status).toBe(0);
    expect(login.out).toContain('Welcome to Linux 6.8 (Debian 12)');
    expect(login.out).toContain('from 10.13.0.66');
    expect(stripAnsi(game.prompt())).toBe('ir@git:~$ ');
    expect((await run(game, 'whoami')).out).toBe('ir\n');
    expect((await run(game, 'hostname')).out).toBe('git\n');
    expect((await run(game, 'cat README.txt')).out).toBe('Read only.\n');
    expect((await run(game, 'cat /root/secret.txt')).err).toContain('Permission denied');
    expect((await run(game, 'grep Accepted /var/log/auth.log')).out).toContain('10.13.0.99');
    expect(game.log.some((e) => e.type === 'FileRead' && e.host === 'forge')).toBe(true);
    // The host shows up on the map once the player is on it.
    expect(game.state.discovered.forge).toBeDefined();
  });

  it('comes back with exit, and each host keeps its own files', async () => {
    const game = play();
    await run(game, 'ssh ir@git.corp.test');
    await run(game, 'echo trace > /home/ir/found.txt');
    const back = await run(game, 'exit');
    expect(back.out).toContain('Connection to git.corp.test closed.');
    expect(stripAnsi(game.prompt())).toBe('kestrel@lab:~$ ');
    expect((await run(game, 'cat note.txt')).out).toBe('mine\n');
    expect((await run(game, 'cat /home/ir/found.txt')).err).toContain('No such file');
    await run(game, 'ssh ir@git.corp.test');
    expect((await run(game, 'cat found.txt')).out).toBe('trace\n');
    expect((await run(game, 'exit')).status).toBe(0);
    expect((await run(game, 'exit')).out).not.toContain('closed');
  });

  it('hops to the next host only from the right one, with the key found there', async () => {
    const game = play();
    // Not from the workstation, even with a key path.
    expect((await run(game, 'ssh -i /home/deploy/.ssh/id_db backup@db.corp.test')).err).toMatch(
      /Identity file .* not accessible[\s\S]*Permission denied/,
    );
    await run(game, 'ssh ir@git.corp.test');
    expect((await run(game, 'ssh backup@db.corp.test')).err).toContain('Permission denied');
    const hop = await run(game, 'ssh -i /home/deploy/.ssh/id_db backup@db.corp.test');
    expect(hop.out).toContain('from 10.13.0.21');
    expect(stripAnsi(game.prompt())).toBe('backup@db:~$ ');
    expect(game.state.revealed.db).toBe(true);
    await run(game, 'cat /var/log/syslog');
    expect(game.state.objectives.db).toBe(true);
    await run(game, 'logout');
    expect(stripAnsi(game.prompt())).toBe('ir@git:~$ ');
  });

  it('replays sessions from the saved log, and a new mission starts back home', async () => {
    const game = play();
    await run(game, 'ssh ir@git.corp.test');
    await run(game, 'cd /var/log');
    const { world, missions } = packs();
    const resumed = new Game({ world, missions, locale: 'en', log: game.log });
    expect(stripAnsi(resumed.prompt())).toBe('ir@git:/var/log$ ');
    resumed.startMission('test.other');
    expect(stripAnsi(resumed.prompt())).toBe('kestrel@lab:~$ ');
    expect((await run(resumed, 'cat note.txt')).out).toBe('mine\n');
    // Access granted by the previous mission's variable is gone.
    expect((await run(resumed, 'ssh ir@git.corp.test')).err).toContain('Permission denied');
  });

  it('hands the mission documents to the player', async () => {
    const game = play();
    expect((await run(game, 'cat missions/order.txt')).out).toBe('Amendment: read only.\n');
    expect((await run(game, 'cat missions/plain.txt')).out).toBe('Plain text.\n');
  });

  it('refuses a mission document path that climbs out of the home directory', () => {
    const { missions } = packs();
    const bad = structuredClone(missions[0]!) as Record<string, any>;
    bad.mission.files = { '../../etc/passwd': 'x' };
    expect(() => parsePack(bad)).toThrow(/mission\.files.*Invalid key/);
  });
});

describe('curl uploads', () => {
  it('posts a local file to a character, with -F or -d @file', async () => {
    const { newGame } = await import('./fixture.ts');
    const game = await newGame();
    await run(game, 'echo "hello there" > cv.txt');
    const form = await run(game, 'curl -F cv=@cv.txt https://www.corp.test/api/chat');
    expect(form.out).toContain('"reply":"Hello."');
    expect(game.log.some((e) => e.type === 'ChatSent' && e.text === 'hello there')).toBe(true);
    const data = await run(game, 'curl --data-binary @cv.txt https://www.corp.test/api/chat');
    expect(data.out).toContain('"reply":"Hello."');
    const plain = await run(game, 'curl -F "message=bonjour" https://www.corp.test/api/chat');
    expect(plain.out).toContain('"reply":"Hello."');
    const missing = await run(game, 'curl -F cv=@nope.txt https://www.corp.test/api/chat');
    expect(missing.status).toBe(26);
    expect(missing.err).toContain('Failed to open/read local data');
  });
});
