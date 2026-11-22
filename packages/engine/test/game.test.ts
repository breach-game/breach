import { describe, expect, it } from 'vitest';
import { Game, socView } from '../src/index.ts';
import { fixture, newGame, run } from './fixture.ts';

describe('missions and rules', () => {
  it('fires rules, completes objectives and finishes the mission', async () => {
    const g = await newGame();
    expect(g.state.messages.map((m) => m.key)).toEqual(['hello']);
    await run(g, 'nmap -sn 10.13.0.0/24');
    expect(g.state.objectives).toEqual({ scan: true, key: false, bonus: false });
    expect(g.state.checkpoint?.name).toBe('scanned');
    expect((await run(g, 'submit FLAG{nope}')).err).toContain('not a flag');
    expect(g.state.missionDone).toBe(false);
    expect((await run(g, 'submit FLAG{x}')).out).toContain('FLAG VALIDATED +100');
    expect(g.state.missionDone).toBe(true);
    expect(g.state.completed['test.m1']?.score).toBe(200);
    expect((await run(g, 'submit FLAG{x}')).out).toContain('already');
  });

  it('never stores a flag in clear text', async () => {
    const { mission } = await fixture();
    expect(JSON.stringify(mission)).not.toContain('FLAG{x}');
  });

  it('gives hints level by level and counts them against the score', async () => {
    const g = await newGame();
    expect((await run(g, 'hint')).out).toContain('Hint one');
    expect((await run(g, 'hint')).out).toContain('Hint two');
    expect((await run(g, 'hint')).out).toContain('Hint two');
    expect(g.state.hintsUsed).toBe(2);
  });

  it('charges noise from the table and lets it decay with time', async () => {
    const g = await newGame();
    await run(g, 'nmap -sn www.corp.test');
    expect(g.state.noise).toBeCloseTo(10, 0);
    await run(g, 'curl http://www.corp.test/');
    expect(g.state.noise).toBeGreaterThan(11);
    await run(g, 'pwd', 5 * 60_000);
    expect(g.state.noise).toBe(0);
    expect(socView(g).map((e) => [e.action, e.noise])).toEqual([['nmap -sn www.corp.test', 10], ['curl http://www.corp.test/', 2]]);
  });

  it('detects a noisy player and restores the last checkpoint', async () => {
    const g = await newGame();
    await run(g, 'nmap -sn 10.13.0.0/24');
    await run(g, 'echo keep > kept.txt');
    const loud = await run(g, 'nmap -T5 10.13.0.0/24');
    expect(loud.status).toBe(0);
    const caught = await run(g, 'nmap -T5 10.13.0.0/24');
    expect(caught.status).toBe(130);
    expect(caught.err).toContain('SOC');
    expect(g.state.detections).toBe(1);
    expect(g.state.noise).toBeLessThanOrEqual(25);
    expect(g.state.objectives.scan).toBe(true);
    expect((await run(g, 'cat kept.txt')).status).toBe(1);
    expect(g.log.at(-2)?.type).not.toBe('Detected');
    expect(g.log.some((e) => e.type === 'Restored')).toBe(true);
  });

  it('rebuilds the exact same state from a saved log', async () => {
    const g = await newGame();
    await run(g, 'nmap -sV 10.13.0.0/24');
    await run(g, 'git clone https://www.corp.test/corp/app.git && cd app');
    await run(g, 'echo note > n.txt');
    await run(g, 'hint');
    const save = JSON.parse(JSON.stringify(g.save()));
    const { world, mission } = await fixture();
    const loaded = new Game({ world, missions: [mission], locale: 'en', log: save.log });
    expect(loaded.state).toEqual(g.state);
    expect((await run(loaded, 'cat n.txt')).out).toBe('note\n');
    expect((await run(loaded, 'git log --oneline')).out).toBe('abc1234 fix\n');
  });

  it('translates through mission, world, then engine strings', async () => {
    const g = await newGame();
    expect(g.t('hello')).toBe('Hello');
    expect(g.t('law')).toBe('Out of scope.');
    expect(g.t('submit.ok')).toBe('FLAG VALIDATED');
    expect(g.t('missing.key')).toBe('missing.key');
  });
});
