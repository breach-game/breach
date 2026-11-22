import { Game, stripAnsi } from '/home/user/breach/packages/engine/src/index.ts';
import { loadAll } from '/home/user/breach/packages/pack-cli/src/index.ts';

const packs = loadAll('/home/user/breach/content');
const world = packs.find((p) => p.pack.kind === 'world')!.pack;
const missions = packs.filter((p) => p.pack.kind === 'mission');
const id = process.argv[2]!;
const m = missions.find((p) => p.pack.id.endsWith(id))!;
const g = new Game({ world, missions: missions.map((p) => p.pack), locale: 'fr' });
g.startMission(m.pack.id);
for (const line of m.solution!) {
  for await (const c of g.exec(line, 20000)) {
  }
}
console.log('done', g.state.missionDone);
for (const l of g.socLines()) console.log(l.actor === 'player' ? '>>' : '  ', l.id, l.text);
