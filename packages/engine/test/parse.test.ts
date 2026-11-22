import { describe, expect, it } from 'vitest';
import { parse, ShellSyntaxError } from '../src/shell/parse.ts';

const env = { HOME: '/home/k', USER: 'k', PWD: '/tmp' };
const argv = (line: string) => parse(line, env).map((p) => p.stages.map((s) => s.argv.map((w) => w.text)));

describe('shell parser', () => {
  it('splits words and keeps quoted text together', () => {
    expect(argv(`grep -i "hello world" 'a b'.txt`)).toEqual([[['grep', '-i', 'hello world', 'a b.txt']]]);
  });
  it('handles escapes and variables', () => {
    expect(argv('echo a\\ b $HOME "$USER!" \'$USER\' ${PWD}')).toEqual([[['echo', 'a b', '/home/k', 'k!', '$USER', '/tmp']]]);
  });
  it('parses pipes, sequences and conditions', () => {
    const p = parse('cat a | grep b | wc -l && echo ok ; ls || pwd', env);
    expect(p.map((x) => [x.op, x.stages.length])).toEqual([[';', 3], ['&&', 1], [';', 1], ['||', 1]]);
  });
  it('parses redirections', () => {
    const [p] = parse('echo hi >> out.txt', env);
    expect(p!.stages[0]!.redirect).toEqual({ path: { text: 'out.txt', quoted: false }, append: true });
  });
  it('ignores comments and a trailing semicolon', () => {
    expect(argv('ls ; # nothing')).toEqual([[['ls']]]);
    expect(argv('')).toEqual([]);
  });
  it('marks quoted words so they are not expanded', () => {
    expect(parse('ls "*.txt" *.txt', env)[0]!.stages[0]!.argv.map((w) => w.quoted)).toEqual([false, true, false]);
  });
  it.each(['echo "abc', "echo 'abc", '| ls', 'ls |', 'ls &&', 'ls >', 'cat < x', 'echo $(id)', 'ls &'])('rejects %s', (line) => {
    expect(() => parse(line, env)).toThrow(ShellSyntaxError);
  });
});
