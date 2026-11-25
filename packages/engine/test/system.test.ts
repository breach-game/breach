import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { kubePath } from '../src/commands/infra.ts';
import { Game } from '../src/index.ts';
import { FilterError, filterMatches, parseFilter, underBase } from '../src/ldap.ts';
import { run } from './fixture.ts';

function world() {
  return parsePack({
    format: 0,
    id: 'test.ops',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Ops' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-11-08T09:00:00+01:00',
      mandate: 'T-9',
      scope: { domains: ['*.ops.test'], networks: ['10.18.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'desk.ops.test',
          ip: '10.18.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: {
            home: {
              kestrel: {
                '.kube': {
                  config:
                    'apiVersion: v1\nclusters:\n- cluster:\n    server: https://k8s.ops.test:6443\ncontexts:\n- context:\n    namespace: shop\nusers:\n- user:\n    token: "tok-ops-1"\n',
                },
              },
            },
          },
          system: {
            processes: [
              { pid: 1, ppid: 0, user: 'root', cmd: '/sbin/init' },
              { pid: 812, user: 'www-data', cmd: 'nginx: worker process', cpu: 0.3 },
              {
                pid: 4242,
                user: 'www-data',
                cmd: '/tmp/.x/miner --pool 10.18.0.99:3333',
                cpu: 97.5,
                if: { config: 'miner', eq: true },
              },
            ],
            sockets: [
              { local: '0.0.0.0:22', pid: 1 },
              {
                state: 'ESTAB',
                local: '10.18.0.66:51122',
                peer: '10.18.0.99:3333',
                pid: 4242,
                if: { config: 'miner', eq: true },
              },
            ],
            services: [
              {
                name: 'nginx',
                description: 'A high performance web server',
                since: 'Mon 2027-11-08 08:00:12 CET',
                pid: 812,
              },
              { name: 'backup', description: 'Nightly backup', state: 'failed', enabled: false },
            ],
            journal: [
              { at: 'Nov 08 08:00:12', unit: 'nginx', pid: 812, text: 'Started nginx.' },
              { at: 'Nov 08 03:00:00', unit: 'backup', text: 'backup.sh: disk full' },
            ],
            logins: [
              {
                user: 'deploy',
                from: '10.18.0.99',
                at: 'Mon Nov  8 09:12',
                if: { config: 'miner', eq: true },
              },
              { user: 'kestrel', from: '10.18.0.1', at: 'Mon Nov  8 08:30', until: '08:45  (00:15)' },
            ],
          },
        },
        {
          id: 'k8s',
          hostname: 'k8s.ops.test',
          ip: '10.18.0.10',
          map: { x: 1, z: 0 },
          services: [{ port: 6443, name: 'kubernetes' }],
          web: {
            '/api/v1/namespaces/shop/pods': {
              status: 403,
              body: '',
              variants: [
                {
                  id: 'token',
                  header: 'Authorization: Bearer tok-ops-1',
                  body: 'NAME     READY   STATUS    RESTARTS   AGE\nweb-1    1/1     Running   0          3d\n',
                },
              ],
            },
            '/api/v1/namespaces/shop/pods/web-1/log': { body: 'GET /health 200\n' },
          },
        },
        {
          id: 'dir',
          hostname: 'ldap.ops.test',
          ip: '10.18.0.20',
          map: { x: 1, z: 1 },
          services: [{ port: 389, name: 'ldap' }],
          directory: {
            base: 'dc=ops,dc=test',
            anonymous: { config: 'anon.open', eq: true },
            binds: [{ dn: 'cn=reader,dc=ops,dc=test', password: 'r3ad' }],
            entries: [
              {
                dn: 'uid=ana,ou=people,dc=ops,dc=test',
                attrs: {
                  objectClass: 'person',
                  uid: 'ana',
                  memberOf: 'cn=admins,ou=groups,dc=ops,dc=test',
                  mail: 'ana@ops.test',
                },
              },
              {
                dn: 'uid=bo,ou=people,dc=ops,dc=test',
                attrs: { objectClass: 'person', uid: 'bo', memberOf: ['cn=staff,ou=groups,dc=ops,dc=test'] },
              },
              {
                dn: 'uid=old,ou=people,dc=ops,dc=test',
                attrs: { objectClass: 'person', uid: 'old' },
                if: { config: 'old.removed', eq: false },
              },
            ],
          },
        },
        { id: 'c2', hostname: 'c2.ops.test', ip: '10.18.0.99', map: { x: 2, z: 2 } },
      ],
      dns: {
        'k8s.ops.test': { A: ['10.18.0.10'] },
        'ldap.ops.test': { A: ['10.18.0.20'] },
      },
      config: { miner: false, 'old.removed': false, 'checkout.v2': false, 'anon.open': false },
    },
    i18n: { en: {} },
  });
}

