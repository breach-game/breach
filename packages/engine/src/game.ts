import type {
  Effect,
  Fix,
  Guidance,
  Host,
  Locale,
  Mission,
  NoiseTable,
  Npc,
  Pack,
  Page,
  Route,
  Rule,
  World,
} from '@breach/pack-schema';
import { FAMILIES } from '@breach/pack-schema';
import { acceptWording, BrainError, type BrainIssue, type NpcBrain, splitReply } from './brain.ts';
import { commands } from './commands/index.ts';
import type { Chunk, Command, CommandCtx } from './commands/types.ts';
import type { EventBody, GameEvent } from './events.ts';
import { errorHtml, findRoute, formatUrl, pageHtml, parseUrl, type Url } from './http.ts';
import { engineStrings, interpolate } from './i18n.ts';
import { resolveTarget } from './net.ts';
import { acceptHearing, type Decision, decide, type Heard, vocabulary } from './npc.ts';
import { evaluate, triggerMatches } from './rules.ts';
import { parse, ShellSyntaxError, type Stage, type Word } from './shell/parse.ts';
import {
  type DefenseState,
  type GameState,
  NOISE_AFTER_RESTORE,
  NOISE_DECAY_PER_MIN,
  NOISE_MAX,
  type Scalar,
} from './state.ts';
import { type LogLine, runDetection, selects, telemetry } from './telemetry.ts';
import { gameDate, sanitizeTerminal, stripAnsi, style } from './util.ts';
import { buildFs, chown, globMatch, lookup, mkdir, mkdirp, normalize, writeFile } from './vfs.ts';

export const ENGINE_VERSION = '0.3.0';

export interface GameOptions {
  world: Pack;
  missions: Pack[];
  locale: Locale;
  /** How much Ada helps. Defaults to `guided`. */
  guidance?: Guidance;
  /** A saved log to resume from. */
  log?: GameEvent[];
  /** A copy the defence replay plays an attack in: the SOC never catches it. */
  sandbox?: boolean;
}

/** One action of the player, played again in the defence replay. */
export type ReplayInput =
  | { kind: 'line'; line: string; dt: number }
  | { kind: 'chat'; npc: string; text: string; heard?: Heard };

export interface ReplayStep {
  input: ReplayInput;
  /** What the action printed in the replay without the fix, then with it. */
  before: string;
  after: string;
  changed: boolean;
  /** What the attack gained at this step without the fix and lost with it: flags, tool calls, objectives. */
  lost: string[];
}

export interface ReplayReport {
  fix: string;
  /** The attack no longer gets everything it got. */
  blocked: boolean;
  /** Index of the first step that lost something. */
  firstBlocked: number | null;
  steps: ReplayStep[];
}

/** Points of the defence replay, before the level's multiplier. */
const DEFENSE_POINTS = [80, 40, 20];

export interface SaveData {
  engine: string;
  world: { id: string; version: string };
  locale: Locale;
  log: GameEvent[];
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  route: Route | undefined;
}

export type BrowseResult =
  | {
      ok: true;
      url: string;
      host: Host;
      status: number;
      /** The page to draw, or null when the answer is not a page (plain text, JSON). */
      page: Page | null;
      /** What the server sent: shown by "view source", and identical to what `curl` prints. */
      source: string;
    }
  | { ok: false; url: string; error: 'malformed' | 'scope' | 'dns' | 'refused' };

export interface ChatResult {
  ok: boolean;
  /** The character's answer, in the game's language. */
  reply: string;
  /** What wrote the wording: the script, or a language model. */
  brain?: string;
  /** Why the model's wording was not used, when the script had to answer alone. */
  issue?: BrainIssue;
  /** What a model understood in the message, once checked, when it interpreted it. */
  heard?: Heard;
}

/** Wait for a model, but not forever. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BrainError('timeout')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Playing with less help multiplies the points earned. */
export const LEVEL_BONUS: Record<Guidance, number> = { guided: 1, standard: 1.25, expert: 1.5 };
const LEVEL_RANK: Record<Guidance, number> = { guided: 0, standard: 1, expert: 2 };

export interface ScoreDetail {
  level: Guidance;
  flags: number;
  objectives: number;
  /** Points added by the level. */
  bonus: number;
  /** Points lost to hints and to detections. */
  hints: number;
  detections: number;
  /** Defence missions: points of the investigation answers, and what the containment cost. */
  answers: number;
  impact: number;
  total: number;
}

/** How long a language model may take before the script answers alone. */
const BRAIN_TIMEOUT_MS = 20_000;

interface ChatTurn {
  npc: Npc;
  text: string;
  /** Sequence number of the player's message. */
  seq: number;
  mission: string | null;
  decision: Decision;
}

type Listener = (event: GameEvent, game: Game) => void;

const MAX_DT = 5 * 60_000;
const MAX_RULE_DEPTH = 8;

export class Game {
  readonly world: World;
  readonly worldPack: Pack;
  readonly missions: Map<string, Pack>;
  state: GameState;
  /** A player setting, not game state: it only decides which messages get emitted from now on. */
  guidance: Guidance;
  log: GameEvent[] = [];
  private listeners = new Set<Listener>();
  private replaying = false;
  private ruleDepth = 0;
  private detectionPending = false;
  /** True while the shell runs a command: it handles a detection itself when the command ends. */
  private busy = false;
  /** The attacker of a defence mission reached its goal: the mission goes back to its checkpoint. */
  private failPending: string | null = null;
  readonly sandbox: boolean;

  constructor(options: GameOptions) {
    if (!options.world.world) throw new Error(`${options.world.id} is not a world pack`);
    this.worldPack = options.world;
    this.world = options.world.world;
    this.missions = new Map(options.missions.map((m) => [m.id, m]));
    this.guidance = options.guidance ?? 'guided';
    this.sandbox = options.sandbox ?? false;
    this.state = this.initialState(options.locale);
    if (options.log?.length) {
      this.replay(options.log);
      // A save resumed at a more helpful level counts at that level.
      if (this.state.level !== null) this.syncLevel();
    }
  }

  /* ---------- accessors ---------- */

  get mission(): Mission | null {
    return this.state.mission ? (this.missions.get(this.state.mission)?.mission ?? null) : null;
  }

  get playerHost(): Host {
    return this.world.hosts.find((h) => h.id === this.world.player.host)!;
  }

  get user(): string {
    return this.world.player.user;
  }

  /** Home directory of the current session's user. */
  get home(): string {
    return this.homeOf(this.state.host, this.state.user);
  }

  /** Host the terminal runs on: the workstation, or a host reached by SSH. */
  get currentHost(): Host {
    return this.host(this.state.host) ?? this.playerHost;
  }

  /** User of the current session: the player on the workstation, the account logged into elsewhere. */
  get currentUser(): string {
    return this.state.user;
  }

  private homeOf(hostId: string, user: string): string {
    const host = this.host(hostId);
    return host?.users.find((u) => u.name === user)?.home ?? (user === 'root' ? '/root' : `/home/${user}`);
  }

  get campaign(): Pack[] {
    return [...this.missions.values()].sort((a, b) => (a.mission?.order ?? 0) - (b.mission?.order ?? 0));
  }

