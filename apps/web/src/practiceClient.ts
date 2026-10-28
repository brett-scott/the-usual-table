import { createRoom, expireDecision, GameError, project, transition, type RandomIndex } from '@casual/engine';
import type { GameClient, Snapshot } from '@casual/protocol';

/** Rejection sampling avoids modulo bias. The same function can live on the Worker. */
export const secureRandomIndex: RandomIndex = max => {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]! >= limit);
  return buffer[0]! % max;
};

/** Local only: private state lives in this adapter, never in React state or the public DTO. */
export function createPracticeClient(name: string): GameClient {
  const id = 'practice-player';
  let state = createRoom(name, secureRandomIndex, Date.now());
  let snapshot: Snapshot = project(state, id);
  const listeners = new Set<() => void>();
  let disposed = false;
  const connection = { status: 'connected' as const, message: 'Local practice' };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function scheduleDeadline() {
    clearTimeout(timeout);
    if (!disposed && state.decisionDeadline !== null) timeout = setTimeout(checkDeadline, Math.max(0, state.decisionDeadline - Date.now()));
  }
  function publish() {
    snapshot = project(state, id);
    scheduleDeadline();
    for (const listener of listeners) listener();
  }
  function checkDeadline() {
    if (disposed) return;
    const next = expireDecision(state, Date.now());
    if (next !== state) { state = next; publish(); }
    else scheduleDeadline();
  }
  // Absolute deadlines also catch up when a background tab's timers were throttled.
  window.addEventListener('focus', checkDeadline);
  document.addEventListener('visibilitychange', checkDeadline);
  return {
    getSnapshot: () => snapshot,
    getConnection: () => connection,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async send(action) {
      if (disposed) throw new Error('This practice session has ended.');
      const before = state;
      checkDeadline();
      if (state !== before) throw new GameError('TURN_EXPIRED', 'Time is up. This hand stood automatically.');
      state = transition(state, {
        protocol: 1, id: crypto.randomUUID(), playerId: id, revision: snapshot.revision,
        roundId: snapshot.roundId, handId: snapshot.activeHandId ?? undefined, action,
      }, secureRandomIndex, Date.now());
      publish();
    },
    dispose() {
      disposed = true; clearTimeout(timeout); listeners.clear();
      window.removeEventListener('focus', checkDeadline);
      document.removeEventListener('visibilitychange', checkDeadline);
    },
  };
}
