import { stripAnsi } from '@breach/engine';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { currentGame, elapsed, resumeSeq, terminalBridge, touch } from '../session.ts';
import { getSettings } from '../settings.ts';
import { translate } from '../ui.ts';

const THEME = {
  background: '#00000000',
  foreground: '#D7E0F5',
  cursor: '#EEF2FF',
  cursorAccent: '#07090F',
  selectionBackground: 'rgba(45,226,255,0.28)',
  black: '#0E1320',
  red: '#FF8FA0',
  green: '#3DFF9A',
  yellow: '#FFB020',
  blue: '#7DA6FF',
  magenta: '#C3A6FF',
  cyan: '#2DE2FF',
  white: '#D7E0F5',
  brightBlack: '#7D8BAA',
  brightRed: '#FF3D5A',
  brightGreen: '#3DFF9A',
  brightYellow: '#FFB020',
  brightBlue: '#7DA6FF',
  brightMagenta: '#C3A6FF',
  brightCyan: '#2DE2FF',
  brightWhite: '#EEF2FF',
};

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

/**
 * Line editor on top of xterm.js: history, cursor movement, Tab completion, paste.
 * It only draws. Every command goes to the engine, which never touches the real network.
 */
class Shell {
  private buffer = '';
  private cursor = 0;
  private cursorRow = 0;
  private busy = false;
  private skip = false;
  private historyIndex = -1;
  private draft = '';
  private queue: string[] = [];

  constructor(private term: XTerm) {}

  private get game() {
    return currentGame();
  }

  private promptText() {
    return this.game.prompt();
  }

  /** Redraw the edited line, handling lines that wrap. */
  private draw() {
    const cols = this.term.cols;
    const prompt = this.promptText();
    const promptLen = stripAnsi(prompt).length;
    let out = '';
    if (this.cursorRow > 0) out += `\x1b[${this.cursorRow}A`;
    out += `\r\x1b[J${prompt}${this.buffer}`;
    const end = promptLen + this.buffer.length;
    if (end > 0 && end % cols === 0) out += '\r\n';
    const pos = promptLen + this.cursor;
    const up = Math.floor(end / cols) - Math.floor(pos / cols);
    if (up > 0) out += `\x1b[${up}A`;
    out += '\r';
    if (pos % cols > 0) out += `\x1b[${pos % cols}C`;
    this.cursorRow = Math.floor(pos / cols);
    this.term.write(out);
  }

