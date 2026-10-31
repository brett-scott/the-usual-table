import { score } from '@casual/engine';
import type { Card } from '@casual/protocol';
import { dealerKey, type CardTimeline } from './cardTimeline';

/** Count only face-up cards whose reveal has completed, never the snapshot's future final total. */
export function displayedDealerTotal(timeline: CardTimeline, now: number): number | null {
  const cards = timeline.source.dealer.filter((card, index) => {
    const cue = timeline.cues[dealerKey(timeline.source.roundId, index)];
    return !('hidden' in card) && !!cue && cue.readyAt <= now;
  }).filter((card): card is Card => !('hidden' in card));
  return cards.length ? score(cards).total : null;
}
