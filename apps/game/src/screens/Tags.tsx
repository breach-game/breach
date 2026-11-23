import type { CatalogEntry } from '@breach/pack-schema';
import { type UiKey, useT } from '../ui.ts';

/** Difficulty (dots doubled by a word) and skills of a mission, as its catalogue entry gives them. */
export function Tags({ entry, fallback }: { entry: CatalogEntry; fallback?: 1 | 2 | 3 }) {
  const t = useT();
  const difficulty = entry.difficulty ?? fallback;
  const skills = entry.skills ?? [];
  if (!difficulty && skills.length === 0) return null;
  return (
    <span className="tags">
      {difficulty && (
        <span className="difficulty" title={t(`difficulty.${difficulty}` as UiKey)}>
          <span aria-hidden="true">{'●'.repeat(difficulty) + '○'.repeat(3 - difficulty)}</span>
          {t(`difficulty.${difficulty}` as UiKey)}
        </span>
      )}
      {skills.map((s) => (
        <span className="tag" key={s}>
          {t(`skill.${s}` as UiKey)}
        </span>
      ))}
    </span>
  );
}
