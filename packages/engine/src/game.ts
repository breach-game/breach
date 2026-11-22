import type { Effect, Host, Locale, Mission, NoiseTable, Pack, Rule, World } from '@breach/pack-schema';
import { commands } from './commands/index.ts';
import type { Chunk, Command, CommandCtx } from './commands/types.ts';
import type { EventBody, GameEvent } from './events.ts';
import { engineStrings, interpolate } from './i18n.ts';
import { evaluate, triggerMatches } from './rules.ts';
import { parse, ShellSyntaxError, type Stage, type Word } from './shell/parse.ts';
import { type GameState, NOISE_AFTER_RESTORE, NOISE_DECAY_PER_MIN, NOISE_MAX } from './state.ts';
import { gameDate, style } from './util.ts';
import { buildFs, chown, globMatch, lookup, mkdirp, normalize, writeFile } from './vfs.ts';

export const ENGINE_VERSION = '0.1.0';

export interface GameOptions {
  world: Pack;
  missions: Pack[];
  locale: Locale;
  /** A saved log to resume from. */
  log?: GameEvent[];
}

export interface SaveData {
  engine: string;
  world: { id: string; version: string };
  locale: Locale;
  log: GameEvent[];
}

type Listener = (event: GameEvent, game: Game) => void;

const MAX_DT = 5 * 60_000;
const MAX_RULE_DEPTH = 8;

export class Game {
  readonly world: World;
  readonly worldPack: Pack;
  readonly missions: Map<string, Pack>;
  state: GameState;
  log: GameEvent[] = [];
  private listeners = new Set<Listener>();
  private replaying = false;
  private ruleDepth = 0;
  private detectionPending = false;

  constructor(options: GameOptions) {
    if (!options.world.world) throw new Error(`${options.world.id} is not a world pack`);
    this.worldPack = options.world;
    this.world = options.world.world;
    this.missions = new Map(options.missions.map((m) => [m.id, m]));
    this.state = this.initialState(options.locale);
    if (options.log?.length) this.replay(options.log);
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

  get home(): string {
    return this.playerHost.users.find((u) => u.name === this.user)?.home ?? `/home/${this.user}`;
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
    const short = this.playerHost.hostname.split('.')[0];
    return `${style.bold(`${this.user}@${short}`)}${style.dim(':')}${style.cyan(cwd)}${style.dim('$')} `;
  }

  /** Translate a key: mission pack, then world pack, then engine strings. */
  t(key: string, vars?: Record<string, string | number>): string {
    const locale = this.state.locale;
    const other: Locale = locale === 'fr' ? 'en' : 'fr';
    const mission = this.state.mission ? this.missions.get(this.state.mission) : undefined;
    for (const loc of [locale, other]) {
      const text = mission?.i18n[loc]?.[key] ?? this.worldPack.i18n[loc]?.[key] ?? engineStrings[loc][key];
      if (text !== undefined) return interpolate(text, { user: this.user, mandate: this.world.mandate, ...vars });
    }
    return key;
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
    const event = { ...body, seq: this.log.length ? this.log[this.log.length - 1]!.seq + 1 : 1, t: this.state.clock } as GameEvent;
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
      fs: { t: 'd', c: {}, owner: 'root', mode: 0o755 },
      repos: {},
      discovered: {},
      revealed: {},
      objectives: {},
      flags: {},
      noise: 0,
      hints: {},
      hintsUsed: 0,
      detections: 0,
      notes: [],
      messages: [],
      vars: {},
      fired: {},
      checkpoint: null,
      missionStartSeq: 0,
      missionDone: false,
      completed: {},
      history: [],
    };
    const host = this.world.hosts.find((h) => h.id === this.world.player.host)!;
    const user = this.world.player.user;
    const translate = (key: string) => {
      const text = this.worldPack.i18n[locale]?.[key] ?? this.worldPack.i18n[locale === 'fr' ? 'en' : 'fr']?.[key] ?? key;
      return interpolate(text, { user, mandate: this.world.mandate });
    };
    state.fs = buildFs(host.fs, translate);
    for (const u of host.users) {
      const home = mkdirp(state.fs, u.home, u.name);
      if (home) {
        home.owner = u.name;
        chown(home, u.name);
      }
    }
    state.cwd = host.users.find((u) => u.name === user)?.home ?? '/';
    state.prevCwd = state.cwd;
    return state;
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
        s.fired = {};
        s.vars = {};
        s.checkpoint = null;
        s.missionStartSeq = e.seq;
        s.missionDone = false;
        for (const id of mission?.reveal ?? []) s.revealed[id] = true;
        break;
      }
      case 'CommandRun':
        decay(e.dt);
        if (e.line && s.history[s.history.length - 1] !== e.line) s.history.push(e.line);
        break;
      case 'ClockAdvanced':
        decay(e.ms);
        break;
      case 'CwdChanged':
        s.prevCwd = s.cwd;
        s.cwd = e.path;
        break;
      case 'FileWritten':
        if (e.host === this.world.player.host) writeFile(s.fs, e.path, e.content, this.world.player.user, e.append);
        break;
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
        const tree = buildFs(repo?.tree, (k) => k, this.world.player.user);
        const dir = mkdirp(s.fs, e.path, this.world.player.user);
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
      case 'MissionCompleted':
        s.missionDone = true;
        s.completed[e.mission] = { score: e.score };
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
    if (event.type === 'NoiseChanged' && event.value >= NOISE_MAX && !this.state.missionDone) {
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
  }

