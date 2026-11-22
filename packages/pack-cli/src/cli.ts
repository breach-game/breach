#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAll, checkAll, loadAll, replaySolution } from './index.ts';

const [command, root, ...rest] = process.argv.slice(2);

function usage(): never {
  console.error(`breach-pack: build and check BREACH content packs

  breach-pack check <content-dir>              validate packs and replay every solution
  breach-pack build <content-dir> --out <dir>  check, then write .breachpack files and index.json
  breach-pack play  <content-dir> <mission-id> print the transcript of a mission's solution`);
  process.exit(2);
}

if (!command || !root) usage();
const packs = loadAll(resolve(root));
if (!packs.length) {
  console.error(`No pack.yaml found under ${root}`);
  process.exit(1);
}

if (command === 'play') {
  const mission = packs.find((p) => p.pack.id === rest[0]);
  const world = packs.find((p) => p.pack.id === mission?.pack.requires[0]);
  if (!mission?.solution || !world) usage();
  const result = await replaySolution(world.pack, mission.pack, mission.solution, (rest[1] as 'fr' | 'en') ?? 'fr');
  console.log(result.transcript);
  console.log(result.done ? 'MISSION COMPLETE' : 'MISSION NOT COMPLETE');
  process.exit(result.done ? 0 : 1);
}

const problems = await checkAll(packs);
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`${packs.length} packs valid, solutions replayed: ${packs.map((p) => p.pack.id).join(', ')}`);

if (command === 'build') {
  const outIndex = rest.indexOf('--out');
  const out = outIndex === -1 ? undefined : rest[outIndex + 1];
  if (!out) usage();
  const dir = resolve(out);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { catalog, files } = buildAll(packs);
  for (const f of files) writeFileSync(join(dir, f.file), f.bytes);
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${files.length} packs and index.json to ${dir}`);
} else if (command !== 'check') usage();
