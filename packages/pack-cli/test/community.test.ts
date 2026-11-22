import { resolve } from 'node:path';
import { catalogSchema, verifySignature } from '@breach/pack-schema';
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
      'example.forgotten-backup',
      'example.pixel-world',
    ]);
    expect(catalog.packs[0]?.authors).toEqual(['BREACH team']);
    expect(files).toHaveLength(2);
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
});
