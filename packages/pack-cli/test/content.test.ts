import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  catalogSchema,
  checkPackSafety,
  isReservedDomain,
  isReservedIp,
  parsePack,
} from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { buildAll, checkAll, loadAll, replaySolution } from '../src/index.ts';

const packs = loadAll(resolve(import.meta.dirname, '../../../content'));
const world = packs.find((p) => p.pack.kind === 'world')!.pack;
const missions = packs.filter((p) => p.pack.kind === 'mission');

describe('official content', () => {
  it('is valid, translated and solvable', async () => {
    expect(await checkAll(packs)).toEqual([]);
  });

  it.each(missions.map((m) => [m.pack.id, m] as const))(
    '%s is finished by its solution without being detected',
    async (_id, m) => {
      for (const locale of m.pack.locales) {
        const result = await replaySolution(world, m.pack, m.solution!, locale);
        expect(result.done).toBe(true);
        expect(result.game.state.detections).toBe(0);
        expect(result.transcript).not.toContain('command not found');
      }
    },
  );

  it('mission 1 never leaves a guided player without a next step', async () => {
    const m1 = missions.find((m) => m.pack.id === 'breach.official.m01')!;
    const lines = ['dig novamind.test ANY', 'nmap -sn 10.13.0.0/24', 'curl https://www.novamind.test/'];
    const { game } = await replaySolution(world, m1.pack, lines, 'fr');
    expect(game.state.messages.at(-1)?.key).toBe('m1.ada.home');
  });

  it('guidance follows the objectives, even when the player goes off script', async () => {
    const m0 = missions.find((m) => m.pack.id === 'breach.official.m00')!;
    const m1 = missions.find((m) => m.pack.id === 'breach.official.m01')!;
    const keys = (g: { state: { messages: { key: string }[] } }) => g.state.messages.map((m) => m.key);
    // Mission 0 backwards: no advice for a step that is already done.
    const back = await replaySolution(
      world,
      m0.pack,
      [
        'dig novamind.test',
        'ping example.com',
        'cat mandat/NM-2026-114.txt',
        'submit FLAG{perimetre-novamind-test}',
      ],
      'fr',
    );
    expect(keys(back.game)).toEqual(['m0.ada.welcome', 'm0.ada.whoami', 'm0.ada.law']);
    // Mission 1: cloning straight away skips the steps that led to the repository.
    const direct = await replaySolution(
      world,
      m1.pack,
      [
        'dig novamind.test',
        'nmap -sn 10.13.0.0/24',
        'curl https://www.novamind.test/careers',
        'curl https://www.novamind.test/',
        'git clone https://git.novamind.test/novamind/nova-widget.git',
        'curl https://git.novamind.test/',
      ],
      'fr',
    );
    expect(keys(direct.game)).toEqual([
      'm1.ada.brief',
      'm1.ada.dns',
      'm1.ada.nmap',
      'm1.ada.scanning',
      'm1.ada.web',
      'm1.ada.careers',
      'm1.ada.history',
    ]);
  });

  it('every required objective opens with guidance in guided mode', async () => {
    for (const m of missions) {
      const { game } = await replaySolution(world, m.pack, m.solution!, 'fr');
      const said = new Set(game.state.messages.map((x) => x.key));
      for (const o of m.pack.mission!.objectives)
        if (!o.optional) expect(said.has(m.pack.mission!.guide[o.id]!), `${m.pack.id} ${o.id}`).toBe(true);
    }
  });

  it('compiles to gzipped packs and a valid catalogue', () => {
    const { catalog, files } = buildAll(packs, new Date(0));
    expect(catalogSchema.parse(catalog).campaign).toEqual(['breach.official.m00', 'breach.official.m01']);
    for (const f of files) expect(() => parsePack(JSON.parse(gunzipSync(f.bytes).toString()))).not.toThrow();
  });

  it('ships no flag in clear text', () => {
    for (const m of missions) expect(JSON.stringify(m.pack.mission)).not.toMatch(/FLAG\{/);
  });
});

describe('content safety', () => {
  it('accepts only reserved names and addresses', () => {
    expect(isReservedDomain('www.novamind.test')).toBe(true);
    expect(isReservedDomain('example.com')).toBe(true);
    expect(isReservedDomain('novamind.fr')).toBe(false);
    expect(isReservedIp('10.13.0.10')).toBe(true);
    expect(isReservedIp('203.0.113.7')).toBe(true);
    expect(isReservedIp('8.8.8.8')).toBe(false);
  });

  it('rejects a pack that points at a real target or carries a script', () => {
    const bad = structuredClone(world) as typeof world;
    bad.world!.hosts[1]!.hostname = 'www.real-company.com';
    bad.world!.hosts[2]!.ip = '93.184.216.34';
    bad.i18n.fr!['web.www.index'] = '<script>alert(1)</script> see https://evil.io/x';
    const problems = checkPackSafety(bad);
    expect(problems.join('\n')).toMatch(/www\.real-company\.com is not a reserved domain/);
    expect(problems.join('\n')).toMatch(/93\.184\.216\.34 is not in a reserved range/);
    expect(problems.join('\n')).toMatch(/script-like content/);
    expect(problems.join('\n')).toMatch(/evil\.io/);
    expect(() => parsePack(bad)).toThrow(/Invalid pack/);
  });

  it('rejects unknown fields, so nothing executable can be smuggled in', () => {
    const bad = structuredClone(missions[0]!.pack) as Record<string, any>;
    bad.mission.rules[0].do.push({ eval: 'alert(1)' });
    expect(() => parsePack(bad)).toThrow();
    const bad2 = structuredClone(missions[0]!.pack) as Record<string, any>;
    bad2.mission.script = 'x';
    expect(() => parsePack(bad2)).toThrow();
  });
});
