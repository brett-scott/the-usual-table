import { createRoom, expireDecision, GameError, project, transition, type RandomIndex } from '@casual/engine';
import { RESULTS_DURATION_MS, resultsRevealDelay, type PlayerIcon, type GameClient, type Snapshot } from '@casual/protocol';

/** Rejection sampling avoids modulo bias. The same function can live on the Worker. */
export const secureRandomIndex: RandomIndex = max => {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]! >= limit);
  return buffer[0]! % max;
};

/** Local only: private state lives in this adapter, never in React state or the public DTO. */
export function createPracticeClient(name: string, icon?: PlayerIcon): GameClient {
  const id = 'practice-player';
  let state = createRoom(name, secureRandomIndex, Date.now(), icon);
  let snapshot: Snapshot = project(state, id);
  const listeners = new Set<() => void>();
  let disposed = false;
  const connection = { status: 'connected' as const, message: 'Local practice' };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let roundDeadline: number | null = null;
  function scheduleDeadline() {
    clearTimeout(timeout);
    const deadline = state.decisionDeadline ?? roundDeadline;
    if (!disposed && deadline !== null) timeout = setTimeout(checkDeadline, Math.max(0, deadline - Date.now()));
  }
  function publish() {
    const next = project(state, id);
    roundDeadline = state.phase === 'ROUND_COMPLETE' ? roundDeadline ?? state.updatedAt + resultsRevealDelay(snapshot, next) + RESULTS_DURATION_MS : null;
    snapshot = { ...next, roundDeadline };
    scheduleDeadline();
    for (const listener of listeners) listener();
  }
  function checkDeadline() {
    if (disposed) return;
    if (roundDeadline !== null && Date.now() >= roundDeadline) {
      state = transition(state, { protocol: 1, id: crypto.randomUUID(), playerId: id, revision: state.revision, roundId: state.roundId, action: { type: 'NextRound' } }, secureRandomIndex, Date.now());
      publish(); return;
    }
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
      if (state !== before) throw new GameError(before.phase === 'ROUND_COMPLETE' ? 'STALE_STATE' : 'TURN_EXPIRED', before.phase === 'ROUND_COMPLETE' ? 'The next betting window has opened. Review your wager.' : 'Time is up. This hand stood automatically.');
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
