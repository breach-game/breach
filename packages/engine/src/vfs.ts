import type { FsSource } from '@breach/pack-schema';
import { buildArtifact, isArtifact } from './artifact.ts';

export interface FsDir {
  t: 'd';
  c: Record<string, FsNode>;
  owner: string;
  mode: number;
}
export interface FsFile {
  t: 'f';
  content: string;
  owner: string;
  mode: number;
}
export type FsNode = FsDir | FsFile;

/**
 * Directory entries live in an object without a prototype, and are only read as own properties, so
 * that names such as `__proto__` or `constructor` are ordinary file names.
 */
export const entries = (): Record<string, FsNode> => Object.create(null) as Record<string, FsNode>;
const own = (dir: FsDir, name: string): FsNode | undefined =>
  Object.hasOwn(dir.c, name) ? dir.c[name] : undefined;

export const mkdir = (owner = 'root', mode = 0o755): FsDir => ({ t: 'd', c: entries(), owner, mode });
export const mkfile = (content: string, owner = 'root', mode = 0o644): FsFile => ({
  t: 'f',
  content,
  owner,
  mode,
});

/** Build a tree from the pack's source form. `translate` resolves `$t` keys. */
export function buildFs(
  source: FsSource | undefined,
  translate: (key: string) => string,
  owner = 'root',
): FsDir {
  const root = mkdir(owner);
  if (
    source &&
    typeof source === 'object' &&
    !('$t' in source) &&
    !('$content' in source) &&
    !isArtifact(source)
  ) {
    for (const [name, child] of Object.entries(source))
      root.c[name] = buildNode(child as FsSource, translate, owner);
  }
  return root;
}

function buildNode(source: FsSource, translate: (key: string) => string, owner: string): FsNode {
  if (typeof source === 'string') return mkfile(source, owner);
  if (isArtifact(source)) {
    const meta = source as { $mode?: string; $owner?: string };
    return mkfile(
      buildArtifact(source, translate),
      meta.$owner ?? owner,
      meta.$mode ? Number.parseInt(meta.$mode, 8) : 0o644,
    );
  }
  if ('$t' in source || '$content' in source) {
    const meta = source as { $t?: string; $content?: string; $mode?: string; $owner?: string };
    const content = meta.$t !== undefined ? translate(meta.$t) : (meta.$content ?? '');
    return mkfile(content, meta.$owner ?? owner, meta.$mode ? Number.parseInt(meta.$mode, 8) : 0o644);
  }
  const dir = mkdir(owner);
  for (const [name, child] of Object.entries(source))
    dir.c[name] = buildNode(child as FsSource, translate, owner);
  return dir;
}

/** Give a subtree to a user (home directories). */
export function chown(node: FsNode, owner: string): void {
  if (node.owner === 'root') node.owner = owner;
  if (node.t === 'd') for (const child of Object.values(node.c)) chown(child, owner);
}

export function normalize(path: string, cwd: string, home: string): string {
  let p = path;
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
  if (!p.startsWith('/')) p = `${cwd}/${p}`;
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export function lookup(root: FsDir, abs: string): FsNode | undefined {
  let node: FsNode = root;
  for (const part of abs.split('/')) {
    if (!part) continue;
    if (node.t !== 'd') return undefined;
    const next: FsNode | undefined = own(node, part);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

export function canRead(node: FsNode, user: string): boolean {
  if (user === 'root' || node.owner === user) return (node.mode & 0o400) !== 0;
  return (node.mode & 0o004) !== 0;
}

export function canWrite(node: FsNode, user: string): boolean {
  if (user === 'root' || node.owner === user) return (node.mode & 0o200) !== 0;
  return (node.mode & 0o002) !== 0;
}

/** Create or replace a file. Parent directories must exist. Returns false when the parent is missing. */
export function writeFile(root: FsDir, abs: string, content: string, owner: string, append = false): boolean {
  const idx = abs.lastIndexOf('/');
  const parent = lookup(root, abs.slice(0, idx) || '/');
  const name = abs.slice(idx + 1);
  if (!parent || parent.t !== 'd' || !name) return false;
  const existing = own(parent, name);
  if (existing?.t === 'd') return false;
  if (existing && append) existing.content += content;
  else if (existing) existing.content = content;
  else parent.c[name] = mkfile(content, owner);
  return true;
}

/** Delete a file. Returns false when there is no such file. */
export function removeFile(root: FsDir, abs: string): boolean {
  const idx = abs.lastIndexOf('/');
  const parent = lookup(root, abs.slice(0, idx) || '/');
  const name = abs.slice(idx + 1);
  if (!parent || parent.t !== 'd' || own(parent, name)?.t !== 'f') return false;
  delete parent.c[name];
  return true;
}

export function mkdirp(root: FsDir, abs: string, owner: string): FsDir | undefined {
  let node: FsDir = root;
  for (const part of abs.split('/')) {
    if (!part) continue;
    const next = own(node, part);
    if (!next) {
      const created = mkdir(owner);
      node.c[part] = created;
      node = created;
    } else if (next.t === 'd') node = next;
    else return undefined;
  }
  return node;
}

export function modeString(node: FsNode): string {
  const bits = 'rwxrwxrwx';
  let s = node.t === 'd' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += node.mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
}

/** Shell-style glob for a single path segment: `*` and `?`. No regular expression from content. */
export function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      mark = t;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}
