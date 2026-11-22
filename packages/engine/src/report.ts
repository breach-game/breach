import type { Game } from './game.ts';
import { gameDate } from './util.ts';

/**
 * The pentest report, written from the journal: one finding per attack mission with the
 * detection and the fix the player validated, then the incidents handled on the Blue Team side.
 * Markdown, so it can be read in the terminal and downloaded as a file.
 */
export function pentestReport(game: Game): string {
  const t = (key: string, vars?: Record<string, string | number>) => game.t(key, vars);
  const locale = game.state.locale;
  const title = (id: string) => {
    const p = game.missions.get(id);
    return p ? (p.title[locale] ?? p.title.fr ?? p.title.en ?? id) : id;
  };

  // What the journal says about each mission's defence and containment.
  const rules: Record<string, string> = {};
  const fixes: Record<string, string> = {};
  const contained: Record<string, string[]> = {};
  let current: string | null = null;
  for (const e of game.log) {
    if (e.type === 'MissionStarted' || e.type === 'DefenseStarted') current = e.mission;
    else if (!current) continue;
    else if (e.type === 'DefenseRuleChosen' && e.correct) rules[current] = e.rule;
    else if (e.type === 'DefenseFixApplied' && e.correct && e.blocked) fixes[current] = e.fix;
    else if (e.type === 'Contained') (contained[current] ??= []).push(e.containment);
  }

  const done = Object.entries(game.state.completed);
  const ordered = done
    .map(([id, result]) => ({ id, result, pack: game.missions.get(id) }))
    .filter((m) => m.pack?.mission)
    .sort((a, b) => a.pack!.mission!.order - b.pack!.mission!.order);
  // A finding is an attack with something to fix: the mandate mission is training, not a finding.
  const attacks = ordered.filter(
    (m) => m.pack!.mission!.side !== 'defense' && m.pack!.mission!.defense?.fixes.length,
  );
  const incidents = ordered.filter((m) => m.pack!.mission!.side === 'defense');
  const total = ordered.reduce((sum, m) => sum + m.result.score + (m.result.defense ?? 0), 0);

  const lines: string[] = [];
  lines.push(`# ${t('report.title')}`, '');
  lines.push(`- ${t('report.client')}`);
  lines.push(`- ${t('report.auditor')}`);
  lines.push(`- ${t('report.date', { date: gameDate(game.world.startTime, game.state.clock).iso })}`);
  lines.push('', `## ${t('report.summary')}`, '');
  lines.push(
    t('report.summary.text', { attacks: attacks.length, incidents: incidents.length, score: total }),
  );
  if (!ordered.length) lines.push('', t('report.empty'));

  if (attacks.length) lines.push('', `## ${t('report.findings')}`);
  attacks.forEach((m, i) => {
    const mission = m.pack!.mission!;
    lines.push('', `### ${i + 1}. ${title(m.id)}`, '');
    if (mission.debrief.reference) lines.push(`**${t('report.class')}** ${mission.debrief.reference}`, '');
    lines.push(`**${t('report.recommendations')}**`, '');
    for (const p of mission.debrief.points) lines.push(`- ${t(p)}`);
    const rule = mission.defense?.rules.find((r) => r.id === rules[m.id]);
    const fix = mission.defense?.fixes.find((f) => f.id === fixes[m.id]);
    if (rule || fix) lines.push('');
    if (rule) lines.push(`**${t('report.detection')}** ${t(rule.title)}`);
    if (fix) lines.push(`**${t('report.fix')}** ${t(fix.title)} ${t('report.fix.verified')}`);
  });

  if (incidents.length) lines.push('', `## ${t('report.incidents')}`);
  for (const m of incidents) {
    const mission = m.pack!.mission!;
    lines.push('', `### ${title(m.id)}`, '');
    const orders = (contained[m.id] ?? [])
      .map((id) => mission.containment.find((c) => c.id === id))
      .filter((c) => c !== undefined);
    if (orders.length) {
      lines.push(`**${t('report.containment')}**`, '');
      for (const c of orders)
        lines.push(`- \`contain ${c.action} ${c.target}\` (${t('report.impact', { impact: c.impact })})`);
      lines.push('');
    }
    lines.push(`**${t('report.recommendations')}**`, '');
    for (const p of mission.debrief.points) lines.push(`- ${t(p)}`);
  }
  lines.push('', '---', t('report.footer'));
  return `${lines.join('\n')}\n`;
}