  nextMission(): Pack | null {
    return this.campaign.find((m) => !(m.id in this.state.completed)) ?? null;
  }

  host(id: string): Host | undefined {
    return this.world.hosts.find((h) => h.id === id);
  }

  date() {
    return gameDate(this.world.startTime, this.state.clock);
  }

  prompt(): string {
    const cwd = this.state.cwd === this.home ? '~' : this.state.cwd.replace(`${this.home}/`, '~/');
    const short = this.currentHost.hostname.split('.')[0];
    const who = `${this.state.user}@${short}`;
    // On a target host, the prompt turns red: the player is on someone else's machine.
    const remote = this.state.host !== this.world.player.host;
    return `${remote ? style.red(style.bold(who)) : style.bold(who)}${style.dim(':')}${style.cyan(cwd)}${style.dim('$')} `;
  }

  /** Translate a key: mission pack, then world pack, then engine strings. */
  t(key: string, vars?: Record<string, string | number>): string {
    const locale = this.state.locale;
    const other: Locale = locale === 'fr' ? 'en' : 'fr';
    const mission = this.state.mission ? this.missions.get(this.state.mission) : undefined;
    for (const loc of [locale, other]) {
      const text = mission?.i18n[loc]?.[key] ?? this.worldPack.i18n[loc]?.[key] ?? engineStrings[loc][key];
      if (text !== undefined)
        return interpolate(text, { user: this.user, mandate: this.world.mandate, ...vars });
    }
    // A message kept from an earlier mission (Ada's history, notes) still reads in that mission's words.
    for (const loc of [locale, other])
      for (const pack of this.missions.values()) {
        const text = pack.i18n[loc]?.[key];
        if (text !== undefined)
          return interpolate(text, { user: this.user, mandate: this.world.mandate, ...vars });
      }
    return key;
  }

  /** True when a mission or world pack defines this text in the current locale or the other one. */
  private hasText(key: string): boolean {
    const mission = this.state.mission ? this.missions.get(this.state.mission) : undefined;
    return (['fr', 'en'] as const).some(
      (loc) => (mission?.i18n[loc]?.[key] ?? this.worldPack.i18n[loc]?.[key]) !== undefined,
    );
  }

  /** Change how much Ada helps. A player who asks for more help gets the pending instruction at once. */
  setGuidance(guidance: Guidance) {
    this.guidance = guidance;
    this.syncLevel();
    this.nextStep();
  }

  /**
   * The score bonus goes to the most helpful level used during the mission, so asking for more
   * help lowers it for good and asking for less never raises it.
   */
  private syncLevel() {
    const s = this.state;
    if (!s.mission || s.missionDone) return;
    if (s.level === null || LEVEL_RANK[this.guidance] < LEVEL_RANK[s.level])
      this.emit({ type: 'GuidanceChanged', level: this.guidance });
  }

  /** Display name of the mission's attack stage. */
  stageName(): string {
    const stage = this.mission?.stage ?? '';
    const text = this.t(`stage.${stage}`);
    return text === `stage.${stage}` ? stage : text;
  }

