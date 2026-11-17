'use client';

import { useCallback, useSyncExternalStore } from 'react';

const storageKey = 'cdek-fm-3d-motion';
const changeEvent = 'cdek-motion-change';
let temporaryChoice: 'on' | 'off' | null = null;

function pausedSnapshot() {
  if (temporaryChoice) return temporaryChoice === 'off';
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'on' || stored === 'off') return stored === 'off';
  } catch { /* Private browsing can disable storage. */ }
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function subscribe(changed: () => void) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    temporaryChoice = null;
    changed();
  };
  media.addEventListener('change', changed);
  window.addEventListener('storage', storage);
  window.addEventListener(changeEvent, changed);
  return () => {
    media.removeEventListener('change', changed);
    window.removeEventListener('storage', storage);
    window.removeEventListener(changeEvent, changed);
  };
}

const serverSnapshot = () => false;

export function useMotionPreference() {
  const paused = useSyncExternalStore(subscribe, pausedSnapshot, serverSnapshot);
  const setPaused = useCallback((value: boolean) => {
    const choice = value ? 'off' : 'on';
    try { localStorage.setItem(storageKey, choice); temporaryChoice = null; }
    catch { temporaryChoice = choice; }
    window.dispatchEvent(new Event(changeEvent));
  }, []);
  return [paused, setPaused] as const;
}
