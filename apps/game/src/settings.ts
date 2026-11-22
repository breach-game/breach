import type { Locale } from '@breach/pack-schema';
import { useSyncExternalStore } from 'react';

export interface Settings {
  locale: Locale;
  /** Scanlines, grain, glitch and typewriter effects. */
  effects: boolean;
}

const KEY = 'breach.settings';
const listeners = new Set<() => void>();

function initial(): Settings {
  const fallback: Settings = {
    locale: navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en',
    effects: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

let current = initial();

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: settings last for the session only.
  }
  document.documentElement.lang = current.locale;
  document.documentElement.dataset.effects = current.effects ? 'on' : 'off';
  for (const l of listeners) l();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

updateSettings({});
