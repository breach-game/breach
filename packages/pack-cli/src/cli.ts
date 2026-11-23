#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifySignature } from '@breach/pack-schema';
import {
  buildAll,
  checkAll,
  generateKeys,
  type LoadedPack,
  loadAll,
  replaySolution,
  signBytes,
} from './index.ts';

const args = process.argv.slice(2);

/** First and last day a pack's folder changed in git. A folder git does not know counts as today. */
function packDates(dir: string): { added: string; updated: string } {
  const days = execFileSync('git', ['log', '--format=%cs', '--', '.'], { cwd: dir, encoding: 'utf8' })
    .split('\n')
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const today = new Date().toISOString().slice(0, 10);
  return { added: days.at(-1) ?? today, updated: days[0] ?? today };
}

function usage(): never {
  console.error(`breach-pack: build and check BREACH content packs

  breach-pack check <content-dir> [options]               validate packs and replay every solution
  breach-pack build <content-dir> --out <dir> [options]   check, then write .breachpack files and index.json
  breach-pack play  <content-dir> <mission-id> [fr|en] [options]
                                                          print the transcript of a mission's solution
  breach-pack keygen                                      print a new catalogue signing key pair
  breach-pack sign  <index.json>                          write <index.json>.sig with the key in
                                                          the BREACH_SIGNING_KEY environment variable

options:
  --with <dir>    packs that the checked packs may require (for example the game's content/ folder);
                  they are used, not checked, and cannot be overridden
  --community     apply the community catalogue rules (no "breach." id, no campaign)
  --git-dates     (build) list the first and last day each pack changed, read from git`);
  process.exit(2);
}

/** Pull `--name value` (repeatable) and `--flag` out of the argument list. */
function option(name: string): string[] {
  const values: string[] = [];
  for (let i = args.indexOf(name); i !== -1; i = args.indexOf(name)) {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) usage();
    values.push(value);
    args.splice(i, 2);
  }
  return values;
}
function flag(name: string): boolean {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
}

const withDirs = option('--with');
const out = option('--out')[0];
const community = flag('--community');
const gitDates = flag('--git-dates');
const [command, root, ...rest] = args;

if (command === 'keygen') {
  const keys = generateKeys();
  console.log(`Public key (put it in the game, apps/game/src/community.ts):\n${keys.publicKey}\n`);
  console.log(
    `Private key (store it as the BREACH_SIGNING_KEY secret, never in a repository):\n${keys.privateKey}`,
  );
  process.exit(0);
}

if (command === 'sign') {
  const privateKey = process.env.BREACH_SIGNING_KEY;
  if (!root) usage();
  if (!privateKey) {
    console.error('BREACH_SIGNING_KEY is not set');
    process.exit(1);
  }
  const bytes = readFileSync(resolve(root));
  const signature = signBytes(bytes, privateKey);
  writeFileSync(`${resolve(root)}.sig`, `${signature}\n`);
  const publicKey = process.env.BREACH_PUBLIC_KEY;
  if (publicKey && !(await verifySignature(new Uint8Array(bytes), signature, publicKey))) {
    console.error('The signature does not match BREACH_PUBLIC_KEY: is it the key the game expects?');
    process.exit(1);
  }
  console.log(`Signed ${root}`);
  process.exit(0);
}

if (!command || !root) usage();
let packs: LoadedPack[] = [];
let dependencies: LoadedPack[] = [];
try {
  packs = loadAll(resolve(root));
  dependencies = withDirs.flatMap((dir) => loadAll(resolve(dir)));
} catch (error) {
  // A pack that does not even parse: show the schema's message, not a stack trace.
  console.error(`  ✗ ${(error as Error).message}`);
  process.exit(1);
}
if (!packs.length) {
  console.error(`No pack.yaml found under ${root}`);
  process.exit(1);
}

if (command === 'play') {
  const mission = packs.find((p) => p.pack.id === rest[0]);
  const all = [...packs, ...dependencies];
  const world = all.find((p) => p.pack.id === mission?.pack.requires[0]);
  if (!mission?.solution || !world) usage();
  const result = await replaySolution(
    world.pack,
    mission.pack,
    mission.solution,
    (rest[1] as 'fr' | 'en') ?? 'fr',
  );
  console.log(result.transcript);
  console.log(result.done ? 'MISSION COMPLETE' : 'MISSION NOT COMPLETE');
  process.exit(result.done ? 0 : 1);
}

if (command !== 'check' && command !== 'build') usage();
const problems = await checkAll(packs, { dependencies, community });
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`${packs.length} packs valid, solutions replayed: ${packs.map((p) => p.pack.id).join(', ')}`);

if (command === 'build') {
  if (!out) usage();
  const dir = resolve(out);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const dates = gitDates ? Object.fromEntries(packs.map((p) => [p.pack.id, packDates(p.dir)])) : undefined;
  const { catalog, files } = buildAll(packs, new Date(), { community, dates });
  for (const f of files) writeFileSync(join(dir, f.file), f.bytes);
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${files.length} packs and index.json to ${dir}`);
}
