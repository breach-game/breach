/**
 * Pack loading: download on demand from a static catalogue, verify, validate, cache.
 * Official and community packs go through this same path.
 */
import { ENGINE_VERSION } from '@breach/engine';
import {
  type Catalog,
  type CatalogEntry,
  catalogSchema,
  isOfficialId,
  MAX_PACK_BYTES,
  type Pack,
  parsePack,
  verifySignature,
} from '@breach/pack-schema';
import { get, set } from 'idb-keyval';
import { COMMUNITY_CATALOG_URL, COMMUNITY_PUBLIC_KEY, UNSIGNED_COMMUNITY_CATALOG } from './community.ts';

export const CATALOG_URL = `${import.meta.env.BASE_URL}packs/`;

/** Checksums of the official packs this build was made with. Empty in development. */
const PINNED: Readonly<Record<string, string>> = __OFFICIAL_PACKS__;
const pinning = Object.keys(PINNED).length > 0;

/** The checksum the game itself expects for a catalogue entry, if this build pinned it. */
export function pinnedSha(entry: Pick<CatalogEntry, 'id' | 'version'>): string | undefined {
  return Object.hasOwn(PINNED, `${entry.id}@${entry.version}`)
    ? PINNED[`${entry.id}@${entry.version}`]
    : undefined;
}

/**
 * The catalogue next to the game no longer matches the packs this page was built with: the site was
 * updated after the page was loaded. Reloading the page brings the matching game.
 */
export class OutdatedBuildError extends Error {
  override name = 'OutdatedBuildError';
  constructor(id: string) {
    super(`${id}: this page is older than the packs online, reload it`);
  }
}