const base = {
  format: 0,
  version: '1.0.0',
  engine: '>=0.1',
  kind: 'mission',
  requires: ['test.ops'],
  authors: ['test'],
  locales: ['en'],
};
const debrief = { title: 'd', lesson: 'd', points: ['d'] };

function start(mission: Record<string, unknown>) {
  const m = parsePack({ ...base, id: 'test.ops.m', title: { en: 'M' }, mission, i18n: { en: {} } });
  const game = new Game({ world: world(), missions: [m], locale: 'en' });
  game.startMission(m.id);
  return game;
}

const attack = (extra: Record<string, unknown> = {}) =>
  start({
    order: 1,
    stage: 'recon',
    briefing: 'b',
    objectives: [{ id: 'o', text: 'o' }],
    flags: [],
    debrief,
    ...extra,
  });

describe('what a host runs', () => {
  it('lists processes, sockets, services, the journal and logins, following the settings', async () => {
    const g = attack({
      systems: { me: { processes: [{ pid: 900, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D' }] } },
    });
    let ps = await run(g, 'ps aux');
    expect(ps.out).toContain('nginx: worker process');
    expect(ps.out).toContain('sshd: /usr/sbin/sshd -D');
    expect(ps.out).not.toContain('miner');
    g.emit({ type: 'ConfigPatched', key: 'miner', value: true, by: 'test' });
    ps = await run(g, 'ps aux');
    expect(ps.out).toMatch(/www-data\s+4242\s+97\.5/);
    expect((await run(g, 'ps -ef')).out).toContain('/tmp/.x/miner');
    expect((await run(g, 'ss -tnp')).out).toMatch(/ESTAB.*10\.18\.0\.99:3333.*miner/);
    expect((await run(g, 'ss -tln')).out).not.toContain('3333');
    const st = await run(g, 'systemctl status nginx');
    expect(st.out).toContain('Active: active (running)');
    expect((await run(g, 'systemctl status backup')).out).toContain('failed');
    expect((await run(g, 'systemctl stop nginx')).status).not.toBe(0);
    expect((await run(g, 'journalctl -u backup')).out).toContain('disk full');
    expect((await run(g, 'journalctl -u nginx')).out).not.toContain('disk full');
    const last = await run(g, 'last');
    expect(last.out.indexOf('deploy')).toBeLessThan(last.out.indexOf('kestrel'));
    expect((await run(g, 'last kestrel')).out).not.toContain('deploy');
    expect(g.log.some((e) => e.type === 'SystemRead')).toBe(true);
  });

  it('lets an attacker step change what runs', async () => {
    const g = start({
      side: 'defense',
      order: 1,
      stage: 'triage',
      briefing: 'b',
      objectives: [{ id: 'o', text: 'o' }],
      flags: [],
      questions: [
        {
          id: 'q',
          text: 'q',
          objective: 'o',
          options: [
            { id: 'a', text: 'a' },
            { id: 'b', text: 'b' },
          ],
        },
      ],
      adversary: {
        id: 'x',
        name: 'Miner',
        from: 'c2',
        pace: 1,
        steps: [
          {
            id: 'drop',
            host: 'me',
            source: 'flow',
            fields: { dst: '10.18.0.99', dport: 3333, bytes: 5000 },
            sets: { miner: true },
          },
          {
            id: 'more',
            host: 'me',
            source: 'flow',
            fields: { dst: '10.18.0.99', dport: 3333, bytes: 7000 },
          },
        ],
      },
      guide: { o: 'g' },
      debrief,
    });
    expect((await run(g, 'ps aux')).out).not.toContain('miner');
    expect((await run(g, 'ps aux')).out).toContain('miner');
    const f = await run(g, 'flows --port 3333');
    expect(f.out).toMatch(/10\.18\.0\.99\s+3333\s+allow\s+2\s+12000/);
    expect((await run(g, 'flows --action deny')).status).toBe(1);
  });
});

describe('ldapsearch', () => {
  it('parses RFC 4515 filters and matches them', () => {
    const f = parseFilter('(&(objectClass=person)(memberOf=cn=admins,*))');
    expect(f.op).toBe('and');
    expect(parseFilter('uid=ana')).toEqual({ op: 'eq', attr: 'uid', value: 'ana' });
    expect(() => parseFilter('(&)')).toThrow(FilterError);
    expect(() => parseFilter('(uid=a')).toThrow(FilterError);
    const entry = { dn: 'uid=ana,dc=t', attrs: { uid: 'Ana', mail: ['a@t'] } };
    expect(filterMatches(entry, parseFilter('(UID=ana)'))).toBe(true);
    expect(filterMatches(entry, parseFilter('(!(mail=*))'))).toBe(false);
    expect(filterMatches(entry, parseFilter('(uid=a*a)'))).toBe(true);
    expect(filterMatches(entry, parseFilter('(uid=an*na)'))).toBe(false);
    expect(underBase('uid=a, ou=p,DC=t', 'dc=t')).toBe(true);
    expect(underBase('uid=a,dc=tt', 'dc=t')).toBe(false);
  });

  it('needs a listed account, then answers from the declared directory', async () => {
    const g = attack();
    const anon = await run(g, 'ldapsearch -x -H ldap://ldap.ops.test');
    expect(anon.out).toContain('50 Insufficient access');
    const bad = await run(g, 'ldapsearch -x -H ldap://ldap.ops.test -D cn=reader,dc=ops,dc=test -w nope');
    expect(bad.status).toBe(49);
    expect(bad.err).toContain('Invalid credentials (49)');
    const ok = await run(
      g,
      'ldapsearch -x -H ldap://ldap.ops.test -D cn=reader,dc=ops,dc=test -w r3ad -b ou=people,dc=ops,dc=test "(memberOf=cn=admins*)" uid mail',
    );
    expect(ok.status).toBe(0);
    expect(ok.out).toContain('dn: uid=ana,ou=people,dc=ops,dc=test');
    expect(ok.out).toContain('mail: ana@ops.test');
    expect(ok.out).not.toContain('memberOf:');
    expect(ok.out).toContain('# numEntries: 1');
    const all = await run(
      g,
      'ldapsearch -LLL -x -H ldap://ldap.ops.test -D cn=reader,dc=ops,dc=test -w r3ad uid=*',
    );
    expect(all.out.match(/^dn:/gm)).toHaveLength(3);
    g.emit({ type: 'ConfigPatched', key: 'old.removed', value: true, by: 'test' });
    const after = await run(
      g,
      'ldapsearch -LLL -x -H ldap://ldap.ops.test -D cn=reader,dc=ops,dc=test -w r3ad uid=*',
    );
    expect(after.out.match(/^dn:/gm)).toHaveLength(2);
    expect(
      (await run(g, 'ldapsearch -x -H ldap://ldap.ops.test -D cn=reader,dc=ops,dc=test -w r3ad "(uid=a"'))
        .err,
    ).toContain('Bad search filter');
    expect((await run(g, 'ldapsearch -x -H ldap://ldap.example.com')).status).toBe(9);
    // Anonymous search can follow a setting.
    g.emit({ type: 'ConfigPatched', key: 'anon.open', value: true, by: 'test' });
    expect((await run(g, 'ldapsearch -LLL -x -H ldap://ldap.ops.test uid=ana uid')).out).toContain(
      'uid: ana',
    );
  });
});

describe('kubectl', () => {
  it('maps resources to API paths', () => {
    expect(kubePath({ plural: 'pods', group: '', namespaced: true }, 'shop', 'web-1')).toBe(
      '/api/v1/namespaces/shop/pods/web-1',
    );
    expect(
      kubePath({ plural: 'clusterroles', group: 'rbac.authorization.k8s.io', namespaced: false }, 'x'),
    ).toBe('/apis/rbac.authorization.k8s.io/v1/clusterroles');
  });

  it('reads the kubeconfig, sends the token and serves the route', async () => {
    const g = attack();
    const pods = await run(g, 'kubectl get pods');
    expect(pods.status).toBe(0);
    expect(pods.out).toContain('web-1');
    const anon = await run(g, 'kubectl get pods --token wrong');
    expect(anon.status).toBe(1);
    expect(anon.err).toContain('Forbidden');
    expect((await run(g, 'kubectl logs web-1')).out).toContain('GET /health 200');
    expect((await run(g, 'kubectl get widgets')).err).toContain("doesn't have a resource type");
    expect((await run(g, 'kubectl get pods --server https://k8s.example.com')).status).toBe(9);
  });
});

describe('deploy, rollback and flags', () => {
  const ops = () =>
    attack({
      releases: [
        {
          service: 'checkout',
          current: '1.4.0',
          versions: [
            { version: '1.4.0', sets: { 'checkout.v2': false } },
            { version: '2.0.0', sets: { 'checkout.v2': true }, impact: 5 },
          ],
        },
      ],
      toggles: [{ name: 'new-cart', value: 'on', off: { miner: false }, on: { miner: true }, impact: 2 }],
    });

  it('changes the settings like a fix, and counts its impact', async () => {
    const g = ops();
    expect((await run(g, 'deploy')).out).toContain('1.4.0*');
    expect((await run(g, 'deploy checkout 2.0.0')).out).toContain('1.4.0 → 2.0.0');
    expect(g.state.config['checkout.v2']).toBe(true);
    expect((await run(g, 'deploy checkout 2.0.0')).status).toBe(1);
    expect((await run(g, 'deploy checkout 9.9')).status).toBe(1);
    expect((await run(g, 'rollback checkout')).out).toContain('2.0.0 → 1.4.0');
    expect(g.state.config['checkout.v2']).toBe(false);
    expect((await run(g, 'rollback checkout')).status).toBe(1);
    // With no deployment of its own, a rollback goes to the version listed before the running one.
    const g2 = attack({
      releases: [
        {
          service: 'checkout',
          current: '2.0.0',
          versions: [
            { version: '1.4.0', sets: { 'checkout.v2': false } },
            { version: '2.0.0', sets: { 'checkout.v2': true } },
          ],
        },
      ],
    });
    expect((await run(g2, 'rollback checkout')).out).toContain('2.0.0 → 1.4.0');
    expect(g2.state.config['checkout.v2']).toBe(false);
    expect((await run(g, 'flag list')).out).toMatch(/new-cart\s+on/);
    await run(g, 'flag set new-cart off');
    expect(g.state.config.miner).toBe(false);
    expect((await run(g, 'flag list')).out).toMatch(/new-cart\s+off/);
    expect((await run(g, 'flag set nope on')).status).toBe(1);
    expect(g.state.impact).toBe(5 + 2);
    // Switching back to the starting value costs nothing.
    await run(g, 'flag set new-cart on');
    expect(g.state.impact).toBe(5 + 2);
    // The settings change before the event, so a rule on `ToggleSet` or `Deployed` sees the new state.
    const types = g.log.map((e) => e.type);
    expect(types.lastIndexOf('ConfigPatched')).toBeLessThan(types.lastIndexOf('ToggleSet'));
  });
});

describe('timelines and paths', () => {
  const inquiry = () =>
    attack({
      objectives: [
        { id: 'order', text: 'o' },
        { id: 'trace', text: 'o' },
      ],
      timelines: [
        {
          id: 'night',
          text: 'tl',
          objective: 'order',
          events: [
            { id: 'phish', text: 'e1' },
            { id: 'login', text: 'e2' },
            { id: 'exfil', text: 'e3' },
          ],
        },
      ],
      paths: [{ id: 'route', text: 'p', hosts: ['c2', 'me', 'dir'], objective: 'trace' }],
    });

  it('judges an order by id, never shows the right one, and counts mistakes', async () => {
    const g = inquiry();
    const shown = g.timelineEvents('night')?.map((e) => e.id);
    expect(shown).not.toEqual(['phish', 'login', 'exfil']);
    expect((await run(g, 'timeline night login phish exfil')).status).toBe(1);
    expect((await run(g, 'timeline night phish login nope')).err).toContain('nope');
    expect((await run(g, 'timeline night phish login exfil')).status).toBe(0);
    expect(g.state.objectives.order).toBe(true);
    expect((await run(g, 'timeline night phish login exfil')).out).not.toContain('✔');
    expect((await run(g, 'path route c2 dir desk')).status).toBe(1);
    expect((await run(g, 'path route c2 nowhere')).err).toContain('nowhere');
    expect((await run(g, 'path route 10.18.0.99 desk.ops.test ldap')).status).toBe(0);
    expect(g.state.objectives.trace).toBe(true);
    expect(g.state.mistakes).toBe(2);
  });
});
