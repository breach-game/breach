import type {
  Condition,
  Detection,
  Effect,
  Fix,
  Guidance,
  Host,
  Locale,
  Matcher,
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
import { buildArtifact } from './artifact.ts';
import { acceptWording, BrainError, type BrainIssue, type NpcBrain, splitReply } from './brain.ts';
import { commands } from './commands/index.ts';
import type { Chunk, Command, CommandCtx } from './commands/types.ts';
import type { EventBody, GameEvent } from './events.ts';
import {
  errorHtml,
  findRoute,
  formatUrl,
  pageHtml,
  parseUrl,
  type RequestExtras,
  type Url,
  variantMatches,
} from './http.ts';
import { engineStrings, interpolate } from './i18n.ts';
import { filterMatches, parseFilter, underBase } from './ldap.ts';
import { resolveTarget } from './net.ts';
import { acceptHearing, type Decision, decide, type Heard, vocabulary } from './npc.ts';
import { evaluate, matches, triggerMatches } from './rules.ts';
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
import { gameDate, sanitizeTerminal, shuffled, stripAnsi, style } from './util.ts';
import {
  buildFs,
  canRead,
  canWrite,
  chown,
  type FsDir,
  globMatch,
  lookup,
  mkdir,
  mkdirp,
  normalize,
  removeFile,
  writeFile,
} from './vfs.ts';

export const ENGINE_VERSION = '0.13.0';

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
  /** Version of each mission pack loaded when the log was recorded. Missing from older saves. */
  missions?: Record<string, string>;
  locale: Locale;
  log: GameEvent[];
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  route: Route | undefined;
  /** The page that answered: the route's own, or the one of the variant that matched. */
  page: Route['page'];
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

/**
 * The level a mission is played at: the one asked for when the mission allows it, otherwise the
 * nearest allowed one, the less helpful on a tie. A challenge allowing only `expert` always gets it.
 */
export function allowedLevel(wanted: Guidance, levels: readonly Guidance[] | undefined): Guidance {
  if (!levels?.length || levels.includes(wanted)) return wanted;
  return [...levels].sort(
    (a, b) =>
      Math.abs(LEVEL_RANK[a] - LEVEL_RANK[wanted]) - Math.abs(LEVEL_RANK[b] - LEVEL_RANK[wanted]) ||
      LEVEL_RANK[b] - LEVEL_RANK[a],
  )[0]!;
}

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
  /** Points lost to wrong answers. */
  mistakes: number;
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

/** What a flag looks like in a text. */
const FLAG_SHAPE = /FLAG\{[^{}\s]{1,120}\}/gi;
const MAX_DT = 5 * 60_000;
const MAX_RULE_DEPTH = 8;

type HostSystem = NonNullable<Host['system']>;
/** What a host runs now, as `ps`, `ss`, `systemctl`, `journalctl` and `last` read it. */
export interface SystemView {
  processes: HostSystem['processes'];
  sockets: HostSystem['sockets'];
  services: HostSystem['services'];
  journal: HostSystem['journal'];
  logins: HostSystem['logins'];
}

export class Game {
  readonly world: World;
  readonly worldPack: Pack;
  readonly missions: Map<string, Pack>;
  state: GameState;
  /** A player setting, not game state: it only decides which messages get emitted from now on. */
  guidance: Guidance;
  /** The level the player asked for, kept to apply again when a mission without limits starts. */
  private wanted: Guidance;
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
    this.wanted = this.guidance;
    this.sandbox = options.sandbox ?? false;
    this.state = this.initialState(options.locale);
    if (options.log?.length) {
      this.replay(options.log);
      this.guidance = allowedLevel(this.wanted, this.levels);
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
  /** The name of the company under audit: the title of the world, in the player's language. */
  get target(): string {
    const title = this.worldPack.title;
    return title[this.state.locale] ?? title.fr ?? title.en ?? '';
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const locale = this.state.locale;
    const other: Locale = locale === 'fr' ? 'en' : 'fr';
    const mission = this.state.mission ? this.missions.get(this.state.mission) : undefined;
    for (const loc of [locale, other]) {
      const text = mission?.i18n[loc]?.[key] ?? this.worldPack.i18n[loc]?.[key] ?? engineStrings[loc][key];
      if (text !== undefined)
        return interpolate(text, {
          user: this.user,
          mandate: this.world.mandate,
          target: this.target,
          ...vars,
        });
    }
    // A message kept from an earlier mission (Ada's history, notes) still reads in that mission's words.
    for (const loc of [locale, other])
      for (const pack of this.missions.values()) {
        const text = pack.i18n[loc]?.[key];
        if (text !== undefined)
          return interpolate(text, {
            user: this.user,
            mandate: this.world.mandate,
            target: this.target,
            ...vars,
          });
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

  /** The guidance levels the current mission may be played at: all three unless its pack says. */
  get levels(): readonly Guidance[] | undefined {
    return this.state.mission ? this.missions.get(this.state.mission)?.levels : undefined;
  }

  /**
   * Change how much Ada helps. A player who asks for more help gets the pending instruction at once.
   * A mission that allows only some levels (a challenge) keeps to them, whatever is asked.
   */
  setGuidance(guidance: Guidance) {
    this.wanted = guidance;
    this.guidance = allowedLevel(guidance, this.levels);
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
      missions: Object.fromEntries([...this.missions.values()].map((m) => [m.id, m.version])),
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
      shown: [],
      noise: 0,
      hints: {},
      hintsUsed: 0,
      detections: 0,
      asked: {},
      choices: {},
      reviewed: {},
      deployed: {},
      toggles: {},
      ordered: {},
      traced: {},
      mistakes: 0,
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
        s.asked = {};
        s.reviewed = {};
        s.deployed = Object.fromEntries((mission?.releases ?? []).map((r) => [r.service, [r.current]]));
        s.toggles = Object.fromEntries((mission?.toggles ?? []).map((t) => [t.name, t.value]));
        s.ordered = {};
        s.traced = {};
        s.mistakes = 0;
        s.level = null;
        s.fired = {};
        s.guided = {};
        s.chats = {};
        s.vars = {};
        s.checkpoint = null;
        s.missionStartSeq = e.seq;
        // The clock only ever goes forward: a mission may start later than the previous one ended.
        if (mission?.startTime)
          s.clock = Math.max(s.clock, Date.parse(mission.startTime) - Date.parse(this.world.startTime));
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
          const content =
            typeof text === 'string'
              ? this.t(text)
              : buildArtifact(text, (k) => this.t(k), this.world.startTime);
          writeFile(s.fs, path, content, this.world.player.user);
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
        // An order may write on a machine the player never opened a session on.
        const fs = this.fsOf(s, e.host);
        if (!fs) break;
        const owner = e.host === s.host ? s.user : this.world.player.user;
        // An archive extracted in place creates its own folders.
        if (e.dirs) mkdirp(fs, e.path.slice(0, e.path.lastIndexOf('/')), owner);
        writeFile(fs, e.path, e.content, owner, e.append);
        break;
      }
      case 'FileRemoved': {
        const fs = this.fsOf(s, e.host);
        if (fs) removeFile(fs, e.path);
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
      case 'Asked':
        if (!(e.question in s.asked)) s.asked[e.question] = null;
        break;
      case 'Answered':
        if (e.correct) s.asked[e.question] = e.option;
        else s.mistakes++;
        if (e.impact) s.impact = Math.min(100, s.impact + e.impact);
        if (e.decision) (s.choices ??= {})[e.question] = e.option;
        break;
      case 'Deployed': {
        const history = (s.deployed[e.service] ??= []);
        if (e.rollback) history.pop();
        else history.push(e.version);
        if (!history.length) history.push(e.version);
        s.impact = Math.min(100, s.impact + e.impact);
        break;
      }
      case 'ToggleSet':
        s.toggles[e.name] = e.value;
        s.impact = Math.min(100, s.impact + e.impact);
        break;
      case 'TimelineOrdered':
        if (e.correct) s.ordered[e.timeline] = true;
        else s.mistakes++;
        break;
      case 'PathTraced':
        if (e.correct) s.traced[e.path] = true;
        else s.mistakes++;
        break;
      case 'Reviewed':
        if (!e.correct) s.mistakes++;
        else if (!s.reviewed[e.review]?.includes(e.line)) (s.reviewed[e.review] ??= []).push(e.line);
        break;
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
      case 'FlagShown':
        if (!s.shown.includes(e.value)) s.shown.push(e.value);
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
        if (e.blocked && e.stop !== false) {
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
      case 'ProgressCarried': {
        for (const [id, m] of Object.entries(e.missions))
          if (this.missions.has(id) && Number.isSafeInteger(m.score) && m.score >= 0)
            s.completed[id] = {
              score: m.score,
              ...(Number.isSafeInteger(m.defense) && m.defense! >= 0 ? { defense: m.defense } : {}),
            };
        // Every mission already finished: stay on the last one, its debrief still open to read.
        const last = this.campaign.at(-1);
        if (last && !this.nextMission()) {
          s.mission = last.id;
          s.missionDone = true;
        }
        break;
      }
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
        if (!triggerMatches(rule, event) || !this.holds(rule.if)) continue;
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

  /** Whether a condition of a pack holds now. */
  holds(cond: Condition | undefined): boolean {
    return evaluate(cond, this.state, { playerHost: this.world.player.host, home: this.playerHome });
  }

  private get playerHome(): string {
    return this.homeOf(this.world.player.host, this.world.player.user);
  }

  /**
   * Answer one of the questions Ada asked. The judge is the pack's `correct` option, nothing else.
   * Returns null when there is no such open question or option.
   */
  answer(
    questionId: string,
    optionId: string,
  ): { correct: boolean; why?: string; decision?: boolean; impact?: number } | null {
    const question = this.mission?.questions.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.id === optionId);
    if (!question || !option || this.state.asked[questionId] !== null || this.state.missionDone) return null;
    const why = option.why ? this.t(option.why) : undefined;
    if (question.correct === undefined) {
      // A decision: no option is wrong. The choice changes the target, then the rules react to it.
      for (const [key, value] of Object.entries(option.sets ?? {}))
        this.emit({ type: 'ConfigPatched', key, value, by: `${questionId}.${optionId}` });
      // What the choice leads to is told in the messenger, before the rules move the story on.
      if (option.why) this.emit({ type: 'NpcMessage', npc: 'ada', key: option.why, tone: 'info' });
      this.emit({
        type: 'Answered',
        question: questionId,
        option: optionId,
        correct: true,
        decision: true,
        ...(option.impact ? { impact: option.impact } : {}),
      });
      if (question.objective) this.completeObjective(question.objective);
      return { correct: true, why, decision: true, impact: option.impact ?? 0 };
    }
    const correct = option.id === question.correct;
    this.emit({ type: 'Answered', question: questionId, option: optionId, correct });
    if (correct && question.objective) this.completeObjective(question.objective);
    return { correct, why };
  }

  /** The hunt of the current mission whose rule lives in this file, if any. */
  huntOf(path: string) {
    const abs = this.resolvePath(path);
    const home = this.homeOf(this.world.player.host, this.world.player.user);
    if (this.state.host !== this.world.player.host) return undefined;
    return this.mission?.hunts.find((h) => `${home}/${h.file}` === abs);
  }

  /**
   * Try a detection rule the player wrote against the logs of the mission. It passes when it alerts
   * on every attacker line the pack wants caught and on no ordinary line. The judge is `runDetection`.
   */
  testRule(path: string, rule: Pick<Detection, 'source' | 'where' | 'count'>) {
    const lines = this.socLines();
    const result = runDetection(rule, lines);
    const hunt = this.huntOf(path);
    const wanted = hunt
      ? lines.filter((l) => l.actor !== 'background' && selects(l, hunt.catch.source, hunt.catch.where))
      : [];
    const caught = wanted.filter((l) => result.alerts.includes(l)).length;
    const missed = wanted.length - caught;
    const passed = hunt !== undefined && wanted.length > 0 && missed === 0 && result.falsePositives === 0;
    if (hunt && !this.state.missionDone) {
      this.emit({
        type: 'RuleTested',
        hunt: hunt.id,
        caught,
        missed,
        falsePositives: result.falsePositives,
        passed,
      });
      if (passed && hunt.objective) this.completeObjective(hunt.objective);
    }
    return { ...result, hunt, wanted: wanted.length, caughtWanted: caught, missed, passed };
  }

  /** The eval of the current mission whose guardrail lives in this file, if any. */
  evalOf(path: string) {
    const abs = this.resolvePath(path);
    const home = this.homeOf(this.world.player.host, this.world.player.user);
    if (this.state.host !== this.world.player.host) return undefined;
    return this.mission?.evals.find((e) => `${home}/${e.file}` === abs);
  }

  /**
   * Try a guardrail the player wrote against the cases of the mission. A case is blocked when it
   * meets every condition; a guardrail without any condition blocks everything. It passes when all
   * the attacks are blocked and no legitimate request is. Returns null when no eval reads this file.
   */
  runEval(path: string, where: Record<string, Matcher>) {
    const suite = this.evalOf(path);
    if (!suite) return null;
    const cases = suite.cases.map((c) => ({
      ...c,
      blocked: Object.entries(where).every(([name, matcher]) => matches(matcher, c.fields[name])),
    }));
    const attacks = cases.filter((c) => c.expect === 'block');
    const legit = cases.filter((c) => c.expect === 'allow');
    const blocked = attacks.filter((c) => c.blocked).length;
    const missed = attacks.length - blocked;
    const wrongly = legit.filter((c) => c.blocked).length;
    const passed = missed === 0 && wrongly === 0;
    if (!this.state.missionDone) {
      this.emit({ type: 'EvalRun', eval: suite.id, blocked, missed, wrongly, passed });
      if (passed && suite.objective) this.completeObjective(suite.objective);
    }
    return { cases, attacks: attacks.length, legit: legit.length, blocked, missed, wrongly, passed };
  }

  /**
   * The options of a question in the order the player sees them. A pack tends to write the right
   * answer at the same place every time, so the order is shuffled: always the same way for a given
   * question, so that a letter typed in a saved game or a solution keeps its meaning.
   */
  optionsOf<Q extends { id: string; options: { id: string }[] }>(question: Q): Q['options'] {
    return shuffled(question.options, `${this.state.mission ?? ''}/${question.id}`);
  }

  /** The code review of the current mission that reads this file, if any. */
  reviewOf(path: string) {
    const abs = this.resolvePath(path);
    const home = this.homeOf(this.world.player.host, this.world.player.user);
    if (this.state.host !== this.world.player.host) return undefined;
    return this.mission?.reviews.find((r) => `${home}/${r.file}` === abs);
  }

  /**
   * Name a line of a reviewed file as faulty. The judge is the pack's list of lines, nothing else.
   * Returns null when the file is not under review, or the review is over.
   */
  review(path: string, line: number): { correct: boolean; left: number; again: boolean } | null {
    const review = this.reviewOf(path);
    if (!review || this.state.missionDone) return null;
    const found = this.state.reviewed[review.id] ?? [];
    if (found.length >= review.lines.length) return null;
    if (found.includes(line)) return { correct: true, left: review.lines.length - found.length, again: true };
    const correct = review.lines.includes(line);
    this.emit({ type: 'Reviewed', review: review.id, line, correct });
    const left = review.lines.length - (this.state.reviewed[review.id]?.length ?? 0);
    if (correct && left === 0 && review.objective) this.completeObjective(review.objective);
    return { correct, left, again: false };
  }

  /* ---------- what a host runs, directories, deployments ---------- */

  /** What a host runs now: the world's entries and the mission's, those whose condition holds. */
  systemOf(hostId: string): SystemView {
    const parts = [this.host(hostId)?.system, this.mission?.systems[hostId]].filter(
      (x): x is NonNullable<Host['system']> => x !== undefined,
    );
    const keep = <T extends { if?: Condition }>(list: T[]) => list.filter((x) => this.holds(x.if));
    return {
      processes: keep(parts.flatMap((p) => p.processes)),
      sockets: keep(parts.flatMap((p) => p.sockets)),
      services: keep(parts.flatMap((p) => p.services)),
      journal: keep(parts.flatMap((p) => p.journal)),
      logins: keep(parts.flatMap((p) => p.logins)),
    };
  }

  /**
   * Search a directory. A bind works only with a listed account and its password; without one, the
   * search needs an anonymous directory. Returns null when the host has no directory.
   */
  ldapSearch(
    hostId: string,
    query: { base: string; filter: string; bind?: string; password?: string },
  ):
    | { ok: true; entries: NonNullable<Host['directory']>['entries'] }
    | { ok: false; code: 32 | 49 | 50 }
    | null {
    const dir = this.host(hostId)?.directory;
    if (!dir) return null;
    const bind = query.bind ?? '';
    let ok = true;
    let code: 32 | 49 | 50 = 50;
    if (bind) {
      const account = dir.binds.find(
        (b) => b.dn.toLowerCase() === bind.toLowerCase() && b.password === query.password && this.holds(b.if),
      );
      if (!account) {
        ok = false;
        code = 49;
      }
    } else if (!dir.anonymous) ok = false;
    let entries: NonNullable<Host['directory']>['entries'] = [];
    if (ok) {
      const filter = parseFilter(query.filter);
      if (!underBase(query.base, dir.base) && !underBase(dir.base, query.base)) {
        ok = false;
        code = 32;
      } else
        entries = dir.entries.filter(
          (e) => this.holds(e.if) && underBase(e.dn, query.base) && filterMatches(e, filter),
        );
    }
    this.emit({
      type: 'LdapSearch',
      host: hostId,
      base: query.base,
      filter: query.filter,
      bind,
      entries: entries.length,
      ok,
    });
    return ok ? { ok, entries } : { ok, code };
  }

  /** Put a version of a service in production, or take the previous one back. */
  deploy(service: string, version: string | null): { from: string; to: string } | string {
    const release = this.mission?.releases.find((r) => r.service === service);
    if (!release) return 'unknown';
    const history = this.state.deployed[service] ?? [release.current];
    const from = history.at(-1) ?? release.current;
    const to = version ?? history.at(-2);
    if (!to) return 'nothing';
    const target = release.versions.find((v) => v.version === to);
    if (!target) return 'version';
    if (to === from && version !== null) return 'same';
    this.emit({
      type: 'Deployed',
      service,
      version: to,
      from,
      rollback: version === null,
      impact: target.impact,
    });
    for (const [key, value] of Object.entries(target.sets))
      this.emit({ type: 'ConfigPatched', key, value, by: `deploy.${service}` });
    return { from, to };
  }

  /** Switch a feature flag of the target. */
  setToggle(name: string, value: 'on' | 'off'): boolean {
    const toggle = this.mission?.toggles.find((t) => t.name === name);
    if (!toggle) return false;
    if (this.state.toggles[name] === value) return true;
    this.emit({ type: 'ToggleSet', name, value, impact: toggle.impact });
    for (const [key, v] of Object.entries(toggle[value]))
      this.emit({ type: 'ConfigPatched', key, value: v, by: `flag.${name}` });
    return true;
  }

  /** The events of a timeline in the order the player sees them: never the right one. */
  timelineEvents(id: string) {
    const tl = this.mission?.timelines.find((t) => t.id === id);
    if (!tl) return null;
    let list = shuffled(tl.events, `${this.state.mission ?? ''}/${tl.id}`);
    if (list.every((e, i) => e.id === tl.events[i]?.id)) list = [...list.slice(1), list[0]!];
    return list;
  }

  /** Judge an order of a timeline's events. Null when there is no such timeline or it is done. */
  orderTimeline(id: string, order: string[]): { correct: boolean; placed: number; total: number } | null {
    const tl = this.mission?.timelines.find((t) => t.id === id);
    if (!tl || this.state.ordered[id] || this.state.missionDone) return null;
    const placed = tl.events.filter((e, i) => order[i] === e.id).length;
    const correct = order.length === tl.events.length && placed === tl.events.length;
    this.emit({ type: 'TimelineOrdered', timeline: id, correct, placed });
    if (correct && tl.objective) this.completeObjective(tl.objective);
    return { correct, placed, total: tl.events.length };
  }

  /** Judge the hosts named for an attack path, by id, hostname or address. */
  tracePath(id: string, names: string[]): { correct: boolean; unknown: string[] } | null {
    const path = this.mission?.paths.find((p) => p.id === id);
    if (!path || this.state.traced[id] || this.state.missionDone) return null;
    const unknown: string[] = [];
    const ids = names.map((raw) => {
      const n = raw.toLowerCase();
      const host = this.world.hosts.find(
        (h) => h.id === n || h.hostname === n || h.hostname.split('.')[0] === n || h.ip === n,
      );
      if (!host) unknown.push(raw);
      return host?.id ?? '';
    });
    if (unknown.length) return { correct: false, unknown };
    const correct = ids.length === path.hosts.length && ids.every((h, i) => h === path.hosts[i]);
    this.emit({ type: 'PathTraced', path: id, correct });
    if (correct && path.objective) this.completeObjective(path.objective);
    return { correct, unknown };
  }

  /** Questions asked and not yet settled, in the order of the pack. */
  openQuestions() {
    return (this.mission?.questions ?? []).filter((q) => this.state.asked[q.id] === null);
  }

  /** Run the mission's checks: the ones that hold complete their objective. */
  verify(): { id: string; text: string; ok: boolean }[] {
    const checks = this.mission?.checks ?? [];
    const results = checks.map((c) => ({ id: c.id, text: this.t(c.text), ok: this.holds(c.if) }));
    if (!checks.length) return results;
    // Objectives first, so that a rule reacting to `Verified` sees what this run settled.
    // An objective is done when all its checks pass, and so do the checks that name no objective:
    // those guard the whole repair (the file must still do its job).
    const ok = (c: (typeof checks)[number]) => !!results.find((r) => r.id === c.id)?.ok;
    const guards = checks.filter((c) => !c.objective).every(ok);
    for (const objective of new Set(checks.flatMap((c) => (c.objective ? [c.objective] : []))))
      if (guards && checks.filter((c) => c.objective === objective).every(ok))
        this.completeObjective(objective);
    this.emit({
      type: 'Verified',
      passed: results.filter((r) => r.ok).map((r) => r.id),
      failed: results.filter((r) => !r.ok).map((r) => r.id),
    });
    return results;
  }

  /**
   * Remember the flag-shaped values in a text the target just showed the player. `typed` is the
   * player's own line: a value they typed themselves was not shown to them.
   */
  private noteShown(text: string, typed = '') {
    if (this.replaying || !text.includes('{')) return;
    for (const found of text.match(FLAG_SHAPE) ?? []) {
      const value = found.replace(/^flag/i, 'FLAG');
      if (typed.toLowerCase().includes(found.toLowerCase()) || this.state.shown.includes(value)) continue;
      this.emit({ type: 'FlagShown', value });
    }
  }

  /** Whether a value may be submitted: anything that is not flag-shaped, or a flag the target showed. */
  wasShown(value: string): boolean {
    return !/^FLAG\{/.test(value) || this.state.shown.includes(value);
  }

  /** Text of a file for the workstation's editor: '' for a new file, null when it cannot be read. */
  readFile(path: string): string | null {
    const node = lookup(this.state.fs, this.resolvePath(path));
    if (!node) return '';
    const text = node.t === 'f' && canRead(node, this.currentUser) ? node.content : null;
    if (text) this.noteShown(text);
    return text;
  }

  /** Save a file from the workstation's editor. Returns false when it cannot be written there. */
  writeFile(path: string, content: string): boolean {
    const abs = this.resolvePath(path);
    const node = lookup(this.state.fs, abs);
    const parent = lookup(this.state.fs, abs.slice(0, abs.lastIndexOf('/')) || '/');
    if (node ? node.t !== 'f' || !canWrite(node, this.currentUser) : parent?.t !== 'd') return false;
    if (content.length > 64_000) return false;
    this.emit({ type: 'FileWritten', host: this.state.host, path: abs, content, append: false });
    return true;
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
    } else if ('ada.ask' in effect) {
      const id = effect['ada.ask'];
      if (!(id in this.state.asked) && this.mission?.questions.some((q) => q.id === id))
        this.emit({ type: 'Asked', question: id });
    }
  }

  /** The file system of a host, built from the pack the first time something touches it. */
  private fsOf(s: GameState, id: string): FsDir | undefined {
    if (s.filesystems[id]) return s.filesystems[id];
    const host = this.world.hosts.find((h) => h.id === id);
    if (!host) return undefined;
    s.filesystems[id] = this.hostFs(host, this.worldText(s.locale));
    return s.filesystems[id];
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
    const answers = (mission?.investigation ?? [])
      .filter((q) => this.state.answers?.[q.id])
      .reduce((sum, q) => sum + q.points, 0);
    const bonus = Math.round((flags + objectives + answers) * (LEVEL_BONUS[level] - 1));
    const hints = this.state.hintsUsed * 10;
    const detections = this.state.detections * 25;
    // Each point of business impact costs 3 points: isolating everything is never free.
    const impact = Math.round((this.state.impact ?? 0) * 3);
    const mistakes = this.state.mistakes * 10;
    const total = Math.max(0, flags + objectives + answers + bonus - hints - detections - impact - mistakes);
    return { level, flags, objectives, bonus, hints, detections, answers, impact, mistakes, total };
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
    const failed = this.failPending;
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
    // Ada's explanation was said after the checkpoint, so going back erased it: say it again, to stay.
    if (failed) {
      // A failed defence starts again from the workstation, whatever session the checkpoint was taken in.
      while (this.state.sessions.length) this.emit({ type: 'SessionClosed', host: this.state.host });
      this.emit({ type: 'NpcMessage', npc: 'ada', key: failed, tone: 'warn' });
    }
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

  /** The character a telephone number reaches, mission characters first. Spaces do not count. */
  phoneOf(number: string): Npc | undefined {
    const digits = (p: string) => p.replace(/[\s.-]/g, '');
    const wanted = digits(number);
    if (!wanted) return undefined;
    const all = [...(this.mission?.npcs ?? []), ...this.world.npcs];
    return all.find((n) => n.phone && digits(n.phone) === wanted);
  }

  /**
   * Telephone a character. It is a conversation like `chat`, decided by the same script; the
   * exchange records a call (`voice` log) instead of a chat line.
   */
  call(number: string, message: string): ChatResult & { npc?: Npc } {
    const npc = this.phoneOf(number);
    if (!npc) return { ok: false, reply: '' };
    const turn = this.openChat(npc.id, message, 'call', 0, undefined, npc.phone);
    if (!turn) return { ok: false, reply: '', npc };
    const reply = this.closeChat(turn);
    return reply === null ? { ok: false, reply: '', npc } : { ok: true, reply, brain: 'scripted', npc };
  }

  /**
   * Answer a simulated HTTP request. The caller has already taken `host` through the scope gate.
   * Nothing here touches the network: the answer is read from the world pack.
   */
  http(host: Host, url: Url, method: string, ua = 'curl/8.5.0', extras: RequestExtras = {}): HttpResponse {
    const product = host.services.find((s) => s.port === url.port)?.product ?? 'nginx';
    const route = findRoute(host, url.path);
    // A cookie or a header the request carries may get another answer from the same address.
    const variant =
      (method === 'POST' || method === 'PUBLISH') && route?.chat !== undefined
        ? undefined
        : route?.variants.find((v) => variantMatches(v, extras) && this.holds(v.if));
    const answer = variant ?? route;
    const status = answer?.status ?? 404;
    const body = !answer
      ? errorHtml(404, product)
      : answer.page
        ? pageHtml(answer.page, host, this.state.locale, (k) => this.t(k))
        : answer.artifact
          ? buildArtifact(answer.artifact, (k) => this.t(k), this.world.startTime)
          : answer.bodyKey
            ? this.t(answer.bodyKey)
            : (answer.body ?? '');
    // A chat endpoint answers what is posted to it: the log records the answer, not the 405 page.
    const chat = route?.chat !== undefined && (method === 'POST' || method === 'PUBLISH');
    const bytes = chat ? undefined : new TextEncoder().encode(body).length;
    this.emit({
      type: 'HttpRequest',
      host: host.id,
      path: url.path,
      method,
      status: chat ? 200 : status,
      ua,
      ...(bytes === undefined ? {} : { bytes }),
      ...(variant ? { variant: variant.id } : {}),
    });
    const headers = {
      server: product.replace(' ', '/'),
      date: this.date().unix,
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(new TextEncoder().encode(body).length),
      ...(answer?.headers ?? {}),
    };
    return { status, headers, body, route, page: answer?.page };
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
        page: res.page ?? null,
        source: res.body,
      };
    });
    if (result?.ok) this.noteShown(result.source);
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
    via: 'browser' | 'api' | 'call',
    dt: number,
    heard?: Heard,
    to?: string,
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
      this.emit({
        type: 'ChatSent',
        npc: npcId,
        text,
        via,
        ...(to ? { to } : {}),
        ...(heard ? { heard } : {}),
      });
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
      const reply = this.detectionPending ? null : (text ?? this.t(d.key));
      if (reply) this.noteShown(reply);
      return reply;
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
    this.takeStep(adv.id, step);
  }

  /** The attacker's step, and what it changes on the target when it goes through. */
  private takeStep(actor: string, step: NonNullable<Mission['adversary']>['steps'][number]) {
    const outcome = this.stepOutcome(step);
    this.emit({ type: 'AdversaryStep', actor, step: step.id, host: step.host, ...outcome });
    if (!outcome.blocked)
      for (const [key, value] of Object.entries(step.sets ?? {}))
        this.emit({ type: 'ConfigPatched', key, value, by: step.id });
  }

  private stepOutcome(step: NonNullable<Mission['adversary']>['steps'][number]) {
    const blocked = step.blockedIf ? evaluate(step.blockedIf, this.state) : false;
    return { blocked, stop: blocked && !step.continueIfBlocked };
  }

  /** Order a containment of the current defence mission. */
  contain(id: string) {
    const order = this.mission?.containment.find((c) => c.id === id);
    if (!order || this.state.contained[id]) return;
    this.emit({ type: 'Contained', containment: id, impact: order.impact });
    for (const [key, value] of Object.entries(order.sets))
      this.emit({ type: 'ConfigPatched', key, value, by: id });
    for (const r of order.removes) this.emit({ type: 'FileRemoved', host: r.host, path: r.path });
    for (const w of order.writes)
      this.emit({ type: 'FileWritten', host: w.host, path: w.path, content: w.content, append: false });
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
      if (evaluate(step.blockedIf, s)) this.takeStep(adv.id, step);
  }

  /* ---------- missions ---------- */

  startMission(id: string) {
    const pack = this.missions.get(id);
    if (!pack) throw new Error(`Unknown mission ${id}`);
    // Before the event: its rules and Ada's first guidance already follow the mission's levels.
    this.guidance = allowedLevel(this.wanted, pack.levels);
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
      let printed = '';
      try {
        while (!step.done) {
          const chunk = step.value;
          if (chunk.k === 'out' || chunk.k === 'err') {
            const text = sanitizeTerminal(chunk.text);
            // A flag may arrive in pieces: look at everything this line printed so far.
            printed += stripAnsi(text);
            this.noteShown(printed, line);
            yield { ...chunk, text };
          } else yield chunk;
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
