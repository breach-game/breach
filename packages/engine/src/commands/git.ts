import type { Repo } from '@breach/pack-schema';
import { resolveTarget } from '../net.ts';
import { style } from '../util.ts';
import { lookup } from '../vfs.ts';
import { type Command, type CommandCtx, err, getopt, out, type Run, wait } from './types.ts';

type Commit = Repo['commits'][number];

/** Stretch a short commit id to 40 hex characters, always the same way. */
function fullId(id: string): string {
  let h = 0x811c9dc5;
  let full = id;
  while (full.length < 40) {
    for (const ch of full) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    full += h.toString(16).padStart(8, '0');
  }
  return full.slice(0, 40);
}

function findRepo(ctx: CommandCtx): { path: string; host: string; name: string; repo: Repo } | null {
  let dir = ctx.state.cwd;
  for (;;) {
    const origin = ctx.state.repos[dir];
    if (origin) {
      const repo = ctx.game.host(origin.host)?.repos?.[origin.repo];
      return repo ? { path: dir, host: origin.host, name: origin.repo, repo } : null;
    }
    if (dir === '/') return null;
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
  }
}

function header(c: Commit, tty: boolean): string {
  const id = `commit ${fullId(c.id)}`;
  return `${tty ? style.yellow(id) : id}\nAuthor: ${c.author}\nDate:   ${c.date}\n\n${c.message
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')}\n`;
}

function paintDiff(diff: string, tty: boolean): string {
  if (!tty) return diff;
  return diff
    .split('\n')
    .map((l) =>
      l.startsWith('+') && !l.startsWith('+++')
        ? style.green(l)
        : l.startsWith('-') && !l.startsWith('---')
          ? style.red(l)
          : l.startsWith('@@')
            ? style.cyan(l)
            : l,
    )
    .join('\n');
}

const NOT_A_REPO = 'fatal: not a git repository (or any of the parent directories): .git';

const git: Command = {
  name: 'git',
  summary: 'cmd.git',
  explain: 'explain.git',
  group: 'network',
  complete: (words, current) =>
    words.length === 0
      ? ['clone', 'log', 'show', 'status', 'remote'].filter((s) => s.startsWith(current))
      : [],
  async *run(ctx): Run {
    const [sub, ...args] = ctx.args;
    if (!sub || sub === '--help') {
      yield out(
        'usage: git <command> [<args>]\n\n   clone     Clone a repository into a new directory\n   log       Show commit logs\n   show      Show a commit and its changes\n   status    Show the working tree status\n   remote    Show the origin of the repository',
      );
      return sub ? 0 : 1;
    }
    if (sub === 'clone') {
      const { rest } = getopt(args, ['b', 'depth']);
      const url = rest[0];
      if (!url) {
        yield err('fatal: You must specify a repository to clone.');
        return 128;
      }
      const m = /^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(url);
      if (!m) {
        yield err(`fatal: repository '${url}' does not exist`);
        return 128;
      }
      const target = resolveTarget(ctx.world, m[1]!);
      if (target.kind === 'out-of-scope') {
        ctx.emit({ type: 'OutOfScope', target: m[1]!, command: 'git' });
        yield err(`git: ${ctx.t('engine.outOfScope', { target: m[1]! })}`);
        return 9;
      }
      const repo = target.kind === 'host' ? target.host.repos?.[m[2]!] : undefined;
      const dirName = rest[1] ?? m[2]!.split('/').pop()!;
      yield out(`Cloning into '${dirName}'...`);
      ctx.noise();
      yield wait(500);
      if (target.kind !== 'host' || !repo) {
        yield err(
          target.kind === 'host'
            ? `remote: Not found.\nfatal: repository '${url}' not found`
            : `fatal: unable to access '${url}': Could not resolve host: ${m[1]}`,
        );
        return 128;
      }
      const path = ctx.path(dirName);
      if (lookup(ctx.state.fs, path)) {
        yield err(`fatal: destination path '${dirName}' already exists and is not an empty directory.`);
        return 128;
      }
      const n = repo.commits.length * 3;
      yield out(
        `remote: Enumerating objects: ${n}, done.\nremote: Counting objects: 100% (${n}/${n}), done.\nremote: Total ${n} (delta ${Math.floor(n / 4)}), reused ${n} (delta ${Math.floor(n / 4)}), pack-reused 0`,
      );
      yield wait(400);
      yield out(`Receiving objects: 100% (${n}/${n}), done.`);
      ctx.emit({ type: 'RepoCloned', host: target.host.id, repo: m[2]!, path });
      return 0;
    }
    const found = findRepo(ctx);
    if (sub === 'log') {
      if (!found) {
        yield err(NOT_A_REPO);
        return 128;
      }
      const { flags, values } = getopt(
        args.map((a) => (a === '--oneline' ? '--oneline' : a)),
        ['n'],
      );
      const limit = values.n ? Number(values.n) : found.repo.commits.length;
      for (const c of found.repo.commits.slice(0, limit)) {
        if (flags.has('oneline')) {
          yield out(
            `${ctx.tty ? style.yellow(c.id.slice(0, 7)) : c.id.slice(0, 7)} ${c.message.split('\n')[0]}`,
          );
        } else {
          yield out(header(c, ctx.tty));
          if (flags.has('p')) {
            ctx.emit({ type: 'CommitViewed', host: found.host, repo: found.name, commit: c.id });
            yield out(`${paintDiff(c.diff, ctx.tty)}\n`);
          }
        }
      }
      return 0;
    }
    if (sub === 'show') {
      if (!found) {
        yield err(NOT_A_REPO);
        return 128;
      }
      const ref = args.find((a) => !a.startsWith('-')) ?? 'HEAD';
      const back = /^HEAD(?:~(\d+)|(\^+))?$/.exec(ref);
      const commit = back
        ? found.repo.commits[back[1] ? Number(back[1]) : (back[2]?.length ?? 0)]
        : found.repo.commits.find((c) => fullId(c.id).startsWith(ref.toLowerCase()) && ref.length >= 4);
      if (!commit) {
        yield err(`fatal: ambiguous argument '${ref}': unknown revision or path not in the working tree.`);
        return 128;
      }
      ctx.emit({ type: 'CommitViewed', host: found.host, repo: found.name, commit: commit.id });
      yield out(`${header(commit, ctx.tty)}\n${paintDiff(commit.diff, ctx.tty)}`);
      return 0;
    }
    if (sub === 'status') {
      if (!found) {
        yield err(NOT_A_REPO);
        return 128;
      }
      yield out(
        "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean",
      );
      return 0;
    }
    if (sub === 'remote') {
      if (!found) {
        yield err(NOT_A_REPO);
        return 128;
      }
      const url = `https://${ctx.game.host(found.host)?.hostname}/${found.name}.git`;
      yield out(args.includes('-v') ? `origin\t${url} (fetch)\norigin\t${url} (push)` : 'origin');
      return 0;
    }
    if (
      [
        'branch',
        'diff',
        'checkout',
        'pull',
        'fetch',
        'push',
        'commit',
        'add',
        'blame',
        'grep',
        'stash',
        'reset',
      ].includes(sub)
    ) {
      yield err(`git: '${sub}' ${ctx.t('engine.gitUnavailable')}`);
      return 1;
    }
    yield err(`git: '${sub}' is not a git command. See 'git --help'.`);
    return 1;
  },
};

export const gitCommands: Command[] = [git];