  setLocale(locale: Locale) {
    this.state.locale = locale;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  save(): SaveData {
    return {
      engine: ENGINE_VERSION,
      world: { id: this.worldPack.id, version: this.worldPack.version },
      locale: this.state.locale,
      log: this.log,
    };
  }

  /* ---------- event log ---------- */

  emit(body: EventBody): GameEvent {
    const event = {
      ...body,
      seq: this.log.length ? this.log[this.log.length - 1]!.seq + 1 : 1,
      t: this.state.clock,
    } as GameEvent;
    this.log.push(event);
    this.apply(event);
    for (const listener of this.listeners) listener(event, this);
    if (!this.replaying) this.react(event);
    return event;
  }

  private replay(log: GameEvent[]) {
    this.replaying = true;
    this.state = this.initialState(this.state.locale);
    this.log = [];
    for (const event of log) {
      this.log.push(event);
      this.apply(event);
    }
    this.replaying = false;
  }

  private initialState(locale: Locale): GameState {
    const state: GameState = {
      locale,
      mission: null,
      clock: 0,
      cwd: '/',
      prevCwd: '/',
      host: this.world.player.host,
      user: this.world.player.user,
      sessions: [],
      fs: mkdir('root'),
      filesystems: {},
      repos: {},
      discovered: {},
      revealed: {},
      objectives: {},
      flags: {},
      noise: 0,
      hints: {},
      hintsUsed: 0,
      detections: 0,
      level: null,
      notes: [],
      messages: [],
      chats: {},
      vars: {},
      fired: {},
      guided: {},
      checkpoint: null,
      missionStartSeq: 0,
      missionDone: false,
      completed: {},
      history: [],
      config: { ...this.world.config },
      defense: null,
      adversary: { next: 0, actions: 0, stopped: false, blockedAt: null },
      impact: 0,
      contained: {},
      answers: {},
    };
    const host = this.world.hosts.find((h) => h.id === this.world.player.host)!;
    const user = this.world.player.user;
    const translate = this.worldText(locale);
    state.fs = this.hostFs(host, translate);
    state.filesystems[host.id] = state.fs;
    state.cwd = host.users.find((u) => u.name === user)?.home ?? '/';
    state.prevCwd = state.cwd;
    return state;
  }

  /** World text, for files: they are built before any mission's text applies. */
  private worldText(locale: Locale) {
    return (key: string) => {
      const text =
        this.worldPack.i18n[locale]?.[key] ??
        this.worldPack.i18n[locale === 'fr' ? 'en' : 'fr']?.[key] ??
        key;
      return interpolate(text, { user: this.world.player.user, mandate: this.world.mandate });
    };
  }

  /** A host's file system as the pack describes it, with a home directory for each of its users. */
  private hostFs(host: Host, translate: (key: string) => string) {
    const fs = buildFs(host.fs, translate);
    for (const u of host.users) {
      const home = mkdirp(fs, u.home, u.name);
      if (home) {
        home.owner = u.name;
        chown(home, u.name);
      }
    }
    return fs;
  }

  /** Leave every SSH session and come back to the workstation. */
  private leaveSessions(s: GameState) {
    const base = s.sessions[0];
    if (!base) return;
    s.sessions = [];
    s.host = base.host;
    s.user = base.user;
    s.cwd = base.cwd;
    s.prevCwd = base.prevCwd;
    s.fs = s.filesystems[base.host]!;
  }

  /** The reducer: the only place where state changes. */
  private apply(e: GameEvent) {
    const s = this.state;
    const decay = (ms: number) => {
      s.clock += ms;
      s.noise = Math.max(0, s.noise - (NOISE_DECAY_PER_MIN * ms) / 60_000);
    };
    switch (e.type) {
      case 'MissionStarted': {
        const mission = this.missions.get(e.mission)?.mission;
        s.mission = e.mission;
        s.objectives = Object.fromEntries((mission?.objectives ?? []).map((o) => [o.id, false]));
        s.flags = {};
        s.noise = 0;
        s.hints = {};
        s.hintsUsed = 0;
        s.detections = 0;
        s.level = null;
        s.fired = {};
        s.guided = {};
        s.chats = {};
        s.vars = {};
        s.checkpoint = null;
        s.missionStartSeq = e.seq;
        s.missionDone = false;
        s.config = { ...this.world.config, ...(mission?.config ?? {}) };
        s.defense = null;
        s.adversary = { next: 0, actions: 0, stopped: false, blockedAt: null };
        s.impact = 0;
        s.contained = {};
        s.answers = {};
        for (const id of mission?.reveal ?? []) s.revealed[id] = true;
        // A mission starts on the workstation, with its documents in the player's home directory.
        this.leaveSessions(s);
        const home = this.homeOf(this.world.player.host, this.world.player.user);
        for (const [rel, text] of Object.entries(mission?.files ?? {})) {
          const path = `${home}/${rel}`;
          mkdirp(s.fs, path.slice(0, path.lastIndexOf('/')), this.world.player.user);
          writeFile(s.fs, path, this.t(text), this.world.player.user);
        }
        break;
      }
      case 'SessionOpened': {
        const host = this.host(e.host);
        if (!host) break;
        s.sessions.push({ host: s.host, user: s.user, cwd: s.cwd, prevCwd: s.prevCwd });
        s.fs = s.filesystems[host.id] ??= this.hostFs(host, this.worldText(s.locale));
        s.host = host.id;
        s.user = e.user;
        s.cwd = lookup(s.fs, this.homeOf(host.id, e.user))?.t === 'd' ? this.homeOf(host.id, e.user) : '/';
        s.prevCwd = s.cwd;
        s.revealed[host.id] = true;
        s.discovered[host.id] ??= [];
        break;
      }
      case 'SessionClosed': {
        const back = s.sessions.pop();
        if (!back) break;
        s.host = back.host;
        s.user = back.user;
        s.cwd = back.cwd;
        s.prevCwd = back.prevCwd;
        s.fs = s.filesystems[back.host]!;
        break;
      }
      case 'CommandRun':
        decay(e.dt);
        if (e.line && s.history[s.history.length - 1] !== e.line) s.history.push(e.line);
        if (e.input) s.adversary.actions++;
        break;
      case 'ClockAdvanced':
        decay(e.ms);
        break;
      case 'CwdChanged':
        s.prevCwd = s.cwd;
        s.cwd = e.path;
        break;
      case 'FileWritten': {
        const fs = s.filesystems[e.host];
        if (fs)
          writeFile(fs, e.path, e.content, e.host === s.host ? s.user : this.world.player.user, e.append);
        break;
      }
      case 'HostDiscovered':
        s.discovered[e.host] ??= [];
        break;
      case 'ServiceDiscovered': {
        const ports = (s.discovered[e.host] ??= []);
        if (!ports.includes(e.port)) ports.push(e.port);
        break;
      }
      case 'HostRevealed':
        s.revealed[e.host] = true;
        break;
      case 'RepoCloned': {
        const repo = this.host(e.host)?.repos?.[e.repo];
        const tree = buildFs(repo?.tree, (k) => k, s.user);
        const dir = mkdirp(s.fs, e.path, s.user);
        if (dir) {
          dir.c = tree.c;
          s.repos[e.path] = { host: e.host, repo: e.repo };
        }
        break;
      }
      case 'FlagSubmitted':
        if (e.correct && e.flag) s.flags[e.flag] = true;
        break;
      case 'NpcMessage':
        s.messages.push({ seq: e.seq, t: e.t, npc: e.npc, key: e.key, tone: e.tone });
        if (e.guide) s.guided[e.guide.objective] = Math.max(s.guided[e.guide.objective] ?? 0, e.guide.step);
        break;
      case 'ChatSent':
        (s.chats[e.npc] ??= []).push({ seq: e.seq, t: e.t, from: 'player', text: e.text });
        break;
      case 'ChatReply':
        (s.chats[e.npc] ??= []).push({
          seq: e.seq,
          t: e.t,
          from: 'npc',
          key: e.key,
          text: e.text,
          intent: e.intent,
        });
        break;
      case 'ObjectiveCompleted':
        s.objectives[e.objective] = true;
        break;
      case 'NoiseChanged':
        s.noise = e.value;
        break;
      case 'HintUsed':
        s.hints[e.objective] = e.level;
        s.hintsUsed++;
        break;
      case 'NoteAdded':
        s.notes.push(e.text);
        break;
      case 'CheckpointSaved':
        s.checkpoint = { name: e.name, seq: e.seq };
        break;
      case 'Restored':
        s.noise = Math.min(s.noise, NOISE_AFTER_RESTORE);
        s.detections = e.detections;
        break;
      case 'VarSet':
        s.vars[e.name] = e.value;
        break;
      case 'RuleFired':
        s.fired[e.rule] = true;
        break;
      case 'GuidanceChanged':
        s.level = e.level;
        break;
      case 'MissionCompleted':
        s.missionDone = true;
        s.completed[e.mission] = { score: e.score };
        break;
      case 'ConfigPatched':
        s.config[e.key] = e.value;
        break;
      case 'DefenseStarted':
        s.defense = {
          found: false,
          wrongMarks: 0,
          findTries: 0,
          rule: null,
          ruleTries: 0,
          fix: null,
          fixTries: 0,
          done: false,
        };
        break;
      case 'DefenseFound':
        if (!s.defense) break;
        s.defense.findTries++;
        s.defense.wrongMarks += e.wrong.length;
        if (!e.missing.length && !e.wrong.length) s.defense.found = true;
        break;
      case 'DefenseRuleChosen':
        if (!s.defense || s.defense.rule) break;
        s.defense.ruleTries++;
        if (e.correct) s.defense.rule = e.rule;
        break;
      case 'DefenseFixApplied':
        if (!s.defense || s.defense.fix) break;
        s.defense.fixTries++;
        if (e.correct && e.blocked) s.defense.fix = e.fix;
        break;
      case 'DefenseCompleted': {
        if (s.defense) s.defense.done = true;
        const done = s.completed[e.mission];
        if (done) done.defense = e.points;
        break;
      }
      case 'AdversaryStep':
        s.adversary.next++;
        if (e.blocked) {
          s.adversary.stopped = true;
          s.adversary.blockedAt = e.step;
        }
        break;
      case 'Contained': {
        s.contained[e.containment] = true;
        s.impact = Math.min(100, s.impact + e.impact);
        break;
      }
      case 'AnswerSubmitted':
        if (e.correct && e.question) s.answers[e.question] = true;
        break;
      default:
        break;
    }
  }

  /* ---------- rules ---------- */

  private activeRules(): { id: string; rule: Rule }[] {
    const out: { id: string; rule: Rule }[] = [];
    this.world.rules.forEach((rule, i) => out.push({ id: rule.id ?? `world.${i}`, rule }));
    this.mission?.rules.forEach((rule, i) => out.push({ id: rule.id ?? `mission.${i}`, rule }));
    return out;
  }

  private react(event: GameEvent) {
    if (
      event.type === 'NoiseChanged' &&
      event.value >= NOISE_MAX &&
      !this.state.missionDone &&
      !this.sandbox
    ) {
      this.detectionPending = true;
      this.emit({ type: 'Detected' });
    }
    if (!this.state.mission || this.ruleDepth >= MAX_RULE_DEPTH) return;
    this.ruleDepth++;
    try {
      for (const { id, rule } of this.activeRules()) {
        if (rule.once && this.state.fired[id]) continue;
        if (!triggerMatches(rule, event) || !evaluate(rule.if, this.state)) continue;
        this.emit({ type: 'RuleFired', rule: id });
        for (const effect of rule.do) this.perform(effect);
      }
    } finally {
      this.ruleDepth--;
    }
    if (this.ruleDepth === 0) this.nextStep();
  }

  /** Say a piece of guidance, in the form the player's level calls for. */
  private guide(key: string, target?: { objective: string; step: number }) {
    if (this.state.missionDone) return;
    if (target) {
      if (this.state.objectives[target.objective]) return;
      if ((this.state.guided[target.objective] ?? -1) >= target.step) return;
    }
    const variant = `${key}.standard`;
    const say =
      this.guidance === 'guided'
        ? key
        : this.guidance === 'standard' && this.hasText(variant)
          ? variant
          : null;
    if (say) this.emit({ type: 'NpcMessage', npc: 'ada', key: say, tone: 'info', guide: target });
  }

  /** Whenever the first open objective has had no guidance yet, give its opening line. */
  private nextStep() {
    const mission = this.mission;
    if (!mission || this.state.missionDone || this.replaying) return;
    const open = mission.objectives.find((o) => !o.optional && !this.state.objectives[o.id]);
    const key = open && mission.guide[open.id];
    if (open && key && this.state.guided[open.id] === undefined)
      this.guide(key, { objective: open.id, step: 0 });
  }

  private perform(effect: Effect) {
    if ('ada.say' in effect)
      this.emit({ type: 'NpcMessage', npc: 'ada', key: effect['ada.say'], tone: 'info' });
    else if ('ada.guide' in effect) {
      const g = effect['ada.guide'];
      if (typeof g === 'string') this.guide(g);
      else this.guide(g.key, { objective: g.for, step: g.step });
    } else if ('ada.warn' in effect)
      this.emit({ type: 'NpcMessage', npc: 'ada', key: effect['ada.warn'], tone: 'warn' });
    else if ('objective.complete' in effect) this.completeObjective(effect['objective.complete']);
    else if ('noise.add' in effect) {
      const n = effect['noise.add'];
      if (typeof n === 'number') this.addNoise(n, 'rule');
      else this.addNoise(n.points, `soc:${n.as}`);
    } else if ('host.reveal' in effect) this.emit({ type: 'HostRevealed', host: effect['host.reveal'] });
    else if ('checkpoint.save' in effect)
      this.emit({ type: 'CheckpointSaved', name: effect['checkpoint.save'] });
    else if ('var.set' in effect) this.emit({ type: 'VarSet', ...effect['var.set'] });
    else if ('note.add' in effect) this.emit({ type: 'NoteAdded', text: this.t(effect['note.add']) });
    else if ('mission.fail' in effect) {
      if (this.state.missionDone || this.sandbox || this.failPending) return;
      this.emit({ type: 'NpcMessage', npc: 'ada', key: effect['mission.fail'], tone: 'warn' });
      this.emit({ type: 'MissionFailed', key: effect['mission.fail'] });
      this.failPending = effect['mission.fail'];
      this.detectionPending = true;
    }
  }

  completeObjective(id: string) {
    const mission = this.mission;
    if (!mission || !(id in this.state.objectives) || this.state.objectives[id]) return;
    this.emit({ type: 'ObjectiveCompleted', objective: id });
    const done = mission.objectives.every((o) => o.optional || this.state.objectives[o.id]);
    if (done && !this.state.missionDone)
      this.emit({ type: 'MissionCompleted', mission: this.state.mission!, score: this.score() });
  }

  score(): number {
    return this.scoreDetail().total;
  }

  /** How the score of the current mission adds up. */
  scoreDetail(): ScoreDetail {
    const mission = this.mission;
    const level = this.state.level ?? 'guided';
    const flags = (mission?.flags ?? [])
      .filter((f) => this.state.flags[f.id])
      .reduce((sum, f) => sum + f.points, 0);
    const objectives = Object.values(this.state.objectives).filter(Boolean).length * 50;
    const answers = (mission?.questions ?? [])
      .filter((q) => this.state.answers?.[q.id])
      .reduce((sum, q) => sum + q.points, 0);
    const bonus = Math.round((flags + objectives + answers) * (LEVEL_BONUS[level] - 1));
    const hints = this.state.hintsUsed * 10;
    const detections = this.state.detections * 25;
    // Each point of business impact costs 3 points: isolating everything is never free.
    const impact = Math.round((this.state.impact ?? 0) * 3);
    const total = Math.max(0, flags + objectives + answers + bonus - hints - detections - impact);
    return { level, flags, objectives, bonus, hints, detections, answers, impact, total };
  }

  /* ---------- noise and detection ---------- */

  addNoise(delta: number, cause: string) {
    if (!delta || this.state.missionDone) return;
    const value = Math.max(0, Math.min(NOISE_MAX, this.state.noise + delta));
    this.emit({ type: 'NoiseChanged', delta, value: Math.round(value * 10) / 10, cause });
  }

  /** Noise cost of a command line, from the mission's table, then the world's. */
  noiseCost(command: string, args: string[]): number {
    const tables: NoiseTable[] = [this.mission?.noise ?? {}, this.world.noise];
    const keys = [args[0] ? `${command} ${args[0]}` : '', command].filter(Boolean);
    for (const table of tables) {
      for (const key of keys) {
        const entry = table[key];
        if (entry === undefined) continue;
        if (typeof entry === 'number') return entry;
        let cost = entry.base;
        for (const [flag, extra] of Object.entries(entry.flags)) if (args.includes(flag)) cost += extra;
        return Math.max(0, cost);
      }
    }
    return 0;
  }

  /** Go back to the last checkpoint (or the mission start) after the SOC caught the player. */
  private restore() {
    this.detectionPending = false;
    this.failPending = null;
    const s = this.state;
    const detections = s.detections + 1;
    const anchor = s.checkpoint?.seq ?? s.missionStartSeq;
    const name = s.checkpoint?.name ?? 'start';
    const index = this.log.findIndex((e) => e.seq === anchor);
    const kept = this.log.slice(0, index + 1);
    const clock = s.clock;
    this.replay(kept);
    this.state.clock = Math.max(this.state.clock, clock);
    if (!s.checkpoint) this.reactToMissionStart();
    this.emit({ type: 'Restored', checkpoint: name, detections });
    this.syncLevel();
  }

  private reactToMissionStart() {
    const start = this.log[this.log.length - 1];
    if (start?.type === 'MissionStarted') this.react(start);
  }

  /* ---------- web and characters ---------- */

  /** A character of the current mission, or of the world. */
  npc(id: string): Npc | undefined {
    return this.mission?.npcs.find((n) => n.id === id) ?? this.world.npcs.find((n) => n.id === id);
  }

  /**
   * Answer a simulated HTTP request. The caller has already taken `host` through the scope gate.
   * Nothing here touches the network: the answer is read from the world pack.
   */
  http(host: Host, url: Url, method: string, ua = 'curl/8.5.0'): HttpResponse {
    const product = host.services.find((s) => s.port === url.port)?.product ?? 'nginx';
    const route = findRoute(host, url.path);
    const status = route?.status ?? 404;
    const body = !route
      ? errorHtml(404, product)
      : route.page
        ? pageHtml(route.page, host, this.state.locale, (k) => this.t(k))
        : route.bodyKey
          ? this.t(route.bodyKey)
          : (route.body ?? '');
    // A chat endpoint answers what is posted to it: the log records the answer, not the 405 page.
    const chat = route?.chat !== undefined && method === 'POST';
    const bytes = chat ? undefined : new TextEncoder().encode(body).length;
    this.emit({
      type: 'HttpRequest',
      host: host.id,
      path: url.path,
      method,
      status: chat ? 200 : status,
      ua,
      ...(bytes === undefined ? {} : { bytes }),
    });
    const headers = {
      server: product.replace(' ', '/'),
      date: this.date().unix,
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(new TextEncoder().encode(body).length),
      ...(route?.headers ?? {}),
    };
    return { status, headers, body, route };
  }

  /** Open a page in the workstation's browser. `dt` is the real time since the player's last action. */
  browse(raw: string, dt = 0): BrowseResult {
    const url = parseUrl(raw, 'https');
    if (!url) return { ok: false, url: raw, error: 'malformed' };
    const shown = formatUrl(url);
    if (dt > 0) this.emit({ type: 'ClockAdvanced', ms: Math.min(dt, MAX_DT) });
    const target = resolveTarget(this.world, url.hostname);
    if (target.kind === 'out-of-scope') {
      this.emit({ type: 'OutOfScope', target: url.hostname, command: 'browser' });
      return { ok: false, url: shown, error: 'scope' };
    }
    if (target.kind !== 'host') return { ok: false, url: shown, error: 'dns' };
    const host = target.host;
    this.addNoise(this.noiseCost('browse', []), `browser GET ${shown}`);
    const result = this.settle<BrowseResult>(() => {
      if (!host.services.some((s) => s.port === url.port) || !host.web)
        return { ok: false, url: shown, error: 'refused' };
      const res = this.http(host, url, 'GET', 'Mozilla/5.0 (X11; Linux x86_64) LR-OS/1.0');
      return {
        ok: true,
        url: shown,
        host,
        status: res.status,
        page: res.route?.page ?? null,
        source: res.body,
      };
    });
    return result ?? { ok: false, url: shown, error: 'refused' };
  }

  /**
   * Say something to a character. The scripted brain decides the answer, so what a character gives
   * away never depends on a language model.
   */
  chat(
    npcId: string,
    message: string,
    via: 'browser' | 'api' = 'browser',
    dt = 0,
    heard?: Heard,
  ): ChatResult {
    const turn = this.openChat(npcId, message, via, dt, heard);
    if (!turn) return { ok: false, reply: '' };
    const reply = this.closeChat(turn);
    return reply === null ? { ok: false, reply: '' } : { ok: true, reply, brain: 'scripted' };
  }

  /**
   * Same as `chat`, with a language model in up to two roles the player chose (see `NpcBrain`).
   * First the model may interpret the message (`hear`): what it understood is checked against the
   * character's vocabulary and the engine's families (`acceptHearing`) and only then given to the
   * scripted brain, which decides as usual. Then the model may word the decided reply (`reply`):
   * its text is checked (`acceptWording`). On any doubt, error or delay, the script works alone.
   */
  async converse(
    npcId: string,
    message: string,
    brain: NpcBrain | null,
    dt = 0,
    timeoutMs = BRAIN_TIMEOUT_MS,
  ): Promise<ChatResult> {
    const npc = this.npc(npcId);
    const said = message.trim().slice(0, 600);
    let heard: Heard | undefined;
    let issue: BrainIssue | undefined;
    if (brain?.hear && npc && said && !this.detectionPending) {
      const mission = this.state.mission;
      const mark = this.log.length;
      const last = this.log[mark - 1];
      try {
        const answer = await withTimeout(
          brain.hear({
            npcId,
            name: npc.name,
            role: this.t(npc.role),
            kind: npc.kind,
            history: this.chatHistory(npcId, Number.POSITIVE_INFINITY, 6),
            message: said,
            locale: this.state.locale,
            vocabulary: vocabulary(npc),
            families: FAMILIES,
          }),
          timeoutMs,
        );
        heard = acceptHearing(npc, answer) ?? undefined;
      } catch (error) {
        issue = error instanceof BrainError ? error.issue : 'error';
      }
      // The player may have been caught, or have left the mission, while the model was reading.
      const rewound = this.log[mark - 1] !== last;
      const restarted = this.log.slice(mark).some((e) => e.type === 'MissionStarted');
      if (this.state.mission !== mission || rewound || restarted) return { ok: false, reply: '' };
    }
    const turn = this.openChat(npcId, message, 'browser', dt, heard);
    if (!turn) return { ok: false, reply: '' };
    let text: string | undefined;
    if (brain?.reply) {
      const scripted = this.t(turn.decision.key);
      const { spoken, block } = splitReply(scripted);
      try {
        const answer = await withTimeout(
          brain.reply({
            npcId,
            name: turn.npc.name,
            role: this.t(turn.npc.role),
            kind: turn.npc.kind,
            sheet: turn.npc.sheet,
            history: this.chatHistory(npcId, turn.seq, 12),
            message: turn.text,
            locale: this.state.locale,
            scripted: spoken,
          }),
          timeoutMs,
        );
        const wording = acceptWording(spoken, answer.text);
        if (wording === null) issue = 'rejected';
        else text = wording + block;
      } catch (error) {
        issue = error instanceof BrainError ? error.issue : 'error';
      }
      // The player may have been caught, or have left the mission, while the model was writing.
      const line = this.state.chats[npcId]?.find((l) => l.seq === turn.seq);
      if (this.state.mission !== turn.mission || line?.from !== 'player' || line.text !== turn.text)
        return { ok: false, reply: '' };
    }
    const reply = this.closeChat(turn, text, brain?.id);
    if (reply === null) return { ok: false, reply: '' };
    return {
      ok: true,
      reply,
      brain: text === undefined ? 'scripted' : brain?.id,
      issue,
      ...(heard ? { heard } : {}),
    };
  }

  /** The last lines said to and by a character before `seq`, oldest first. */
  private chatHistory(npcId: string, before: number, count: number) {
    return (this.state.chats[npcId] ?? [])
      .filter((l) => l.seq < before)
      .slice(-count)
      .map((l) => ({ from: l.from, text: l.text ?? (l.key ? this.t(l.key) : '') }));
  }

  /** The player's half of an exchange: pay for the request, log the message, let the script decide. */
  private openChat(
    npcId: string,
    message: string,
    via: 'browser' | 'api',
    dt: number,
    heard?: Heard,
  ): ChatTurn | null {
    const npc = this.npc(npcId);
    // A file posted through the API (a CV, a document) may be longer than a chat message.
    const text = message.trim().slice(0, via === 'api' ? 4000 : 600);
    if (!npc || !text || this.detectionPending) return null;
    if (dt > 0) this.emit({ type: 'ClockAdvanced', ms: Math.min(dt, MAX_DT) });
    // Through the API, `curl` has already paid for the request.
    if (via === 'browser')
      this.addNoise(this.noiseCost('chat', [npcId]), `browser POST ${this.chatUrl(npcId)}`);
    return this.settle(() => {
      this.emit({ type: 'ChatSent', npc: npcId, text, via, ...(heard ? { heard } : {}) });
      const seq = this.log[this.log.length - 1]!.seq;
      const decision = decide(npc, text, this.state, heard);
      return { npc, text, seq, mission: this.state.mission, decision };
    });
  }

  /** The character's half. `text` is a model's wording of the decided reply, already checked. */
  private closeChat(turn: ChatTurn, text?: string, brain = 'scripted'): string | null {
    const d = turn.decision;
    return this.settle(() => {
      for (const [name, value] of Object.entries(d.set)) this.emit({ type: 'VarSet', name, value });
      // An agent acts before it reports: the mission judges the tool call, not the words.
      const tool = turn.npc.intents.find((i) => i.id === d.intent)?.tool;
      if (tool)
        this.emit({
          type: 'ToolCall',
          agent: turn.npc.id,
          tool: tool.name,
          args: tool.args,
          admin: tool.admin,
        });
      this.emit({
        type: 'ChatReply',
        npc: turn.npc.id,
        key: d.key,
        ...(text === undefined ? {} : { text }),
        intent: d.intent,
        families: d.families,
        brain: text === undefined ? 'scripted' : brain,
      });
      return this.detectionPending ? null : (text ?? this.t(d.key));
    });
  }

  /** Address of the endpoint a character answers on, for the logs. */
  private chatUrl(npcId: string): string {
    for (const host of this.world.hosts)
      for (const [path, route] of Object.entries(host.web ?? {}))
        if (route.chat === npcId) return `https://${host.hostname}${path}`;
    return npcId;
  }

  /**
   * Run an action taken outside the terminal. If it got the player caught, go back to the last
   * checkpoint, as the shell does at the end of a command, and return null.
   */
  private settle<T>(action: () => T | null): T | null {
    const value = this.detectionPending ? null : action();
    if (!this.detectionPending || this.busy) return value;
    this.restore();
    return null;
  }

  /* ---------- telemetry and defence ---------- */

  /** Sequence number of the current mission's completion, if it is done. */
  private missionEndSeq(): number | undefined {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i]!;
      if (e.seq < this.state.missionStartSeq) break;
      if (e.type === 'MissionCompleted') return e.seq;
    }
    return undefined;
  }

  /**
   * What the target's logs recorded during the current mission, the target's ordinary activity
   * included. In a finished attack mission, lines stop at the mission's end.
   */
  socLines(): LogLine[] {
    const attack = this.mission?.side !== 'defense';
    return telemetry(this, {
      from: this.state.missionStartSeq,
      to: attack ? this.missionEndSeq() : undefined,
      background: true,
      // A defence mission reads the logs live: nothing after the current time.
      ...(attack ? {} : { until: this.state.clock }),
    });
  }

  /** Open the defence replay of a finished attack mission. */
  startDefense() {
    const s = this.state;
    if (!s.missionDone || !this.mission?.defense || s.defense) return;
    this.emit({ type: 'DefenseStarted', mission: s.mission! });
  }

  /** Step 1: the player marks the lines they think are theirs. */
  markLines(ids: string[]): { ok: boolean; wrong: string[]; missing: number[] } {
    const d = this.mission?.defense;
    if (!d || !this.state.defense || this.state.defense.found) return { ok: false, wrong: [], missing: [] };
    const lines = this.socLines();
    const marked = lines.filter((l) => ids.includes(l.id));
    const wrong = marked.filter((l) => l.actor === 'background').map((l) => l.id);
    const mine = marked.filter((l) => l.actor !== 'background');
    const missing = d.find
      .map((f, i) => (mine.some((l) => selects(l, f.source, f.where)) ? -1 : i))
      .filter((i) => i >= 0);
    // A kind of line the player never produced (no noise, another path) cannot be asked for.
    const possible = missing.filter((i) =>
      lines.some((l) => l.actor !== 'background' && selects(l, d.find[i]!.source, d.find[i]!.where)),
    );
    this.emit({ type: 'DefenseFound', marked: mine.map((l) => l.id), wrong, missing: possible });
    this.completeDefenseIfReady();
    return { ok: !possible.length && !wrong.length, wrong, missing: possible };
  }

  /** What a detection rule would have raised over this mission's logs. Pure: emits nothing. */
  previewRule(id: string) {
    const rule =
      this.mission?.defense?.rules.find((r) => r.id === id) ?? this.mission?.alerts.find((r) => r.id === id);
    return rule ? runDetection(rule, this.socLines()) : null;
  }

  /** Step 2: the player picks the rule that would have caught them. */
  chooseRule(id: string): boolean {
    const rule = this.mission?.defense?.rules.find((r) => r.id === id);
    if (!rule || !this.state.defense || this.state.defense.rule) return false;
    this.emit({ type: 'DefenseRuleChosen', rule: id, correct: rule.correct });
    this.completeDefenseIfReady();
    return rule.correct;
  }

  /** Step 3: apply a fix to a copy of the target and replay the player's attack against it. */
  async applyFix(id: string): Promise<ReplayReport | null> {
    const fix = this.mission?.defense?.fixes.find((f) => f.id === id);
    if (!fix || !this.state.defense || this.state.defense.fix) return null;
    const report = await this.replayWith(fix);
    this.emit({ type: 'DefenseFixApplied', fix: id, correct: fix.correct, blocked: report.blocked });
    this.completeDefenseIfReady();
    return report;
  }

  /** Points of the defence replay so far, with the mission's level multiplier. */
  defensePoints(d: DefenseState = this.state.defense!): number {
    if (!d) return 0;
    const pick = (tries: number) => DEFENSE_POINTS[Math.min(Math.max(tries, 1), 3) - 1]!;
    const find = Math.max(20, 60 - 15 * d.wrongMarks - 10 * Math.max(0, d.findTries - 1));
    const rule = pick(d.ruleTries);
    const fix = this.mission?.defense?.fixes.length ? pick(d.fixTries) : 0;
    return Math.round((find + rule + fix) * LEVEL_BONUS[this.state.level ?? 'guided']);
  }

  private completeDefenseIfReady() {
    const d = this.state.defense;
    const defense = this.mission?.defense;
    if (!d || !defense || d.done || !d.found || !d.rule) return;
    if (defense.fixes.length && !d.fix) return;
    this.emit({ type: 'DefenseCompleted', mission: this.state.mission!, points: this.defensePoints(d) });
  }

  /** The player's actions during the current mission, in order, as the replay plays them again. */
  missionInputs(): { inputs: ReplayInput[]; firstSeq: number | null } {
    const end = this.missionEndSeq() ?? Number.POSITIVE_INFINITY;
    const start = this.state.missionStartSeq;
    const events = this.log.filter((e) => e.seq > start && e.seq <= end);
    // Saves made before inputs were marked: a new line starts when the text changes.
    const marked = events.some((e) => e.type === 'CommandRun' && e.input);
    const inputs: ReplayInput[] = [];
    let firstSeq: number | null = null;
    let lastLine: string | null = null;
    for (const e of events) {
      if (e.type === 'CommandRun') {
        const isInput = marked ? e.input === true : e.line !== lastLine;
        lastLine = e.line;
        if (!isInput) continue;
        firstSeq ??= e.seq;
        inputs.push({ kind: 'line', line: e.line, dt: e.dt });
      } else if (e.type === 'ChatSent' && e.via === 'browser') {
        lastLine = null;
        firstSeq ??= e.seq;
        inputs.push({
          kind: 'chat',
          npc: e.npc,
          text: e.text,
          ...(e.heard ? { heard: e.heard as Heard } : {}),
        });
      }
    }
    return { inputs, firstSeq };
  }

  /**
   * Replay the current mission's actions twice in sandboxes: against the target as it was, then
   * with the fix applied. A flag only counts in a replay if it was actually printed there first.
   */
  async replayWith(fix: Pick<Fix, 'id' | 'sets'>): Promise<ReplayReport> {
    const { inputs, firstSeq } = this.missionInputs();
    const cut = firstSeq === null ? this.log.length : this.log.findIndex((e) => e.seq === firstSeq);
    // Everything before the first action: earlier missions, and the mission's own start.
    const base = this.log.slice(0, cut).filter((e) => e.type !== 'DefenseStarted');
    const play = async (sets: Record<string, Scalar> | null) => {
      const g = new Game({
        world: this.worldPack,
        missions: [...this.missions.values()],
        locale: this.state.locale,
        guidance: this.guidance,
        log: base,
        sandbox: true,
      });
      if (sets)
        for (const [key, value] of Object.entries(sets))
          g.emit({ type: 'ConfigPatched', key, value, by: fix.id });
      let seen = '';
      const results: { output: string; gains: string[] }[] = [];
      for (const input of inputs) {
        const mark = g.log.length;
        let output = '';
        if (input.kind === 'line') {
          const flags = input.line.match(/FLAG\{[^}]*\}/gi) ?? [];
          const unseen =
            /^\s*submit\b/.test(input.line) && flags.some((f) => !seen.includes(f.replace(/^flag/i, 'FLAG')));
          if (unseen) output = this.t('defense.replay.unseen');
          else
            for await (const chunk of g.exec(input.line, input.dt))
              if (chunk.k === 'out' || chunk.k === 'err') output += stripAnsi(chunk.text);
        } else {
          const r = g.chat(input.npc, input.text, 'browser', 0, input.heard);
          output = r.reply;
        }
        seen += output;
        const gains = g.log
          .slice(mark)
          .flatMap((e) =>
            e.type === 'FlagSubmitted' && e.correct && e.flag
              ? [`flag:${e.flag}`]
              : e.type === 'ToolCall'
                ? [`tool:${e.tool}`]
                : e.type === 'ObjectiveCompleted'
                  ? [`objective:${e.objective}`]
                  : [],
          );
        results.push({ output: output.trim(), gains });
      }
      return results;
    };
    const before = await play(null);
    const after = await play(fix.sets);
    const gainedAfter = new Set(after.flatMap((r) => r.gains));
    const steps: ReplayStep[] = inputs.map((input, i) => {
      const b = before[i]!;
      const a = after[i]!;
      return {
        input,
        before: b.output,
        after: a.output,
        changed: b.output !== a.output,
        lost: b.gains.filter((g) => !gainedAfter.has(g)),
      };
    });
    const firstBlocked = steps.findIndex((st) => st.lost.length > 0);
    return {
      fix: fix.id,
      blocked: firstBlocked >= 0,
      firstBlocked: firstBlocked >= 0 ? firstBlocked : null,
      steps,
    };
  }

  /* ---------- defence missions ---------- */

  /** After each line the player types, the scripted attacker may take its next step. */
  private advanceAdversary() {
    const adv = this.mission?.adversary;
    const s = this.state;
    if (!adv || this.mission?.side !== 'defense' || this.replaying || s.missionDone || s.adversary.stopped)
      return;
    const acted = s.adversary.actions - adv.delay;
    if (acted <= 0 || acted % adv.pace !== 0) return;
    const step = adv.steps[s.adversary.next];
    if (!step) return;
    this.emit({
      type: 'AdversaryStep',
      actor: adv.id,
      step: step.id,
      host: step.host,
      blocked: step.blockedIf ? evaluate(step.blockedIf, s) : false,
    });
  }

  /** Order a containment of the current defence mission. */
  contain(id: string) {
    const order = this.mission?.containment.find((c) => c.id === id);
    if (!order || this.state.contained[id]) return;
    this.emit({ type: 'Contained', containment: id, impact: order.impact });
    for (const [key, value] of Object.entries(order.sets))
      this.emit({ type: 'ConfigPatched', key, value, by: id });
    // An attacker already inside feels it at once: his next step fails now, not at his next turn.
    const adv = this.mission?.adversary;
    const s = this.state;
    const step = adv?.steps[s.adversary.next];
    if (
      adv &&
      step?.blockedIf &&
      s.adversary.next > 0 &&
      !s.adversary.stopped &&
      !s.missionDone &&
      !this.replaying
    )
      if (evaluate(step.blockedIf, s))
        this.emit({ type: 'AdversaryStep', actor: adv.id, step: step.id, host: step.host, blocked: true });
  }

  /* ---------- missions ---------- */

  startMission(id: string) {
    if (!this.missions.has(id)) throw new Error(`Unknown mission ${id}`);
    this.emit({ type: 'MissionStarted', mission: id });
    this.syncLevel();
  }

  /* ---------- shell ---------- */

  resolvePath(path: string): string {
    return normalize(path, this.state.cwd, this.home);
  }

  private expand(words: Word[]): string[] {
    const out: string[] = [];
    for (const w of words) {
      let text = w.text;
      if (!w.quoted && (text === '~' || text.startsWith('~/'))) text = this.home + text.slice(1);
      if (!w.quoted && /[*?]/.test(text)) {
        const slash = text.lastIndexOf('/');
        const dirPart = slash === -1 ? '' : text.slice(0, slash + 1);
        const pattern = text.slice(slash + 1);
        const dir = lookup(this.state.fs, this.resolvePath(dirPart || '.'));
        if (dir?.t === 'd' && !/[*?]/.test(dirPart)) {
          const names = Object.keys(dir.c)
            .filter((n) => (pattern.startsWith('.') || !n.startsWith('.')) && globMatch(pattern, n))
            .sort();
          if (names.length) {
            out.push(...names.map((n) => dirPart + n));
            continue;
          }
        }
      }
      out.push(text);
    }
    return out;
  }

  /**
   * Run a command line. Output is streamed as chunks so the interface can type it out, wait where
   * the real tool would, and react to events at the right moment.
   * `dt` is the real time elapsed since the previous command, in milliseconds.
   */
  async *exec(line: string, dt = 0): AsyncGenerator<Chunk, number> {
    this.busy = true;
    try {
      // Pack text reaches the terminal through many commands: clean every chunk at the one exit.
      const run = this.run(line, dt);
      let step = await run.next();
      try {
        while (!step.done) {
          const chunk = step.value;
          yield chunk.k === 'out' || chunk.k === 'err'
            ? { ...chunk, text: sanitizeTerminal(chunk.text) }
            : chunk;
          step = await run.next();
        }
      } finally {
        // The caller stopped early: let the command finish its own cleanup.
        if (!step.done) await run.return(130);
      }
      return step.value;
    } finally {
      this.busy = false;
    }
  }

  private async *run(line: string, dt: number): AsyncGenerator<Chunk, number> {
    const env = { HOME: this.home, USER: this.state.user, PWD: this.state.cwd };
    const cleaned = line.replace(/\s2>\s*(&1|\/dev\/null)/g, '');
    let pipelines: ReturnType<typeof parse>;
    try {
      pipelines = parse(cleaned, env);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      this.emit({
        type: 'CommandRun',
        line,
        command: '',
        args: [],
        cwd: this.state.cwd,
        dt: Math.min(dt, MAX_DT),
        input: true,
      });
      yield { k: 'err', text: `lrsh: ${error.message}\n` };
      return 2;
    }
    let status = 0;
    let waited = 0;
    let first = true;
    outer: for (const pipeline of pipelines) {
      if (pipeline.op === '&&' && status !== 0) continue;
      if (pipeline.op === '||' && status === 0) continue;
      let stdin: string | null = null;
      for (let i = 0; i < pipeline.stages.length; i++) {
        const stage = pipeline.stages[i]!;
        const last = i === pipeline.stages.length - 1;
        const capture = !last || stage.redirect !== undefined;
        let captured = '';
        const run = this.runStage(stage, stdin, !capture, line, first ? Math.min(dt, MAX_DT) : 0, first);
        first = false;
        let step = await run.next();
        while (!step.done) {
          const chunk = step.value;
          if (chunk.k === 'wait') waited += chunk.ms;
          if (chunk.k === 'out' && capture) captured += chunk.text;
          else yield chunk;
          if (this.detectionPending) {
            await run.return(130);
            break outer;
          }
          step = await run.next();
        }
        status = step.done ? (step.value ?? 0) : 130;
        if (stage.redirect) {
          const path = this.resolvePath(this.expand([stage.redirect.path])[0]!);
          const ok = lookup(this.state.fs, path.slice(0, path.lastIndexOf('/')) || '/')?.t === 'd';
          if (ok)
            this.emit({
              type: 'FileWritten',
              host: this.state.host,
              path,
              content: captured,
              append: stage.redirect.append,
            });
          else yield { k: 'err', text: `lrsh: ${stage.redirect.path.text}: No such file or directory\n` };
          captured = '';
        }
        stdin = captured;
      }
    }
    if (waited > 0) this.emit({ type: 'ClockAdvanced', ms: waited });
    if (!this.detectionPending) this.advanceAdversary();
    if (this.failPending) {
      yield {
        k: 'err',
        text: `\n${style.red(this.t('engine.failed.line1'))}\n${style.yellow(this.t('engine.failed.line2'))}\n`,
      };
      this.restore();
      return 130;
    }
    if (this.detectionPending) {
      yield {
        k: 'err',
        text: `\n${style.red(this.t('engine.detected.line1'))}\n${style.yellow(this.t('engine.detected.line2'))}\n`,
      };
      this.restore();
      return 130;
    }
    return status;
  }

  private async *runStage(
    stage: Stage,
    stdin: string | null,
    tty: boolean,
    line: string,
    dt: number,
    input = false,
  ): AsyncGenerator<Chunk, number> {
    const [name, ...args] = this.expand(stage.argv) as [string, ...string[]];
    this.emit({
      type: 'CommandRun',
      line,
      command: name,
      args,
      cwd: this.state.cwd,
      dt,
      ...(input ? { input: true } : {}),
    });
    const command: Command | undefined = commands.get(name);
    if (!command) {
      if (/^FLAG\{[^}]*\}$/.test(name)) {
        yield { k: 'err', text: `${this.t('engine.flagHint', { flag: name })}\n` };
        return 127;
      }
      const known = RESTRICTED.includes(name);
      yield {
        k: 'err',
        text: known ? `${name}: ${this.t('engine.restricted')}\n` : `lrsh: ${name}: command not found\n`,
      };
      return 127;
    }
    const ctx: CommandCtx = {
      game: this,
      world: this.world,
      state: this.state,
      name,
      args,
      stdin,
      tty,
      t: (key, vars) => this.t(key, vars),
      emit: (body) => this.emit(body),
      path: (p) => this.resolvePath(p),
      noise: () => this.addNoise(this.noiseCost(name, args), [name, ...args].join(' ')),
    };
    // `ctx.state` must stay current even if the log is replayed mid-command.
    Object.defineProperty(ctx, 'state', { get: () => this.state });
    const status = yield* command.run(ctx);
    return status ?? 0;
  }

  /** Tab completion. Returns the start index of the word being completed and the candidates. */
  complete(line: string): { from: number; candidates: string[] } {
    const from = Math.max(line.lastIndexOf(' '), line.lastIndexOf('|'), line.lastIndexOf(';')) + 1;
    const word = line.slice(from);
    const before = line.slice(0, from).trim();
    const firstWord = before === '' || /[|;&]$/.test(before);
    const head = before.split(/\s+/)[0] ?? '';
    if (firstWord) return { from, candidates: [...commands.keys()].filter((c) => c.startsWith(word)).sort() };
    if (['explain', 'man', 'help'].includes(head))
      return { from, candidates: [...commands.keys()].filter((c) => c.startsWith(word)).sort() };
    const custom = commands.get(head)?.complete?.(before.split(/\s+/).slice(1), word);
    if (custom?.length) return { from, candidates: custom };
    const slash = word.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
    const prefix = word.slice(slash + 1);
    const dir = lookup(this.state.fs, this.resolvePath(dirPart || '.'));
    if (dir?.t !== 'd') return { from, candidates: [] };
    const candidates = Object.entries(dir.c)
      .filter(([n]) => n.startsWith(prefix) && (prefix.startsWith('.') || !n.startsWith('.')))
      .map(([n, node]) => dirPart + n + (node.t === 'd' ? '/' : ''))
      .sort();
    return { from, candidates };
  }
}

/** Real tools the player may try, which the training workstation does not provide. */
const RESTRICTED = [
  'rm',
  'mv',
  'cp',
  'mkdir',
  'touch',
  'chmod',
  'chown',
  'vi',
  'vim',
  'nano',
  'emacs',
  'python',
  'python3',
  'perl',
  'ruby',
  'node',
  'bash',
  'sh',
  'zsh',
  'apt',
  'apt-get',
  'pip',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'telnet',
  'ftp',
  'scp',
  'john',
  'hydra',
  'sqlmap',
  'msfconsole',
  'nikto',
  'gobuster',
  'ffuf',
  'hashcat',
  'tcpdump',
  'wireshark',
  'traceroute',
  'ps',
  'top',
  'kill',
  'ifconfig',
  'ip',
  'netstat',
  'ss',
  'less',
  'more',
  'awk',
  'sed',
  'sort',
  'uniq',
  'cut',
  'tr',
  'base64',
  'xxd',
  'strings',
  'file',
  'env',
  'export',
  'alias',
  'which',
  'su',
  'docker',
  'make',
  'gcc',
];
