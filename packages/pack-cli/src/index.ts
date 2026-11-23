import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Game, normalizeAnswer, runDetection, selects, stripAnsi } from '@breach/engine';
import {
  type Catalog,
  isOfficialId,
  type Locale,
  MAX_PACK_BYTES,
  type Npc,
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
  for (const part of ['world', 'mission', 'series'] as const) {
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

/**
 * The defence replay must teach the right thing on the solution's own logs: the correct rule
 * catches the attack without false alarm, every wrong rule visibly misfires or misses, the correct
 * fix stops the replayed attack and no wrong fix does.
 */
export async function defenseProblems(game: Game): Promise<string[]> {
  const d = game.mission?.defense;
  if (!d) return [];
  const problems: string[] = [];
  game.startDefense();
  const lines = game.socLines();
  const mine = lines.filter((l) => l.actor !== 'background');
  d.find.forEach((f, i) => {
    if (!mine.some((l) => selects(l, f.source, f.where)))
      problems.push(`defense: find[${i}] matches none of the solution's log lines`);
  });
  for (const rule of d.rules) {
    const r = runDetection(rule, lines);
    if (rule.correct && (r.caught === 0 || r.falsePositives > 0))
      problems.push(
        `defense: correct rule ${rule.id} should catch the solution without false positive (caught ${r.caught}, false positives ${r.falsePositives})`,
      );
    if (!rule.correct && r.caught > 0 && r.falsePositives === 0)
      problems.push(`defense: wrong rule ${rule.id} catches the solution without any false positive`);
  }
  for (const fix of d.fixes) {
    const report = await game.replayWith(fix);
    if (fix.correct && !report.blocked)
      problems.push(`defense: correct fix ${fix.id} does not stop the solution`);
    if (!fix.correct && report.blocked) problems.push(`defense: wrong fix ${fix.id} stops the solution`);
  }
  return problems;
}

/** A text that names a translation, as opposed to a short literal such as a product name. */
const looksLikeKey = (text: string) => /^[a-z0-9]+(\.[A-Za-z0-9_-]+)+$/.test(text);

function npcTexts(npc: Npc): string[] {
  return [
    npc.role,
    ...(npc.greeting ? [npc.greeting] : []),
    ...npc.fallback,
    ...npc.intents.flatMap((i) => i.reply),
  ];
}

function npcProblems(npc: Npc): string[] {
  const problems: string[] = [];
  const seen = new Set<string>(['fallback']);
  for (const intent of npc.intents) {
    if (seen.has(intent.id)) problems.push(`character ${npc.id}: intent id ${intent.id} is used twice`);
    seen.add(intent.id);
    if (!intent.words.length && !intent.families.length && !intent.if)
      problems.push(`character ${npc.id}: intent ${intent.id} matches every message, use fallback instead`);
  }
  return problems;
}

/** Texts and references of a world's pages and characters. */
function worldProblems(pack: Pack): string[] {
  const problems: string[] = [];
  const w = pack.world!;
  const npcs = new Set(w.npcs.map((n) => n.id));
  const texts: string[] = [];
  const hostIds = new Set(w.hosts.map((h) => h.id));
  for (const host of w.hosts)
    for (const login of host.ssh)
      for (const from of login.from)
        if (!hostIds.has(from))
          problems.push(`${host.hostname}: ssh login ${login.user} comes from unknown host ${from}`);
  for (const host of w.hosts)
    for (const [path, route] of Object.entries(host.web ?? {})) {
      const where = `${host.hostname}${path}`;
      if (route.chat && !npcs.has(route.chat)) problems.push(`${where}: unknown character ${route.chat}`);
      if (!route.page) continue;
      texts.push(route.page.title);
      for (const block of route.page.blocks) {
        if ('chat' in block) {
          if (!npcs.has(block.chat)) problems.push(`${where}: unknown character ${block.chat}`);
          continue;
        }
        const links = 'nav' in block ? block.nav : 'link' in block ? [block.link] : [];
        for (const l of links) {
          texts.push(l.label);
          if (!/^(\/|https?:\/\/)/.test(l.href))
            problems.push(`${where}: link ${l.href} must be a path or a URL`);
        }
        if ('list' in block) texts.push(...block.list);
        for (const value of Object.values(block)) if (typeof value === 'string') texts.push(value);
      }
    }
  for (const npc of w.npcs) {
    texts.push(...npcTexts(npc));
    problems.push(...npcProblems(npc));
  }
  for (const key of new Set(texts.filter(looksLikeKey)))
    for (const locale of pack.locales)
      if (pack.i18n[locale]?.[key] === undefined)
        problems.push(`text key ${key} has no translation in ${locale}`);
  return problems.map((p) => `${pack.id}: ${p}`);
}

/**
 * A series holds together: its missions exist, share its world, are numbered in playing order, and
 * their solutions finish one after the other in a single game, as the player will play them.
 */
async function seriesProblems(pack: Pack, byId: Map<string, LoadedPack>): Promise<string[]> {
  const problems: string[] = [];
  const worldId = pack.requires[0] ?? '';
  const world = byId.get(worldId)?.pack;
  if (!world?.world) return [`${pack.id}: its first requirement must be a world pack`];
  const missions: LoadedPack[] = [];
  for (const id of pack.series!.missions) {
    const m = byId.get(id);
    if (!m || m.pack.kind !== 'mission') problems.push(`${pack.id}: ${id} is not a mission pack`);
    else if (m.pack.requires[0] !== worldId)
      problems.push(`${pack.id}: ${id} is played in ${m.pack.requires[0]}, not in ${worldId}`);
    else missions.push(m);
  }
  for (const locale of pack.locales)
    for (const m of missions)
      if (!m.pack.locales.includes(locale)) problems.push(`${pack.id}: ${m.pack.id} has no ${locale} text`);
  if (problems.length) return problems;
  const orders = missions.map((m) => m.pack.mission!.order);
  if (orders.some((o, i) => i > 0 && o <= orders[i - 1]!))
    problems.push(`${pack.id}: its missions must have increasing \`order\` values, in the order listed`);
  if (missions.some((m) => !m.solution) || problems.length) return problems;
  for (const locale of pack.locales) {
    const game = new Game({ world, missions: missions.map((m) => m.pack), locale });
    for (const m of missions) {
      game.startMission(m.pack.id);
      for (const line of m.solution!) for await (const _ of game.exec(line, 20_000));
      if (!game.state.missionDone) {
        problems.push(
          `${pack.id}: ${m.pack.id} does not finish when played after the missions before it (${locale})`,
        );
        break;
      }
    }
  }
  return problems;
}

export interface CheckOptions {
  /**
   * Packs that are only there to resolve dependencies (the official world, for a community mission).
   * They are not checked again and cannot be overridden.
   */
  dependencies?: LoadedPack[];
  /** Community rules: no `breach.` id, no pack that takes the id of a dependency. */
  community?: boolean;
}

/** Problems specific to packs submitted to the community catalogue. */
function communityProblems(packs: LoadedPack[], dependencies: LoadedPack[]): string[] {
  const problems: string[] = [];
  const deps = new Set(dependencies.map((d) => d.pack.id));
  const seen = new Set<string>();
  for (const { pack } of packs) {
    if (isOfficialId(pack.id))
      problems.push(`${pack.id}: ids starting with "breach." are reserved for the official packs`);
    else if (!/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(pack.id))
      problems.push(
        `${pack.id}: a community id is "<your-name>.<pack-name>", for example "jdoe.lost-backup"`,
      );
    if (deps.has(pack.id)) problems.push(`${pack.id}: this id is already taken by another pack`);
    if (seen.has(pack.id)) problems.push(`${pack.id}: two packs use this id`);
    seen.add(pack.id);
    for (const dep of pack.requires)
      if (isOfficialId(dep) && !deps.has(dep))
        problems.push(`${pack.id}: requires ${dep}, which is not an official pack`);
  }
  return problems;
}

/** Every problem found in a set of packs: schema, dependencies, translations, solutions. */
export async function checkAll(packs: LoadedPack[], options: CheckOptions = {}): Promise<string[]> {
  const dependencies = options.dependencies ?? [];
  const problems: string[] = options.community ? communityProblems(packs, dependencies) : [];
  // Packs under review come last, so a dependency can never be replaced by a submitted pack.
  const byId = new Map([...packs, ...dependencies].map((p) => [p.pack.id, p]));
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
    if (pack.world) problems.push(...worldProblems(pack));
    if (pack.kind === 'series') problems.push(...(await seriesProblems(pack, byId)));
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
      ...(m.debrief.facts ? [m.debrief.facts.title, ...m.debrief.facts.points] : []),
      ...m.objectives.map((o) => o.text),
      ...Object.values(m.hints).flat(),
      ...Object.values(m.guide),
      ...m.npcs.flatMap(npcTexts).filter(looksLikeKey),
      ...Object.values(m.files).filter(looksLikeKey),
      ...(m.defense
        ? [
            m.defense.intro,
            ...(m.defense.lesson ? [m.defense.lesson] : []),
            ...m.defense.find.map((f) => f.text),
            ...m.defense.rules.flatMap((r) => [r.title, r.why]),
            ...m.defense.fixes.flatMap((f) => [f.title, f.why]),
          ]
        : []),
      ...m.containment.map((c) => c.text),
      ...m.investigation.map((q) => q.text),
      ...m.alerts.flatMap((a) => [a.title, a.why]),
      ...m.checks.map((c) => c.text),
      ...m.questions.flatMap((q) => [
        q.text,
        ...q.options.flatMap((o) => (o.why ? [o.text, o.why] : [o.text])),
      ]),
    ];
    const settings = { ...world.world.config, ...m.config };
    for (const fix of [...(m.defense?.fixes ?? []), ...m.containment])
      for (const key of Object.keys(fix.sets))
        if (!(key in settings)) problems.push(`${pack.id}: ${fix.id} sets ${key}, which no config declares`);
    const hostIds = new Set([...world.world.hosts.map((h) => h.id), 'dns', 'ids', 'fw']);
    for (const step of m.adversary?.steps ?? [])
      if (!hostIds.has(step.host))
        problems.push(`${pack.id}: adversary step ${step.id} names unknown host ${step.host}`);
    if (m.adversary && !hostIds.has(m.adversary.from))
      problems.push(`${pack.id}: the adversary comes from unknown host ${m.adversary.from}`);
    if (m.side === 'defense' && !m.adversary)
      problems.push(`${pack.id}: a defence mission needs an adversary`);
    for (const npc of m.npcs) problems.push(...npcProblems(npc).map((p) => `${pack.id}: ${p}`));
    const objectiveIds = new Set(m.objectives.map((o) => o.id));
    for (const o of m.objectives)
      if (!o.optional && !m.guide[o.id]) problems.push(`${pack.id}: objective ${o.id} has no entry in guide`);
    for (const key of Object.keys(m.guide))
      if (!objectiveIds.has(key)) problems.push(`${pack.id}: guide names unknown objective ${key}`);
    for (const rule of [...m.rules, ...world.world.rules])
      for (const effect of rule.do) {
        const guide = (effect as Record<string, unknown>)['ada.guide'];
        if (guide && typeof guide === 'object') {
          const g = guide as { key: string; for: string };
          keysUsed.push(g.key);
          if (rule && m.rules.includes(rule) && !objectiveIds.has(g.for))
            problems.push(`${pack.id}: ada.guide names unknown objective ${g.for}`);
          continue;
        }
        const noise = (effect as Record<string, unknown>)['noise.add'];
        if (noise && typeof noise === 'object') keysUsed.push((noise as { as: string }).as);
        const key =
          (effect as Record<string, unknown>)['ada.say'] ??
          guide ??
          (effect as Record<string, unknown>)['ada.warn'] ??
          (effect as Record<string, unknown>)['note.add'];
        if (typeof key === 'string') keysUsed.push(key);
      }
    for (const key of keysUsed)
      if (!known(key)) problems.push(`${pack.id}: text key ${key} has no translation`);
    for (const check of m.checks)
      if (check.objective && !objectiveIds.has(check.objective))
        problems.push(`${pack.id}: check ${check.id} points to unknown objective ${check.objective}`);
    for (const q of m.questions) {
      if (q.objective && !objectiveIds.has(q.objective))
        problems.push(`${pack.id}: question ${q.id} points to unknown objective ${q.objective}`);
      if (!q.options.some((o) => o.id === q.correct))
        problems.push(`${pack.id}: question ${q.id} has no option ${q.correct}`);
    }
    for (const rule of m.rules)
      for (const effect of rule.do) {
        const asked = (effect as Record<string, unknown>)['ada.ask'];
        if (typeof asked === 'string' && !m.questions.some((q) => q.id === asked))
          problems.push(`${pack.id}: ada.ask names unknown question ${asked}`);
      }
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
      } else if (m.defense && locale === pack.locales[0])
        problems.push(...(await defenseProblems(result.game)).map((p) => `${pack.id}: ${p}`));
    }
  }
  return problems;
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
  // A series without its own estimate takes the sum of its missions', when all of them have one.
  const minutesOf = (pack: Pack): number | undefined => {
    if (pack.minutes || !pack.series) return pack.minutes;
    const each = pack.series.missions.map((id) => byId.get(id)?.minutes);
    return each.every((m) => m !== undefined)
      ? Math.min(
          600,
          each.reduce((a, b) => a + b, 0),
        )
      : undefined;
  };
  for (const { pack } of packs) {
    const minutes = minutesOf(pack);
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
    entries.push({
      id: pack.id,
      version: pack.version,
      kind: pack.kind,
      engine: pack.engine,
      requires: pack.requires,
      title: pack.title,
      summary: pack.summary,
      authors: pack.authors,
      order: pack.mission?.order,
      ...(pack.kind === 'mission' ? { track: pack.track } : {}),
      ...(pack.difficulty ? { difficulty: pack.difficulty } : {}),
      ...(pack.skills.length ? { skills: pack.skills } : {}),
      ...(pack.incident ? { incident: pack.incident } : {}),
      ...(minutes ? { minutes } : {}),
      ...(dates ? { added: dates.added, updated: dates.updated } : {}),
      ...(pack.series ? { missions: pack.series.missions } : {}),
      locales: pack.locales,
      file,
      sha256: sha256(bytes),
      size: bytes.length,
      reviewed: true,
    });
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

export { generateKeys, type KeyPair, signBytes } from './sign.ts';
