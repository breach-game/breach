/**
 * Pack format v0.
 *
 * A pack is pure data. Nothing in this schema is ever executed: no script, no raw HTML, no regular
 * expression supplied by content. Rules are a closed list of triggers, conditions and effects.
 */
import { z } from 'zod';
import { checkPackSafety } from './safety.ts';

export const PACK_FORMAT = 0;
export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase id expected');
const i18nKey = z.string().min(1).max(120);
const i18nText = z
  .object({ fr: z.string(), en: z.string() })
  .partial()
  .refine((v) => v.fr || v.en, {
    message: 'at least one locale is required',
  });

/* ---------- virtual file system (source form) ---------- */

export type FsSource =
  | string
  | { $t: string; $mode?: string; $owner?: string }
  | { $content: string; $mode?: string; $owner?: string }
  | { [name: string]: FsSource };

const fsMeta = {
  $mode: z
    .string()
    .regex(/^[0-7]{3,4}$/)
    .optional(),
  $owner: z.string().optional(),
};
const fsSource: z.ZodType<FsSource> = z.lazy(() =>
  z.union([
    z.string().max(64_000),
    z.strictObject({ $t: i18nKey, ...fsMeta }),
    z.strictObject({ $content: z.string().max(64_000), ...fsMeta }),
    z.record(z.string().regex(/^[^/$\0][^/\0]*$/, 'invalid file name'), fsSource),
  ]),
);

/* ---------- world ---------- */

const service = z.strictObject({
  port: z.number().int().min(1).max(65535),
  proto: z.enum(['tcp', 'udp']).default('tcp'),
  name: z.string().max(32),
  product: z.string().max(80).optional(),
});

const route = z.strictObject({
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(64_000).optional(),
  bodyKey: i18nKey.optional(),
});

const commit = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{7,40}$/),
  author: z.string().max(120),
  date: z.string().max(40),
  message: z.string().max(400),
  diff: z.string().max(32_000).default(''),
});

const repo = z.strictObject({
  description: z.string().max(200).optional(),
  /** Newest first. */
  commits: z.array(commit).min(1).max(50),
  /** Working tree at HEAD, checked out by `git clone`. */
  tree: fsSource.optional(),
});

const host = z.strictObject({
  id,
  hostname: z.string().max(120),
  ip: z.string().max(45),
  kind: z.enum(['player', 'host', 'ai', 'unknown']).default('host'),
  os: z.string().max(80).optional(),
  /** Never returned by a scan until a rule reveals it. */
  hidden: z.boolean().default(false),
  /** Position on the network map. */
  map: z.strictObject({ x: z.number(), z: z.number(), h: z.number().default(80) }),
  links: z.array(id).default([]),
  services: z.array(service).default([]),
  users: z.array(z.strictObject({ name: z.string(), home: z.string() })).default([]),
  fs: fsSource.optional(),
  web: z.record(z.string().startsWith('/'), route).optional(),
  repos: z.record(z.string(), repo).optional(),
});

const noiseEntry = z.union([
  z.number(),
  z.strictObject({ base: z.number().default(0), flags: z.record(z.string(), z.number()).default({}) }),
]);
const noiseTable = z.record(z.string(), noiseEntry);

/* ---------- rules: trigger, condition, effect ---------- */

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const matcher = z.union([
  scalar,
  z.strictObject({ glob: z.string().max(200) }),
  z.strictObject({ in: z.array(scalar).max(50) }),
  z.strictObject({ contains: z.string().max(200) }),
  z.strictObject({ gte: z.number() }),
]);
export type Matcher = z.infer<typeof matcher>;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { objective: string }
  | { flag: string }
  | { discovered: string | { gte: number } }
  | { noise: { gte?: number; lt?: number } }
  | { var: string; eq: string | number | boolean };

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condition).max(20) }),
    z.strictObject({ any: z.array(condition).max(20) }),
    z.strictObject({ not: condition }),
    z.strictObject({ objective: id }),
    z.strictObject({ flag: id }),
    z.strictObject({ discovered: z.union([id, z.strictObject({ gte: z.number() })]) }),
    z.strictObject({ noise: z.strictObject({ gte: z.number().optional(), lt: z.number().optional() }) }),
    z.strictObject({ var: id, eq: scalar }),
  ]),
);

/**
 * How much Ada helps. `guided` spells out the commands, `standard` only gives the direction,
 * `expert` gets the briefing and nothing more.
 */
export const GUIDANCE_LEVELS = ['guided', 'standard', 'expert'] as const;
export type Guidance = (typeof GUIDANCE_LEVELS)[number];

const effect = z.union([
  z.strictObject({ 'ada.say': i18nKey }),
  /** Guidance, as opposed to story. Shown in `guided`; in `standard` only if `<key>.standard` exists. */
  z.strictObject({ 'ada.guide': i18nKey }),
  z.strictObject({ 'ada.warn': i18nKey }),
  z.strictObject({ 'objective.complete': id }),
  z.strictObject({ 'noise.add': z.number().min(-100).max(100) }),
  z.strictObject({ 'host.reveal': id }),
  z.strictObject({ 'checkpoint.save': id }),
  z.strictObject({ 'var.set': z.strictObject({ name: id, value: scalar }) }),
  z.strictObject({ 'note.add': i18nKey }),
]);
export type Effect = z.infer<typeof effect>;

