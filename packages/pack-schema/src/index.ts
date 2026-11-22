/**
 * Pack format v0.
 *
 * A pack is pure data. Nothing in this schema is ever executed: no script, no raw HTML, no regular
 * expression supplied by content. Rules are a closed list of triggers, conditions and effects.
 */
import { z } from 'zod';
import { checkPackSafety } from './safety.ts';

// Validate without generating code: zod would otherwise probe `new Function`, which the game's
// Content Security Policy and Trusted Types forbid (and report as a violation).
z.config({ jitless: true });

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

/** A translation key, or the text itself when no translation exists under that name. */
const text = z.string().min(1).max(2000);
const href = z.string().min(1).max(200);

/**
 * A page is a list of typed blocks. The game renders them itself, and `curl` prints the HTML it
 * derives from them: content never supplies markup.
 */
const block = z.union([
  z.strictObject({ h1: text }),
  z.strictObject({ h2: text }),
  z.strictObject({ p: text }),
  z.strictObject({ list: z.array(text).min(1).max(30) }),
  z.strictObject({ code: text }),
  z.strictObject({
    nav: z
      .array(z.strictObject({ href, label: text }))
      .min(1)
      .max(12),
  }),
  z.strictObject({ link: z.strictObject({ href, label: text }) }),
  /** An HTML comment: invisible on the rendered page, visible in the source and in `curl`. */
  z.strictObject({ comment: text }),
  /** A live chat with a character. */
  z.strictObject({ chat: id }),
  z.strictObject({ footer: text }),
]);
export type Block = z.infer<typeof block>;
const page = z.strictObject({ title: text, blocks: z.array(block).min(1).max(60) });
export type Page = z.infer<typeof page>;

