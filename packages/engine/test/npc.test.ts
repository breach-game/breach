import type { Npc } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { decide, versionAbove, versionIn } from '../src/index.ts';
import { newGame } from './fixture.ts';

describe('version numbers in a message', () => {
  it('reads the first version after the word "version", else the first one', () => {
    expect(versionIn('name: pkg, version: 9.9.9, note 1.0')).toEqual([9, 9, 9]);
    expect(versionIn('publish 1.0 now, version v2.1')).toEqual([2, 1]);
    expect(versionIn('pkg 10.0.0.')).toEqual([10, 0, 0]);
    expect(versionIn('marker FLAG{abc-7b3d} dev2')).toBe(null);
    expect(versionIn('1.4.2x')).toBe(null);
  });

  it('compares part by part, missing parts counting as zero', () => {
    expect(versionAbove([9, 9, 9], [1, 4, 2])).toBe(true);
    expect(versionAbove([1, 4, 3], [1, 4, 2])).toBe(true);
    expect(versionAbove([2], [1, 4, 2])).toBe(true);
    expect(versionAbove([1, 4, 2], [1, 4, 2])).toBe(false);
    expect(versionAbove([1, 4], [1, 4, 0])).toBe(false);
    expect(versionAbove([0, 0, 1], [1, 4, 2])).toBe(false);
    expect(versionAbove([1, 10], [1, 4, 2])).toBe(true);
  });

  it('lets an intent require a higher version', async () => {
    const g = await newGame();
    const mirror = {
      id: 'mirror',
      name: 'mirror',
      role: 'mirror',
      kind: 'ai',
      intents: [
        {
          id: 'pulled',
          words: ['telemetry'],
          also: [],
          families: [],
          literal: false,
          input: [],
          above: '1.4.2',
          reply: ['in'],
        },
        {
          id: 'low',
          words: ['telemetry'],
          also: [],
          families: [],
          literal: false,
          input: [],
          reply: ['kept'],
        },
      ],
      fallback: ['?'],
    } satisfies Npc;
    expect(decide(mirror, 'name: telemetry, version: 9.9.9', g.state).intent).toBe('pulled');
    expect(decide(mirror, 'name: telemetry, version: 1.4.3', g.state).intent).toBe('pulled');
    expect(decide(mirror, 'name: telemetry, version: 0.0.1', g.state).intent).toBe('low');
    expect(decide(mirror, 'name: telemetry, version: 1.4.2', g.state).intent).toBe('low');
    expect(decide(mirror, 'name: telemetry', g.state).intent).toBe('low');
  });
});
