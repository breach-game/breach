import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { Game, telemetry } from '../src/index.ts';
import { run } from './fixture.ts';

function farm() {
  const world = parsePack({
    format: 0,
    id: 'test.farm',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Farm' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-01-11T09:00:00+01:00',
      mandate: 'T-3',
      scope: { domains: ['*.farm.test'], networks: ['10.16.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      config: { 'broker.auth': false },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.16.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: { home: { kestrel: {} } },
        },
        {
          id: 'broker',
          hostname: 'broker.farm.test',
          ip: '10.16.0.10',
          map: { x: 1, z: 1 },
          services: [{ port: 1883, name: 'mqtt', product: 'Mosquitto 2.0' }],
          web: {
            '/#': {
              body: 'farm/1/temp 21.4\n',
              variants: [{ id: 'closed', if: { config: 'broker.auth', eq: true }, status: 401, body: '' }],
            },
            '/farm/admin': {
              status: 401,
              body: '',
              variants: [
                { id: 'factory', header: 'Authorization: device:0000', body: 'farm/admin wifi=x\n' },
              ],
            },
            '/farm/0/lamp/set': { chat: 'lamp' },
          },
        },
        {
          id: 'www',
          hostname: 'www.farm.test',
          ip: '10.16.0.20',
          map: { x: 2, z: 1 },
          services: [{ port: 443, name: 'https', product: 'nginx 1.27' }],
          web: { '/': { body: 'hello\n' } },
        },
      ],
      dns: { 'broker.farm.test': { A: ['10.16.0.10'] }, 'www.farm.test': { A: ['10.16.0.20'] } },
      npcs: [
        {
          id: 'lamp',
          name: 'lamp-0',
          role: 'Lamp',
          intents: [{ id: 'on', words: ['on'], reply: ['farm/0/lamp/state on'] }],
          fallback: ['farm/0/lamp/state unchanged'],
        },
      ],
    },
    i18n: { en: {} },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.farm.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.farm'],
    title: { en: 'Farm mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      objectives: [{ id: 'listen', text: 'o.listen' }],
      flags: [],
      rules: [
        {
          on: { event: 'HttpRequest', host: 'broker', method: 'SUBSCRIBE', path: '/#' },
          do: [{ 'objective.complete': 'listen' }],
        },
      ],
      debrief: { title: 'd.t', lesson: 'd.l', points: ['d.p'] },
    },
    i18n: { en: { brief: 'Brief' } },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('mqtt', () => {
  it('reads the retained messages of a topic, and rules see the subscription', async () => {
    const g = farm();
    const all = await run(g, 'mqtt sub -h broker.farm.test -t "#"');
    expect(all.out).toBe('farm/1/temp 21.4\n');
    expect(g.state.objectives.listen).toBe(true);
    expect((await run(g, 'mqtt sub -h broker.farm.test -t farm/9/none')).out).toContain(
      'no retained message',
    );
  });

  it('refuses a topic without the right account, and a closed broker', async () => {
    const g = farm();
    const denied = await run(g, 'mqtt sub -h broker.farm.test -t farm/admin');
    expect(denied.err).toContain('not authorised');
    expect(denied.status).toBe(5);
    const factory = await run(g, 'mqtt sub -h broker.farm.test -t farm/admin -u device -P 0000');
    expect(factory.out).toBe('farm/admin wifi=x\n');
    g.emit({ type: 'ConfigPatched', key: 'broker.auth', value: true, by: 'test' });
    expect((await run(g, 'mqtt sub -h broker.farm.test -t "#"')).err).toContain('not authorised');
  });

  it('hands a published message to the device behind the topic', async () => {
    const g = farm();
    expect((await run(g, 'mqtt pub -h broker.farm.test -t farm/0/lamp/set -m on')).out).toBe(
      'farm/0/lamp/state on\n',
    );
    expect(g.log.findLast((e) => e.type === 'ChatReply')).toMatchObject({ npc: 'lamp', intent: 'on' });
    expect((await run(g, 'mqtt pub -h broker.farm.test -t farm/9/none -m on')).out).toBe('');
  });

  it('stays inside the scope and only talks to a broker', async () => {
    const g = farm();
    expect((await run(g, 'mqtt sub -h broker.example.org -t "#"')).status).toBe(9);
    expect((await run(g, 'mqtt sub -h www.farm.test -t "#"')).err).toContain('Connection refused');
    expect((await run(g, 'mqtt sub -h broker.farm.test')).err).toContain('usage: mqtt sub');
  });

  it('leaves broker lines in the logs, not web or chat lines', async () => {
    const g = farm();
    await run(g, 'mqtt sub -h broker.farm.test -t "#"');
    await run(g, 'mqtt pub -h broker.farm.test -t farm/0/lamp/set -m on');
    const lines = telemetry(g, { from: 0 }).filter((l) => l.actor === 'player');
    expect(lines.map((l) => l.source)).toEqual(['mqtt', 'mqtt']);
    expect(lines[0]!.text).toMatch(/: Received SUBSCRIBE from kestrel@10\.16\.0\.66 '#'$/);
    expect(lines[1]!.text).toMatch(
      /: Received PUBLISH from kestrel@10\.16\.0\.66 'farm\/0\/lamp\/set' \(\d+ bytes\)$/,
    );
  });
});
