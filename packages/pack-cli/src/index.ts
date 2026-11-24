import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { normalizeAnswer } from '@breach/engine';
import {
  BUNDLE_FORMAT,
  type Bundle,
  type Catalog,
  catalogEntry,
  MAX_BUNDLE_BYTES,
  MAX_PACK_BYTES,
  PACK_FORMAT,
  type Pack,
  parsePack,
} from '@breach/pack-schema';
import { parse as parseYaml } from 'yaml';
import type { LoadedPack } from './check.ts';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const readYaml = (file: string): unknown => parseYaml(readFileSync(file, 'utf8'), { maxAliasCount: 100 });

/** Replace `{ $file: "relative/path" }` by the content of that file. Paths cannot leave the pack. */
function include(value: unknown, dir: string): unknown {
  if (Array.isArray(value)) return value.map((v) => include(v, dir));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$file === 'string' && Object.keys(obj).length === 1) {
      const file = resolve(dir, obj.$file);
      if (!file.startsWith(resolve(dir) + sep)) throw new Error(`$file ${obj.$file} is outside the pack`);
      return readFileSync(file, 'utf8');
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, include(v, dir)]));
  }
  return value;
}

/** Read a pack's source directory and return the validated, compiled pack. */
export function loadPack(dir: string): LoadedPack {
  const raw = readYaml(join(dir, 'pack.yaml')) as Record<string, unknown>;
  for (const part of ['world', 'mission', 'series', 'path'] as const) {
    const file = join(dir, `${part}.yaml`);
    if (existsSync(file)) raw[part] = readYaml(file);
  }
  const i18nDir = join(dir, 'i18n');
  if (existsSync(i18nDir)) {
    const i18n: Record<string, unknown> = {};
    for (const file of readdirSync(i18nDir)) {
      const m = /^([a-z]{2})\.ya?ml$/.exec(file);
      if (m) i18n[m[1]!] = readYaml(join(i18nDir, file));
    }
    raw.i18n = i18n;
  }
  raw.format ??= PACK_FORMAT;
  const compiled = include(raw, dir) as {
    mission?: { flags?: Record<string, unknown>[]; investigation?: Record<string, unknown>[] };
  };
  for (const flag of compiled.mission?.flags ?? []) {
    if (typeof flag.value === 'string') {
      flag.sha256 = sha256(flag.value.trim());
      delete flag.value;
    }
  }
  // Answers are compared the way the game normalises them: trimmed, lower case.
  for (const question of compiled.mission?.investigation ?? []) {
    if (typeof question.value === 'string') {
      question.sha256 = sha256(normalizeAnswer(question.value));
      delete question.value;
    }
  }
  let pack: Pack;
  try {
    pack = parsePack(compiled);
  } catch (error) {
    throw new Error(`${dir}: ${(error as Error).message}`);
  }
  const solutionFile = join(dir, 'solution.txt');
  const solution = existsSync(solutionFile)
    ? readFileSync(solutionFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : null;
  return { dir, pack, solution };
}

export function findPacks(root: string, depth = 3): string[] {
  if (existsSync(join(root, 'pack.yaml'))) return [root];
  if (depth === 0) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((p) => statSync(p).isDirectory())
    .flatMap((p) => findPacks(p, depth - 1))
    .sort();
}

export function loadAll(root: string): LoadedPack[] {
  return findPacks(root).map(loadPack);
}

export interface BuiltPack {
  file: string;
  bytes: Uint8Array;
}

/**
 * Compile packs to `.breachpack` files (gzipped JSON) and their catalogue. A community catalogue has
 * no campaign: its missions are played one at a time.
 */
export function buildAll(
  packs: LoadedPack[],
  now = new Date(),
  options: {
    community?: boolean;
    /** First and last day each pack changed, by id (from git, for the community catalogue). */
    dates?: Record<string, { added: string; updated: string }>;
  } = {},
): { catalog: Catalog; files: BuiltPack[] } {
  const files: BuiltPack[] = [];
  const entries: Catalog['packs'] = [];
  const byId = new Map(packs.map((p) => [p.pack.id, p.pack]));
  for (const { pack } of packs) {
    // A series changes when its world or one of its missions does.
    const related = pack.series ? [pack.id, ...pack.requires, ...pack.series.missions] : [pack.id];
    const known = related.map((id) => options.dates?.[id]).filter((d) => !!d);
    const dates = known.length
      ? {
          added: known.map((d) => d.added).sort()[0]!,
          updated: known
            .map((d) => d.updated)
            .sort()
            .at(-1)!,
        }
      : undefined;
    const bytes = gzipSync(Buffer.from(JSON.stringify(pack)), { level: 9 });
    if (bytes.length > MAX_PACK_BYTES)
      throw new Error(`${pack.id}: pack is larger than ${MAX_PACK_BYTES} bytes`);
    const file = `${pack.id}-${pack.version}.breachpack`;
    files.push({ file, bytes });
    entries.push(
      catalogEntry(pack, { file, sha256: sha256(bytes), size: bytes.length }, byId, {
        reviewed: true,
        ...dates,
      }),
    );
  }
  const track = (name: Pack['track']) =>
    options.community
      ? []
      : packs
          .filter((p) => p.pack.kind === 'mission' && p.pack.track === name)
          .sort(
            (a, b) =>
              (name === 'training' ? (a.pack.difficulty ?? 1) - (b.pack.difficulty ?? 1) : 0) ||
              a.pack.mission!.order - b.pack.mission!.order,
          )
          .map((p) => p.pack.id);
  return {
    catalog: {
      format: PACK_FORMAT,
      generatedAt: now.toISOString(),
      campaign: track('campaign'),
      training: track('training'),
      seasons: options.community
        ? []
        : packs
            .filter((p) => p.pack.kind === 'series')
            .map((p) => p.pack.id)
            .sort(),
      packs: entries,
    },
    files,
  };
}

/** Gather packs and their solutions into one `.breachbundle` file, for players to import. */
export function bundle(packs: LoadedPack[]): Uint8Array {
  const data: Bundle = {
    format: BUNDLE_FORMAT,
    packs: packs.map(({ pack, solution }) => ({ pack, solution })),
  };
  const bytes = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
  if (bytes.length > MAX_BUNDLE_BYTES) throw new Error(`the bundle is larger than ${MAX_BUNDLE_BYTES} bytes`);
  return bytes;
}

export {
  type CheckOptions,
  checkAll,
  defenseProblems,
  type LoadedPack,
  type ReplayResult,
  replaySolution,
} from './check.ts';
export { generateKeys, type KeyPair, signBytes } from './sign.ts';
