import { dataCommands } from './data.ts';
import { defenseCommands } from './defense.ts';
import { fileCommands } from './files.ts';
import { gameCommands } from './gamecmds.ts';
import { gitCommands } from './git.ts';
import { hostCommands } from './host.ts';
import { infraCommands } from './infra.ts';
import { inspectCommands } from './inspect.ts';
import { networkCommands } from './network.ts';
import { opsCommands } from './ops.ts';
import { systemCommands } from './system.ts';
import { textCommands } from './text.ts';
import type { Command } from './types.ts';

export const commands = new Map<string, Command>();
for (const c of [
  ...gameCommands,
  ...fileCommands,
  ...textCommands,
  ...dataCommands,
  ...inspectCommands,
  ...networkCommands,
  ...infraCommands,
  ...gitCommands,
  ...systemCommands,
  ...hostCommands,
  ...defenseCommands,
  ...opsCommands,
])
  commands.set(c.name, c);