  private perform(effect: Effect) {
    if ('ada.say' in effect) this.emit({ type: 'NpcMessage', npc: 'ada', key: effect['ada.say'], tone: 'info' });
    else if ('ada.warn' in effect) this.emit({ type: 'NpcMessage', npc: 'ada', key: effect['ada.warn'], tone: 'warn' });
    else if ('objective.complete' in effect) this.completeObjective(effect['objective.complete']);
    else if ('noise.add' in effect) this.addNoise(effect['noise.add'], 'rule');
    else if ('host.reveal' in effect) this.emit({ type: 'HostRevealed', host: effect['host.reveal'] });
    else if ('checkpoint.save' in effect) this.emit({ type: 'CheckpointSaved', name: effect['checkpoint.save'] });
    else if ('var.set' in effect) this.emit({ type: 'VarSet', ...effect['var.set'] });
    else if ('note.add' in effect) this.emit({ type: 'NoteAdded', text: this.t(effect['note.add']) });
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
    const mission = this.mission;
    if (!mission) return 0;
    const flags = mission.flags.filter((f) => this.state.flags[f.id]).reduce((sum, f) => sum + f.points, 0);
    const objectives = Object.values(this.state.objectives).filter(Boolean).length * 50;
    return Math.max(0, flags + objectives - this.state.hintsUsed * 10 - this.state.detections * 25);
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
  }

  private reactToMissionStart() {
    const start = this.log[this.log.length - 1];
    if (start?.type === 'MissionStarted') this.react(start);
  }

  /* ---------- missions ---------- */

  startMission(id: string) {
    if (!this.missions.has(id)) throw new Error(`Unknown mission ${id}`);
    this.emit({ type: 'MissionStarted', mission: id });
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
    const env = { HOME: this.home, USER: this.user, PWD: this.state.cwd };
    const cleaned = line.replace(/\s2>\s*(&1|\/dev\/null)/g, '');
    let pipelines: ReturnType<typeof parse>;
    try {
      pipelines = parse(cleaned, env);
    } catch (error) {
      if (!(error instanceof ShellSyntaxError)) throw error;
      this.emit({ type: 'CommandRun', line, command: '', args: [], cwd: this.state.cwd, dt: Math.min(dt, MAX_DT) });
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
        const run = this.runStage(stage, stdin, !capture, line, first ? Math.min(dt, MAX_DT) : 0);
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
            this.emit({ type: 'FileWritten', host: this.world.player.host, path, content: captured, append: stage.redirect.append });
          else yield { k: 'err', text: `lrsh: ${stage.redirect.path.text}: No such file or directory\n` };
          captured = '';
        }
        stdin = captured;
      }
    }
    if (waited > 0) this.emit({ type: 'ClockAdvanced', ms: waited });
    if (this.detectionPending) {
      yield { k: 'err', text: `\n${style.red(this.t('engine.detected.line1'))}\n${style.yellow(this.t('engine.detected.line2'))}\n` };
      this.restore();
      return 130;
    }
    return status;
  }

  private async *runStage(stage: Stage, stdin: string | null, tty: boolean, line: string, dt: number): AsyncGenerator<Chunk, number> {
    const [name, ...args] = this.expand(stage.argv) as [string, ...string[]];
    this.emit({ type: 'CommandRun', line, command: name, args, cwd: this.state.cwd, dt });
    const command: Command | undefined = commands.get(name);
    if (!command) {
      const known = RESTRICTED.includes(name);
      yield { k: 'err', text: known ? `${name}: ${this.t('engine.restricted')}\n` : `lrsh: ${name}: command not found\n` };
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
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'vi', 'vim', 'nano', 'emacs', 'python', 'python3', 'perl',
  'ruby', 'node', 'bash', 'sh', 'zsh', 'apt', 'apt-get', 'pip', 'wget', 'nc', 'ncat', 'netcat', 'telnet', 'ftp',
  'scp', 'john', 'hydra', 'sqlmap', 'msfconsole', 'nikto', 'gobuster', 'ffuf', 'hashcat', 'tcpdump', 'wireshark',
  'traceroute', 'ps', 'top', 'kill', 'ifconfig', 'ip', 'netstat', 'ss', 'less', 'more', 'awk', 'sed', 'sort', 'uniq',
  'cut', 'tr', 'base64', 'xxd', 'strings', 'file', 'env', 'export', 'alias', 'which', 'su', 'docker', 'make', 'gcc',
];
