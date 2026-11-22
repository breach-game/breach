import { fileCommands } from './files.ts';
import { gameCommands } from './gamecmds.ts';
import { gitCommands } from './git.ts';
import { networkCommands } from './network.ts';
import { systemCommands } from './system.ts';
import type { Command } from './types.ts';

export const commands = new Map<string, Command>();
for (const c of [...gameCommands, ...fileCommands, ...networkCommands, ...gitCommands, ...systemCommands]) commands.set(c.name, c);
