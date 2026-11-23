import { resolve } from 'node:path';
import { loadAll } from '@breach/pack-cli';
import { BUNDLE_FORMAT, type Pack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { ImportRefused, localCatalog, localSaveKey, verifyBundle } from '../src/local.ts';

const official = loadAll(resolve(import.meta.dirname, '../../../content'));
const samples = loadAll(resolve(import.meta.dirname, '../../../packages/pack-cli/test/fixtures/community'));

/** The sample packs under another author's ids, as a player would bundle them. */
function renamed(prefix: string) {
  const swap = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value).replace(
        /example\.(atelier-pixel|closing-the-door|forgotten-backup|pixel-world)/g,
        `${prefix}.$1`,
      ),
    );
  return samples.map(({ pack, solution }) => ({ pack: swap(pack), solution }));
}

const ctx = (taken: string[] = []) => ({
  official: async (id: string) => official.find((p) => p.pack.id === id)?.pack,
  taken: new Set(taken),
});

const refusal = async (data: unknown, taken: string[] = []) => {
  try {
    await verifyBundle(data, ctx(taken));
  } catch (error) {
    if (error instanceof ImportRefused) return { step: error.step, text: error.problems.join('\n') };
    throw error;
  }
  return null;
};

describe('missions imported from a file', () => {
  it('accepts a bundle that passes the community checks, and lists it as not reviewed', async () => {
    const steps: string[] = [];
    const packs = await verifyBundle(
      { format: BUNDLE_FORMAT, packs: renamed('jdoe') },
      { ...ctx(), onStep: (s) => steps.push(s) },
    );
    expect(steps).toEqual(['schema', 'ids', 'replay']);
    const catalog = localCatalog({ sha256: 'a'.repeat(64), importedAt: '2026-11-23T12:00:00Z', packs });
    expect(catalog.packs.every((p) => !p.reviewed)).toBe(true);
    expect(catalog.packs.find((p) => p.kind === 'series')?.missions).toEqual([
      'jdoe.forgotten-backup',
      'jdoe.closing-the-door',
    ]);
    expect(localSaveKey({ id: 'jdoe.x', version: '1.0.0' }, 'abcdef0123456789')).toBe(
      'save:local:jdoe.x@1.0.0-abcdef012345',
    );
  }, 60_000);

  it('refuses a file that is not a bundle', async () => {
    expect(await refusal({ hello: 'world' })).toMatchObject({ step: 'schema' });
    expect(await refusal({ format: BUNDLE_FORMAT, packs: [] })).toMatchObject({ step: 'schema' });
  });

  it('refuses a pack that fails the schema or the safety checks', async () => {
    const packs = renamed('jdoe');
    const unsafe = JSON.parse(JSON.stringify(packs).replaceAll('mail.example', 'mail.fr'));
    expect(await refusal({ format: BUNDLE_FORMAT, packs: unsafe })).toMatchObject({
      step: 'schema',
      text: expect.stringMatching(/not a reserved domain/),
    });
  });

  it('refuses ids of the signed catalogue, official ids and dependencies it cannot resolve', async () => {
    expect(
      await refusal({ format: BUNDLE_FORMAT, packs: renamed('jdoe') }, ['jdoe.atelier-pixel']),
    ).toMatchObject({
      step: 'ids',
      text: expect.stringMatching(/belongs to a mission of the community catalogue/),
    });
    const missions = renamed('jdoe').filter((p) => (p.pack as Pack).kind === 'mission');
    expect(await refusal({ format: BUNDLE_FORMAT, packs: missions })).toMatchObject({
      step: 'ids',
      text: expect.stringMatching(/neither in the file nor an official pack/),
    });
    expect(await refusal({ format: BUNDLE_FORMAT, packs: renamed('breach') })).toMatchObject({
      text: expect.stringMatching(/reserved for the official packs/),
    });
  }, 60_000);

  it('refuses a mission its own solution does not finish', async () => {
    const packs = renamed('jdoe').map((p) => (p.solution ? { ...p, solution: p.solution.slice(0, 1) } : p));
    expect(await refusal({ format: BUNDLE_FORMAT, packs })).toMatchObject({
      step: 'replay',
      text: expect.stringMatching(/does not finish/),
    });
  }, 60_000);
});
