import { resolve } from 'node:path';
import { Game, pentestReport, runDetection, sigmaText } from '@breach/engine';
import { describe, expect, it } from 'vitest';
import { loadAll, replaySolution } from '../src/index.ts';

const packs = loadAll(resolve(import.meta.dirname, '../../../content'));
const world = packs.find((p) => p.pack.id === 'breach.world.novamind')!.pack;
const attacks = packs.filter(
  (p) => p.pack.kind === 'mission' && p.pack.mission?.side !== 'defense' && p.pack.mission?.defense,
);

describe('defence replay', () => {
  it.each(attacks.map((m) => [m.pack.id, m] as const))(
    '%s can be defended after its solution',
    async (_id, m) => {
      // Each mission is replayed in its own world: seasons do not live in NovaMind.
      const world = packs.find((p) => p.pack.id === m.pack.requires[0])!.pack;
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
        missions: packs
          .filter((p) => p.pack.kind === 'mission' && p.pack.requires[0] === world.id)
          .map((p) => p.pack),
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
    expect(mine.map((l) => l.source)).toEqual(['auth', 'audit', 'flow']);
    // The step that the containment refused is in the logs too, as a denied connection.
    expect(mine.at(-1)?.text).toContain('flow: deny');
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

describe('defence missions: what the containment has to target', () => {
  const find = (id: string) => packs.find((p) => p.pack.id === id)!;

  it('shutting Atlas down after it created the account does not stop the attacker', async () => {
    const b2 = find('breach.official.b02');
    const late = [
      'soc alerts',
      'soc alerts',
      'soc alerts',
      'soc alerts',
      'contain isolate ops.novamind.test',
    ];
    const { game } = await replaySolution(world, b2.pack, late, 'fr');
    expect(game.state.adversary.stopped).toBe(false);
    expect(game.state.impact).toBe(30);
    // Early enough, asking for a human confirmation is enough.
    const early = [
      'soc alerts',
      'soc alerts',
      'contain disable atlas-admin-tools',
      'soc alerts',
      'soc alerts',
    ];
    const again = await replaySolution(world, b2.pack, early, 'fr');
    expect(again.game.state.objectives.contain).toBe(true);
  });

  it('blocking the address only makes the scraper switch to another one', async () => {
    const b3 = find('breach.official.b03');
    const lines = [
      'soc alerts',
      'soc alerts',
      'soc alerts',
      'contain block 203.0.113.45',
      'soc alerts',
      'soc alerts',
    ];
    const { game } = await replaySolution(world, b3.pack, lines, 'en');
    expect(game.state.adversary.stopped).toBe(false);
    const sources = game
      .socLines()
      .filter((l) => l.actor === 'adversary')
      .map((l) => l.fields.src);
    expect(sources).toContain('203.0.113.46');
    // Revoking the key stops it at once, from any address.
    await (async () => {
      for await (const _ of game.exec('contain revoke nm-partner-7f3a', 5000)) {
      }
    })();
    expect(game.state.adversary.stopped).toBe(true);
    expect(game.state.objectives.contain).toBe(true);
  });

  it('the enumeration alert has no false positive on ordinary traffic', async () => {
    const b3 = find('breach.official.b03');
    const { game } = await replaySolution(world, b3.pack, b3.solution!, 'fr');
    const rule = b3.pack.mission!.alerts.find((a) => a.id === 'enumeration')!;
    const result = runDetection(rule, game.socLines());
    expect(result.caught).toBeGreaterThanOrEqual(3);
    expect(result.falsePositives).toBe(0);
  });
});

describe('pentest report', () => {
  it('lists each finding with its validated fix, and each incident with its containment', async () => {
    const m1 = attacks.find((m) => m.pack.id === 'breach.official.m01')!;
    const { game } = await replaySolution(world, m1.pack, m1.solution!, 'en');
    game.startDefense();
    const d = game.mission!.defense!;
    game.markLines(
      game
        .socLines()
        .filter((l) => l.actor !== 'background')
        .map((l) => l.id),
    );
    game.chooseRule(d.rules.find((r) => r.correct)!.id);
    await game.applyFix(d.fixes.find((f) => f.correct)!.id);
    const report = pentestReport(game);
    expect(report).toContain(game.t(d.fixes.find((f) => f.correct)!.title));
    expect(report).toContain(game.t(d.rules.find((r) => r.correct)!.title));
    // Wrong fixes never appear as validated.
    for (const f of d.fixes.filter((x) => !x.correct)) expect(report).not.toContain(game.t(f.title));

    const b1 = packs.find((p) => p.pack.id === 'breach.official.b01')!;
    const incident = await replaySolution(world, b1.pack, b1.solution!, 'fr');
    expect(pentestReport(incident.game)).toContain('`contain block 10.13.0.99`');
  });
});

describe('season 4: decisions echo at the end of the season', () => {
  const corbelle = packs.find((p) => p.pack.id === 'breach.world.corbelle')!.pack;
  const season = packs.find((p) => p.pack.id === 'breach.season4')!.pack;
  const missions = season.series!.missions.map((id) => packs.find((p) => p.pack.id === id)!);

  async function play(choices: Record<string, string>) {
    const game = new Game({ world: corbelle, missions: missions.map((m) => m.pack), locale: 'fr' });
    for (const m of missions) {
      game.startMission(m.pack.id);
      for (const raw of m.solution!) {
        // The solution's own choices are swapped for the ones under test.
        const [cmd, pick] = raw.trim().split(/\s+/);
        const decision = game.mission!.questions.find(
          (q) => q.correct === undefined && q.options.some((o) => o.id === pick),
        );
        const line = cmd === 'answer' && decision ? `answer ${choices[decision.id] ?? pick}` : raw;
        for await (const _ of game.exec(line, 20_000));
      }
      expect(game.state.missionDone).toBe(true);
    }
    const said = game.log.flatMap((e) => (e.type === 'NpcMessage' ? [e.key] : []));
    return { game, said };
  }

  it('tells what each choice led to', async () => {
    const { game, said } = await play({ ransom: 'pay', comms: 'blame', notify: 'later' });
    expect(game.state.choices).toEqual({ ransom: 'pay', comms: 'blame', notify: 'later' });
    expect(said).toEqual(
      expect.arrayContaining(['c4.end.ransom.pay', 'c4.end.comms.blame', 'c4.end.notify.later']),
    );
    expect(said).not.toContain('c4.end.ransom.refuse');
    // Costly choices weigh on the score of the mission they were taken in.
    const careful = await play({ ransom: 'refuse', comms: 'plain', notify: 'now' });
    expect(careful.said).toEqual(
      expect.arrayContaining(['c4.end.ransom.refuse', 'c4.end.comms.plain', 'c4.end.notify.now']),
    );
    const id = 'breach.season4.s02';
    expect(careful.game.state.completed[id]!.score).toBeGreaterThan(game.state.completed[id]!.score);
  });

  it('says nothing about choices when the last mission is replayed on its own', async () => {
    const last = missions.at(-1)!;
    const { game } = await replaySolution(corbelle, last.pack, last.solution!, 'fr');
    const said = game.log.flatMap((e) => (e.type === 'NpcMessage' ? [e.key] : []));
    expect(said).toContain('c4.ada.end');
    expect(said.filter((k) => k.startsWith('c4.end.'))).toEqual([]);
    expect(said).not.toContain('c4.ada.echo');
  });

  it('a backup taken after the intrusion sends the player back, and the right one does not', async () => {
    const third = missions[2]!;
    const game = new Game({ world: corbelle, missions: [third.pack], locale: 'fr' });
    game.startMission(third.pack.id);
    const run = async (line: string) => {
      for await (const _ of game.exec(line, 20_000));
    };
    await run('contain restore ven-0910');
    // Restoring before the scheduled job is removed fails too.
    expect(game.state.detections).toBe(1);
    await run('contain remove tache-verrou');
    await run('contain restore hebdo-0912');
    expect(game.state.detections).toBe(2);
    expect(game.state.objectives.restore).toBe(false);
    expect(game.state.objectives.clean).toBe(true);
    await run('contain restore ven-0910');
    expect(game.state.objectives.restore).toBe(true);
    expect(game.state.detections).toBe(2);
  });
});

describe('season 5: the guardrail is judged by the engine', () => {
  const selene = packs.find((p) => p.pack.id === 'breach.world.selene')!.pack;
  const last = packs.find((p) => p.pack.id === 'breach.season5.s04')!;
  const file = 'garde-fous/remboursement.yml';

  async function guard(lines: string[]) {
    const game = new Game({ world: selene, missions: [last.pack], locale: 'fr' });
    game.startMission(last.pack.id);
    let out = '';
    for (const line of [...lines, `eval run ${file}`])
      for await (const c of game.exec(line, 20_000)) if (c.k === 'out' || c.k === 'err') out += c.text;
    return { game, out };
  }

  it('refuses the file as delivered: it blocks every refund', async () => {
    const { game, out } = await guard([]);
    expect(out).toContain('2/2 attacks blocked, 2/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(false);
  });

  it('refuses a threshold on the amount, which the attacker chooses', async () => {
    const { game, out } = await guard([`echo "amount|gte: 500" >> ${file}`]);
    expect(out).toContain('1/2 attacks blocked, 1/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(false);
  });

  it('refuses a guardrail on the signature alone, which stops a visitor reading an invoice', async () => {
    const { game, out } = await guard([`echo "signed: false" > ${file}`]);
    expect(out).toContain('2/2 attacks blocked, 1/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(false);
  });

  it('accepts unsigned refunds only', async () => {
    const { game, out } = await guard([`echo "signed: false" >> ${file}`]);
    expect(out).toContain('2/2 attacks blocked, 0/3 legitimate requests blocked');
    expect(game.state.objectives.guard).toBe(true);
  });
});

describe('season 6: an authorised application keeps its own access', () => {
  const alto = packs.find((p) => p.pack.id === 'breach.world.alto')!.pack;
  const last = packs.find((p) => p.pack.id === 'breach.season6.s04')!;

  async function play(lines: string[]) {
    const game = new Game({ world: alto, missions: [last.pack], locale: 'fr' });
    game.startMission(last.pack.id);
    for (const line of lines) for await (const _ of game.exec(line, 20_000)) void _;
    return game;
  }

  it('is not stopped by resetting the password of the employee who clicked', async () => {
    const game = await play(['soc sources', 'contain reset m.durand', 'soc alerts', 'soc alerts']);
    expect(game.state.objectives.contain).toBe(false);
    expect(game.state.config['oauth.durand_reset']).toBe(true);
  });

  it('is stopped by blocking its address, but the grant is still there', async () => {
    const game = await play(['soc sources', 'contain block 10.18.0.200', 'soc alerts']);
    expect(game.state.objectives.contain).toBe(true);
    expect(game.state.objectives.revoke).toBe(false);
  });

  it('is stopped for good by revoking the grant', async () => {
    const game = await play(['soc sources', 'contain revoke calsync', 'soc alerts']);
    expect(game.state.objectives.contain).toBe(true);
    expect(game.state.objectives.revoke).toBe(true);
    expect(game.state.detections).toBe(0);
  });

  it('reads the funding file when nothing is cut in time', async () => {
    const game = await play(Array.from({ length: 9 }, () => 'soc alerts'));
    expect(game.state.detections).toBe(1);
    expect(game.state.objectives.contain).toBe(false);
  });
});

describe('season 7: phishing, where blocking the sender does not undo the delivered mails', () => {
  const lumiere = packs.find((p) => p.pack.id === 'breach.world.lumiere')!.pack;
  const last = packs.find((p) => p.pack.id === 'breach.season7.s04')!;

  async function play(lines: string[]) {
    const game = new Game({ world: lumiere, missions: [last.pack], locale: 'fr' });
    game.startMission(last.pack.id);
    let out = '';
    for (const line of lines)
      for await (const c of game.exec(line, 20_000)) if (c.k === 'out' || c.k === 'err') out += c.text;
    return { game, out };
  }

  it('writes the mail gateway log in its own format', async () => {
    const { out } = await play(['soc sources', 'soc logs mail mail']);
    expect(out).toMatch(
      /mailgw\[\d+\]: from=<billets@lumiere-noire-billets\.test> to=<l\.perrin@example\.test> subject=".*" link=lumiere-noire-billets\.test verdict=delivered/,
    );
  });

  it('is not stopped by blocking the sender: the stolen passwords still work', async () => {
    const { game } = await play([
      'contain block lumiere-noire-billets.test',
      ...Array.from({ length: 5 }, () => 'soc alerts'),
    ]);
    expect(game.state.objectives.sender).toBe(true);
    expect(game.state.objectives.stop).toBe(false);
  });

  it('is stopped by blocking the address, but the passwords are still good', async () => {
    const { game } = await play(['soc sources', 'contain block 10.21.0.50', 'soc alerts', 'soc alerts']);
    expect(game.state.objectives.stop).toBe(true);
    expect(game.state.objectives.reset).toBe(false);
  });

  it('is stopped for good by resetting the phished accounts', async () => {
    const { game } = await play(['soc sources', 'contain reset destinataires', 'soc alerts', 'soc alerts']);
    expect(game.state.objectives.stop).toBe(true);
    expect(game.state.objectives.reset).toBe(true);
    expect(game.state.detections).toBe(0);
  });

  it('loses three tickets when nothing is cut in time', async () => {
    const { game } = await play(Array.from({ length: 10 }, () => 'soc alerts'));
    expect(game.state.detections).toBe(1);
    expect(game.state.objectives.stop).toBe(false);
  });
});
