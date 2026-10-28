import { useSyncExternalStore } from 'react';

export const COMPACT_QUERY = '(max-width: 640px), (max-width: 1024px) and (max-height: 500px)';
function current() { return window.matchMedia(COMPACT_QUERY).matches; }
function subscribe(listener: () => void) {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export function useCompactLayout() { return useSyncExternalStore(subscribe, current); }
