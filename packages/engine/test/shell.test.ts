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
    // -R walks the folders below, with a header per folder.
    const tree = (await run(g, 'ls -R')).out;
    expect(tree).toMatch(/^\.:\na\.txt {2}b\.txt {2}docs\n\n\.\/docs:\n/);
    expect((await run(g, 'echo x > docs')).err).toBe('lrsh: docs: Is a directory\n');
    // 2>/dev/null hides errors, 2>&1 sends them with the output.
    expect((await run(g, 'cat nope 2>/dev/null')).err).toBe('');
    expect((await run(g, 'cat nope 2>&1 | wc -l')).out).toBe('1\n');
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
    expect((await run(g, 'python3 a.py')).err).toContain('not installed');
    expect((await run(g, 'ls 2>/dev/null')).status).toBe(0);
  });

  it('completes commands and paths', async () => {
    const g = await newGame();
    expect(g.complete('who').candidates).toEqual(['whoami', 'whois']);
    expect(g.complete('cat a').candidates).toEqual(['a.txt']);
    expect(g.complete('cat do').candidates).toEqual(['docs/']);
    expect(g.complete('cat docs/').candidates).toEqual(['docs/note.md']);
    expect(g.complete('explain nma').candidates).toEqual(['nmap']);
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
    expect((await run(g, 'dig shop.corp.test +short')).out).toBe('www.corp.test.\n10.13.0.10\n');
    expect((await run(g, 'dig shop.corp.test')).out).toMatch(
      /shop\.corp\.test\.\t\t300\tIN\tCNAME\twww\.corp\.test\.\nwww\.corp\.test\.\t\t300\tIN\tA\t10\.13\.0\.10/,
    );
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

describe('text tools', () => {
  it('sorts, counts and cuts', async () => {
    const g = await newGame();
    await run(g, 'echo "10.0.0.2 GET /a" > log');
    await run(g, 'echo "10.0.0.9 GET /b" >> log');
    await run(g, 'echo "10.0.0.2 POST /c" >> log');
    expect((await run(g, 'cut -d " " -f 1 log | sort | uniq -c | sort -rn')).out).toBe(
      '      2 10.0.0.2\n      1 10.0.0.9\n',
    );
    expect((await run(g, 'cut -d " " -f 2- log | head -1')).out).toBe('GET /a\n');
    expect((await run(g, 'sort -r a.txt')).out).toBe('gamma\nbeta\nalpha\n');
    expect((await run(g, 'cat a.txt | tr a-z A-Z')).out).toBe('ALPHA\nBETA\nGAMMA\n');
    expect((await run(g, 'echo hello | tr -d l')).out).toBe('heo\n');
  });

  it('encodes, decodes and fingerprints', async () => {
    const g = await newGame();
    expect((await run(g, 'echo -n "clé:42" | base64')).out).toBe('Y2zDqTo0Mg==\n');
    expect((await run(g, 'echo Y2zDqTo0Mg== | base64 -d')).out).toBe('clé:42');
    expect((await run(g, 'echo "***" | base64 -d')).err).toBe('base64: invalid input\n');
    expect((await run(g, 'echo -n abc | sha256sum')).out).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n',
    );
    expect((await run(g, 'sha256sum b.txt')).out).toMatch(/^[0-9a-f]{64} {2}b\.txt\n$/);
    expect((await run(g, 'echo -n abc | sha1sum')).out).toBe('a9993e364706816aba3e25717850c26c9cd0d89d  -\n');
    expect((await run(g, 'sha512sum b.txt')).out).toMatch(/^[0-9a-f]{128} {2}b\.txt\n$/);
  });

  it('compares files', async () => {
    const g = await newGame();
    await run(g, 'sed "s/beta/BETA/" a.txt > c.txt');
    await run(g, 'echo delta >> c.txt');
    expect((await run(g, 'diff a.txt c.txt')).out).toBe('2c2\n< beta\n---\n> BETA\n3a4\n> delta\n');
    expect((await run(g, 'diff a.txt a.txt')).status).toBe(0);
    expect((await run(g, 'diff -q a.txt c.txt')).out).toBe('Files a.txt and c.txt differ\n');
  });

  it('rewrites a file in place with sed', async () => {
    const g = await newGame();
    expect((await run(g, 'sed "s/a/A/g" a.txt')).out).toBe('AlphA\nbetA\ngAmmA\n');
    await run(g, 'sed -i "s|beta|x/y|" a.txt');
    await run(g, 'sed -i /gamma/d a.txt');
    expect((await run(g, 'cat a.txt')).out).toBe('alpha\nx/y\n');
    expect((await run(g, 'sed -i s/a/b/ /etc/shadow')).status).toBe(1);
    expect((await run(g, 'sed nope a.txt')).status).toBe(1);
  });

  it('reads basic regular expressions as grep and sed do, and extended ones with -E', async () => {
    const g = await newGame();
    expect((await run(g, 'grep "alpha\\|gamma" a.txt')).out).toBe('alpha\ngamma\n');
    expect((await run(g, 'grep -E "alpha|gamma" a.txt')).out).toBe('alpha\ngamma\n');
    expect((await run(g, 'grep "alpha|gamma" a.txt')).status).toBe(1);
    await run(g, 'echo "user|contains: root" > r.yml');
    await run(g, 'sed -i "s/user|contains/cmd|contains/" r.yml');
    expect((await run(g, 'cat r.yml')).out).toBe('cmd|contains: root\n');
    expect((await run(g, 'sed "s/\\(al\\)pha/\\1/; s/beta/B/" a.txt')).out).toBe('al\nB\ngamma\n');
    expect((await run(g, 'sed "s/alpha/A/; s/beta/B/" a.txt')).out).toBe('A\nB\ngamma\n');
    expect((await run(g, 'sed -E "s/(al)pha/X/" a.txt')).out).toBe('X\nbeta\ngamma\n');
  });
});
