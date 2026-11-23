import { resolve } from 'node:path';
import { catalogSchema, checkPackSafety, packSchema, verifySignature } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { buildAll, checkAll, generateKeys, type LoadedPack, loadAll, signBytes } from '../src/index.ts';

const official = loadAll(resolve(import.meta.dirname, '../../../content'));
const community = loadAll(resolve(import.meta.dirname, 'fixtures/community'));

/** A copy of a loaded pack with some fields changed. */
const variant = (p: LoadedPack, change: Partial<LoadedPack['pack']>): LoadedPack => ({
  ...p,
  pack: { ...structuredClone(p.pack), ...change },
});

describe('community packs', () => {
  it('the sample packs pass the community checks', async () => {
    expect(await checkAll(community, { community: true, dependencies: official })).toEqual([]);
  });

  it('refuses the official prefix, odd ids and ids taken by a dependency', async () => {
    const world = community.find((p) => p.pack.kind === 'world')!;
    const problems = await checkAll(
      [
        variant(world, { id: 'breach.world.fake' }),
        variant(world, { id: 'nonamespace' }),
        variant(world, { id: 'example.pixel-world' }),
      ],
      { community: true, dependencies: [...official, world] },
    );
    expect(problems.join('\n')).toMatch(/reserved for the official packs/);
    expect(problems.join('\n')).toMatch(/a community id is "<your-name>.<pack-name>"/);
    expect(problems.join('\n')).toMatch(/already taken by another pack/);
  });

  it('a community mission can be played in the official world', async () => {
    const m01 = official.find((p) => p.pack.id === 'breach.official.m01')!;
    const mission = variant(m01, { id: 'jdoe.footprint-again' });
    expect(await checkAll([mission], { community: true, dependencies: official })).toEqual([]);
  });

  it('cannot require an official pack the game does not have', async () => {
    const mission = community.find((p) => p.pack.kind === 'mission')!;
    const problems = await checkAll([variant(mission, { requires: ['breach.world.nowhere'] })], {
      community: true,
      dependencies: official,
    });
    expect(problems.join('\n')).toMatch(/not an official pack/);
  });

  it('builds a catalogue without campaign, with authors', () => {
    const { catalog, files } = buildAll(community, new Date(0), { community: true });
    expect(catalogSchema.parse(catalog).campaign).toEqual([]);
    expect(catalog.packs.map((p) => p.id).sort()).toEqual([
      'example.atelier-pixel',
      'example.closing-the-door',
      'example.forgotten-backup',
      'example.pixel-world',
    ]);
    expect(catalog.packs[0]?.authors).toEqual(['BREACH team']);
    expect(files).toHaveLength(4);
  });

  it('lists a series with its missions in playing order', () => {
    const { catalog } = buildAll(community, new Date(0), { community: true });
    const series = catalogSchema.parse(catalog).packs.find((p) => p.kind === 'series');
    expect(series?.missions).toEqual(['example.forgotten-backup', 'example.closing-the-door']);
  });

  it('lists the estimated length, the incident year and the dates of each pack', () => {
    const timed = community.map((p) =>
      p.pack.kind === 'mission' ? variant(p, { minutes: p.pack.id.includes('backup') ? 10 : 15 }) : p,
    );
    const dates = Object.fromEntries(
      timed.map((p, i) => [p.pack.id, { added: `2026-11-0${i + 1}`, updated: `2026-11-1${i + 1}` }]),
    );
    const real = timed.map((p) => (p.pack.kind === 'series' ? variant(p, { incident: 2023 }) : p));
    const { catalog } = buildAll(real, new Date(0), { community: true, dates });
    const parsed = catalogSchema.parse(catalog);
    const series = parsed.packs.find((p) => p.kind === 'series')!;
    // A series without its own estimate adds up its missions'.
    expect(series.minutes).toBe(25);
    expect(series.incident).toBe(2023);
    // A series is as old as its oldest part, and as recent as its latest change.
    const own = [series.id, ...series.requires, ...(series.missions ?? [])].map((id) => dates[id]!);
    expect(series.added).toBe(own.map((d) => d.added).sort()[0]);
    expect(series.updated).toBe(
      own
        .map((d) => d.updated)
        .sort()
        .at(-1),
    );
    expect(parsed.packs.find((p) => p.id === 'example.forgotten-backup')?.minutes).toBe(10);
  });

  it('opens a catalogue that carries fields this game does not know', () => {
    const { catalog } = buildAll(community, new Date(0), { community: true });
    const later = { ...catalog, future: true, packs: catalog.packs.map((p) => ({ ...p, stars: 5 })) };
    expect(catalogSchema.parse(later).packs).toHaveLength(4);
  });

  it('refuses a series whose missions are missing, out of order or from another world', async () => {
    const series = community.find((p) => p.pack.kind === 'series')!;
    const others = community.filter((p) => p !== series);
    const check = async (packs: LoadedPack[]) =>
      (await checkAll(packs, { community: true, dependencies: official })).join('\n');
    const missing = variant(series, {
      series: { missions: ['example.forgotten-backup', 'example.nowhere'] },
    });
    expect(await check([...others, missing])).toMatch(/example.nowhere is not a mission pack/);
    const reversed = variant(series, {
      series: { missions: ['example.closing-the-door', 'example.forgotten-backup'] },
    });
    expect(await check([...others, reversed])).toMatch(/increasing `order` values/);
    const elsewhere = variant(series, { requires: ['breach.world.novamind'] });
    expect(await check([...others, elsewhere])).toMatch(/is played in example.pixel-world/);
  });
});

