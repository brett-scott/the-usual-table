import { expect, it } from 'vitest';
import { createDecks, createRoom, project, transition } from '@casual/engine';
import type { Action, Rank } from '@casual/protocol';
import { DEAL_MS, FLIP_MS, dealerKey, planCards, playerCardKey } from './cardTimeline';

const rng = (max: number) => max - 1;
function setup(ranks: Rank[]) {
  let state = createRoom('A', rng);
  const rest = createDecks(); state.shoe.cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
  return { get state() { return state; }, send(action: Action) {
    state = transition(state, { protocol: 1, id: `cmd-${state.revision}`, revision: state.revision, roundId: state.roundId, playerId: 'practice-player', handId: project(state, 'practice-player').activeHandId ?? undefined, action }, rng, 1000);
    return project(state, 'practice-player');
  } };
}

it('deals in seat order and flips face-up cards individually, keeping the hole card hidden', () => {
  const game = setup(['10', '9', '6', '8', '8', '10']);
  game.state.players.push({ ...createRoom('B', rng).players[0]!, id: 'other', seat: 2 });
  const snapshot = game.send({ type: 'Ready' }); const timeline = planCards(null, snapshot, 1000, false);
  const first = snapshot.players[0]!.hands[0]!.cards; const other = snapshot.players[1]!.hands[0]!.cards;
  const keys = [playerCardKey(first[0]!.id), playerCardKey(other[0]!.id), dealerKey(1, 0), playerCardKey(first[1]!.id), playerCardKey(other[1]!.id), dealerKey(1, 1)];
  expect(keys.map(key => timeline.cues[key]!.dealAt)).toEqual([1000, 1360, 1720, 2080, 2440, 2800]);
  expect(timeline.cues[keys[0]!]!.revealAt).toBe(1000 + DEAL_MS);
  expect(timeline.cues[keys[5]!]!.revealAt).toBeNull();
});
it('reveals the existing hole card before dealing additional dealer cards', () => {
  const game = setup(['10', '6', '8', '10', '5']);
  const dealt = game.send({ type: 'Ready' }); const first = planCards(null, dealt, 1000, false);
  const done = game.send({ type: 'Stand' }); const next = planCards(first, done, 4000, false);
  const hole = next.cues[dealerKey(1, 1)]!; const extra = next.cues[dealerKey(1, 2)]!;
  expect(hole.dealAt).toBe(first.cues[dealerKey(1, 1)]!.dealAt);
  expect(hole.revealAt).toBe(4000); expect(extra.dealAt).toBeGreaterThanOrEqual(hole.readyAt);
  expect(extra.readyAt).toBe(extra.revealAt! + FLIP_MS);
});
it('does not replay existing cards when hitting, splitting or switching themes', () => {
  const game = setup(['8', '10', '8', '7', '3', '2', '2']);
  const dealt = game.send({ type: 'Ready' }); let timeline = planCards(null, dealt, 1000, false);
  const original = { ...timeline.cues };
  const split = game.send({ type: 'Split' }); timeline = planCards(timeline, split, 4000, false);
  for (const [key, cue] of Object.entries(original)) expect(timeline.cues[key]).toEqual(cue);
  const hit = game.send({ type: 'Hit' }); const next = planCards(timeline, hit, 6000, false);
  for (const [key, cue] of Object.entries(timeline.cues)) expect(next.cues[key]).toEqual(cue);
  expect(planCards(next, hit, 9000, false).cues).toEqual(next.cues);
});
it('reduced motion presents immediately without changing the snapshot or revealing the hole card', () => {
  const game = setup(['10', '9', '8', '7']); const snapshot = game.send({ type: 'Ready' });
  const timeline = planCards(null, snapshot, 1000, true);
  expect(timeline.endsAt).toBe(0); expect(timeline.source).toBe(snapshot);
  expect(timeline.cues[dealerKey(1, 1)]!.revealAt).toBeNull();
  expect(Object.values(timeline.cues).every(cue => cue.readyAt === 0)).toBe(true);
});
