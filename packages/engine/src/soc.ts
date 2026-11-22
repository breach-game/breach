import type { GameEvent } from './events.ts';
import type { Game } from './game.ts';
import { gameDate } from './util.ts';

export interface SocEntry {
  time: string;
  source: string;
  /** The command line that made the noise. */
  action: string;
  noise: number;
}

/**
 * What NovaMind's SOC flagged during the current mission: each action that made noise.
 * The source is the address the action came from: the workstation, or the host the player had
 * reached by SSH when they ran it.
 */
export function socView(game: Game): SocEntry[] {
  const player = game.world.player.host;
  const ip = (id: string) => game.host(id)?.ip ?? game.playerHost.ip;
  const start = game.log.findIndex((e) => e.seq === game.state.missionStartSeq);
  const stack: string[] = [];
  let current = player;
  const entries: SocEntry[] = [];
  game.log.forEach((e: GameEvent, i) => {
    if (e.type === 'MissionStarted') {
      stack.length = 0;
      current = player;
    } else if (e.type === 'SessionOpened') {
      stack.push(current);
      current = e.host;
    } else if (e.type === 'SessionClosed') current = stack.pop() ?? player;
    if (i < start || e.type !== 'NoiseChanged' || e.delta <= 0 || e.cause === 'rule') return;
    entries.push({
      time: gameDate(game.world.startTime, e.t).time,
      source: ip(current),
      // A reaction of the target that a mission chose to show, or the player's own command line.
      action: e.cause.startsWith('soc:') ? game.t(e.cause.slice(4)) : e.cause,
      noise: e.delta,
    });
  });
  return entries;
}
