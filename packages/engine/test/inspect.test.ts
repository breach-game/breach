import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { readArchive, readCert } from '../src/artifact.ts';
import { parseRule } from '../src/commands/defense.ts';
import { components, describe as describeFile, identifyHash, parseHeaders } from '../src/commands/inspect.ts';
import { Game, runDetection, telemetry } from '../src/index.ts';
import type { LogLine } from '../src/telemetry.ts';
import { run } from './fixture.ts';

const EML = [
  'Return-Path: <billing@paiements-rapides.example>',
  'Received: from mx.lab.test (mx.lab.test [10.17.0.25]) by inbox.lab.test; Mon, 11 Jan 2027 09:01:02 +0100',
  'Received: from relay.paiements-rapides.example (relay [203.0.113.9])',
  '  by mx.lab.test with ESMTP id 4f2; Mon, 11 Jan 2027 09:01:00 +0100',
  'Authentication-Results: mx.lab.test; spf=fail (sender 203.0.113.9 not permitted) smtp.mailfrom=paiements-rapides.example;',
  '  dkim=none; dmarc=fail header.from=lab.test',
  'From: "Claire, CFO" <claire@lab.test>',
  'Reply-To: claire.cfo@paiements-rapides.example',
  'To: compta@lab.test',
  'Subject: Virement urgent',
  '',
  'Body',
].join('\n');

