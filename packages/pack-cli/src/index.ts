import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Game, stripAnsi } from '@breach/engine';
import {
  type Catalog,
  type Locale,
  MAX_PACK_BYTES,
  PACK_FORMAT,
  type Pack,
  parsePack,
} from '@breach/pack-schema';
import { parse as parseYaml } from 'yaml';

export interface LoadedPack {
  dir: string;
  pack: Pack;
  solution: string[] | null;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const readYaml = (file: string): unknown => parseYaml(readFileSync(file, 'utf8'), { maxAliasCount: 0 });

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
  for (const part of ['world', 'mission'] as const) {
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
  const compiled = include(raw, dir) as { mission?: { flags?: Record<string, unknown>[] } };
  for (const flag of compiled.mission?.flags ?? []) {
    if (typeof flag.value === 'string') {
      flag.sha256 = sha256(flag.value.trim());
      delete flag.value;
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

export interface ReplayResult {
  done: boolean;
  transcript: string;
  game: Game;
}

/** Play a mission from its solution file. This is the proof that a pack can be finished. */
export async function replaySolution(
  world: Pack,
  mission: Pack,
  lines: string[],
  locale: Locale,
): Promise<ReplayResult> {
  const game = new Game({ world, missions: [mission], locale });
  game.startMission(mission.id);
  let transcript = '';
  for (const line of lines) {
    transcript += `$ ${line}\n`;
    for await (const chunk of game.exec(line, 20_000))
      if (chunk.k === 'out' || chunk.k === 'err') transcript += stripAnsi(chunk.text);
  }
  return { done: game.state.missionDone, transcript, game };
}

/** Every problem found in a set of packs: schema, dependencies, translations, solutions. */
export async function checkAll(packs: LoadedPack[]): Promise<string[]> {
  const problems: string[] = [];
  const byId = new Map(packs.map((p) => [p.pack.id, p]));
  for (const { pack, solution } of packs) {
    for (const dep of pack.requires)
      if (!byId.has(dep)) problems.push(`${pack.id}: missing required pack ${dep}`);
    const [first, ...others] = pack.locales;
    const keys = Object.keys(pack.i18n[first!] ?? {});
    for (const locale of others) {
      const have = new Set(Object.keys(pack.i18n[locale] ?? {}));
      for (const key of keys)
        if (!have.has(key)) problems.push(`${pack.id}: i18n key ${key} is missing in ${locale}`);
      for (const key of have)
        if (!keys.includes(key)) problems.push(`${pack.id}: i18n key ${key} is missing in ${first}`);
    }
    if (pack.kind !== 'mission') continue;
    const world = byId.get(pack.requires[0] ?? '')?.pack;
    if (!world?.world) {
      problems.push(`${pack.id}: its first requirement must be a world pack`);
      continue;
    }
    const known = (key: string) =>
      pack.locales.every((l) => (pack.i18n[l]?.[key] ?? world.i18n[l]?.[key]) !== undefined);
    const m = pack.mission!;
    const keysUsed = [
      m.briefing,
      m.debrief.title,
      m.debrief.lesson,
      ...m.debrief.points,
      ...m.objectives.map((o) => o.text),
      ...Object.values(m.hints).flat(),
    ];
    for (const rule of [...m.rules, ...world.world.rules])
      for (const effect of rule.do) {
        const key =
          (effect as Record<string, unknown>)['ada.say'] ??
          (effect as Record<string, unknown>)['ada.guide'] ??
          (effect as Record<string, unknown>)['ada.warn'] ??
          (effect as Record<string, unknown>)['note.add'];
        if (typeof key === 'string') keysUsed.push(key);
      }
    for (const key of keysUsed)
      if (!known(key)) problems.push(`${pack.id}: text key ${key} has no translation`);
    for (const flag of m.flags)
      if (flag.objective && !m.objectives.some((o) => o.id === flag.objective))
        problems.push(`${pack.id}: flag ${flag.id} points to unknown objective ${flag.objective}`);
    if (!solution) {
      problems.push(`${pack.id}: solution.txt is missing`);
      continue;
    }
    for (const locale of pack.locales) {
      const result = await replaySolution(world, pack, solution, locale);
      if (!result.done) {
        const open = m.objectives
          .filter((o) => !o.optional && !result.game.state.objectives[o.id])
          .map((o) => o.id);
        problems.push(
          `${pack.id}: solution.txt does not finish the mission in ${locale} (open: ${open.join(', ')})`,
        );
      }
    }
  }
  return problems;
}

export interface BuiltPack {
  file: string;
  bytes: Uint8Array;
}

/** Compile packs to `.breachpack` files (gzipped JSON) and their catalogue. */
export function buildAll(packs: LoadedPack[], now = new Date()): { catalog: Catalog; files: BuiltPack[] } {
  const files: BuiltPack[] = [];
  const entries: Catalog['packs'] = [];
  for (const { pack } of packs) {
    const bytes = gzipSync(Buffer.from(JSON.stringify(pack)), { level: 9 });
    if (bytes.length > MAX_PACK_BYTES)
      throw new Error(`${pack.id}: pack is larger than ${MAX_PACK_BYTES} bytes`);
    const file = `${pack.id}-${pack.version}.breachpack`;
    files.push({ file, bytes });
    entries.push({
      id: pack.id,
      version: pack.version,
      kind: pack.kind,
      engine: pack.engine,
      requires: pack.requires,
      title: pack.title,
      summary: pack.summary,
      order: pack.mission?.order,
      locales: pack.locales,
      file,
      sha256: sha256(bytes),
      size: bytes.length,
      reviewed: true,
    });
  }
  const campaign = packs
    .filter((p) => p.pack.kind === 'mission')
    .sort((a, b) => a.pack.mission!.order - b.pack.mission!.order)
    .map((p) => p.pack.id);
  return {
    catalog: { format: PACK_FORMAT, generatedAt: now.toISOString(), campaign, packs: entries },
    files,
  };
}
