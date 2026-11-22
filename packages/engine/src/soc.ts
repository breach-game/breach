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
 * What NovaMind's SOC saw of the player during the current mission.
 * It is read straight from the event log, which is why the Blue Team debrief can show the player
 * their own traces.
 */
export function socView(game: Game): SocEntry[] {
  const start = game.log.findIndex((e) => e.seq === game.state.missionStartSeq);
  const entries: SocEntry[] = [];
  for (const e of game.log.slice(Math.max(0, start)) as GameEvent[]) {
    if (e.type !== 'NoiseChanged' || e.delta <= 0 || e.cause === 'rule') continue;
    entries.push({
      time: gameDate(game.world.startTime, e.t).time,
      source: game.playerHost.ip,
      // A reaction of the target that a mission chose to show, or the player's own command line.
      action: e.cause.startsWith('soc:') ? game.t(e.cause.slice(4)) : e.cause,
      noise: e.delta,
    });
  }
  return entries;
}