function lab() {
  const world = parsePack({
    format: 0,
    id: 'test.lab',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Lab' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-01-11T09:00:00+01:00',
      mandate: 'T-4',
      scope: { domains: ['*.lab.test'], networks: ['10.17.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.17.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: {
            home: {
              kestrel: {
                'agent.bin': {
                  $binary: { format: 'elf', strings: ['https://update.lab.test/beacon', 'KEY=lab-7f3a'] },
                },
                'app.apk': {
                  $archive: {
                    format: 'zip',
                    files: {
                      'assets/config.json': '{"api": "https://api.lab.test"}\n',
                      'classes.dex': {
                        $binary: { format: 'data', strings: ['/v1/hidden-admin', 'Bearer lab-77'] },
                      },
                    },
                  },
                },
                'release.tar.gz': {
                  $archive: {
                    format: 'tgz',
                    files: {
                      'src/main.c': 'int main(void) { return 0; }\n',
                      'build.sh': '#!/bin/sh\nmake\n',
                    },
                  },
                },
                'site.pem': {
                  $cert: {
                    subject: 'CN=www.lab.test, O=Lab',
                    issuer: 'CN=Lab Issuing CA, O=Lab',
                    serial: '0A:1B:2C',
                    notBefore: '2026-01-01T00:00:00Z',
                    notAfter: '2027-01-01T00:00:00Z',
                    san: ['www.lab.test', 'lab.test'],
                  },
                },
                'invoice.eml': EML,
                app: {
                  'package-lock.json': JSON.stringify({
                    lockfileVersion: 3,
                    packages: {
                      '': { name: 'app' },
                      'node_modules/left-pad': { version: '1.3.0' },
                      'node_modules/colorz': { version: '2.1.4' },
                    },
                  }),
                  'package.json': '{"dependencies": {"left-pad": "^1.3.0"}}',
                },
              },
            },
          },
        },
        {
          id: 'files',
          hostname: 'files.lab.test',
          ip: '10.17.0.20',
          map: { x: 1, z: 1 },
          services: [{ port: 443, name: 'https', product: 'nginx 1.27' }],
          web: {
            '/export.zip': {
              artifact: {
                $archive: { format: 'zip', files: { 'notes.txt': 'hello\n', '../escape.txt': 'x\n' } },
              },
            },
          },
        },
      ],
      dns: { 'files.lab.test': { A: ['10.17.0.20'] } },
      npcs: [
        {
          id: 'claire',
          name: 'Claire',
          role: 'CFO',
          phone: '+33 1 99 00 42 17',
          intents: [
            { id: 'transfer', words: ['virement', 'transfer'], reply: ['I never asked for a transfer.'] },
          ],
          fallback: ['Yes?'],
        },
      ],
      advisories: [
        {
          id: 'BRX-2027-0042',
          package: 'colorz',
          versions: ['2.1.4'],
          summary: 'adv.colorz',
          fixed: '2.1.5',
          severity: 'critical',
        },
      ],
    },
    i18n: { en: { 'adv.colorz': 'A published version runs code at install time.' } },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.lab.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.lab'],
    title: { en: 'Lab mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      files: {
        'drop/pack.zip': { $archive: { format: 'zip', files: { 'readme.txt': 'read me\n' } } },
      },
      objectives: [{ id: 'verify', text: 'o.verify' }],
      flags: [],
      rules: [
        {
          on: { event: 'ChatReply', npc: 'claire', intent: 'transfer' },
          do: [{ 'objective.complete': 'verify' }],
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

describe('artifacts', () => {
  it('give binaries their strings, archives their members, certificates their fields', async () => {
    const g = lab();
    const s = await run(g, 'strings agent.bin');
    expect(s.out).toBe('https://update.lab.test/beacon\nKEY=lab-7f3a\n');
    // The members of a gzipped tar do not show through strings.
    expect((await run(g, 'strings release.tar.gz')).out).not.toContain('main');
    expect((await run(g, 'file agent.bin release.tar.gz site.pem invoice.eml app')).out).toBe(
      [
        'agent.bin: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, stripped',
        'release.tar.gz: gzip compressed data, from Unix, original size modulo 2^32 10240',
        'site.pem: PEM certificate',
        'invoice.eml: SMTP mail, ASCII text',
        'app: directory',
        '',
      ].join('\n'),
    );
    expect(describeFile('{"a": 1}')).toBe('JSON text data');
    expect(describeFile('#!/usr/bin/env python3\nprint(1)\n')).toBe('Python script, ASCII text executable');
    const cert = readCert(g.readFile('/home/kestrel/site.pem') ?? '');
    expect(cert?.subject).toBe('CN=www.lab.test, O=Lab');
    expect(readArchive(g.readFile('/home/kestrel/release.tar.gz') ?? '')?.entries.map((e) => e.path)).toEqual(
      ['src/main.c', 'build.sh'],
    );
  });

  it('lists and extracts archives, refusing paths that leave the folder', async () => {
    const g = lab();
    expect((await run(g, 'tar -tzf release.tar.gz')).out).toBe('src/main.c\nbuild.sh\n');
    await run(g, 'tar xzf release.tar.gz -C out');
    expect(g.readFile('/home/kestrel/out/src/main.c')).toContain('int main');
    expect((await run(g, 'unzip -l drop/pack.zip')).out).toContain('readme.txt');
    expect((await run(g, 'unzip -p drop/pack.zip readme.txt')).out).toBe('read me\n');
    await run(g, 'curl -s https://files.lab.test/export.zip > export.zip');
    const r = await run(g, 'unzip export.zip -d x');
    expect(r.out).toContain('extracting: x/notes.txt');
    expect(r.err).toContain('../escape.txt');
    expect(g.readFile('/home/kestrel/x/notes.txt')).toBe('hello\n');
    expect(g.readFile('/home/kestrel/escape.txt')).toBe('');
    expect((await run(g, 'unzip agent.bin')).status).toBe(9);
    // A binary member keeps its bytes: strings finds its texts, file calls it data.
    expect((await run(g, 'unzip -p app.apk classes.dex | strings')).out).toBe(
      '/v1/hidden-admin\nBearer lab-77\n',
    );
    expect((await run(g, 'unzip -p app.apk assets/config.json')).out).toContain('api.lab.test');
    await run(g, 'unzip app.apk -d apk');
    expect((await run(g, 'file apk/classes.dex apk/assets/config.json')).out).toBe(
      'apk/classes.dex: data\napk/assets/config.json: JSON text data\n',
    );
  });

  it('reads certificates and fingerprints like openssl', async () => {
    const g = lab();
    const text = await run(g, 'openssl x509 -in site.pem -noout -text');
    expect(text.out).toContain('Issuer: CN = Lab Issuing CA, O = Lab');
    expect(text.out).toContain('Not After : Jan  1 00:00:00 2027 GMT');
    expect(text.out).toContain('DNS:www.lab.test, DNS:lab.test');
    expect((await run(g, 'openssl x509 -in site.pem -noout -dates')).out).toBe(
      'notBefore=Jan  1 00:00:00 2026 GMT\nnotAfter=Jan  1 00:00:00 2027 GMT\n',
    );
    expect((await run(g, 'cat site.pem | openssl x509 -noout -subject')).out).toBe(
      'subject=CN = www.lab.test, O = Lab\n',
    );
    const fp = await run(g, 'openssl x509 -in site.pem -noout -fingerprint -sha256');
    expect(fp.out).toMatch(/^sha256 Fingerprint=([0-9A-F]{2}:){31}[0-9A-F]{2}\n$/);
    const dgst = await run(g, 'openssl dgst -sha256 drop/pack.zip');
    expect(dgst.out).toMatch(/^SHA2-256\(drop\/pack\.zip\)= [0-9a-f]{64}\n$/);
    expect((await run(g, 'echo -n abc | openssl dgst -sha256')).out).toBe(
      'SHA2-256(stdin)= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n',
    );
  });
});

describe('hashid, sbom, mailhdr', () => {
  it('guesses hash algorithms from their shape only', () => {
    expect(identifyHash('5f4dcc3b5aa765d61d8327deb882cf99')).toContain('MD5');
    expect(identifyHash('$2b$12$C6UzMDM.H6dfI/f/IKcEeO7m9VJ9r5yS3y6m7v7fYw7F1oY1e5lNa')).toEqual([
      'bcrypt',
      'Blowfish(OpenBSD)',
    ]);
    expect(identifyHash('pbkdf2_sha256$600000$salt$hash')).toEqual(['Django(PBKDF2-HMAC-SHA256)']);
    expect(identifyHash('hello')).toEqual([]);
  });

  it('lists components from lock files and matches advisories', async () => {
    expect(components('requirements.txt', 'Flask==3.0.0\n# x\nrequests >= 2\n')).toEqual([
      { name: 'flask', version: '3.0.0', type: 'python' },
    ]);
    const g = lab();
    const list = await run(g, 'sbom app');
    expect(list.out).toContain('Cataloged 2 packages from 1 file');
    expect(list.out).toMatch(/colorz\s+2\.1\.4\s+npm/);
    const vuln = await run(g, 'sbom app --vuln');
    expect(vuln.out).toMatch(/colorz\s+2\.1\.4\s+2\.1\.5\s+npm\s+BRX-2027-0042\s+Critical/);
    expect(vuln.out).toContain('A published version runs code at install time.');
    expect(g.log.findLast((e) => e.type === 'SbomScanned')).toMatchObject({ findings: ['BRX-2027-0042'] });
  });

  it('lays out mail headers, oldest hop first, and flags domains that differ from the sender', async () => {
    expect(parseHeaders(EML).filter((h) => h.name === 'Received')).toHaveLength(2);
    const g = lab();
    const r = await run(g, 'mailhdr invoice.eml');
    expect(r.out).toContain(
      'Reply-To:     claire.cfo@paiements-rapides.example   [domain paiements-rapides.example ≠ lab.test]',
    );
    expect(r.out).toContain('1. relay.paiements-rapides.example [203.0.113.9] -> mx.lab.test');
    expect(r.out).toContain('2. mx.lab.test [10.17.0.25] -> inbox.lab.test');
    expect(r.out).toMatch(/spf\s+fail/);
    expect(r.out).toMatch(/dmarc\s+fail/);
  });
});

describe('call', () => {
  it('reaches a character by a fictional number and leaves a call record', async () => {
    const g = lab();
    const r = await run(g, 'call "+33 1 99 00 42 17" "Did you ask for a virement?"');
    expect(r.out).toContain('Claire: I never asked for a transfer.');
    expect(g.state.objectives.verify).toBe(true);
    expect((await run(g, 'call +33199004217')).out).toContain('Claire: …');
    expect((await run(g, 'call 0612345678 hello')).err).toContain('not in service');
    const voice = telemetry(g, { from: 0 }).filter((l) => l.source === 'voice');
    expect(voice).toHaveLength(1);
    expect(voice[0]!.text).toMatch(
      /asterisk: CDR src=10\.17\.0\.66 from=- to="\+33 1 99 00 42 17" callee=claire/,
    );
  });

  it('refuses a real-looking number in a pack', () => {
    expect(() =>
      parsePack({
        format: 0,
        id: 'test.bad',
        version: '1.0.0',
        engine: '>=0.1',
        kind: 'world',
        title: { en: 'Bad' },
        authors: ['test'],
        locales: ['en'],
        world: {
          startTime: '2027-01-11T09:00:00+01:00',
          mandate: 'T',
          scope: { domains: ['*.bad.test'], networks: ['10.18.0.0/24'] },
          player: { host: 'me', user: 'kestrel' },
          hosts: [{ id: 'me', hostname: 'bad.test', ip: '10.18.0.66', kind: 'player', map: { x: 0, z: 0 } }],
          dns: {},
          npcs: [{ id: 'x', name: 'X', role: 'r', phone: '+33 6 12 34 56 78', fallback: ['?'] }],
        },
      }),
    ).toThrow(/fictional number/);
  });
});

describe('threshold rules', () => {
  const line = (t: number, user: string, src: string, actor: LogLine['actor'] = 'adversary'): LogLine => ({
    id: `${t}`,
    t,
    host: 'h',
    hostname: 'h',
    source: 'auth',
    actor,
    seq: t,
    fields: { user, src, result: 'Failed' },
    text: '',
  });

  it('reads count, within and by in a player rule', () => {
    const parsed = parseRule('source: auth\nresult: Failed\ncount|gte: 3\nwithin: 5\nby: user\n');
    expect(parsed).toEqual({
      rule: { source: 'auth', where: { result: 'Failed' }, count: { gte: 3, within: 5, by: 'user' } },
    });
    expect('error' in parseRule('source: auth\nwithin: 5\n')).toBe(true);
    expect('error' in parseRule('source: auth\ncount|gte: 1\n')).toBe(true);
  });

  it('groups by any field: many addresses on one account still alert', () => {
    // A password spray: one attempt from each of five addresses, all on the same account.
    const lines = [0, 1, 2, 3, 4].map((i) => line(i * 30_000, 'alice', `203.0.113.${i}`));
    lines.push(line(10_000, 'bob', '10.0.0.5', 'background'));
    const bySrc = runDetection(
      { source: 'auth', where: { result: 'Failed' }, count: { gte: 3, within: 5 } },
      lines,
    );
    expect(bySrc.alerts).toHaveLength(0);
    const byUser = runDetection(
      { source: 'auth', where: { result: 'Failed' }, count: { gte: 3, within: 5, by: 'user' } },
      lines,
    );
    expect(byUser.caught).toBe(5);
    expect(byUser.falsePositives).toBe(0);
  });
});
