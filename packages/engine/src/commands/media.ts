import type { ImageSource } from '@breach/pack-schema';
import { imageBytes, readImage } from '../artifact.ts';
import { canWrite, lookup } from '../vfs.ts';
import { type Command, err, out, type Run } from './types.ts';

/**
 * What a photo says about the person who took it, and what a web page put on the clipboard. Both
 * only read the game's own state: `exiftool` reads the tags a pack declared on a `$image`, `clip`
 * reads what a page's `copy` button wrote. Nothing reaches the real clipboard or a real file.
 */

const label = (name: string) => `${name.padEnd(32)}: `;
const compact = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const isGps = (name: string) => /^gps/i.test(name);
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} kB`
      : `${bytes} bytes`;

const exiftool: Command = {
  name: 'exiftool',
  summary: 'cmd.exiftool',
  explain: 'explain.exiftool',
  group: 'files',
  async *run(ctx): Run {
    const options = ctx.args.filter((a) => a.startsWith('-'));
    const files = ctx.args.filter((a) => !a.startsWith('-'));
    if (!files.length) {
      yield err(
        'Syntax:  exiftool [OPTIONS] FILE\n\nTry "exiftool -h" for help, or "exiftool -all= FILE" to remove all metadata.',
      );
      return 1;
    }
    // Writing: `-all=` removes every tag, `-gps:all=` only the position. Real exiftool keeps a copy.
    const removeAll = options.includes('-all=');
    const removeGps = options.some((o) => /^-gps:all=$/i.test(o));
    if (removeAll || removeGps) {
      let updated = 0;
      for (const f of files) {
        const abs = ctx.path(f);
        const node = lookup(ctx.state.fs, abs);
        const img = node?.t === 'f' ? readImage(node.content) : null;
        if (!node || node.t !== 'f') {
          yield err(`Error: File not found - ${f}`);
          continue;
        }
        if (!img) {
          yield err(`Error: Not a supported image file - ${f}`);
          continue;
        }
        if (!canWrite(node, ctx.state.user)) {
          yield err(`Error: Permission denied - ${f}`);
          continue;
        }
        const exif = removeAll
          ? {}
          : Object.fromEntries(Object.entries(img.exif ?? {}).filter(([k]) => !isGps(k)));
        const next: ImageSource = { ...img, exif };
        if (!options.includes('-overwrite_original'))
          ctx.emit({
            type: 'FileWritten',
            host: ctx.state.host,
            path: `${abs}_original`,
            content: node.content,
            append: false,
          });
        ctx.emit({
          type: 'FileWritten',
          host: ctx.state.host,
          path: abs,
          content: imageBytes(next),
          append: false,
        });
        updated++;
      }
      yield out(`    ${updated} image files updated`);
      return updated ? 0 : 1;
    }
    // Reading: every tag, a group (`-gps:all`) or named tags (`-Model -GPSPosition`).
    const groups = options.filter((o) => /^-gps:all$/i.test(o)).length > 0;
    const named = options
      .filter((o) => /^-[A-Za-z][A-Za-z0-9]*$/.test(o) && !['-s', '-a', '-u', '-g', '-G'].includes(o))
      .map((o) => compact(o.slice(1)));
    let status = 0;
    for (const f of files) {
      const abs = ctx.path(f);
      const node = lookup(ctx.state.fs, abs);
      if (!node || node.t !== 'f') {
        yield err(`Error: File not found - ${f}`);
        status = 1;
        continue;
      }
      if (files.length > 1) yield out(`======== ${f}`);
      const img = readImage(node.content);
      const tags = Object.entries(img?.exif ?? {});
      ctx.emit({
        type: 'ExifRead',
        file: abs,
        tags: tags.map(([k]) => k),
        gps: tags.some(([k]) => isGps(k)),
      });
      const shown = tags.filter(([k]) => (groups ? isGps(k) : !named.length || named.includes(compact(k))));
      const lines: string[] = [];
      if (!groups && !named.length) {
        const name = abs.split('/').pop() ?? f;
        lines.push(
          `${label('ExifTool Version Number')}12.76`,
          `${label('File Name')}${name}`,
          `${label('Directory')}${abs.slice(0, abs.lastIndexOf('/')) || '/'}`,
          // A photo's pixels are not described: its size is what a camera would write for it.
          `${label('File Size')}${size(img ? Math.round(img.width * img.height * (img.format === 'png' ? 1.1 : 0.21)) : node.content.length)}`,
        );
        if (!img) lines.push(`${label('File Type')}${node.content.length ? 'TXT' : '(empty)'}`);
        else
          lines.push(
            `${label('File Type')}${img.format.toUpperCase()}`,
            `${label('MIME Type')}image/${img.format}`,
            `${label('Image Width')}${img.width}`,
            `${label('Image Height')}${img.height}`,
          );
      }
      for (const [k, v] of shown) lines.push(`${label(k)}${v}`);
      if (lines.length) yield out(lines.join('\n'));
    }
    if (files.length > 1) yield out(`    ${files.length} image files read`);
    return status;
  },
};

const PASTE_TOOLS = ['clip', 'xclip', 'xsel', 'pbpaste', 'wl-paste'];

/** Read the clipboard without pasting it anywhere: what a page put there is shown, never run. */
const clipboardRead = (name: string): Command => ({
  name,
  summary: `cmd.${name === 'clip' ? 'clip' : 'paste'}`,
  explain: 'explain.clip',
  group: 'files',
  async *run(ctx): Run {
    if (name === 'xclip' && !ctx.args.includes('-o')) {
      yield err('xclip: this workstation only reads the clipboard: xclip -o -selection clipboard');
      return 1;
    }
    if (name === 'xsel' && !ctx.args.some((a) => a === '-o' || a === '-b' || a === '--output')) {
      yield err('xsel: this workstation only reads the clipboard: xsel -b -o');
      return 1;
    }
    const text = ctx.state.clipboard;
    if (!text) {
      yield err(ctx.t('engine.clip.empty'));
      return 1;
    }
    ctx.emit({ type: 'ClipboardRead', text });
    yield out(text);
    return 0;
  },
});

export const mediaCommands: Command[] = [exiftool, ...PASTE_TOOLS.map(clipboardRead)];