const route = z.strictObject({
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(64_000).optional(),
  bodyKey: i18nKey.optional(),
  page: page.optional(),
  /** A character answers what is posted here (`curl -d "message"`). */
  chat: id.optional(),
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

/**
 * Who may open an SSH session on a host. Nothing is cracked or guessed: a login works when the
 * player comes from one of the listed hosts, holds the listed key, and the condition holds.
 */
const sshLogin = z.lazy(() =>
  z.strictObject({
    user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
    /** Hosts a session may come from, by id: the player's workstation or a host already reached. */
    from: z.array(id).min(1).max(16),
    /** Path of the private key, on the host the player comes from, that `ssh -i` must name. */
    key: z.string().startsWith('/').max(200).optional(),
    /** Only while this holds, for example a variable a mission sets. */
    if: condition.optional(),
  }),
);

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
  ssh: z.array(sshLogin).max(16).default([]),
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
  | { var: string; eq: string | number | boolean }
  | { file: string; host?: string; contains?: string; lacks?: string }
  | { answer: string; eq: string };

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
    /**
     * A file as it stands now, on the player's workstation unless `host` names another one. `~` is the
     * home directory. True when the file exists, holds `contains` and does not hold `lacks`. Plain
     * text only: content never supplies a regular expression.
     */
    z.strictObject({
      file: z.string().min(1).max(200),
      host: id.optional(),
      contains: z.string().min(1).max(400).optional(),
      lacks: z.string().min(1).max(400).optional(),
    }),
    /** The option the player picked for a question. */
    z.strictObject({ answer: id, eq: id }),
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
  z.strictObject({
    'ada.guide': z.union([
      i18nKey,
      /** A finer step inside an objective: dropped once the objective is done or a later step was given. */
      z.strictObject({ key: i18nKey, for: id, step: z.number().int().min(1).max(20).default(1) }),
    ]),
  }),
  z.strictObject({ 'ada.warn': i18nKey }),
  z.strictObject({ 'objective.complete': id }),
  /** Noise made by a reaction of the target. With `as`, the SOC log shows it under that text. */
  z.strictObject({
    'noise.add': z.union([
      z.number().min(-100).max(100),
      z.strictObject({ points: z.number().min(-100).max(100), as: i18nKey }),
    ]),
  }),
  z.strictObject({ 'host.reveal': id }),
  z.strictObject({ 'checkpoint.save': id }),
  z.strictObject({ 'var.set': z.strictObject({ name: id, value: scalar }) }),
  z.strictObject({ 'note.add': i18nKey }),
  /** Ada puts one of the mission's questions to the player. */
  z.strictObject({ 'ada.ask': id }),
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

/* ---------- characters ---------- */

/** Injection technique families the engine can recognise in a message. */
export const FAMILIES = [
  'override',
  'reveal',
  'roleplay',
  'translation',
  'encoding',
  'authority',
  'completion',
  'hypothetical',
] as const;
export type Family = (typeof FAMILIES)[number];

const intent = z.strictObject({
  id,
  /**
   * Word groups. A group matches when each of its words is in the message, whatever the case or
   * accents. A word of four letters or more also matches longer words that start with it
   * ("urgen" matches "urgent" and "urgence"). The intent needs one matching group, or none if the
   * list is empty.
   */
  words: z.array(z.string().min(1).max(80)).max(80).default([]),
  /** A second list of word groups: when it is not empty, one of these must match too. */
  also: z.array(z.string().min(1).max(80)).max(80).default([]),
  /** Technique families: one of them must be detected, or none if the list is empty. */
  families: z.array(z.enum(FAMILIES)).default([]),
  /**
   * The player must type these words themselves: a name, a code word, a fact found elsewhere.
   * A language model that interprets the player's message never counts for this intent's words.
   */
  literal: z.boolean().default(false),
  if: condition.optional(),
  /** Replies, used in turn when the intent comes back. The last one repeats. */
  reply: z.array(text).min(1).max(5),
  /** Remember something for the rest of the conversation. */
  set: z.record(id, scalar).optional(),
});
export type Intent = z.infer<typeof intent>;

const npc = z.strictObject({
  id,
  name: z.string().min(1).max(40),
  role: text,
  kind: z.enum(['human', 'ai']).default('human'),
  greeting: text.optional(),
  /** Checked in order: the first intent that matches answers. */
  intents: z.array(intent).max(80).default([]),
  /** Used in turn when nothing matches. */
  fallback: z.array(text).min(1).max(6),
  /** Character sheet for language-model brains. Never shown to the player. */
  sheet: z.string().max(6000).optional(),
});
export type Npc = z.infer<typeof npc>;

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
  /** Characters the player can talk to. A mission may redefine one by id. */
  npcs: z.array(npc).max(24).default([]),
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
  /**
   * Documents handed to the player when the mission starts, by path relative to the player's home
   * directory (`missions/cv-modele.txt`). The text is a translation key or the text itself.
   */
  files: z
    .record(
      z
        .string()
        .regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/, 'relative path expected')
        .max(200),
      z.string().min(1).max(16_000),
    )
    .default({}),
  rules: z.array(rule).max(100).default([]),
  noise: noiseTable.default({}),
  /** Characters for this mission. They replace the world's character with the same id. */
  npcs: z.array(npc).max(24).default([]),
  /**
   * What Ada says to start each objective. The engine gives the one for the first open objective
   * whenever the player has no pending instruction, so a guided player is never left without a next step.
   */
  guide: z.record(id, i18nKey).default({}),
  /** Three levels of hints per objective, from vague to explicit. */
  hints: z.record(id, z.array(i18nKey).min(1).max(3)).default({}),
  /**
   * Things the player must put right, judged by `verify`: each check is a condition on the state of
   * the game, usually a file. A check that passes completes its objective.
   */
  checks: z
    .array(z.strictObject({ id, text: i18nKey, if: condition, objective: id.optional() }))
    .max(12)
    .default([]),
  /**
   * Multiple-choice questions Ada asks with `ada.ask`. The right option completes the objective.
   * A wrong one costs points and gets the option's `why`, and the player answers again.
   */
  questions: z
    .array(
      z.strictObject({
        id,
        text: i18nKey,
        options: z
          .array(z.strictObject({ id, text: i18nKey, why: i18nKey.optional() }))
          .min(2)
          .max(5),
        correct: id,
        objective: id.optional(),
      }),
    )
    .max(12)
    .default([]),
  debrief: z.strictObject({
    title: i18nKey,
    lesson: i18nKey,
    points: z.array(i18nKey).min(1).max(8),
    reference: z.string().max(80).optional(),
  }),
});
export type Mission = z.infer<typeof mission>;