const rule = z.strictObject({
  id: id.optional(),
  on: z.object({ event: z.string() }).catchall(matcher),
  if: condition.optional(),
  /** A rule fires once per mission unless `once: false`. */
  once: z.boolean().default(true),
  do: z.array(effect).min(1).max(12),
});
export type Rule = z.infer<typeof rule>;

const world = z.strictObject({
  /** In-game start date, ISO 8601 with offset. */
  startTime: z.string(),
  mandate: z.string().max(40),
  scope: z.strictObject({ domains: z.array(z.string()).min(1), networks: z.array(z.string()).min(1) }),
  player: z.strictObject({ host: id, user: z.string().regex(/^[a-z][a-z0-9_-]{0,15}$/) }),
  resolver: z.string().default('10.13.0.2'),
  hosts: z.array(host).min(1).max(64),
  dns: z.record(z.string(), z.partialRecord(z.enum(['A', 'MX', 'NS', 'TXT', 'CNAME']), z.array(z.string()))),
  whois: z.record(z.string(), z.string().max(4000)).default({}),
  noise: noiseTable.default({}),
  rules: z.array(rule).max(100).default([]),
});
export type World = z.infer<typeof world>;
export type Host = z.infer<typeof host>;
export type Repo = z.infer<typeof repo>;
export type Route = z.infer<typeof route>;
export type NoiseTable = z.infer<typeof noiseTable>;

/* ---------- mission ---------- */

const mission = z.strictObject({
  order: z.number().int().min(0),
  /** Attack stage, shown in the notebook. */
  stage: z.string().max(40),
  briefing: i18nKey,
  objectives: z
    .array(z.strictObject({ id, text: i18nKey, optional: z.boolean().default(false) }))
    .min(1)
    .max(12),
  /** Flags are stored as SHA-256 of the trimmed value. The CLI hashes a plain `value` at build time. */
  flags: z
    .array(
      z.strictObject({
        id,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        points: z.number().int().min(0).default(100),
        objective: id.optional(),
      }),
    )
    .max(12)
    .default([]),
  /** Hosts visible on the map when the mission starts. */
  reveal: z.array(id).default([]),
  rules: z.array(rule).max(100).default([]),
  noise: noiseTable.default({}),
  /** Three levels of hints per objective, from vague to explicit. */
  hints: z.record(id, z.array(i18nKey).min(1).max(3)).default({}),
  debrief: z.strictObject({
    title: i18nKey,
    lesson: i18nKey,
    points: z.array(i18nKey).min(1).max(8),
    reference: z.string().max(80).optional(),
  }),
});
export type Mission = z.infer<typeof mission>;

/* ---------- pack ---------- */

const packBase = z.strictObject({
  format: z.literal(PACK_FORMAT),
  id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Engine compatibility range: ">=0.1 <1". */
  engine: z.string().max(40),
  kind: z.enum(['world', 'mission']),
  requires: z.array(id).default([]),
  title: i18nText,
  summary: i18nText.optional(),
  authors: z.array(z.string().max(80)).min(1).max(10),
  locales: z.array(z.enum(LOCALES)).min(1),
  world: world.optional(),
  mission: mission.optional(),
  i18n: z.partialRecord(z.enum(LOCALES), z.record(z.string(), z.string().max(8000))).default({}),
});

export const packSchema = packBase.superRefine((pack, ctx) => {
  if (pack.kind === 'world' && !pack.world)
    ctx.addIssue({ code: 'custom', message: 'a world pack needs `world`' });
  if (pack.kind === 'mission' && !pack.mission)
    ctx.addIssue({ code: 'custom', message: 'a mission pack needs `mission`' });
  if (pack.kind === 'mission' && pack.requires.length === 0)
    ctx.addIssue({ code: 'custom', message: 'a mission pack must require its world pack' });
  for (const problem of checkPackSafety(pack)) ctx.addIssue({ code: 'custom', message: problem });
});
export type Pack = z.infer<typeof packSchema>;

/** Catalogue served next to the packs. */
export const catalogSchema = z.strictObject({
  format: z.literal(PACK_FORMAT),
  generatedAt: z.string(),
  campaign: z.array(id),
  packs: z.array(
    z.strictObject({
      id,
      version: z.string(),
      kind: z.enum(['world', 'mission']),
      engine: z.string(),
      requires: z.array(id),
      title: i18nText,
      summary: i18nText.optional(),
      order: z.number().optional(),
      locales: z.array(z.enum(LOCALES)),
      file: z.string().regex(/^[a-z0-9._-]+\.breachpack$/),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      size: z.number().int(),
      reviewed: z.boolean(),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogEntry = Catalog['packs'][number];

export const MAX_PACK_BYTES = 2_000_000;

export function parsePack(data: unknown): Pack {
  const result = packSchema.safeParse(data);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(pack)'}: ${i.message}`);
    throw new Error(`Invalid pack:\n${lines.join('\n')}`);
  }
  return result.data;
}

export { checkPackSafety, isReservedDomain, isReservedIp } from './safety.ts';
