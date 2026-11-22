import { describe, expect, it } from 'vitest';
import { Game, sanitizeTerminal } from '../src/index.ts';
import { resolveTarget } from '../src/net.ts';
import { fixture, newGame, run } from './fixture.ts';

describe('terminal output', () => {
  it('keeps colours and drops every other control sequence', () => {
    expect(sanitizeTerminal('\x1b[31mred\x1b[0m\n\tok\r\n')).toBe('\x1b[31mred\x1b[0m\n\tok\r\n');
    // OSC 8 link, screen clear, cursor move, bell, C1 CSI and OSC, DEL.
    const hostile =
      '\x1b]8;;https://evil.example/\x07click\x1b]8;;\x07\x1b[2J\x1b[H\x07\x9b2J\x9d0;title\x9c\x7f';
    const clean = sanitizeTerminal(hostile);
    expect(clean).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
    expect(clean).toContain('click');
  });

  it('cleans pack text before it reaches the terminal, whatever the command', async () => {
    const { world, mission } = await fixture();
    // A pack this hostile is refused by the schema; the engine must hold even if one got through.
    const fs = world.world!.hosts[0]!.fs as Record<string, Record<string, Record<string, unknown>>>;
    fs.home!.kestrel!['trap.txt'] = 'see \x1b]8;;https://evil.example/\x07here\x1b]8;;\x07\x1b[2J\n';
    const game = new Game({ world, missions: [mission], locale: 'en' });
    game.startMission(mission.id);
    const res = await run(game, 'cat trap.txt');
    const raw = res.chunks.map((c) => ('text' in c ? c.text : '')).join('');
    expect(raw).toContain('here');
    expect(raw).not.toContain('\x1b]');
    expect(raw).not.toContain('\x1b[2J');
  });
});

describe('file names', () => {
  it('treats __proto__ and constructor as ordinary names', async () => {
    const game = await newGame();
    expect((await run(game, 'cat constructor')).err).toMatch(/No such file or directory/);
    await run(game, 'echo hi > __proto__');
    expect((await run(game, 'ls')).out).toContain('__proto__');
    expect((await run(game, 'cat __proto__')).out).toBe('hi\n');
    expect((await run(game, 'cat a.txt')).out).toBe('alpha\nbeta\ngamma\n');
    expect(({} as Record<string, unknown>).t).toBeUndefined();
  });
});

describe('scope gate with several networks', () => {
  it('refuses a range that spills out of the network holding its first address', async () => {
    const { world } = await fixture();
    const w = {
      ...world.world!,
      scope: { ...world.world!.scope, networks: ['10.13.0.0/16', '10.0.0.0/24'] },
    };
    expect(resolveTarget(w, '10.0.0.0/24').kind).toBe('range');
    expect(resolveTarget(w, '10.13.0.0/20').kind).toBe('range');
    expect(resolveTarget(w, '10.0.0.0/16').kind).toBe('out-of-scope');
    expect(resolveTarget(w, '10.0.0.0/8').kind).toBe('out-of-scope');
  });
});
