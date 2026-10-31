import { expect, it } from 'vitest';
import { createRoom, project } from '@casual/engine';
import { dealerKey, planCards, type CardTimeline } from './cardTimeline';
import { displayedDealerTotal } from './dealerScore';

function revealed(ranks: ('A' | '6' | '10')[]): CardTimeline {
  const room = createRoom('Player', max => max - 1, 0);
  const snapshot = { ...project(room, room.players[0]!.id), roundId: 1,
    dealer: ranks.map((rank, index) => ({ id: String(index), rank, suit: 'spades' as const })), dealerTotal: 99 };
  return { source: snapshot, endsAt: 2000, cues: Object.fromEntries(ranks.map((_, index) => [dealerKey(1, index), { dealAt: 0, revealAt: 0, readyAt: 100 + index * 500 }])) };
}
it('updates once per completed reveal and never leaks the future snapshot total', () => {
  const timeline = revealed(['10', '6', 'A']);
  expect(displayedDealerTotal(timeline, 99)).toBeNull();
  expect(displayedDealerTotal(timeline, 100)).toBe(10);
  expect(displayedDealerTotal(timeline, 599)).toBe(10);
  expect(displayedDealerTotal(timeline, 600)).toBe(16);
  expect(displayedDealerTotal(timeline, 1100)).toBe(17);
});
it('revalues revealed aces and ignores hidden cards even when their cues have completed', () => {
  const timeline = revealed(['A', '6', '10']);
  expect(displayedDealerTotal(timeline, 600)).toBe(17);
  expect(displayedDealerTotal(timeline, 1100)).toBe(17);
  timeline.source.dealer[2] = { hidden: true };
  expect(displayedDealerTotal(timeline, 5000)).toBe(17);
});
it('supports immediate reduced-motion totals and clears the total for a fresh betting window', () => {
  const timeline = revealed(['10', '6']);
  const immediate = planCards(null, timeline.source, 1000, true);
  expect(displayedDealerTotal(immediate, 1000)).toBe(16);
  const cleared = planCards(immediate, { ...timeline.source, phase: 'BETTING', dealer: [], dealerTotal: null }, 1100, true);
  expect(displayedDealerTotal(cleared, 1100)).toBeNull();
});
