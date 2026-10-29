import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Snapshot } from '@casual/protocol';
import { planCards } from './cardTimeline';

function motionPreference() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
export function useTablePresentation(snapshot: Snapshot) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionPreference);
  const [stored, setStored] = useState(() => ({ timeline: planCards(null, snapshot, Date.now(), reducedMotion), reducedMotion }));
  let timeline = stored.timeline;
  if (timeline.source !== snapshot || stored.reducedMotion !== reducedMotion) {
    timeline = planCards(timeline, snapshot, Date.now(), reducedMotion);
    setStored({ timeline, reducedMotion });
  }
  const [now, setNow] = useState(Date.now);
  const ticking = snapshot.decisionDeadline !== null || (snapshot.roundDeadline ?? null) !== null || (snapshot.room?.bettingDeadline ?? null) !== null || (snapshot.room?.insuranceDeadline ?? null) !== null || snapshot.players.some(p => !p.connected && p.reservationDeadline != null && p.reservationDeadline > now) || now < timeline.endsAt;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [ticking]);
  return { timeline, reducedMotion, now, presenting: now < timeline.endsAt };
}
