import { Game } from '/home/user/breach/packages/engine/src/index.ts';
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
g.startDefense();
const d = m.pack.mission!.defense!;
const lines = g.socLines();
for (const r of d.rules) {
  const p = g.previewRule(r.id)!;
  console.log('rule', r.id, r.correct, 'caught', p.caught, 'fp', p.falsePositives, 'missed', p.missed);
}
for (const f of d.fixes) {
  const rep = (await g.replayWith(f))!;
  console.log(
    'fix',
    f.id,
    f.correct,
    'blocked',
    rep.blocked,
    'at',
    rep.firstBlocked,
    rep.steps.filter((s) => s.lost.length).map((s) => s.lost),
  );
}
const mine = lines.filter((l) => l.actor === 'player').map((l) => l.id);
console.log(g.markLines(mine));
console.log(g.chooseRule(d.rules.find((r) => r.correct)!.id));
if (d.fixes.length) {
  const r = await g.applyFix(d.fixes.find((f) => f.correct)!.id);
  console.log(
    r?.steps.map((s) => [s.input.kind === 'line' ? s.input.line : s.input.text, s.changed, s.lost]),
  );
}
console.log(g.state.defense, g.state.completed);
