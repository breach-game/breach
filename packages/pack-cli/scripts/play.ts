/**
 * Play a mission as a player would, one command per line of a file, at a given guidance level, and
 * print the briefing, the objectives, every command's output and everything Ada says.
 *
 * Usage: tsx scripts/play.ts <guided|standard|expert> <mission id> <commands file> [--from N] [--quiet]
 * - The commands file holds one command per line (blank lines and lines starting with # are skipped).
 *   Append a line and run again: the whole file is replayed (the engine is deterministic), and
 *   --from N prints the output of commands N and later only (1-based).
 * - In a series (official season or community series), the missions before this one are first
 *   played from their own solution.txt in the same game, as the player would have done.
 * - BREACH_CONTENT lists other content folders separated by ":", BREACH_LOCALE picks fr or en.
 */
import { readFileSync } from 'node:fs';
import { Game, stripAnsi } from '@breach/engine';
import { type LoadedPack, loadAll } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const quiet = args.includes('--quiet');
if (quiet) args.splice(args.indexOf('--quiet'), 1);
const from = Number(flag('--from') ?? '1');
const [level, missionId, file] = args;
if (!level || !missionId || !file) {
  console.error('usage: play.ts <guided|standard|expert> <mission id> <commands file> [--from N]');
  process.exit(2);
}

const roots = [
  new URL('../../../content', import.meta.url).pathname,
  ...(process.env.BREACH_CONTENT ?? '').split(':'),
];
const packs: LoadedPack[] = roots.filter(Boolean).flatMap((root) => loadAll(root));
const byId = new Map(packs.map((p) => [p.pack.id, p]));
const target = byId.get(missionId);
if (!target || target.pack.kind !== 'mission') {
  console.error(`no mission ${missionId}`);
  process.exit(2);
}
const mission = target.pack;
const world = byId.get(mission.requires[0]!)!.pack;
const series = packs.find((p) => p.pack.kind === 'series' && p.pack.series!.missions.includes(missionId));
const before = series
  ? series.pack.series!.missions.slice(0, series.pack.series!.missions.indexOf(missionId))
  : [];
const missions = packs
  .filter((p) => p.pack.kind === 'mission' && p.pack.requires[0] === world.id)
  .map((p) => p.pack);
const locale = process.env.BREACH_LOCALE === 'en' ? 'en' : 'fr';
const game = new Game({ world, missions, locale, guidance: level as never });
let seenBefore = 0;

for (const id of before) {
  const prior = byId.get(id)!;
  game.startMission(id);
  for (const line of prior.solution ?? []) for await (const _ of game.exec(line, 20_000));
  if (!game.state.missionDone) console.log(`!! earlier mission ${id} did not finish from its solution`);
}
if (before.length)
  console.log(`(series ${series!.pack.id}: played ${before.join(', ')} from their solutions)`);

seenBefore = game.state.messages.length;
game.startMission(missionId);
const m = mission.mission!;
console.log(`== ${mission.title[locale] ?? mission.id} · level ${game.guidance} · ${locale}`);
console.log(`BRIEFING: ${game.t(m.briefing)}`);
for (const o of m.objectives)
  console.log(`  OBJECTIVE ${o.id}${o.optional ? ' (optional)' : ''}: ${game.t(o.text)}`);

let seen = seenBefore;
const asked = new Set<string>();
const say = (msg: { key: string; tone?: string; vars?: unknown }) =>
  console.log(`   ADA${msg.tone === 'warn' ? '!' : ''}: ${game.t(msg.key, msg.vars as never)}`);
const flush = (show: boolean) => {
  if (game.state.messages.length < seen) {
    // A failure went back to the checkpoint: what Ada said after it is in the log, after `Restored`.
    const at = game.log.findLastIndex((e) => e.type === 'Restored');
    for (const e of game.log.slice(at + 1)) if (show && e.type === 'NpcMessage') say(e as never);
  } else for (const msg of game.state.messages.slice(seen)) if (show) say(msg);
  seen = game.state.messages.length;
  // Ada's multiple-choice questions show as buttons in the game: print them with their options.
  for (const id of Object.keys(game.state.asked)) {
    if (asked.has(id)) continue;
    asked.add(id);
    const q = m.questions.find((x) => x.id === id);
    if (!q || !show) continue;
    console.log(`   ADA ASKS (${id}): ${game.t(q.text)}`);
    for (const o of game.optionsOf(q)) console.log(`     - answer ${o.id}: ${game.t(o.text)}`);
  }
};
const status = () =>
  `   [${Object.entries(game.state.objectives)
    .map(([k, v]) => `${v ? '✓' : '·'}${k}`)
    .join(
      ' ',
    )}] noise=${game.state.noise.toFixed(0)} detections=${game.state.detections} done=${game.state.missionDone}`;
flush(true);

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
let n = 0;
for (const line of lines) {
  n++;
  const show = n >= from;
  let out = '';
  for await (const c of game.exec(line, 20_000)) if (c.k === 'out' || c.k === 'err') out += stripAnsi(c.text);
  if (show) {
    console.log(`\n$ [${n}] ${line}`);
    if (!quiet) console.log(out.replace(/\n$/, '').replace(/^/gm, '   | '));
  }
  flush(show);
  if (show) console.log(status());
}
if (game.state.missionDone) {
  const s = game.scoreDetail();
  console.log(`\n== MISSION DONE · score ${s.total} · level counted ${game.state.level ?? game.guidance}`);
  console.log(JSON.stringify(s));
}
