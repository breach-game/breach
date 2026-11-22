import { resolve } from 'node:path';
import { Game, runDetection, sigmaText } from '@breach/engine';
import { describe, expect, it } from 'vitest';
import { loadAll, replaySolution } from '../src/index.ts';

const packs = loadAll(resolve(import.meta.dirname, '../../../content'));
const world = packs.find((p) => p.pack.kind === 'world')!.pack;
const attacks = packs.filter((p) => p.pack.kind === 'mission' && p.pack.mission?.side !== 'defense');

describe('defence replay', () => {
  it.each(attacks.map((m) => [m.pack.id, m] as const))(
    '%s can be defended after its solution',
    async (_id, m) => {
      const { game } = await replaySolution(world, m.pack, m.solution!, 'fr');
      const defense = game.mission!.defense!;
      game.startDefense();
      const lines = game.socLines();
      // The player's own lines, and some background noise, are in the logs.
      expect(lines.some((l) => l.actor === 'player')).toBe(true);
      expect(lines.some((l) => l.actor === 'background')).toBe(true);

      // A background line marked by mistake is refused.
      const noise = lines.find((l) => l.actor === 'background')!;
      expect(game.markLines([noise.id]).wrong).toEqual([noise.id]);
      expect(game.state.defense!.found).toBe(false);

      expect(game.markLines(lines.filter((l) => l.actor !== 'background').map((l) => l.id)).ok).toBe(true);
      expect(game.state.defense!.found).toBe(true);

      const wrongRule = defense.rules.find((r) => !r.correct)!;
      expect(game.chooseRule(wrongRule.id)).toBe(false);
      const rightRule = defense.rules.find((r) => r.correct)!;
      expect(game.chooseRule(rightRule.id)).toBe(true);
      const preview = game.previewRule(rightRule.id)!;
      expect(preview.caught).toBeGreaterThan(0);
      expect(preview.falsePositives).toBe(0);

      for (const fix of defense.fixes.filter((f) => !f.correct)) {
        const report = (await game.applyFix(fix.id))!;
        expect(report.blocked).toBe(false);
      }
      const right = defense.fixes.find((f) => f.correct);
      if (right) {
        const report = (await game.applyFix(right.id))!;
        expect(report.blocked).toBe(true);
        expect(report.steps[report.firstBlocked!]!.lost.length).toBeGreaterThan(0);
      }
      expect(game.state.defense!.done).toBe(true);
      const points = game.state.completed[m.pack.id]!.defense!;
      expect(points).toBeGreaterThan(0);
      // A wrong mark, a wrong rule and wrong fixes all cost points.
      expect(points).toBeLessThan(
        game.defensePoints({
          ...game.state.defense!,
          wrongMarks: 0,
          findTries: 1,
          ruleTries: 1,
          fixTries: 1,
        }) + 1,
      );

      // The save is the journal: a reload gives the same defence state, without a new replay.
      const again = new Game({
        world,
        missions: packs.filter((p) => p.pack.kind === 'mission').map((p) => p.pack),
        locale: 'fr',
        log: game.log,
      });
      expect(again.state.defense).toEqual(game.state.defense);
      expect(again.state.completed[m.pack.id]).toEqual(game.state.completed[m.pack.id]);
    },
  );

  it('a replay never counts a flag the attack did not see first', async () => {
    const m1 = attacks.find((m) => m.pack.id === 'breach.official.m01')!;
    const flag = m1.solution!.at(-1)!;
    // A flag typed from memory, never shown by the target: the replay does not credit it.
    const { game } = await replaySolution(world, m1.pack, ['dig novamind.test', flag], 'fr');
    const fix = game.mission!.defense!.fixes.find((f) => f.correct)!;
    const report = await game.replayWith(fix);
    expect(report.blocked).toBe(false);
    expect(report.steps.at(-1)!.after).toContain(game.t('defense.replay.unseen'));
  });

  it('a revoked key no longer validates its flag', async () => {
    const m1 = attacks.find((m) => m.pack.id === 'breach.official.m01')!;
    const { game } = await replaySolution(world, m1.pack, m1.solution!.slice(0, -1), 'fr');
    game.emit({ type: 'ConfigPatched', key: 'secrets.debug_key_revoked', value: true, by: 'test' });
    for await (const _ of game.exec(m1.solution!.at(-1)!, 5000)) {
    }
    expect(Object.keys(game.state.flags)).toEqual([]);
  });
});

