import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { linksIn, senderKind } from '../src/commands/personal.ts';
import { Game } from '../src/index.ts';
import { run } from './fixture.ts';

function home(wifi?: unknown[]) {
  const world = parsePack({
    format: 0,
    id: 'test.home',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Home' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-06-12T09:00:00+02:00',
      mandate: 'T-9',
      scope: { domains: ['*.home.test'], networks: ['10.18.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'laptop.home.test',
          ip: '10.18.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
        },
        {
          id: 'box',
          hostname: 'box.home.test',
          ip: '10.18.0.1',
          map: { x: 1, z: 1 },
          services: [{ port: 22, name: 'ssh' }],
          users: [{ name: 'admin', home: '/home/admin' }],
          ssh: [{ user: 'admin', from: ['me'] }],
          fs: { home: { admin: {} } },
        },
      ],
      dns: { 'box.home.test': { A: ['10.18.0.1'] } },
      config: { 'box.wpa3': false },
      wifi: wifi ?? [
        {
          ssid: 'Home-5G',
          bssid: '02:11:22:33:44:55',
          channel: 36,
          signal: 71,
          security: 'WPA2',
          inUse: true,
          if: { config: 'box.wpa3', eq: false },
        },
        {
          ssid: 'Home-5G',
          bssid: '02:11:22:33:44:55',
          channel: 36,
          signal: 71,
          security: 'WPA3',
          inUse: true,
          if: { config: 'box.wpa3', eq: true },
        },
        { ssid: 'Neighbour', bssid: '06:AA:BB:CC:DD:01', channel: 6, signal: 88, security: 'open' },
        { ssid: '', bssid: '0A:AA:BB:CC:DD:02', channel: 11, signal: 20, security: 'WEP' },
      ],
      sms: [
        { id: 'bank', from: '36105', at: '2027-06-11 18:02', text: 'sms.bank' },
        { id: 'parcel', from: 'ColisPlus', at: '2027-06-12 08:41', text: 'sms.parcel' },
      ],
    },
    i18n: {
      en: {
        'sms.bank': 'Your code is 418 220. Never share it.',
        'sms.parcel': 'Your parcel is waiting: pay 1.99 at https://colisplus-suivi.example/pay?id=7.',
        'sms.kid': 'Mum it is me, new number. Can you send 300?',
      },
    },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.home.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.home'],
    title: { en: 'Home mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      sms: [{ id: 'kid', from: '+33 6 39 98 12 34', at: '2027-06-12 08:55', text: 'sms.kid' }],
      objectives: [
        { id: 'scan', text: 'o.scan' },
        { id: 'read', text: 'o.read' },
      ],
      flags: [],
      rules: [
        { on: { event: 'WifiScanned' }, do: [{ 'objective.complete': 'scan' }] },
        { on: { event: 'SmsRead', sms: 'parcel' }, do: [{ 'objective.complete': 'read' }] },
      ],
      debrief: { title: 'd.t', lesson: 'd.l', points: ['d.p'], home: { points: ['d.h1', 'd.h2'] } },
    },
    i18n: { en: { brief: 'Brief' } },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('nmcli', () => {
  it('lists the networks in range, strongest first, in the format of the tool', async () => {
    const g = home();
    const r = await run(g, 'nmcli device wifi list');
    expect(r.out).toBe(
      [
        'IN-USE  BSSID              SSID       MODE   CHAN  RATE        SIGNAL  BARS  SECURITY',
        '        06:AA:BB:CC:DD:01  Neighbour  Infra  6     130 Mbit/s  88      ▂▄▆█  --',
        '*       02:11:22:33:44:55  Home-5G    Infra  36    270 Mbit/s  71      ▂▄▆_  WPA2',
        '        0A:AA:BB:CC:DD:02  --         Infra  11    54 Mbit/s   20      ▂___  WEP',
        '',
      ].join('\n'),
    );
    expect(g.state.objectives.scan).toBeTruthy();
    // Short forms and a field list, as the real tool takes them.
    expect((await run(g, 'nmcli -f SSID,SECURITY dev wifi')).out).toBe(
      ['SSID       SECURITY', 'Neighbour  --', 'Home-5G    WPA2', '--         WEP', ''].join('\n'),
    );
  });

  it('follows the settings of the target: a fix changes what the box announces', async () => {
    const g = home();
    g.emit({ type: 'ConfigPatched', key: 'box.wpa3', value: true, by: 'test' });
    const r = await run(g, 'nmcli -f SSID,SECURITY device wifi list');
    expect(r.out).toContain('Home-5G    WPA3');
    expect(r.out).not.toContain('WPA2');
  });

  it('refuses anything but the passive list, and has no radio on a remote host', async () => {
    const g = home();
    const bad = await run(g, 'nmcli device wifi connect Neighbour');
    expect(bad.status).toBe(2);
    expect(bad.err).toContain('usage: nmcli');
    expect((await run(g, 'nmcli connection show')).status).toBe(2);
    expect((await run(g, 'nmcli -f SSID,KEY device wifi list')).err).toContain("invalid field 'KEY'");
    await run(g, 'ssh admin@box.home.test');
    expect(g.state.host).toBe('box');
    expect((await run(g, 'nmcli device wifi list')).err).toContain('No Wi-Fi device');
  });

  it('only accepts hardware addresses that no vendor owns', () => {
    expect(() =>
      home([{ ssid: 'Real', bssid: '00:1A:2B:33:44:55', channel: 1, signal: 50, security: 'WPA2' }]),
    ).toThrow();
  });
});

describe('sms', () => {
  it('lists the inbox of the world and of the mission, oldest first', async () => {
    const g = home();
    const r = await run(g, 'sms');
    expect(r.out).toBe(
      [
        '#  FROM               RECEIVED          TEXT',
        '1  36105              2027-06-11 18:02  Your code is 418 220. Never share it.',
        '2  ColisPlus          2027-06-12 08:41  Your parcel is waiting: pay 1.99 at https://col…',
        '3  +33 6 39 98 12 34  2027-06-12 08:55  Mum it is me, new number. Can you send 300?',
        '',
      ].join('\n'),
    );
    expect(g.state.objectives.read).toBeFalsy();
  });

  it('shows one message with the kind of sender and where each link really leads', async () => {
    const g = home();
    const r = await run(g, 'sms 2');
    expect(r.out).toBe(
      [
        'From:      ColisPlus',
        'Sender:    sender name (free text, set by whoever sends the message)',
        'Received:  2027-06-12 08:41',
        '',
        'Your parcel is waiting: pay 1.99 at https://colisplus-suivi.example/pay?id=7.',
        '',
        'Links:',
        '  https://colisplus-suivi.example/pay?id=7',
        '    opens: colisplus-suivi.example',
        '',
      ].join('\n'),
    );
    expect(g.state.objectives.read).toBeTruthy();
    expect((await run(g, 'sms bank')).out).toContain('short code');
    expect((await run(g, 'sms 3')).out).toContain('mobile or landline number');
    expect((await run(g, 'sms 9')).status).toBe(1);
  });

  it('reads senders and links as data', () => {
    expect(senderKind('36105')).toBe('shortcode');
    expect(senderKind('MaBanque')).toBe('name');
    expect(senderKind('+33 6 39 98 00 01')).toBe('number');
    expect(linksIn('see http://a.example/x, then https://b.example.')).toEqual([
      { url: 'http://a.example/x', host: 'a.example' },
      { url: 'https://b.example', host: 'b.example' },
    ]);
  });

  it('refuses a sender that could be a real subscriber', () => {
    const make = (from: string) =>
      parsePack({
        format: 0,
        id: 'test.sms',
        version: '1.0.0',
        engine: '>=0.1',
        kind: 'world',
        title: { en: 'x' },
        authors: ['t'],
        locales: ['en'],
        world: {
          startTime: '2027-06-12T09:00:00+02:00',
          mandate: 'T',
          scope: { domains: ['*.home.test'], networks: ['10.18.0.0/24'] },
          player: { host: 'me', user: 'kestrel' },
          hosts: [
            {
              id: 'me',
              hostname: 'l.home.test',
              ip: '10.18.0.66',
              kind: 'player',
              map: { x: 0, z: 0 },
              users: [{ name: 'kestrel', home: '/home/kestrel' }],
            },
          ],
          dns: {},
          sms: [{ id: 'a', from, at: '2027-06-12 08:41', text: 'k' }],
        },
        i18n: { en: { k: 'hello' } },
      });
    expect(() => make('+33 6 12 34 56 78')).toThrow();
    expect(() => make('+33 6 39 98 56 78')).not.toThrow();
  });
});