/* ---------- pack ---------- */

export const KINDS = ['world', 'mission', 'series'] as const;

/**
 * A series chains missions of one world into a short campaign: they are played in the order listed,
 * in a single save, so what the player did in one mission is still there in the next.
 */
const series = z.strictObject({
  missions: z.array(id).min(2).max(12),
});
export type Series = z.infer<typeof series>;

export const TRACKS = ['campaign', 'training'] as const;
export const SKILLS = [
  'recon',
  'web',
  'social',
  'llm',
  'logs',
  'linux',
  'crypto',
  'supply',
  'defense',
] as const;
export type Skill = (typeof SKILLS)[number];

const packBase = z.strictObject({
  format: z.literal(PACK_FORMAT),
  id,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Engine compatibility range: ">=0.1 <1". */
  engine: z.string().max(40),
  kind: z.enum(KINDS),
  requires: z.array(id).default([]),
  title: i18nText,
  summary: i18nText.optional(),
  authors: z.array(z.string().max(80)).min(1).max(10),
  locales: z.array(z.enum(LOCALES)).min(1),
  /** Where a mission is listed: in the story, or among the short standalone trainings. */
  track: z.enum(TRACKS).default('campaign'),
  /** 1 easy, 2 medium, 3 hard. */
  difficulty: z.number().int().min(1).max(3).optional(),
  /** What the mission trains, shown as labels. */
  skills: z.array(z.enum(SKILLS)).max(4).default([]),
  world: world.optional(),
  mission: mission.optional(),
  series: series.optional(),
  i18n: z.partialRecord(z.enum(LOCALES), z.record(z.string(), z.string().max(8000))).default({}),
});

export const packSchema = packBase.superRefine((pack, ctx) => {
  if (pack.kind === 'world' && !pack.world)
    ctx.addIssue({ code: 'custom', message: 'a world pack needs `world`' });
  if (pack.kind === 'mission' && !pack.mission)
    ctx.addIssue({ code: 'custom', message: 'a mission pack needs `mission`' });
  if (pack.kind === 'mission' && pack.requires.length === 0)
    ctx.addIssue({ code: 'custom', message: 'a mission pack must require its world pack' });
  if (pack.kind === 'series' && !pack.series)
    ctx.addIssue({ code: 'custom', message: 'a series pack needs `series`' });
  if (pack.kind === 'series' && pack.requires.length === 0)
    ctx.addIssue({ code: 'custom', message: 'a series pack must require its world pack' });
  if (pack.kind === 'series' && new Set(pack.series?.missions).size !== pack.series?.missions.length)
    ctx.addIssue({ code: 'custom', message: 'a series lists each mission once' });
  for (const problem of checkPackSafety(pack)) ctx.addIssue({ code: 'custom', message: problem });
});
export type Pack = z.infer<typeof packSchema>;

/** Catalogue served next to the packs. */
export const catalogSchema = z.strictObject({
  format: z.literal(PACK_FORMAT),
  generatedAt: z.string(),
  campaign: z.array(id),
  /** Short standalone missions, easiest first. */
  training: z.array(id).default([]),
  packs: z.array(
    z.strictObject({
      id,
      version: z.string(),
      kind: z.enum(KINDS),
      engine: z.string(),
      requires: z.array(id),
      title: i18nText,
      summary: i18nText.optional(),
      authors: z.array(z.string().max(80)).max(10).optional(),
      order: z.number().optional(),
      track: z.enum(TRACKS).optional(),
      difficulty: z.number().int().min(1).max(3).optional(),
      skills: z.array(z.enum(SKILLS)).max(4).optional(),
      /** For a series: its missions in playing order. */
      missions: z.array(id).max(12).optional(),
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
export { isOfficialId, OFFICIAL_PREFIX, SIGNATURE_ALGORITHM, verifySignature } from './signature.ts';