export interface PackProgress {
  entry: CatalogEntry;
  state: 'cached' | 'downloading' | 'verified';
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function gunzip(bytes: ArrayBuffer, limit: number): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Guard against decompression bombs.
    if (total > limit) throw new Error('pack is too large once decompressed');
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Does the engine satisfy a range such as ">=0.1 <1"? */
export function engineSatisfies(range: string, version = ENGINE_VERSION): boolean {
  const num = (v: string) => v.split('.').map((n) => Number(n) || 0);
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  return range
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => {
      const m = /^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/.exec(part);
      if (!m) return false;
      const c = cmp(num(version), num(m[2]!));
      return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[m[1] ?? '=']!;
    });
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const response = await fetch(`${CATALOG_URL}index.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`catalogue: HTTP ${response.status}`);
    const catalog = catalogSchema.parse(await response.json());
    void set('catalog', catalog).catch(() => {});
    return catalog;
  } catch (error) {
    // Offline: fall back to the last catalogue seen.
    const cached = await get<Catalog>('catalog').catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

/** Where a pack comes from: the game's own catalogue, or the signed community catalogue. */
export type PackSource = 'official' | 'community';

export async function loadPack(
  entry: CatalogEntry,
  onProgress?: (p: PackProgress) => void,
  source: PackSource = 'official',
): Promise<Pack> {
  if (!engineSatisfies(entry.engine))
    throw new Error(`${entry.id} needs engine ${entry.engine}, this is ${ENGINE_VERSION}`);
  // An official pack only ever comes from the game's own catalogue...
  if (source === 'community' && isOfficialId(entry.id))
    throw new Error(`${entry.id}: an official pack cannot come from the community catalogue, refused`);
  // ...and must be the very one this build was made with, whatever the catalogue says.
  const pinned = pinnedSha(entry);
  if (pinning && isOfficialId(entry.id) && pinned !== entry.sha256) {
    // From the game's own catalogue, a pack this build does not know is almost always a newer
    // release: the page was loaded before the site was updated. A reload settles it.
    if (source === 'official') throw new OutdatedBuildError(entry.id);
    throw new Error(`${entry.id}: not the official pack this game was built with, refused`);
  }
  const base = source === 'community' ? COMMUNITY_CATALOG_URL : CATALOG_URL;
  const key = `pack:${entry.sha256}`;
  let bytes = await get<ArrayBuffer>(key).catch(() => undefined);
  if (bytes) onProgress?.({ entry, state: 'cached' });
  else {
    onProgress?.({ entry, state: 'downloading' });
    // Revalidate with the host: GitHub Pages lets browsers reuse a file for ten minutes, and a pack
    // rebuilt under the same name would otherwise fail its pinned checksum after a redeploy.
    const response = await fetch(`${base}${entry.file}`, { cache: 'no-cache', credentials: 'omit' });
    if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  }
  if (bytes.byteLength > MAX_PACK_BYTES) throw new Error(`${entry.id}: pack is too large`);
  // The catalogue pins the exact bytes that were reviewed.
  if ((await sha256Hex(bytes)) !== entry.sha256)
    throw new Error(`${entry.id}: checksum mismatch, pack refused`);
  const pack = parsePack(JSON.parse(await gunzip(bytes, MAX_PACK_BYTES * 8)));
  if (pack.id !== entry.id || pack.version !== entry.version || pack.kind !== entry.kind)
    throw new Error(`${entry.id}: pack does not match its catalogue entry`);
  void set(key, bytes).catch(() => {});
  onProgress?.({ entry, state: 'verified' });
  return pack;
}

export interface Campaign {
  catalog: Catalog;
  world: Pack;
  missions: Pack[];
}

/** Load the official campaign: its world and every mission listed in the catalogue. */
export async function loadCampaign(onProgress?: (p: PackProgress) => void): Promise<Campaign> {
  const catalog = await loadCatalog();
  const entries = catalog.campaign
    .map((id) => catalog.packs.find((p) => p.id === id))
    .filter((e): e is CatalogEntry => !!e);
  const worldId = entries[0]?.requires[0];
  const worldEntry = catalog.packs.find((p) => p.id === worldId && p.kind === 'world');
  if (!worldEntry) throw new Error('catalogue has no world pack for the campaign');
  // The campaign is made of official packs only: a catalogue cannot slip another pack into it.
  for (const entry of [worldEntry, ...entries])
    if (pinning && pinnedSha(entry) === undefined) throw new OutdatedBuildError(entry.id);
  const world = await loadPack(worldEntry, onProgress);
  const missions: Pack[] = [];
  for (const entry of entries) missions.push(await loadPack(entry, onProgress));
  return { catalog, world, missions };
}

/* ---------- community missions ---------- */

/** Largest community catalogue the game reads: about a thousand packs. */
const MAX_CATALOG_BYTES = 1_000_000;
const COMMUNITY_KEY = 'community:catalog';

interface SignedCatalog {
  bytes: ArrayBuffer;
  signature: string;
}

/** Check the signature first, then the format. A community catalogue never speaks for official packs. */
async function readSigned({ bytes, signature }: SignedCatalog): Promise<Catalog> {
  if (!UNSIGNED_COMMUNITY_CATALOG && !(await verifySignature(bytes, signature, COMMUNITY_PUBLIC_KEY)))
    throw new Error('community catalogue: signature does not match, refused');
  const catalog = catalogSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return { ...catalog, campaign: [], packs: catalog.packs.filter((p) => !isOfficialId(p.id)) };
}

async function fetchSigned(): Promise<SignedCatalog> {
  const options: RequestInit = { cache: 'no-cache', credentials: 'omit' };
  const [index, sig] = await Promise.all([
    fetch(`${COMMUNITY_CATALOG_URL}index.json`, options),
    UNSIGNED_COMMUNITY_CATALOG ? null : fetch(`${COMMUNITY_CATALOG_URL}index.json.sig`, options),
  ]);
  if (!index.ok) throw new Error(`community catalogue: HTTP ${index.status}`);
  if (sig && !sig.ok) throw new Error(`community catalogue signature: HTTP ${sig.status}`);
  const bytes = await index.arrayBuffer();
  if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error('community catalogue is too large');
  return { bytes, signature: sig ? (await sig.text()).slice(0, 200) : '' };
}

/**
 * The community catalogue, downloaded only when the player opens the list. Its signature is checked
 * against the key compiled into the game, also when it comes from the cache. A catalogue older than
 * the last one seen is ignored, so an outdated copy cannot bring back a pack that was withdrawn.
 */
export async function loadCommunityCatalog(): Promise<Catalog> {
  const cached = await get<SignedCatalog>(COMMUNITY_KEY).catch(() => undefined);
  const known = cached ? await readSigned(cached).catch(() => undefined) : undefined;
  try {
    const signed = await fetchSigned();
    const catalog = await readSigned(signed);
    if (known && Date.parse(catalog.generatedAt) < Date.parse(known.generatedAt)) return known;
    void set(COMMUNITY_KEY, signed).catch(() => {});
    return catalog;
  } catch (error) {
    // Offline, or a catalogue that does not verify: keep the last good one.
    if (known) return known;
    throw error;
  }
}

/**
 * Load one community mission, or every mission of a community series, and the world they are played
 * in. The world is an official pack (from the game's own catalogue, pinned) or a community pack from
 * the same signed catalogue.
 */
export async function loadCommunityMission(
  entry: CatalogEntry,
  community: Catalog,
  onProgress?: (p: PackProgress) => void,
): Promise<Campaign> {
  if (entry.kind === 'world' || !community.packs.includes(entry))
    throw new Error(`${entry.id}: not a mission of the community catalogue`);
  const worldId = entry.requires[0] ?? '';
  let world: Pack;
  if (isOfficialId(worldId)) {
    const official = await loadCatalog();
    const worldEntry = official.packs.find((p) => p.id === worldId && p.kind === 'world');
    if (!worldEntry)
      throw new Error(`${entry.id} is played in ${worldId}, which this version of the game lacks`);
    world = await loadPack(worldEntry, onProgress, 'official');
  } else {
    const worldEntry = community.packs.find((p) => p.id === worldId && p.kind === 'world');
    if (!worldEntry) throw new Error(`${entry.id}: its world ${worldId} is not in the catalogue`);
    world = await loadPack(worldEntry, onProgress, 'community');
  }
  const entries = entry.kind === 'series' ? seriesMissions(entry, community) : [entry];
  if (!entries.length) throw new Error(`${entry.id}: the series has no mission in the catalogue`);
  const missions: Pack[] = [];
  for (const e of entries) {
    const mission = await loadPack(e, onProgress, 'community');
    if (!mission.mission || mission.requires[0] !== world.id)
      throw new Error(`${e.id}: the mission does not match its world`);
    missions.push(mission);
  }
  return { catalog: community, world, missions };
}

/**
 * Load an official season: a series of official missions played after the campaign, in its own
 * world and its own save. Everything is loaded as official, so the build's pinned fingerprints hold.
 */
export async function loadSeason(
  seriesId: string,
  onProgress?: (p: PackProgress) => void,
): Promise<Campaign> {
  const catalog = await loadCatalog();
  const series = catalog.packs.find((p) => p.id === seriesId && p.kind === 'series');
  if (!series || !catalog.seasons.includes(seriesId))
    throw new Error(`${seriesId}: not a season of this game`);
  const worldId = series.requires[0] ?? '';
  const worldEntry = catalog.packs.find((p) => p.id === worldId && p.kind === 'world');
  if (!worldEntry) throw new Error(`${seriesId}: its world ${worldId} is not in the catalogue`);
  const world = await loadPack(worldEntry, onProgress, 'official');
  const entries = seriesMissions(series, catalog);
  if (!entries.length) throw new Error(`${seriesId}: the series has no mission in the catalogue`);
  const missions: Pack[] = [];
  for (const e of entries) missions.push(await loadPack(e, onProgress, 'official'));
  return { catalog, world, missions };
}

/** The season series listed by the official catalogue, in catalogue order. */
export async function loadSeasons(): Promise<{ catalog: Catalog; seasons: CatalogEntry[] }> {
  const catalog = await loadCatalog();
  const seasons = catalog.seasons
    .map((id) => catalog.packs.find((p) => p.id === id && p.kind === 'series'))
    .filter((e): e is CatalogEntry => !!e);
  return { catalog, seasons };
}

/** The missions of a series, in playing order. A mission the catalogue lacks makes the series empty. */
export function seriesMissions(series: CatalogEntry, catalog: Catalog): CatalogEntry[] {
  const found = (series.missions ?? []).map((id) =>
    catalog.packs.find((p) => p.id === id && p.kind === 'mission' && p.requires[0] === series.requires[0]),
  );
  return found.every((e): e is CatalogEntry => !!e) ? found : [];
}
