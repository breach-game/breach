/**
 * Missions imported from a file. A `.breachbundle` holds an author's packs and their solutions; the
 * game checks it the way the community catalogue's CI does (schema, safety, community id rules, every
 * solution replayed) before keeping it on this computer. Nobody has reviewed its content, so it is
 * listed apart, flagged "not reviewed", and saved apart.
 */
import {
  bundleSchema,
  type Catalog,
  type CatalogEntry,
  catalogEntry,
  isOfficialId,
  MAX_BUNDLE_BYTES,
  MAX_PACK_BYTES,
  PACK_FORMAT,
  type Pack,
  parsePack,
} from '@breach/pack-schema';

/** A bundle kept on this computer. */
export interface LocalBundle {
  /** SHA-256 of the imported file: it names the bundle and its saves. */
  sha256: string;
  importedAt: string;
  packs: Pack[];
}

export type ImportStep = 'read' | 'schema' | 'ids' | 'replay';
export const IMPORT_STEPS: readonly ImportStep[] = ['read', 'schema', 'ids', 'replay'];

/** Why an import was refused: one line per problem, in the words of the checks. */
export class ImportRefused extends Error {
  override name = 'ImportRefused';
  constructor(
    readonly step: ImportStep,
    readonly problems: string[],
  ) {
    super(problems.join('\n'));
  }
}

export interface VerifyContext {
  /** An official world pack, from the game's own pinned catalogue. */
  official: (id: string) => Promise<Pack | undefined>;
  /** Ids already used by the signed community catalogue: a file cannot stand in for one of them. */
  taken: ReadonlySet<string>;
  onStep?: (step: ImportStep) => void;
}

const MAX_PROBLEMS = 12;

/**
 * Check the content of a bundle file (already decompressed and parsed as JSON) and return its packs.
 * Throws `ImportRefused` at the first step that fails.
 */
export async function verifyBundle(data: unknown, ctx: VerifyContext): Promise<Pack[]> {
  ctx.onStep?.('schema');
  const parsed = bundleSchema.safeParse(data);
  if (!parsed.success)
    throw new ImportRefused('schema', ['this file is not a BREACH bundle (breach-pack bundle)']);
  const loaded: { pack: Pack; solution: string[] | null; dir: string }[] = [];
  for (const [i, item] of parsed.data.packs.entries()) {
    try {
      // Same schema and same safety checks as a published pack: reserved domains and addresses,
      // no control characters, no code.
      loaded.push({ pack: parsePack(item.pack), solution: item.solution, dir: '' });
    } catch (error) {
      throw new ImportRefused('schema', [`pack ${i + 1}: ${(error as Error).message}`]);
    }
  }

  ctx.onStep?.('ids');
  const problems: string[] = [];
  const inside = new Set(loaded.map((p) => p.pack.id));
  for (const { pack } of loaded) {
    if (ctx.taken.has(pack.id))
      problems.push(`${pack.id}: this id belongs to a mission of the community catalogue`);
    for (const dep of pack.requires)
      if (!inside.has(dep) && !isOfficialId(dep))
        problems.push(`${pack.id}: requires ${dep}, which is neither in the file nor an official pack`);
  }
  if (!loaded.some((p) => p.pack.kind === 'mission')) problems.push('the file holds no mission to play');
  if (problems.length) throw new ImportRefused('ids', problems.slice(0, MAX_PROBLEMS));
  const dependencies = [];
  for (const id of new Set(loaded.flatMap((p) => p.pack.requires).filter((d) => !inside.has(d)))) {
    const pack = await ctx.official(id);
    if (!pack) throw new ImportRefused('ids', [`requires ${id}, which this version of the game lacks`]);
    dependencies.push({ pack, solution: null, dir: '' });
  }

  ctx.onStep?.('replay');
  // The community CI's own checks, solutions replayed in every language, in this browser.
  const { checkAll } = await import('@breach/pack-cli/check');
  const found = await checkAll(loaded, { community: true, dependencies });
  if (found.length) throw new ImportRefused('replay', found.slice(0, MAX_PROBLEMS));
  return loaded.map((p) => p.pack);
}

/** The entries a bundle adds to the store, as if it were a small catalogue of its own. */
export function localCatalog(bundle: LocalBundle): Catalog {
  const byId = new Map(bundle.packs.map((p) => [p.id, p]));
  return {
    format: PACK_FORMAT,
    generatedAt: bundle.importedAt,
    campaign: [],
    training: [],
    seasons: [],
    packs: bundle.packs.map((pack) =>
      catalogEntry(
        pack,
        { file: `${pack.id}-${pack.version}.breachpack`, sha256: bundle.sha256, size: 0 },
        byId,
        {
          reviewed: false,
          added: bundle.importedAt.slice(0, 10),
          updated: bundle.importedAt.slice(0, 10),
        },
      ),
    ),
  };
}

/** Where a local mission or series is saved: its id, version and the file it came from. */
export const localSaveKey = (entry: Pick<CatalogEntry, 'id' | 'version'>, sha256: string) =>
  `save:local:${entry.id}@${entry.version}-${sha256.slice(0, 12)}`;

export const LOCAL_LIMITS = { file: MAX_BUNDLE_BYTES, unpacked: MAX_PACK_BYTES * 8 } as const;
