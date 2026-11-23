import { stripAnsi } from '@breach/engine';

/**
 * True when a piece of command output leaves the cursor in the middle of a line.
 * The prompt redraws its whole line, so the terminal must end that line first.
 */
export const needsNewline = (text: string) => text.length > 0 && !stripAnsi(text).endsWith('\n');
