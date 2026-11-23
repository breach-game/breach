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
  /**
   * A one-field form of the application. What is typed is posted to the scripted character `to`,
   * which stands for the application behind the form, and the answer is shown under the field.
   */
  z.strictObject({
    form: z.strictObject({
      to: id,
      label: text,
      button: text,
      /** Name of the field in the HTML source and in `curl -d "name=value"`. */
      name: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,19}$/)
        .default('q'),
      placeholder: text.optional(),
    }),
  }),
  /** A table of plain cells, with one header row. */
  z.strictObject({
    table: z.strictObject({
      head: z.array(text).min(1).max(8),
      rows: z.array(z.array(text).min(1).max(8)).min(1).max(40),
    }),
  }),
  z.strictObject({ footer: text }),
]);
export type Block = z.infer<typeof block>;
const page = z.strictObject({ title: text, blocks: z.array(block).min(1).max(60) });
export type Page = z.infer<typeof page>;

const answer = {
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(64_000).optional(),
  bodyKey: i18nKey.optional(),
  page: page.optional(),
};

/**
 * Another answer of a route, given when the request carries a cookie or a header, written exactly
 * as `curl -b "name=value"` or `curl -H "Name: value"` sends it. The first variant that matches
 * answers. A variant with only `if` answers every request while its condition holds, in the browser
 * too: a fix closes a door (403), something the player did shows on a page.
 */
const variant = z
  .strictObject({
    id,
    cookie: z.string().min(3).max(200).optional(),
    header: z.string().min(3).max(200).optional(),
    /** Only while this holds: a fix can close the variant. */
    if: z.lazy(() => condition).optional(),
    ...answer,
  })
  .refine((v) => v.cookie !== undefined || v.header !== undefined || v.if !== undefined, {
    message: 'a variant needs `cookie`, `header` or `if`',
  });

const route = z.strictObject({
  ...answer,
  /** A character answers what is posted here (`curl -d "message"`). */
  chat: id.optional(),
  variants: z.array(variant).max(8).default([]),
});

const commit = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{7,40}$/),
  author: z.string().max(120),
  date: z.string().max(40),
  message: z.string().max(400),
  diff: z.string().max(32_000).default(''),
  /** The commit only exists while this holds: a fix can rewrite history. */
  if: z.lazy(() => condition).optional(),
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
  /** A setting of the target, that a defender's fix can change (`config` of the world). */
  | { config: string; eq: string | number | boolean }
  | { file: string; host?: string; contains?: string; lacks?: string }
  | { answer: string; eq: string }
  | { choice: string; eq: string };

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
    z.strictObject({ config: id, eq: scalar }),
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
    /**
     * The option the player took for a decision, in this mission or an earlier one of the same game.
     * False when the decision was never taken (a mission replayed alone): write that branch as the default.
     */
    z.strictObject({ choice: id, eq: id }),
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
  /** The attack got through in a defence mission: back to the last checkpoint, with Ada's words. */
  z.strictObject({ 'mission.fail': i18nKey }),
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

/**
 * Shapes of a raw input that an application may mistake for something else than text. They name a
 * class of flaw, not an exploit: `quote` is a quote that is not part of a word, `markup` an HTML tag, `negative` a
 * number below zero.
 */
export const INPUT_SHAPES = ['quote', 'markup', 'negative'] as const;
export type InputShape = (typeof INPUT_SHAPES)[number];

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
  /**
   * The message must give a version number higher than this one (`1.4.2`): the first number of
   * the form `2`, `2.0` or `2.0.1` after the word "version", or in the whole message when that word
   * is not there, compared part by part. Read from what was typed only, never from a model.
   */
  above: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6}){0,3}$/)
    .optional(),
  /**
   * Shapes the raw text must have, all of them: what an application's form does with its input.
   * Read from what was typed only, never from a model.
   */
  input: z.array(z.enum(INPUT_SHAPES)).max(3).default([]),
  if: condition.optional(),
  /** Replies, used in turn when the intent comes back. The last one repeats. */
  reply: z.array(text).min(1).max(5),
  /** Remember something for the rest of the conversation. */
  set: z.record(id, scalar).optional(),
  /**
   * An agent runs a tool when it gives this reply. The engine logs the call (`ToolCall`), and the
   * mission judges the action, not the words.
   */
  tool: z
    .strictObject({
      name: id,
      /** Arguments as the agent's audit log shows them. */
      args: z.string().max(200).default(''),
      /** Run with administrator rights. */
      admin: z.boolean().default(false),
    })
    .optional(),
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

/* ---------- telemetry: what the target's logs record ---------- */

