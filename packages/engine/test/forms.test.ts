import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { Game, inputShapes, sha256, sigmaText, telemetry } from '../src/index.ts';
import { run } from './fixture.ts';

const TOKEN = `${btoa('{"alg":"none","typ":"JWT"}')}.${btoa('{"sub":"1042","role":"customer"}')}.`;

async function shop() {
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
      startTime: '2027-01-11T09:00:00+01:00',
      mandate: 'T-2',
      scope: { domains: ['*.shop.test'], networks: ['10.15.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      config: { 'session.random_ids': false, 'bucket.private': false },
      hosts: [
        {
          id: 'me',
          hostname: 'lab.test',
          ip: '10.15.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: {
            home: {
              kestrel: {
                'cart.txt': 'one\ntwo\nthree\nfour\n',
                'data.json':
                  '{"items":[{"name":"coat","price":42},{"name":"hat","price":9}],"token":"abc"}\n',
              },
            },
          },
        },
        {
          id: 'shop',
          hostname: 'www.shop.test',
          ip: '10.15.0.10',
          map: { x: 1, z: 1 },
          services: [{ port: 443, name: 'https', product: 'nginx 1.27' }],
          web: {
            '/search': {
              page: {
                title: 'Search',
                blocks: [
                  { form: { to: 'search', label: 'Find', button: 'Go' } },
                  {
                    table: {
                      head: ['Size', 'Stock'],
                      rows: [
                        ['M', '3'],
                        ['L', '`0`'],
                      ],
                    },
                  },
                ],
              },
              chat: 'search',
            },
            '/backup': {
              body: 'rows\n',
              variants: [
                {
                  id: 'denied',
                  if: { config: 'bucket.private', eq: true },
                  status: 403,
                  page: { title: 'Denied', blocks: [{ p: 'AccessDenied' }] },
                },
              ],
            },
            '/account': {
              status: 401,
              body: 'sign in\n',
              variants: [
                { id: 'mine', cookie: 'session=aaa', body: 'account 1042\n' },
                {
                  id: 'other',
                  cookie: 'session=bbb',
                  if: { config: 'session.random_ids', eq: false },
                  body: 'account 1041\n',
                },
                { id: 'staff', header: 'X-Preview: staff', body: 'preview\n' },
              ],
            },
          },
        },
      ],
      dns: { 'www.shop.test': { A: ['10.15.0.10'] } },
      noise: { curl: 2, browse: 2, chat: 1 },
      npcs: [
        {
          id: 'search',
          name: 'shop-search',
          role: 'Search',
          intents: [
            { id: 'error', input: ['quote'], reply: ['SQL error near "\'"\nline two'] },
            { id: 'tag', input: ['markup'], reply: ['stored'] },
            { id: 'minus', input: ['negative'], reply: ['refund'] },
          ],
          fallback: ['no result'],
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
        { id: 'review', text: 'o.review' },
        { id: 'key', text: 'o.key' },
      ],
      flags: [{ id: 'k', sha256: await sha256('FLAG{y}'), points: 100, objective: 'key' }],
      reviews: [{ id: 'cart', file: 'cart.txt', lines: [2, 4], objective: 'review' }],
      rules: [],
      debrief: { title: 'd.t', lesson: 'd.l', points: ['d.p'] },
    },
    i18n: { en: { brief: 'Brief' } },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('input shapes', () => {
  it('sees a quote that is not an apostrophe', () => {
    expect(inputShapes("veste' OR '1'='1")).toContain('quote');
    expect(inputShapes("'")).toContain('quote');
    expect(inputShapes("l'avis d'un client")).not.toContain('quote');
    expect(inputShapes('it’s fine')).not.toContain('quote');
  });

  it('sees markup and a number below zero', () => {
    expect(inputShapes('nice <b>coat</b>')).toContain('markup');
    expect(inputShapes('1 < 2 and 3 > 2')).not.toContain('markup');
    expect(inputShapes('qty=-3')).toContain('negative');
    expect(inputShapes('-1')).toContain('negative');
    expect(inputShapes('size 38-40')).not.toContain('negative');
  });
});

describe('forms and tables', () => {
  it('draws them in the source', async () => {
    const g = await shop();
    const page = await run(g, 'curl https://www.shop.test/search');
    expect(page.out).toContain('<form method="post" action="/search">');
    expect(page.out).toContain('<input name="q">');
    expect(page.out).toContain('<tr><th>Size</th><th>Stock</th></tr>');
    expect(page.out).toContain('<tr><td>L</td><td><code>0</code></td></tr>');
  });

  it('answers a posted field in plain text, by the shape of the input', async () => {
    const g = await shop();
    const error = await run(g, `curl -d "q=coat'" https://www.shop.test/search`);
    expect(error.out).toBe('SQL error near "\'"\nline two\n');
    expect(g.log.findLast((e) => e.type === 'ChatReply')).toMatchObject({ npc: 'search', intent: 'error' });
    expect((await run(g, 'curl -d "q=coat" https://www.shop.test/search')).out).toBe('no result\n');
    expect((await run(g, 'curl -d "q=<b>x</b>" https://www.shop.test/search')).out).toBe('stored\n');
    expect((await run(g, 'curl -d "q=-2" https://www.shop.test/search')).out).toBe('refund\n');
  });
});

describe('form telemetry', () => {
  it('logs a submission as the application does, not as a conversation', async () => {
    const g = await shop();
    await run(g, `curl -d "q=coat'" https://www.shop.test/search`);
    const line = telemetry(g, { from: 0 }).find((l) => l.source === 'chat');
    expect(line?.text).toMatch(/www app: form=search src=10\.15\.0\.66 result=error input="coat'"$/);
    expect(line?.fields).toMatchObject({ npc: 'search', intent: 'error', form: true });
  });

  it('writes a rule with the names of that log', async () => {
    const g = await shop();
    const rule = { id: 'r', source: 'chat' as const, where: { npc: 'search', intent: 'error' } };
    const text = sigmaText(rule, 'Search errors', g.world);
    expect(text).toContain('service: application');
    expect(text).toContain('form: "search"');
    expect(text).toContain('result: "error"');
    expect(sigmaText(rule, 'Search errors')).toContain('product: chat-gateway');
  });
});

describe('route variants', () => {
  it('serves by cookie and by header', async () => {
    const g = await shop();
    expect((await run(g, 'curl https://www.shop.test/account')).out).toBe('sign in\n');
    expect((await run(g, 'curl -b "session=aaa" https://www.shop.test/account')).out).toBe('account 1042\n');
    expect((await run(g, 'curl -b "lang=fr; session=bbb" https://www.shop.test/account')).out).toBe(
      'account 1041\n',
    );
    expect((await run(g, 'curl -H "x-preview:staff" https://www.shop.test/account')).out).toBe('preview\n');
    expect((await run(g, 'curl -b "session=zzz" https://www.shop.test/account')).out).toBe('sign in\n');
    expect(g.log.filter((e) => e.type === 'HttpRequest').map((e) => e.variant)).toEqual([
      undefined,
      'mine',
      'other',
      'staff',
      undefined,
    ]);
  });

  it('closes a variant when the flaw is fixed', async () => {
    const g = await shop();
    g.emit({ type: 'ConfigPatched', key: 'session.random_ids', value: true, by: 'test' });
    expect((await run(g, 'curl -b "session=bbb" https://www.shop.test/account')).out).toBe('sign in\n');
    expect((await run(g, 'curl -b "session=aaa" https://www.shop.test/account')).out).toBe('account 1042\n');
  });
});

describe('a variant with only a condition', () => {
  it('answers every request while the condition holds, in the browser too', async () => {
    const g = await shop();
    expect((await run(g, 'curl https://www.shop.test/backup')).out).toBe('rows\n');
    g.emit({ type: 'ConfigPatched', key: 'bucket.private', value: true, by: 'test' });
    expect((await run(g, 'curl https://www.shop.test/backup')).out).toContain('AccessDenied');
    const page = g.browse('https://www.shop.test/backup');
    expect(page).toMatchObject({ ok: true, status: 403, page: { title: 'Denied' } });
    expect(g.log.filter((e) => e.type === 'HttpRequest').map((e) => e.variant)).toEqual([
      undefined,
      'denied',
      'denied',
    ]);
  });
});

describe('jq', () => {
  it('walks paths, arrays and pipes', async () => {
    const g = await shop();
    expect((await run(g, 'jq -r .token data.json')).out).toBe('abc\n');
    expect((await run(g, 'jq .token data.json')).out).toBe('"abc"\n');
    expect((await run(g, 'jq -r ".items[].name" data.json')).out).toBe('coat\nhat\n');
    expect((await run(g, 'jq ".items[1].price" data.json')).out).toBe('9\n');
    expect((await run(g, 'jq ".items | length" data.json')).out).toBe('2\n');
    expect((await run(g, 'jq -c keys data.json')).out).toBe('["items","token"]\n');
    expect((await run(g, 'cat data.json | jq -c ".items[0]"')).out).toBe('{"name":"coat","price":42}\n');
  });

  it('refuses what it does not know', async () => {
    const g = await shop();
    const bad = await run(g, 'jq "select(.a)" data.json');
    expect(bad.status).toBe(3);
    expect(bad.err).toContain('compile error');
    expect((await run(g, 'jq . cart.txt')).status).toBe(2);
    expect((await run(g, 'jq ".token.x" data.json')).err).toContain('Cannot index string');
  });
});

describe('jwt', () => {
  it('decodes and never signs', async () => {
    const g = await shop();
    const decoded = await run(g, `jwt decode ${TOKEN}`);
    expect(decoded.status).toBe(0);
    expect(decoded.out).toContain('"alg": "none"');
    expect(decoded.out).toContain('"sub": "1042"');
    expect((await run(g, 'jwt decode not-a-token')).status).not.toBe(0);
    expect((await run(g, `jwt sign ${TOKEN}`)).status).toBe(2);
    expect((await run(g, `jwt encode ${TOKEN}`)).status).toBe(2);
  });
});

describe('code review', () => {
  it('numbers the lines and judges by the pack', async () => {
    const g = await shop();
    const listing = await run(g, 'review cart.txt');
    expect(listing.out).toMatch(/2\s+two/);
    const before = g.state.mistakes;
    const wrong = await run(g, 'review cart.txt 1');
    expect(wrong.status).not.toBe(0);
    expect(g.state.mistakes).toBe(before + 1);
    expect((await run(g, 'review cart.txt 2')).status).toBe(0);
    expect(g.state.objectives.review).not.toBe(true);
    await run(g, 'review cart.txt 2');
    expect(g.state.reviewed.cart).toEqual([2]);
    await run(g, 'review cart.txt 4');
    expect(g.state.reviewed.cart).toEqual([2, 4]);
    expect(g.log.some((e) => e.type === 'ObjectiveCompleted' && e.objective === 'review')).toBe(true);
    expect((await run(g, 'review data.json 1')).out).toContain('review');
    expect((await run(g, 'review cart.txt 9')).status).not.toBe(0);
  });
});
