import { CARD_DEAL_MS, CARD_FLIP_MS, INITIAL_CARD_STEP_MS, DEALER_REVEAL_STEP_MS, type Snapshot } from '@casual/protocol';

export const DEAL_MS = CARD_DEAL_MS;
export const FLIP_MS = CARD_FLIP_MS;
const CARD_STEP_MS = INITIAL_CARD_STEP_MS;
export interface CardCue { dealAt: number; revealAt: number | null; readyAt: number }
export interface CardTimeline { source: Snapshot; cues: Record<string, CardCue>; endsAt: number }
export const dealerKey = (round: number, index: number) => `dealer:${round}:${index}`;
export const playerCardKey = (id: string) => `player:${id}`;

/** Presentation only: never schedules a game transition or inspects private cards. */
export function planCards(previous: CardTimeline | null, snapshot: Snapshot, now: number, reducedMotion: boolean): CardTimeline {
  // A host may skip the results while dealer animation is still running.
  if (snapshot.phase === 'BETTING' && !snapshot.dealer.length) return { source: snapshot, cues: {}, endsAt: 0 };
  const sameRound = previous?.source.roundId === snapshot.roundId;
  const cues = sameRound ? { ...previous.cues } : {};
  let endsAt = sameRound ? previous.endsAt : 0;
  let cursor = Math.max(now, endsAt);
  function include(key: string, faceUp: boolean, pauseAfter?: number) {
    const existing = cues[key];
    if (existing) {
      if (faceUp && existing.revealAt === null) {
        cues[key] = { ...existing, revealAt: cursor, readyAt: cursor + FLIP_MS };
        endsAt = cursor + FLIP_MS; cursor = pauseAfter === undefined ? cursor + CARD_STEP_MS : endsAt + pauseAfter;
      }
      return;
    }
    const revealAt = faceUp ? cursor + DEAL_MS : null;
    const readyAt = cursor + DEAL_MS + (faceUp ? FLIP_MS : 0);
    cues[key] = { dealAt: cursor, revealAt, readyAt };
    endsAt = Math.max(endsAt, readyAt); cursor = pauseAfter === undefined ? cursor + CARD_STEP_MS : readyAt + pauseAfter;
  }
  // Initial deal travels around the occupied seats, then dealer, in two passes.
  if (!sameRound || !previous.source.dealer.length) {
    for (let pass = 0; pass < 2; pass++) {
      for (const p of snapshot.players) {
        const card = p.hands[0]?.cards[pass];
        if (card) include(playerCardKey(card.id), true);
      }
      const card = snapshot.dealer[pass];
      if (card) include(dealerKey(snapshot.roundId, pass), !('hidden' in card));
    }
  }
  // Split cards already on the felt retain their cues when they move between hands.
  for (const p of snapshot.players) for (const h of p.hands) for (const c of h.cards) include(playerCardKey(c.id), true);
  // Reveal the existing hole card before dealing and flipping additional dealer cards.
  const revealing = sameRound && previous.source.dealer.some(card => 'hidden' in card) && snapshot.dealer.every(card => !('hidden' in card));
  snapshot.dealer.forEach((card, index) => include(dealerKey(snapshot.roundId, index), !('hidden' in card), revealing ? DEALER_REVEAL_STEP_MS : undefined));
  if (reducedMotion) {
    for (const [key, cue] of Object.entries(cues)) cues[key] = { dealAt: 0, revealAt: cue.revealAt === null ? null : 0, readyAt: 0 };
    endsAt = 0;
  }
  return { source: snapshot, cues, endsAt };
}
