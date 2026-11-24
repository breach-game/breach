/**
 * Checking packs: schema, dependencies, translations, and the replay of every solution. Nothing here
 * touches the file system, so the game runs the same checks on a mission imported from a file.
 */
import { Game, runDetection, selects, stripAnsi } from '@breach/engine';
import { isOfficialId, type Locale, type Npc, type Pack } from '@breach/pack-schema';

export interface LoadedPack {
  dir: string;
  pack: Pack;
  solution: string[] | null;
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

/** How much longer than the longest wrong option the right one may be. */
const GIVEAWAY_RATIO = 1.3;

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
    if (!intent.words.length && !intent.families.length && !intent.input.length && !intent.if)
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

/**
 * A path only points: every step is a mission or a series that exists, among the packs checked or
 * the official ones they are checked with, and every note reads in every language of the path.
 */
function pathProblems(pack: Pack, byId: Map<string, LoadedPack>): string[] {
  const problems: string[] = [];
  for (const step of pack.path!.steps) {
    const target = byId.get(step.ref)?.pack;
    if (!target) problems.push(`${pack.id}: step ${step.ref} is not a known mission or series`);
    else if (target.kind !== 'mission' && target.kind !== 'series')
      problems.push(`${pack.id}: step ${step.ref} is a ${target.kind}, not a mission or a series`);
    if (step.note)
      for (const locale of pack.locales)
        if (pack.i18n[locale]?.[step.note] === undefined)
          problems.push(`${pack.id}: text key ${step.note} has no translation in ${locale}`);
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
    if (pack.kind === 'path') problems.push(...pathProblems(pack, byId));
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
      ...Object.values(m.files)
        .flatMap((f) =>
          typeof f === 'string'
            ? [f]
            : '$archive' in f
              ? Object.values(f.$archive.files).map((v) => (typeof v === 'string' ? v : v.$t))
              : [],
        )
        .filter(looksLikeKey),
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
      ...m.evals.flatMap((e) => e.cases.map((c) => c.text)),
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
    if (m.side === 'defense' && !m.adversary && !m.containment.length && !m.questions.length)
      problems.push(`${pack.id}: a defence mission needs an adversary, containment orders or questions`);
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
      // A decision has no right option: every one of its branches is replayed further down.
      if (q.correct === undefined) continue;
      if (!q.options.some((o) => o.id === q.correct))
        problems.push(`${pack.id}: question ${q.id} has no option ${q.correct}`);
      // A right answer much longer than every wrong one is found without reading the question.
      for (const locale of pack.locales) {
        const size = (key: string) => (pack.i18n[locale]?.[key] ?? '').length;
        const right = q.options.find((o) => o.id === q.correct);
        const wrong = Math.max(0, ...q.options.filter((o) => o.id !== q.correct).map((o) => size(o.text)));
        if (right && wrong > 0 && size(right.text) > wrong * GIVEAWAY_RATIO)
          problems.push(
            `${pack.id}: question ${q.id} (${locale}): the right option is much longer than the others, ` +
              'which gives it away. Make the wrong options as detailed, or shorten the right one',
          );
      }
    }
    for (const e of m.evals)
      if (e.objective && !objectiveIds.has(e.objective))
        problems.push(`${pack.id}: eval ${e.id} points to unknown objective ${e.objective}`);
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
    // Every branch of a decision must lead to the end: the solution is replayed once per option,
    // with that option in place of the one the solution takes.
    for (const q of m.questions.filter((q) => q.correct === undefined)) {
      const ids = q.options.map((o) => o.id);
      const at = solution.findIndex((line) => {
        const [cmd, pick] = line.trim().split(/\s+/);
        return cmd === 'answer' && ids.includes(pick ?? '');
      });
      if (at < 0) {
        problems.push(`${pack.id}: solution.txt never takes decision ${q.id} (answer <option id>)`);
        continue;
      }
      for (const option of ids) {
        const branch = solution.map((line, i) => (i === at ? `answer ${option}` : line));
        const result = await replaySolution(world, pack, branch, pack.locales[0]!);
        if (!result.done)
          problems.push(
            `${pack.id}: decision ${q.id}: the mission cannot be finished after choosing ${option}`,
          );
      }
    }
  }
  return problems;
}