/** Log sources the engine knows how to write, each in the format of the real tool. */
export const LOG_SOURCES = [
  'access', // web server, combined log format
  'auth', // sshd in auth.log
  'chat', // a chatbot's conversation gateway
  'agent', // an AI agent's tool audit log
  'dns', // resolver query log
  'ids', // network intrusion detection sensor
  'audit', // commands run on a host (auditd)
  'git', // code forge
  'db', // database audit
  'flow', // firewall flow log
  'mail', // inbound mail gateway
] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

const fieldValue = z.union([scalar, z.array(z.string().max(80)).max(10)]);
const fields = z.record(z.string().regex(/^[a-z_]{1,20}$/), fieldValue);
export type LogFields = z.infer<typeof fields>;

/**
 * Ordinary activity of the target: customers on the website, employees logging in, nightly
 * backups. The engine spreads it over the mission's time, the same way for every player, so that
 * the player's own lines have to be found among others and a detection rule can misfire.
 */
const background = z.strictObject({
  host: id,
  source: z.enum(LOG_SOURCES),
  /** One line every so many minutes of game time. */
  every: z.number().min(1).max(600),
  /** Minutes before the first line. */
  offset: z.number().min(0).max(600).default(0),
  fields,
});

const telemetry = z.strictObject({ background: z.array(background).max(60).default([]) });

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
  /**
   * Settings of the target that decide whether a weakness is there (`nova.output_filter: false`).
   * Conditions read them with `{ config: key, eq: value }`; a defender's fix changes them.
   */
  config: z.record(id, scalar).default({}),
  telemetry: telemetry.default({ background: [] }),
});
export type World = z.infer<typeof world>;
export type Host = z.infer<typeof host>;
export type Repo = z.infer<typeof repo>;
export type Route = z.infer<typeof route>;
export type NoiseTable = z.infer<typeof noiseTable>;

/* ---------- mission ---------- */

/* ---------- defence ---------- */

/** Which log lines a rule or a search selects: every field named must match. */
const where = z.record(z.string().regex(/^[a-z_]{1,20}$/), matcher);
export type Where = z.infer<typeof where>;

/**
 * A detection rule, in a simplified form of Sigma: a log source, a selection, and an optional
 * threshold (`count` lines from the same source address within `within` minutes).
 */
const detection = z.strictObject({
  id,
  title: i18nKey,
  /** Why it is right or wrong, shown once the player has chosen. */
  why: i18nKey,
  source: z.enum(LOG_SOURCES),
  where: where.default({}),
  count: z
    .strictObject({ gte: z.number().int().min(2).max(50), within: z.number().min(1).max(240) })
    .optional(),
  correct: z.boolean().default(false),
});
export type Detection = z.infer<typeof detection>;

const fix = z.strictObject({
  id,
  title: i18nKey,
  why: i18nKey,
  /** Settings the fix changes (`world.config`). */
  sets: z.record(id, scalar),
  correct: z.boolean().default(false),
});
export type Fix = z.infer<typeof fix>;

/**
 * The defence replay that ends an attack mission: find your own lines in the target's logs, pick
 * the rule that catches them, then apply the fix and watch your attack fail when the engine replays it.
 */
const defense = z
  .strictObject({
    intro: i18nKey,
    /** Kinds of lines the player must find among theirs: each needs one marked line. */
    find: z
      .array(z.strictObject({ source: z.enum(LOG_SOURCES), where: where.default({}), text: i18nKey }))
      .min(1)
      .max(6),
    rules: z.array(detection).min(2).max(4),
    /** None for a mission where nothing needs fixing (the mandate). */
    fixes: z.array(fix).max(4).default([]),
    lesson: i18nKey.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.rules.filter((r) => r.correct).length !== 1)
      ctx.addIssue({ code: 'custom', message: 'defense: exactly one rule must be correct' });
    if (d.fixes.length && d.fixes.filter((f) => f.correct).length !== 1)
      ctx.addIssue({ code: 'custom', message: 'defense: exactly one fix must be correct' });
  });
export type Defense = z.infer<typeof defense>;

/** One move of a scripted attacker, logged like a move of the player. */
const adversaryStep = z.strictObject({
  id,
  host: id,
  source: z.enum(LOG_SOURCES),
  fields,
  /** The step fails (and the attacker stops) while this holds: a containment did its job. */
  blockedIf: condition.optional(),
  /** When blocked, the attacker carries on with the next step (another address, another way). */
  continueIfBlocked: z.boolean().default(false),
});

/** In a defence mission, the attacker plays a script, one step every `pace` actions of the player. */
const adversary = z.strictObject({
  id,
  name: z.string().min(1).max(40),
  /** Host the attack comes from, by id. */
  from: id,
  pace: z.number().int().min(1).max(6).default(2),
  /** Player actions before the first step. */
  delay: z.number().int().min(0).max(30).default(0),
  steps: z.array(adversaryStep).min(1).max(30),
});
export type Adversary = z.infer<typeof adversary>;

