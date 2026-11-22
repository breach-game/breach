import { describe, expect, it } from 'vitest';
import { newGame, run } from './fixture.ts';

describe('shell', () => {
  it('runs file commands', async () => {
    const g = await newGame();
    expect((await run(g, 'pwd')).out).toBe('/home/kestrel\n');
    expect((await run(g, 'ls')).out).toBe('a.txt  b.txt  docs\n');
    expect((await run(g, 'ls -a')).out).toContain('.hidden');
    expect((await run(g, 'ls -l')).out).toMatch(/^total \d+\n-rw-r--r-- 1 kestrel/);
    expect((await run(g, 'cat a.txt')).out).toBe('alpha\nbeta\ngamma\n');
    expect((await run(g, 'cat nope')).err).toBe('cat: nope: No such file or directory\n');
    expect((await run(g, 'cat /etc/shadow')).err).toBe('cat: /etc/shadow: Permission denied\n');
    expect((await run(g, 'cat docs')).err).toBe('cat: docs: Is a directory\n');
  });

  it('changes directory, with ~, - and ..', async () => {
    const g = await newGame();
    await run(g, 'cd docs');
    expect(g.state.cwd).toBe('/home/kestrel/docs');
    await run(g, 'cd ..');
    await run(g, 'cd /etc');
    expect((await run(g, 'cd -')).out).toBe('/home/kestrel\n');
    expect((await run(g, 'cd nope')).status).toBe(1);
    await run(g, 'cd /etc');
    await run(g, 'cd');
    expect(g.state.cwd).toBe('/home/kestrel');
  });

  it('pipes, filters and counts', async () => {
    const g = await newGame();
    expect((await run(g, 'cat a.txt | grep -n a | head -2')).out).toBe('1:alpha\n2:beta\n');
    expect((await run(g, 'grep -i beta a.txt b.txt')).out).toBe('a.txt:beta\nb.txt:Beta again\n');
    expect((await run(g, 'grep -rn token .')).out).toBe('docs/note.md:1:secret token\n');
    expect((await run(g, 'cat a.txt | wc -l')).out).toBe('3\n');
    expect((await run(g, 'grep -c a a.txt')).out).toBe('3\n');
    expect((await run(g, 'tail -n 1 a.txt')).out).toBe('gamma\n');
    expect((await run(g, 'grep zzz a.txt')).status).toBe(1);
    expect((await run(g, 'find . -name "*.md"')).out).toBe('./docs/note.md\n');
  });

  it('expands globs unless quoted', async () => {
    const g = await newGame();
    expect((await run(g, 'echo *.txt')).out).toBe('a.txt b.txt\n');
    expect((await run(g, 'echo "*.txt"')).out).toBe('*.txt\n');
  });

  it('redirects output to a file and chains with && and ||', async () => {
    const g = await newGame();
    await run(g, 'echo one > out.txt && echo two >> out.txt');
    expect((await run(g, 'cat out.txt')).out).toBe('one\ntwo\n');
    expect((await run(g, 'cat nope || echo fallback')).out).toBe('fallback\n');
    expect((await run(g, 'cat nope && echo never')).out).toBe('');
  });

  it('reports unknown commands and syntax errors like a shell', async () => {
    const g = await newGame();
    const unknown = await run(g, 'frobnicate');
    expect(unknown.err).toBe('lrsh: frobnicate: command not found\n');
    expect(unknown.status).toBe(127);
    const bare = await run(g, 'FLAG{some-code}');
    expect(bare.err).toContain('submit FLAG{some-code}');
    expect(bare.err).not.toContain('command not found');
    expect((await run(g, 'ls |')).err).toContain('syntax error');
    expect((await run(g, 'vim a.txt')).err).toContain('not installed');
    expect((await run(g, 'ls 2>/dev/null')).status).toBe(0);
  });

  it('completes commands and paths', async () => {
    const g = await newGame();
    expect(g.complete('who').candidates).toEqual(['whoami', 'whois']);
    expect(g.complete('cat a').candidates).toEqual(['a.txt']);
    expect(g.complete('cat do').candidates).toEqual(['docs/']);
    expect(g.complete('cat docs/').candidates).toEqual(['docs/note.md']);
    expect(g.complete('explain nm').candidates).toEqual(['nmap']);
    expect(g.complete('git cl').candidates).toEqual(['clone']);
  });

  it('keeps a history', async () => {
    const g = await newGame();
    await run(g, 'pwd');
    await run(g, 'ls');
    expect((await run(g, 'history')).out).toContain('    2  ls');
  });
});

describe('network commands', () => {
  it('never reaches an out-of-scope target', async () => {
    const g = await newGame();
    for (const line of [
      'nmap example.com',
      'curl https://example.com/',
      'ping 8.8.8.8',
      'dig example.com',
      'whois example.org',
      'ssh root@example.com',
      'git clone https://example.com/a/b.git',
    ]) {
      const before = g.state.noise;
      const r = await run(g, line);
      expect(r.err, line).toContain('outside the scope');
      expect(r.status, line).toBe(9);
      expect(g.state.noise, line).toBe(before);
    }
    expect(g.log.filter((e) => e.type === 'OutOfScope')).toHaveLength(7);
    expect(g.log.some((e) => e.type === 'HttpRequest' || e.type === 'Scan')).toBe(false);
    expect(g.state.messages.filter((m) => m.key === 'law')).toHaveLength(7);
  });

  it('scans a range like nmap and hides hidden hosts', async () => {
    const g = await newGame();
    const r = await run(g, 'nmap -sV 10.13.0.0/24');
    expect(r.out).toContain('Nmap scan report for www.corp.test (10.13.0.10)');
    expect(r.out).toMatch(/80\/tcp\s+open\s+http\s+nginx 1\.27/);
    expect(r.out).toContain('Nmap done: 256 IP addresses (2 hosts up)');
    expect(r.out).not.toContain('ghost');
    expect(r.chunks.some((c) => c.k === 'wait')).toBe(true);
    expect(g.state.discovered).toEqual({ web: [80, 443], db: [5432] });
  });

  it('answers dig and curl in the real formats', async () => {
    const g = await newGame();
    expect((await run(g, 'dig corp.test +short')).out).toBe('10.13.0.10\n');
    expect((await run(g, 'dig corp.test MX')).out).toContain('corp.test.\t\t300\tIN\tMX\t10 mail.corp.test.');
    expect((await run(g, 'dig nope.corp.test')).out).toContain('status: NXDOMAIN');
    expect((await run(g, 'curl http://www.corp.test/')).out).toBe('<h1>hello</h1>\n');
    expect((await run(g, 'curl -I https://www.corp.test/nope')).out).toMatch(
      /^HTTP\/1\.1 404 Not Found\nserver: nginx\/1\.27/,
    );
    expect((await run(g, 'curl http://db.corp.test/')).err).toContain('curl: (7) Failed to connect');
  });

  it('clones a repository and reads its history', async () => {
    const g = await newGame();
    expect((await run(g, 'git log')).err).toContain('not a git repository');
    await run(g, 'git clone https://www.corp.test/corp/app.git');
    await run(g, 'cd app');
    expect((await run(g, 'ls')).out).toBe('README.md\n');
    expect((await run(g, 'git log --oneline')).out).toBe('abc1234 fix\n');
    expect((await run(g, 'git show abc1234 | grep KEY')).out).toBe('-KEY=FLAG{x}\n');
    expect((await run(g, 'git show HEAD')).out).toContain('Author: A <a@corp.test>');
    expect((await run(g, 'git show ffff')).status).toBe(128);
  });
});
