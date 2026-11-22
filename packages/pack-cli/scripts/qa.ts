/**
 * Play a list of commands at a given guidance level and print what Ada says after each one.
 * Usage: pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts <guided|standard|expert> <mission id> <none|head|full> "cmd ;; cmd ;; ..."
 * BREACH_CONTENT lists other content folders, separated by ":" (community packs, for instance), and
 * BREACH_LOCALE picks the language (fr by default).
 */
import { Game, stripAnsi } from '@breach/engine';
import { loadAll } from '../src/index.ts';

const roots = [
  new URL('../../../content', import.meta.url).pathname,
  ...(process.env.BREACH_CONTENT ?? '').split(':'),
];
const packs = roots.filter(Boolean).flatMap((root) => loadAll(root));
const [, , level, missionId, showOut, ...lines] = process.argv;
const mission = packs.find((p) => p.pack.id === missionId)!.pack;
const world = packs.find((p) => p.pack.id === mission.requires[0])!.pack;
const missions = packs
  .filter((p) => p.pack.kind === 'mission' && p.pack.requires[0] === world.id)
  .map((p) => p.pack);
const locale = process.env.BREACH_LOCALE === 'en' ? 'en' : 'fr';
const game = new Game({ world, missions, locale, guidance: level as never });
let seen = 0;
const flush = () => {
  for (const m of game.state.messages.slice(seen))
    console.log(`   ADA${m.tone === 'warn' ? '!' : ''} [${m.key}] ${game.t(m.key)}`);
  seen = game.state.messages.length;
};
const objs = () =>
  Object.entries(game.state.objectives)
    .map(([k, v]) => `${v ? '✓' : '·'}${k}`)
    .join(' ');
game.startMission(missionId!);
flush();
for (const line of lines.join(' ').split(' ;; ')) {
  let out = '';
  for await (const c of game.exec(line, 8000)) if (c.k === 'out' || c.k === 'err') out += stripAnsi(c.text);
  console.log(`$ ${line}`);
  if (showOut === 'full') console.log(out.replace(/^/gm, '   | '));
  else if (showOut === 'head') console.log(out.split('\n').slice(0, 6).join('\n').replace(/^/gm, '   | '));
  flush();
  console.log(
    `   [${objs()}] noise=${game.state.noise.toFixed(0)} done=${game.state.missionDone} det=${game.state.detections}`,
  );
}