/** A containment the player can order with `contain <action> <target>`. */
const containment = z.strictObject({
  id,
  action: z.enum(['block', 'revoke', 'isolate', 'disable', 'reset', 'remove', 'restore', 'rotate']),
  target: z.string().min(1).max(80),
  text: i18nKey,
  sets: z.record(id, scalar),
  /** What it costs the business, out of 100: an isolated database stops every clinic. */
  impact: z.number().min(0).max(100).default(0),
  /**
   * Files of the target the order rewrites, so that the machine shows what was done (a scheduled
   * job removed, an account locked). Plain text, on a host of the world.
   */
  writes: z
    .array(
      z.strictObject({
        host: id,
        path: z.string().regex(/^\/[\w./-]{1,200}$/, 'absolute path expected'),
        content: z.string().max(4000),
      }),
    )
    .max(4)
    .default([]),
  /** Files of the target the order deletes: what a restore sweeps away. */
  removes: z
    .array(
      z.strictObject({
        host: id,
        path: z.string().regex(/^\/[\w./-]{1,200}$/, 'absolute path expected'),
      }),
    )
    .max(8)
    .default([]),
});
export type Containment = z.infer<typeof containment>;

/** An investigation question, answered with `answer <id> <value>` and judged by hash. */
const investigationQuestion = z.strictObject({
  id,
  text: i18nKey,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  points: z.number().int().min(0).default(100),
  objective: id.optional(),
});

const mission = z.strictObject({
  /** `defense`: the player defends the target against a scripted attacker. */
  side: z.enum(['attack', 'defense']).default('attack'),
  order: z.number().int().min(0),
  /** Attack stage, shown in the notebook. */
  stage: z.string().max(40),
  briefing: i18nKey,
  /**
   * When the mission takes place, if later than where the game clock stands: a series can skip a
   * few hours or days between two missions. Same form as the world's `startTime`.
   */
  startTime: z
    .string()
    .refine((v) => Number.isFinite(Date.parse(v)), 'a date and time such as 2027-09-13T09:30:00+02:00')
    .optional(),
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
        /** The flag only counts while this holds: a revoked key is worth nothing. */
        if: condition.optional(),
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
          .array(
            z.strictObject({
              id,
              text: i18nKey,
              why: i18nKey.optional(),
              /** Decisions only: settings of the target this choice changes. */
              sets: z.record(id, scalar).optional(),
              /** Decisions only: what this choice costs the organisation, out of 100. */
              impact: z.number().min(0).max(100).optional(),
            }),
          )
          .min(2)
          .max(5),
        /**
         * The right option. Without it the question is a decision: no option is wrong, each one has
         * consequences (`sets`, `impact`, and the rules that react to `Answered`), and any of them
         * completes the objective.
         */
        correct: id.optional(),
        objective: id.optional(),
      }),
    )
    .max(12)
    .default([])
    .superRefine((questions, ctx) => {
      for (const q of questions)
        if (q.correct !== undefined && q.options.some((o) => o.sets !== undefined || o.impact !== undefined))
          ctx.addIssue({
            code: 'custom',
            message: `question ${q.id}: sets and impact belong to a decision (a question without correct)`,
          });
    }),
  /**
   * Code reviews: the player reads a file of the workstation with `review <file>` and names the
   * faulty lines with `review <file> <line>`. Finding them all completes the objective; a line that
   * is not faulty costs points.
   */
  reviews: z
    .array(
      z.strictObject({
        id,
        /** Path of the file, relative to the player's home directory. */
        file: z.string().min(1).max(200),
        lines: z.array(z.number().int().min(1).max(400)).min(1).max(6),
        objective: id.optional(),
      }),
    )
    .max(6)
    .default([]),
  debrief: z.strictObject({
    title: i18nKey,
    lesson: i18nKey,
    points: z.array(i18nKey).min(1).max(8),
    reference: z.string().max(80).optional(),
    /**
     * For a mission inspired by a documented incident: what really happened, told after the fiction.
     * The sources are shown as plain text, never as links, and are the only place where a pack may
     * write a real address.
     */
    facts: z
      .strictObject({
        title: i18nKey,
        points: z.array(i18nKey).min(1).max(8),
        sources: z
          .array(
            z.strictObject({
              label: z.string().min(1).max(120),
              url: z
                .string()
                .max(200)
                .regex(
                  /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./%~]*)?$/,
                  'a plain https address expected',
                ),
            }),
          )
          .min(1)
          .max(6),
      })
      .optional(),
  }),
  /** Settings of the target for this mission, over the world's. */
  config: z.record(id, scalar).default({}),
  defense: defense.optional(),
  adversary: adversary.optional(),
  containment: z.array(containment).max(12).default([]),
  /** Ordinary activity of the target during this mission, over the world's. */
  background: z.array(background).max(30).default([]),
  /** Rules running in the target's SOC during a defence mission (`soc alerts`). */
  alerts: z.array(detection).max(10).default([]),
  /** Open questions of a defence investigation, answered in free text and judged by hash. */
  investigation: z.array(investigationQuestion).max(8).default([]),
  /**
   * Detection rules the player writes in a file of the workstation and tries with `rule test <file>`.
   * The rule passes when it raises an alert on every line `catch` selects among the attacker's, and
   * on no line of the ordinary activity.
   */
  hunts: z
    .array(
      z.strictObject({
        id,
        /** Path of the rule file, relative to the player's home directory. */
        file: z.string().min(1).max(200),
        catch: z.strictObject({ source: z.enum(LOG_SOURCES), where: where.default({}) }),
        objective: id.optional(),
      }),
    )
    .max(4)
    .default([]),
  /**
   * Guardrails the player writes in a file of the workstation and tries with `eval run <file>`.
   * A guardrail is a list of conditions on a request (a tool call of an agent): a request that meets
   * them all is blocked. It passes when every case marked `block` is blocked and no case marked
   * `allow` is. The cases are data: nothing is run, and no model judges.
   */
  evals: z
    .array(
      z.strictObject({
        id,
        /** Path of the guardrail file, relative to the player's home directory. */
        file: z.string().min(1).max(200),
        cases: z
          .array(
            z.strictObject({
              id,
              text: i18nKey,
              fields: z.record(z.string().regex(/^[a-z_]{1,20}$/), scalar),
              expect: z.enum(['block', 'allow']),
            }),
          )
          .min(2)
          .max(16)
          .refine(
            (cases) => cases.some((c) => c.expect === 'block') && cases.some((c) => c.expect === 'allow'),
            'an eval needs at least one case to block and one to allow',
          ),
        objective: id.optional(),
      }),
    )
    .max(4)
    .default([]),
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