  private endLine() {
    const cols = this.term.cols;
    const promptLen = stripAnsi(this.promptText()).length;
    const down = Math.floor((promptLen + this.buffer.length) / cols) - this.cursorRow;
    this.term.write(`${down > 0 ? `\x1b[${down}B` : ''}\r\n`);
    this.cursorRow = 0;
  }

  prompt() {
    this.buffer = '';
    this.cursor = 0;
    this.cursorRow = 0;
    this.historyIndex = -1;
    this.draw();
  }

  banner(lines: string[]) {
    this.term.write(crlf(`${lines.map((l) => `\x1b[2m${l}\x1b[0m`).join('\n')}\n\n`));
  }

  /** Type and run a command on behalf of another window. */
  inject(line: string) {
    if (this.busy) {
      this.queue.push(line);
      return;
    }
    this.buffer = line;
    this.cursor = line.length;
    this.draw();
    void this.submit();
  }

  private async submit() {
    const line = this.buffer;
    this.endLine();
    if (!line.trim()) {
      this.prompt();
      return;
    }
    this.busy = true;
    this.skip = false;
    try {
      for await (const chunk of this.game.exec(line, elapsed())) {
        if (chunk.k === 'out') this.term.write(crlf(chunk.text));
        else if (chunk.k === 'err') this.term.write(crlf(chunk.text));
        else if (chunk.k === 'clear') this.term.write('\x1b[2J\x1b[3J\x1b[H');
        else if (!this.skip)
          await new Promise((r) => setTimeout(r, getSettings().effects ? chunk.ms : Math.min(chunk.ms, 40)));
      }
    } catch (error) {
      this.term.write(crlf(`\x1b[31mlrsh: internal error: ${(error as Error).message}\x1b[0m\n`));
    }
    touch();
    this.busy = false;
    this.prompt();
    const next = this.queue.shift();
    if (next !== undefined) this.inject(next);
  }

  private setBuffer(text: string) {
    this.buffer = text;
    this.cursor = text.length;
    this.draw();
  }

  private history(delta: number) {
    const h = this.game.state.history;
    if (!h.length) return;
    if (this.historyIndex === -1) {
      if (delta > 0) return;
      this.draft = this.buffer;
      this.historyIndex = h.length - 1;
    } else {
      this.historyIndex += delta;
      if (this.historyIndex >= h.length) {
        this.historyIndex = -1;
        this.setBuffer(this.draft);
        return;
      }
      this.historyIndex = Math.max(0, this.historyIndex);
    }
    this.setBuffer(h[this.historyIndex] ?? '');
  }

  private complete() {
    const head = this.buffer.slice(0, this.cursor);
    const { from, candidates } = this.game.complete(head);
    if (!candidates.length) return;
    let common = candidates[0]!;
    for (const c of candidates) while (!c.startsWith(common)) common = common.slice(0, -1);
    const single = candidates.length === 1;
    const insert = common + (single && !common.endsWith('/') ? ' ' : '');
    if (insert.length > head.length - from) {
      this.buffer = head.slice(0, from) + insert + this.buffer.slice(this.cursor);
      this.cursor = from + insert.length;
      this.draw();
    } else if (!single) {
      this.endLine();
      this.term.write(
        crlf(
          `${candidates.map((c) => c.split('/').filter(Boolean).pop() + (c.endsWith('/') ? '/' : '')).join('  ')}\n`,
        ),
      );
      this.cursorRow = 0;
      this.draw();
    }
  }

  private insert(text: string) {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.draw();
  }

  onData(data: string) {
    if (this.busy) {
      if (data === '\x03') this.skip = true;
      return;
    }
    switch (data) {
      case '\r':
        void this.submit();
        return;
      case '\x7f':
      case '\b':
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.draw();
        }
        return;
      case '\x1b[3~':
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        this.draw();
        return;
      case '\x1b[D':
        this.cursor = Math.max(0, this.cursor - 1);
        this.draw();
        return;
      case '\x1b[C':
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        this.draw();
        return;
      case '\x1b[A':
        this.history(-1);
        return;
      case '\x1b[B':
        this.history(1);
        return;
      case '\x1b[H':
      case '\x1bOH':
      case '\x01':
        this.cursor = 0;
        this.draw();
        return;
      case '\x1b[F':
      case '\x1bOF':
      case '\x05':
        this.cursor = this.buffer.length;
        this.draw();
        return;
      case '\x15':
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        this.draw();
        return;
      case '\x0b':
        this.buffer = this.buffer.slice(0, this.cursor);
        this.draw();
        return;
      case '\x17': {
        const head = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, '');
        this.buffer = head + this.buffer.slice(this.cursor);
        this.cursor = head.length;
        this.draw();
        return;
      }
      case '\x03':
        this.endLine();
        this.prompt();
        return;
      case '\x0c':
        this.term.write('\x1b[2J\x1b[3J\x1b[H');
        this.cursorRow = 0;
        this.draw();
        return;
      case '\t':
        this.complete();
        return;
      default: {
        if (data.startsWith('\x1b')) return;
        // Pasted text: keep the first line, drop control characters.
        const text = (data.split(/\r|\n/)[0] ?? '').replace(/[\x00-\x1f\x7f]/g, '');
        if (text) this.insert(text);
      }
    }
  }
}

export function Terminal({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      await document.fonts.load('13.5px "JetBrains Mono"').catch(() => {});
      if (disposed) return;
      const term = new XTerm({
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
        fontSize: 13.5,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'block',
        allowTransparency: true,
        scrollback: 2000,
        theme: THEME,
        screenReaderMode: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      termRef.current = term;
      const shell = new Shell(term);
      const game = currentGame();
      const locale = getSettings().locale;
      shell.banner([
        translate(locale, 'term.welcome', { user: game.user, mandate: game.world.mandate }),
        translate(locale, resumeSeq() > 1 ? 'term.resumed' : 'term.welcome2'),
      ]);
      shell.prompt();
      const sub = term.onData((d) => shell.onData(d));
      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // The window is being resized to nothing.
        }
      });
      observer.observe(el);
      terminalBridge.run = (line) => shell.inject(line);
      terminalBridge.focus = () => term.focus();
      term.focus();
      cleanup = () => {
        sub.dispose();
        observer.disconnect();
        terminalBridge.run = undefined;
        terminalBridge.focus = undefined;
        term.dispose();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return <div className="term" ref={host} />;
}