describe('detection rules', () => {
  const line = (src: string, n: number) => ({
    id: `l${n}`,
    t: n * 60_000,
    host: 'www',
    hostname: 'www.novamind.test',
    source: 'access' as const,
    actor: src === '10.13.0.66' ? ('player' as const) : ('background' as const),
    fields: { src, path: '/careers' },
    text: `${src} GET /careers`,
  });
  const rule = {
    id: 'r',
    title: 'Many hits',
    why: 'why',
    source: 'access' as const,
    where: { path: '/careers' },
    count: { gte: 3, within: 60 },
    correct: true,
  };

  it('counts per source address within the window', () => {
    const lines = [
      line('10.13.0.66', 1),
      line('10.13.0.66', 2),
      line('10.13.0.66', 3),
      line('10.13.0.31', 4),
    ];
    const r = runDetection(rule as never, lines as never);
    expect(r.caught).toBe(3);
    expect(r.falsePositives).toBe(0);
    const spread = [line('10.13.0.66', 1), line('10.13.0.66', 100), line('10.13.0.66', 200)];
    expect(runDetection(rule as never, spread as never).alerts).toEqual([]);
  });

  it('prints the rule as Sigma-like YAML', () => {
    const text = sigmaText(rule as never, 'Many hits');
    expect(text).toContain('title: Many hits');
    expect(text).toContain('condition:');
  });
});

describe('defence mission: Mute returns', () => {
  const b1 = packs.find((p) => p.pack.id === 'breach.official.b01')!;
  const play = async (game: Game, lines: string[]) => {
    let out = '';
    for (const line of lines)
      for await (const c of game.exec(line, 5000)) if (c.k === 'out' || c.k === 'err') out += c.text;
    return out;
  };

  it('stops Mute with the narrowest containment, for no impact', async () => {
    const { game, done } = await replaySolution(world, b1.pack, b1.solution!, 'fr');
    expect(done).toBe(true);
    expect(game.state.adversary.stopped).toBe(true);
    expect(game.state.impact).toBe(0);
    expect(game.scoreDetail()).toMatchObject({ answers: 200, impact: 0 });
    // Mute's own lines are in the logs, and the exfiltration never happened.
    const mine = game.socLines().filter((l) => l.actor === 'adversary');
    expect(mine.map((l) => l.source)).toEqual(['auth', 'audit']);
  });

  it('isolating the database works, but costs the clinics', async () => {
    const { game } = await replaySolution(
      world,
      b1.pack,
      [
        'soc alerts',
        'soc alerts',
        'contain isolate db.novamind.test',
        'soc alerts',
        'soc alerts',
        'soc alerts',
      ],
      'en',
    );
    expect(game.state.objectives.contain).toBe(true);
    expect(game.state.impact).toBe(60);
    expect(game.scoreDetail().impact).toBe(180);
  });

  it('fails when the data leaves, and starts again from the alert', async () => {
    const { game } = await replaySolution(world, b1.pack, [], 'fr');
    const out = await play(game, Array(10).fill('soc alerts'));
    expect(game.state.detections).toBe(1);
    expect(out).toContain('10.13.0.99');
    // Back before the attack: Mute starts over, and the player can do better.
    expect(game.state.adversary.next).toBe(0);
    await play(game, ['soc alerts', 'soc alerts', 'contain block 10.13.0.99', 'answer pivot backup']);
    expect(game.state.adversary.stopped).toBe(true);
    expect(game.state.answers.pivot).toBe(true);
  });

  it('refuses SOC and containment commands outside a defence mission', async () => {
    const m0 = attacks.find((m) => m.pack.id === 'breach.official.m00')!;
    const { game } = await replaySolution(world, m0.pack, [], 'en');
    const out = await play(game, ['soc alerts', 'contain block 10.13.0.99']);
    expect(out).toContain(game.t('soc.unavailable'));
    expect(game.state.contained).toEqual({});
  });
});