describe('catalogue signature', () => {
  const keys = generateKeys();
  const bytes = new TextEncoder().encode('{"format":0,"packs":[]}\n');
  const signature = signBytes(bytes, keys.privateKey);

  it('verifies with the matching public key', async () => {
    expect(await verifySignature(bytes, signature, keys.publicKey)).toBe(true);
  });

  it('refuses a changed byte, another key or a malformed signature', async () => {
    const tampered = bytes.slice();
    tampered[3] = tampered[3]! ^ 1;
    expect(await verifySignature(tampered, signature, keys.publicKey)).toBe(false);
    expect(await verifySignature(bytes, signature, generateKeys().publicKey)).toBe(false);
    expect(await verifySignature(bytes, 'not base64!', keys.publicKey)).toBe(false);
    expect(await verifySignature(bytes, signature.slice(4), keys.publicKey)).toBe(false);
  });

  it('only signs with a P-256 key', () => {
    expect(() => signBytes(bytes, 'not a key')).toThrow();
  });

  it('lets a debrief cite real sources as plain addresses, and nothing else name a real host', () => {
    const door = community.find((p) => p.pack.id === 'example.closing-the-door')!;
    const url = 'https://about.codecov.io/apr-2021-post-mortem/';
    const withSource = (label: string, address: string) => {
      const pack = structuredClone(door.pack);
      pack.mission!.debrief.facts = {
        title: 'cd.debrief.title',
        points: ['cd.debrief.p1'],
        sources: [{ label, url: address }],
      };
      return pack;
    };
    expect(packSchema.safeParse(withSource('Post-mortem', url)).success).toBe(true);
    expect(checkPackSafety(withSource('Post-mortem', url))).toEqual([]);
    expect(checkPackSafety(withSource('See about.codecov.io', url)).join()).toMatch(/not a reserved domain/);
    for (const bad of [
      'http://about.codecov.io/',
      'https://user:pw@about.codecov.io/',
      'https://about.codecov.io:8443/',
      'https://about.codecov.io/?q=1',
      'javascript:alert(1)',
    ])
      expect(packSchema.safeParse(withSource('Post-mortem', bad)).success, bad).toBe(false);
  });
});