/** `season`: a mission of an official series played after the campaign, listed only through its series. */
export const TRACKS = ['campaign', 'training', 'season'] as const;
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
  'crisis',
  'cloud',
  'privacy',
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
  /** Year of the real incident the pack is inspired by, told in its `debrief.facts`. */
  incident: z.number().int().min(1970).max(2100).optional(),
  /** The author's estimate of the playing time, in minutes (for a series: the whole series). */
  minutes: z.number().int().min(5).max(600).optional(),
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

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Catalogue served next to the packs. Unknown fields are dropped rather than refused, so a catalogue
 * published with fields a newer game reads still opens in an older game.
 */
export const catalogSchema = z.object({
  format: z.literal(PACK_FORMAT),
  generatedAt: z.string(),
  campaign: z.array(id),
  /** Short standalone missions, easiest first. */
  training: z.array(id).default([]),
  /** Official series played after the campaign, in order: each one is a season with its own world. */
  seasons: z.array(id).default([]),
  packs: z.array(
    z.object({
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
      incident: z.number().int().min(1970).max(2100).optional(),
      minutes: z.number().int().min(5).max(600).optional(),
      /** First and last day the pack changed in its repository (community catalogue only). */
      added: day.optional(),
      updated: day.optional(),
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

/**
 * The catalogue entry of a pack. `packs` holds the packs published with it, so that a series without
 * its own length estimate adds up its missions'.
 */
export function catalogEntry(
  pack: Pack,
  built: { file: string; sha256: string; size: number },
  packs: ReadonlyMap<string, Pack>,
  extra: { reviewed: boolean; added?: string; updated?: string },
): CatalogEntry {
  let minutes = pack.minutes;
  if (!minutes && pack.series) {
    const each = pack.series.missions.map((id) => packs.get(id)?.minutes);
    if (each.every((m) => m !== undefined))
      minutes = Math.min(
        600,
        each.reduce((a, b) => a + b, 0),
      );
  }
  return {
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
    ...(extra.added && extra.updated ? { added: extra.added, updated: extra.updated } : {}),
    ...(pack.series ? { missions: pack.series.missions } : {}),
    locales: pack.locales,
    ...built,
    reviewed: extra.reviewed,
  };
}

/**
 * A bundle gathers the packs of one author's work (a world, its missions, a series) with their
 * solutions, so that a player can import it from a file. Gzipped JSON, like a `.breachpack`.
 */
export const BUNDLE_FORMAT = 'breach-bundle/1';
export const MAX_BUNDLE_BYTES = 4_000_000;
export const bundleSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  packs: z
    .array(
      z.strictObject({
        pack: z.unknown(),
        solution: z.array(z.string().max(2000)).max(400).nullable(),
      }),
    )
    .min(1)
    .max(30),
});
export type Bundle = z.infer<typeof bundleSchema>;

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
