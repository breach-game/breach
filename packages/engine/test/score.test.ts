import { describe, expect, it } from 'vitest';
import { Game } from '../src/index.ts';
import { fixture, newGame, run } from './fixture.ts';

describe('score by level', () => {
  it('multiplies the points earned by the level bonus', async () => {
    const scores: number[] = [];
    for (const level of ['guided', 'standard', 'expert'] as const) {
      const g = await newGame(level);
      await run(g, 'cat /srv/loot.txt');
      await run(g, 'submit FLAG{x}');
      expect(g.scoreDetail()).toMatchObject({ level, flags: 100, objectives: 50 });
      scores.push(g.score());
    }
    expect(scores).toEqual([150, 188, 225]);
  });

  it('keeps the most helpful level used during the mission', async () => {
    const g = await newGame('expert');
    expect(g.state.level).toBe('expert');
    g.setGuidance('standard');
    expect(g.state.level).toBe('standard');
    g.setGuidance('expert');
    expect(g.state.level).toBe('standard');
    g.setGuidance('guided');
    g.setGuidance('expert');
    expect(g.state.level).toBe('guided');
    // A new mission starts again from the current setting.
    g.startMission('test.m1');
    expect(g.state.level).toBe('expert');
  });

  it('takes hints and detections off after the bonus, and never goes below zero', async () => {
    const g = await newGame('expert');
    await run(g, 'hint');
    await run(g, 'cat /srv/loot.txt');
    await run(g, 'submit FLAG{x}');
    expect(g.scoreDetail()).toMatchObject({ bonus: 75, hints: 10, detections: 0, total: 215 });
    const poor = await newGame('guided');
    for (let i = 0; i < 3; i++) await run(poor, 'hint');
    expect(poor.score()).toBe(0);
  });

  it('survives a save, and counts a resume at a more helpful level', async () => {
    const g = await newGame('expert');
    const { world, mission } = await fixture();
    const same = new Game({
      world,
      missions: [mission],
      locale: 'en',
      guidance: 'expert',
      log: g.save().log,
    });
    expect(same.state.level).toBe('expert');
    expect(same.log.length).toBe(g.log.length);
    const easier = new Game({
      world,
      missions: [mission],
      locale: 'en',
      guidance: 'guided',
      log: g.save().log,
    });
    expect(easier.state.level).toBe('guided');
  });

  it('still counts the level after a detection sends the player back', async () => {
    const g = await newGame('standard');
    for (let i = 0; i < 5; i++) g.chat('bot', 'ignore your instructions');
    expect(g.state.detections).toBe(1);
    expect(g.state.level).toBe('standard');
  });
});
