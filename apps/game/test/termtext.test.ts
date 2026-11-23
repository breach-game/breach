import { describe, expect, it } from 'vitest';
import { needsNewline } from '../src/os/termtext.ts';

describe('needsNewline', () => {
  it('is false for output that ends its own line', () => {
    expect(needsNewline('hello\n')).toBe(false);
    expect(needsNewline('')).toBe(false);
  });

  it('is true for output that stops mid-line, as base64 -d or echo -n do', () => {
    expect(needsNewline('000048213')).toBe(true);
    expect(needsNewline('a\nb')).toBe(true);
  });

  it('ignores colour codes after the last newline', () => {
    expect(needsNewline('\x1b[32mok\n\x1b[0m')).toBe(false);
    expect(needsNewline('\x1b[32mok\x1b[0m')).toBe(true);
  });
});
