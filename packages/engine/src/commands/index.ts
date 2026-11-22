import { defenseCommands } from './defense.ts';
import { fileCommands } from './files.ts';
import { gameCommands } from './gamecmds.ts';
import { gitCommands } from './git.ts';
import { networkCommands } from './network.ts';
import { systemCommands } from './system.ts';
import { textCommands } from './text.ts';
import type { Command } from './types.ts';

export const commands = new Map<string, Command>();
for (const c of [
  ...gameCommands,
  ...fileCommands,
  ...textCommands,
  ...networkCommands,
  ...gitCommands,
  ...systemCommands,
  ...defenseCommands,
])
  commands.set(c.name, c);
