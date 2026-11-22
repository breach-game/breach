import type { Locale } from '@breach/pack-schema';
import { en } from './locales/en.ts';
import { fr } from './locales/fr.ts';

export const engineStrings: Record<Locale, Record<string, string>> = { fr, en };

export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
