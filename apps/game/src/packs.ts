/**
 * Pack loading: download on demand from a static catalogue, verify, validate, cache.
 * Official and community packs go through this same path.
 */
import { ENGINE_VERSION } from '@breach/engine';
import {
  type Catalog,
  type CatalogEntry,
  catalogSchema,
  MAX_PACK_BYTES,
  type Pack,
  parsePack,
} from '@breach/pack-schema';
import { get, set } from 'idb-keyval';

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

export async function loadPack(entry: CatalogEntry, onProgress?: (p: PackProgress) => void): Promise<Pack> {
  if (!engineSatisfies(entry.engine))
    throw new Error(`${entry.id} needs engine ${entry.engine}, this is ${ENGINE_VERSION}`);
  // An official pack must be the very one this build was made with, whatever the catalogue says.
  const pinned = pinnedSha(entry);
  if (pinning && entry.id.startsWith('breach.') && pinned !== entry.sha256)
    throw new Error(`${entry.id}: not the official pack this game was built with, refused`);
  const key = `pack:${entry.sha256}`;
  let bytes = await get<ArrayBuffer>(key).catch(() => undefined);
  if (bytes) onProgress?.({ entry, state: 'cached' });
  else {
    onProgress?.({ entry, state: 'downloading' });
    // Revalidate with the host: GitHub Pages lets browsers reuse a file for ten minutes, and a pack
    // rebuilt under the same name would otherwise fail its pinned checksum after a redeploy.
    const response = await fetch(`${CATALOG_URL}${entry.file}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  }
  if (bytes.byteLength > MAX_PACK_BYTES) throw new Error(`${entry.id}: pack is too large`);
  // The catalogue pins the exact bytes that were reviewed.
  if ((await sha256Hex(bytes)) !== entry.sha256)
    throw new Error(`${entry.id}: checksum mismatch, pack refused`);
  const pack = parsePack(JSON.parse(await gunzip(bytes, MAX_PACK_BYTES * 8)));
  if (pack.id !== entry.id || pack.version !== entry.version)
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
    if (pinning && pinnedSha(entry) === undefined)
      throw new Error(`${entry.id}: not an official pack of this build, refused in the campaign`);
  const world = await loadPack(worldEntry, onProgress);
  const missions: Pack[] = [];
  for (const entry of entries) missions.push(await loadPack(entry, onProgress));
  return { catalog, world, missions };
}
