import { useSyncExternalStore } from 'react';
export const WIDE_CHAT_QUERY = '(min-width: 1200px) and (min-height: 600px)';
function current() { return window.matchMedia(WIDE_CHAT_QUERY).matches; }
function subscribe(listener: () => void) {
  const media = window.matchMedia(WIDE_CHAT_QUERY); media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
export function useWideChat() { return useSyncExternalStore(subscribe, current); }
