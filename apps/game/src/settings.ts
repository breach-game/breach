import type { Guidance, Locale } from '@breach/pack-schema';
import { useSyncExternalStore } from 'react';

export interface Settings {
  locale: Locale;
  /** Scanlines, grain, glitch and typewriter effects. */
  effects: boolean;
  /** How much Ada helps: every command, the direction only, or nothing after the briefing. */
  guidance: Guidance;
  /** Master switch for music and sound effects. */
  sound: boolean;
  /** Volumes, 0 to 1. */
  music: number;
  sfx: number;
}

const KEY = 'breach.settings';
const listeners = new Set<() => void>();

function initial(): Settings {
  const fallback: Settings = {
    locale: navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en',
    effects: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    guidance: 'guided',
    sound: true,
    music: 0.6,
    sfx: 0.7,
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

/** Be told of every change, outside React. */
export function onSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
