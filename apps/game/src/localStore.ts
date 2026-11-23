/**
 * The missions imported from files, kept in IndexedDB on this computer only, and how they are loaded
 * to be played. The checks themselves live in `local.ts`.
 */
import { isOfficialId, type Pack, parsePack } from '@breach/pack-schema';
import { get, set } from 'idb-keyval';
import {
  ImportRefused,
  type ImportStep,
  LOCAL_LIMITS,
  type LocalBundle,
  localCatalog,
  verifyBundle,
} from './local.ts';
import {
  type Campaign,
  gunzip,
  loadCatalog,
  loadCommunityCatalog,
  loadPack,
  type PackProgress,
  sha256Hex,
} from './packs.ts';

const KEY = 'local:bundles';

/** Bundles kept on this computer. Each pack is checked again against the schema when read back. */
export async function localBundles(): Promise<LocalBundle[]> {
  const stored = await get<LocalBundle[]>(KEY).catch(() => undefined);
  if (!Array.isArray(stored)) return [];
  const out: LocalBundle[] = [];
  for (const b of stored) {
    try {
      out.push({ sha256: String(b.sha256), importedAt: String(b.importedAt), packs: b.packs.map(parsePack) });
    } catch {
      // A bundle this version of the game no longer accepts is left out.
    }
  }
  return out;
}

async function officialWorld(id: string, onProgress?: (p: PackProgress) => void): Promise<Pack | undefined> {
  if (!isOfficialId(id)) return undefined;
  const catalog = await loadCatalog();
  const entry = catalog.packs.find((p) => p.id === id && p.kind === 'world');
  return entry ? loadPack(entry, onProgress, 'official') : undefined;
}

/**
 * Import a `.breachbundle` file: read it within limits, check it as the community CI would, then keep
 * it. A new import of the same packs replaces the earlier one.
 */
export async function importBundle(file: File, onStep?: (step: ImportStep) => void): Promise<LocalBundle> {
  onStep?.('read');
  if (file.size > LOCAL_LIMITS.file) throw new ImportRefused('read', ['the file is too large for a bundle']);
  const bytes = await file.arrayBuffer();
  let data: unknown;
  try {
    data = JSON.parse(await gunzip(bytes, LOCAL_LIMITS.unpacked));
  } catch {
    throw new ImportRefused('read', ['this file is not a BREACH bundle (breach-pack bundle)']);
  }
  // Ids of the signed catalogue: offline, the last catalogue seen still counts.
  const community = await loadCommunityCatalog().catch(() => null);
  const packs = await verifyBundle(data, {
    official: (id) => officialWorld(id),
    taken: new Set(community?.packs.map((p) => p.id) ?? []),
    onStep,
  });
  const bundle: LocalBundle = { sha256: await sha256Hex(bytes), importedAt: new Date().toISOString(), packs };
  const ids = new Set(packs.map((p) => p.id));
  const kept = (await localBundles()).filter(
    (b) => b.sha256 !== bundle.sha256 && !b.packs.some((p) => ids.has(p.id)),
  );
  await set(KEY, [...kept, bundle]);
  return bundle;
}

/** Forget an imported bundle. Its saves stay, harmless, until the same file is imported again. */
export async function removeBundle(sha256: string): Promise<void> {
  const kept = (await localBundles()).filter((b) => b.sha256 !== sha256);
  await set(KEY, kept);
}

/** Load an imported mission, or every mission of an imported series, with the world they are played in. */
export async function loadLocalMission(
  id: string,
  sha256: string,
  onProgress?: (p: PackProgress) => void,
): Promise<Campaign & { pack: Pack }> {
  const bundle = (await localBundles()).find((b) => b.sha256 === sha256);
  const pack = bundle?.packs.find((p) => p.id === id);
  if (!bundle || !pack || pack.kind === 'world') throw new Error(`${id}: this imported mission is gone`);
  const worldId = pack.requires[0] ?? '';
  const world =
    bundle.packs.find((p) => p.id === worldId && p.kind === 'world') ??
    (await officialWorld(worldId, onProgress));
  if (!world) throw new Error(`${id}: its world ${worldId} is missing`);
  const ids = pack.series ? pack.series.missions : [pack.id];
  const missions = ids.map((m) => bundle.packs.find((p) => p.id === m && p.kind === 'mission'));
  if (missions.some((m) => !m || m.requires[0] !== world.id))
    throw new Error(`${id}: a mission does not match its world`);
  return { catalog: localCatalog(bundle), world, missions: missions as Pack[], pack };
}
