import { describe, expect, it } from 'vitest';
import { inCidr, resolveTarget } from '../src/net.ts';
import { globMatch, normalize } from '../src/vfs.ts';
import { fixture } from './fixture.ts';

describe('paths and globs', () => {
  it('normalises paths', () => {
    expect(normalize('../x/./y', '/a/b', '/home/k')).toBe('/a/x/y');
    expect(normalize('~/z', '/a', '/home/k')).toBe('/home/k/z');
    expect(normalize('/../..', '/a', '/home/k')).toBe('/');
  });
  it('matches globs without regular expressions', () => {
    expect(globMatch('*.txt', 'a.txt')).toBe(true);
    expect(globMatch('a?c*', 'abcdef')).toBe(true);
    expect(globMatch('*.novamind.test', 'www.novamind.test')).toBe(true);
    expect(globMatch('*.txt', 'a.md')).toBe(false);
    expect(globMatch('a*b*c', `${'ab'.repeat(2000)}d`)).toBe(false);
  });
});

describe('scope gate', () => {
  it('knows which addresses are inside a range', () => {
    expect(inCidr('10.13.0.200', '10.13.0.0/24')).toBe(true);
    expect(inCidr('10.14.0.1', '10.13.0.0/16')).toBe(false);
  });
  it('accepts in-scope targets and refuses everything else', async () => {
    const { world } = await fixture();
    const w = world.world!;
    expect(resolveTarget(w, 'www.corp.test').kind).toBe('host');
    expect(resolveTarget(w, '10.13.0.50').kind).toBe('host');
    expect(resolveTarget(w, '10.13.0.0/24').kind).toBe('range');
    expect(resolveTarget(w, 'nope.corp.test').kind).toBe('unknown');
    for (const target of [
      'example.com',
      'corp.test.evil.example',
      '8.8.8.8',
      '10.14.0.1',
      '10.0.0.0/8',
      '0.0.0.0/0',
      'google.com',
    ])
      expect(resolveTarget(w, target).kind, target).toBe('out-of-scope');
  });
});
