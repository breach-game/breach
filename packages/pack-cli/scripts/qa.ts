/**
 * Play a list of commands at a given guidance level and print what Ada says after each one.
 * Usage: pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts <guided|standard|expert> <mission id> <none|head|full> "cmd ;; cmd ;; ..."
 */
import { Game, stripAnsi } from '@breach/engine';
import { loadAll } from '../src/index.ts';

const packs = loadAll(new URL('../../../content', import.meta.url).pathname);
const world = packs.find((p) => p.pack.kind === 'world')!.pack;
const missions = packs.filter((p) => p.pack.kind === 'mission').map((p) => p.pack);
const [, , level, missionId, showOut, ...lines] = process.argv;
const game = new Game({ world, missions, locale: 'fr', guidance: level as never });
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
