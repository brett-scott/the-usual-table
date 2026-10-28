import { describe, expect, it } from 'vitest';
import { commandSchema, type Action, type Command, type Rank } from '@casual/protocol';
import { CUT_CARD, GameError, HAND_DURATION_MS, ROUND_RESERVE, createDecks, createRoom, createShoe, expireDecision, legalActions, project, score, transition, type Card, type RoomState } from './index';

const rng = (max: number) => max - 1;
const id = 'practice-player';
function cards(...ranks: Rank[]): Card[] { return ranks.map((rank, i) => ({ rank, suit: 'spades', id: `fixture-${i}` })); }
function fixture(...ranks: Rank[]): RoomState {
  const state = createRoom('Alex', rng);
  const rest = createDecks();
  const prefix = ranks.map(rank => {
    const index = rest.findIndex(c => c.rank === rank);
    if (index < 0) throw new Error(`No physical ${rank} left in fixture`);
    return rest.splice(index, 1)[0]!;
  });
  state.shoe.cards = [...prefix, ...rest];
  return state;
}
function command(state: RoomState, action: Action, overrides: Partial<Command> = {}): Command {
  return { protocol: 1, id: `cmd-${state.revision}`, playerId: id, revision: state.revision, roundId: state.roundId,
    handId: project(state, id).activeHandId ?? undefined, action, ...overrides };
}
function act(state: RoomState, action: Action) { return transition(state, command(state, action), rng, 123); }
function deal(...ranks: Rank[]) { return act(fixture(...ranks), { type: 'Ready' }); }
function p(state: RoomState) { return state.players[0]!; }

describe('physical shoe and totals', () => {
  it('creates 312 unique physical instances, six of each rank/suit', () => {
    const deck = createDecks(); expect(deck).toHaveLength(312); expect(new Set(deck.map(c => c.id)).size).toBe(312);
    const counts = new Map<string, number>();
    for (const c of deck) counts.set(`${c.rank}-${c.suit}`, (counts.get(`${c.rank}-${c.suit}`) ?? 0) + 1);
    expect(counts.size).toBe(52); expect([...counts.values()].every(n => n === 6)).toBe(true);
  });
  it('Fisher–Yates preserves every instance and validates injected random indices', () => {
    const shoe = createShoe(() => 0); expect(new Set(shoe.cards.map(c => c.id)).size).toBe(312);
    expect(shoe.cards[0]!.id).not.toBe(createDecks()[0]!.id);
    expect(() => createShoe(max => max)).toThrow(GameError);
  });
  it.each([
    [['A', 'A', '9'], 21, true, false], [['A', 'A', '9', 'K'], 21, false, false],
    [['A', '6'], 17, true, false], [['A', '6', 'K'], 17, false, false],
    [['K', 'Q', '2'], 22, false, true], [['A', 'A', 'A'], 13, true, false],
  ] as [Rank[], number, boolean, boolean][] )('scores %j', (ranks, total, soft, bust) => {
    expect(score(cards(...ranks))).toEqual({ total, soft, bust });
  });
  it('preserves the shoe across rounds without dealing the same card twice', () => {
    let state = fixture('10', '10', '8', '7', '9', '10', '8', '7');
    const seen = new Set<string>();
    for (let round = 0; round < 10; round++) {
      state = act(state, { type: 'Ready' });
      if (state.phase === 'INSURANCE') state = act(state, { type: 'InsuranceDecision', amount: 0 });
      while (state.phase === 'PLAYER_TURNS') state = act(state, { type: 'Stand' });
      for (const card of [...state.dealer, ...p(state).hands.flatMap(h => h.cards)]) { expect(seen.has(card.id)).toBe(false); seen.add(card.id); }
      const cursor = state.shoe.cursor;
      state = act(state, { type: 'NextRound' }); expect(state.shoe.cursor).toBe(cursor);
    }
    expect(state.shoe.number).toBe(1);
  });
  it.each([CUT_CARD, 312 - ROUND_RESERVE + 1])('shuffles before the next round at cursor %i', cursor => {
    const state = fixture('8', '9', '10', '7'); state.shoe.cursor = cursor;
    const next = act(state, { type: 'Ready' }); expect(next.shoe.number).toBe(2); expect(next.shuffled).toBe(true); expect(next.shoe.cursor).toBeLessThan(10);
  });
  it('does not reshuffle mid-hand even after crossing the reserve boundary', () => {
    const state = fixture('2', '6', '2', '10', '2', '2', '10', '5');
    state.shoe.cards = [...state.shoe.cards.slice(136), ...state.shoe.cards.slice(0, 136)]; state.shoe.cursor = 176;
    let next = act(state, { type: 'Ready' }); next = act(next, { type: 'Hit' });
    expect(next.shoe.number).toBe(1); expect(next.shoe.cursor).toBeGreaterThan(176);
  });
});

describe('settlement and dealer procedure', () => {
  it('derives the safety reserve from the lowest-valued physical cards across 17 hands', () => {
    const values = createDecks().map(c => c.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)).sort((a, b) => a - b);
    let sum = 0; let count = 0;
    for (const value of values) { if (sum + value > 17 * 21) break; sum += value; count++; }
    expect(count).toBe(119); expect(count + 17).toBe(ROUND_RESERVE);
  });
  it.each([
    [['A', '9', 'K', '7'], 'blackjack', 2030, 50],
    [['10', '10', '9', '7'], 'win', 2020, 40],
    [['10', '10', '8', '8'], 'push', 2000, 20],
    [['10', '10', '7', '9'], 'loss', 1980, 0],
  ] as [Rank[], string, number, number][] )('settles %j as %s', (ranks, outcome, balance, returned) => {
    let state = deal(...ranks); if (state.phase === 'PLAYER_TURNS') state = act(state, { type: 'Stand' });
    expect(state.phase).toBe('ROUND_COMPLETE'); expect(p(state).balance).toBe(balance);
    expect(p(state).hands[0]).toMatchObject({ outcome, returned });
  });
  it('stands on soft 17', () => {
    const state = act(deal('10', 'A', '8', '6'), { type: 'InsuranceDecision', amount: 0 });
    const done = act(state, { type: 'Stand' }); expect(done.dealer).toHaveLength(2); expect(p(done).hands[0]!.outcome).toBe('win');
  });
  it('draws through 16 then settles a dealer bust', () => {
    const done = act(deal('10', '10', '7', '6', 'K'), { type: 'Stand' });
    expect(done.dealer).toHaveLength(3); expect(p(done).balance).toBe(2020);
  });
  it('bust immediately closes the hand and skips unnecessary dealer draws', () => {
    const done = act(deal('10', '6', '8', '10', 'K'), { type: 'Hit' });
    expect(done.phase).toBe('ROUND_COMPLETE'); expect(done.dealer).toHaveLength(2); expect(p(done).hands[0]!.status).toBe('bust'); expect(p(done).balance).toBe(1980);
  });
  it('peeks at ten-value upcards before allowing any actions', () => {
    const done = deal('9', 'K', '9', 'A'); expect(done.phase).toBe('ROUND_COMPLETE'); expect(p(done).balance).toBe(1980);
  });
  it('offers insurance before an ace peek, pays once, and pushes simultaneous naturals', () => {
    const state = deal('A', 'A', 'K', 'Q'); expect(state.phase).toBe('INSURANCE'); expect(state.revealed).toBe(false);
    const input = command(state, { type: 'InsuranceDecision', amount: 10 });
    const done = transition(state, input, rng); expect(done.phase).toBe('ROUND_COMPLETE'); expect(p(done).balance).toBe(2020);
    expect(done.insurance[id]).toMatchObject({ wager: 10, returned: 30 }); expect(p(done).hands[0]!.outcome).toBe('push');
    expect(transition(done, input, rng)).toBe(done);
  });
  it('loses insurance when the dealer has no blackjack then continues the hand', () => {
    const state = act(deal('10', 'A', '9', '7'), { type: 'InsuranceDecision', amount: 10 });
    expect(state.phase).toBe('PLAYER_TURNS'); expect(p(state).balance).toBe(1970);
    const done = act(state, { type: 'Stand' }); expect(p(done).balance).toBe(2010);
  });
  it('caps insurance at half the original wager and available funds', () => {
    const state = deal('9', 'A', '7', 'K');
    expect(() => act(state, { type: 'InsuranceDecision', amount: 11 })).toThrow('Insurance may be');
    p(state).balance = 5; expect(() => act(state, { type: 'InsuranceDecision', amount: 10 })).toThrow('Insurance may be');
    expect(act(state, { type: 'InsuranceDecision', amount: 5 }).insurance[id]!.returned).toBe(15);
  });
});

describe('double and split', () => {
  it('debits an equal extra stake for double, draws exactly once, then stands', () => {
    const done = act(deal('5', '10', '6', '7', 'K'), { type: 'Double' });
    expect(p(done).hands[0]).toMatchObject({ wager: 40, status: 'stood', returned: 80 });
    expect(p(done).hands[0]!.cards).toHaveLength(3); expect(p(done).balance).toBe(2040);
  });
  it('disallows double after a hit and without enough funds', () => {
    const state = deal('2', '10', '3', '7', '2'); p(state).balance = 19;
    expect(legalActions(state, id)).not.toContain('Double'); expect(() => act(state, { type: 'Double' })).toThrow();
    p(state).balance = 100; const hit = act(state, { type: 'Hit' }); expect(legalActions(hit, id)).not.toContain('Double');
  });
  it('requires identical ranks rather than any two ten-value cards', () => {
    const state = deal('K', '10', 'Q', '7'); expect(legalActions(state, id)).not.toContain('Split');
  });
  it('splits in deterministic hand order and allows double after split', () => {
    let state = act(deal('8', '6', '8', '10', '3', '2', 'K', '5'), { type: 'Split' });
    expect(p(state).balance).toBe(1960); expect(p(state).hands.map(h => score(h.cards).total)).toEqual([11, 10]);
    const secondId = p(state).hands[1]!.id;
    state = act(state, { type: 'Double' }); expect(p(state).balance).toBe(1940); expect(project(state, id).activeHandId).toBe(secondId);
    state = act(state, { type: 'Stand' }); expect(state.phase).toBe('ROUND_COMPLETE'); expect(p(state).hands[0]!.outcome).toBe('push'); expect(p(state).balance).toBe(1980);
  });
  it('caps a player at four hands', () => {
    let state = deal('8', '10', '8', '7', '8', '8', '8', '8', '8', '8');
    for (let i = 0; i < 3; i++) state = act(state, { type: 'Split' });
    expect(p(state).hands).toHaveLength(4); expect(legalActions(state, id)).not.toContain('Split');
  });
  it('does not split without enough chips', () => {
    const state = deal('8', '10', '8', '7'); p(state).balance = 19; expect(legalActions(state, id)).not.toContain('Split');
  });
  it('split aces take exactly one card, stand, and pay ordinary 21', () => {
    const state = act(deal('A', '10', 'A', '7', 'K', '9'), { type: 'Split' });
    expect(state.phase).toBe('ROUND_COMPLETE'); expect(p(state).hands.map(h => h.cards.length)).toEqual([2, 2]);
    expect(p(state).hands[0]).toMatchObject({ naturalEligible: false, status: 'stood', outcome: 'win', returned: 40 }); expect(p(state).balance).toBe(2040);
  });
  it('never resplits aces even when the replacement card is another ace', () => {
    const state = act(deal('A', '10', 'A', '7', 'A', 'A'), { type: 'Split' });
    expect(state.phase).toBe('ROUND_COMPLETE'); expect(legalActions(state, id)).not.toContain('Split'); expect(p(state).hands).toHaveLength(2);
  });
  it('split ten-value hands reaching 21 are not natural blackjacks', () => {
    let state = act(deal('K', '10', 'K', '7', 'A', '9'), { type: 'Split' });
    state = act(state, { type: 'Stand' }); expect(p(state).hands[0]).toMatchObject({ outcome: 'win', returned: 40 });
  });
});

describe('transaction boundary, privacy, and recovery', () => {
  it('checks an accepted retry before a stale revision and never double-draws', () => {
    const start = deal('2', '10', '3', '7', '2'); const input = command(start, { type: 'Hit' });
    const next = transition(start, input, rng); expect(transition(next, input, rng)).toBe(next);
    expect(() => transition(next, { ...input, id: 'another' }, rng)).toThrow('table changed');
    expect(start.shoe.cursor).toBe(4); expect(next.shoe.cursor).toBe(5);
  });
  it('rejects wrong players and wrong hand IDs without mutation', () => {
    const state = deal('10', '10', '8', '7'); const before = JSON.stringify(state);
    expect(() => transition(state, command(state, { type: 'Hit' }, { playerId: 'unknown' }), rng)).toThrow('Unknown player');
    expect(() => transition(state, command(state, { type: 'Hit' }, { handId: 'old-hand' }), rng)).toThrow('no longer active'); expect(JSON.stringify(state)).toBe(before);
  });
  it('never deals without a wager and rejects malformed/out-of-phase commands', () => {
    const state = fixture(); p(state).bet = 0;
    expect(() => act(state, { type: 'Ready' })).toThrow(); expect(state.shoe.cursor).toBe(0);
    expect(() => act(state, { type: 'Hit' })).toThrow(); expect(commandSchema.safeParse({ ...command(state, { type: 'PlaceBet', amount: 20 }), protocol: 2 }).success).toBe(false);
  });
  it.each([0, 19, 21, 220, -20, 20.5])('rejects an invalid base wager %i', amount => {
    expect(() => act(fixture(), { type: 'PlaceBet', amount })).toThrow();
  });
  it('debits only on deal and refills only below the minimum, once per accepted command', () => {
    let state = act(fixture(), { type: 'PlaceBet', amount: 100 }); expect(p(state).balance).toBe(2000);
    expect(() => act(state, { type: 'Refill' })).toThrow(); p(state).balance = 19;
    const input = command(state, { type: 'Refill' }); state = transition(state, input, rng); expect(p(state).balance).toBe(2000);
    expect(transition(state, input, rng)).toBe(state); expect(() => act(state, { type: 'Refill' })).toThrow();
  });
  it('projects only a placeholder for the hole card and never includes the private shoe', () => {
    const state = deal('10', '9', '8', '7'); const snapshot = project(state, id);
    expect(snapshot.dealer[1]).toEqual({ hidden: true }); expect(snapshot.dealerTotal).toBeNull();
    const json = JSON.stringify(snapshot); expect(json).not.toContain(state.dealer[1]!.id); expect(json).not.toContain('acceptedCommands'); expect(json).not.toContain('cursor'); expect(json).not.toContain(state.shoe.cards[4]!.id);
    expect(() => project(state, 'unknown')).toThrow();
  });
  it('serializes and restores an active hand without changing the shoe or payout', () => {
    const state = deal('10', '10', '8', '7'); const restored = JSON.parse(JSON.stringify(state)) as RoomState;
    expect(act(restored, { type: 'Stand' })).toEqual(act(state, { type: 'Stand' }));
  });
  it('bounds accepted-command history', () => {
    let state = fixture(); for (let n = 0; n < 140; n++) state = act(state, { type: 'PlaceBet', amount: 20 });
    expect(state.acceptedCommands).toHaveLength(128);
  });
  it('processes occupied seats in order, skips empty seats, and enforces the active player', () => {
    const state = fixture('10', '9', '10', '8', '8', '7');
    state.players.push({ ...createRoom('Alex', rng).players[0]!, id: 'second-player', seat: 3 });
    let next = act(state, { type: 'Ready' });
    expect(next.players.map(player => player.hands[0]!.cards.map(c => c.rank))).toEqual([['10', '8'], ['9', '8']]);
    expect(() => transition(next, command(next, { type: 'Stand' }, { playerId: 'second-player' }), rng)).toThrow();
    next = act(next, { type: 'Stand' }); expect(project(next, 'second-player').activePlayerId).toBe('second-player');
    next = transition(next, command(next, { type: 'Stand' }, { playerId: 'second-player', handId: project(next, 'second-player').activeHandId! }), rng);
    expect(next.phase).toBe('ROUND_COMPLETE'); expect(next.players.map(player => player.balance)).toEqual([2020, 2000]);
  });
});

describe('20-second hand decisions', () => {
  it('starts a deadline only when a player needs to act', () => {
    expect(fixture().decisionDeadline).toBeNull();
    expect(deal('2', '10', '3', '7').decisionDeadline).toBe(123 + HAND_DURATION_MS);
    const insured = deal('9', 'A', '7', '9'); expect(insured.decisionDeadline).toBeNull();
    expect(act(insured, { type: 'InsuranceDecision', amount: 0 }).decisionDeadline).toBe(123 + HAND_DURATION_MS);
    expect(deal('A', '10', 'K', '7').decisionDeadline).toBeNull();
  });
  it('resets the countdown to 20 seconds on every accepted Hit', () => {
    let state = deal('2', '10', '3', '7', '2', '2');
    state = transition(state, command(state, { type: 'Hit' }), rng, 15_000);
    expect(state.decisionDeadline).toBe(35_000);
    state = transition(state, command(state, { type: 'Hit' }), rng, 34_999);
    expect(state.decisionDeadline).toBe(54_999); expect(p(state).hands[0]!.cards).toHaveLength(4);
  });
  it('a retried Hit cannot reset time or draw again', () => {
    const state = deal('2', '10', '3', '7', '2'); const input = command(state, { type: 'Hit' });
    const next = transition(state, input, rng, 1000);
    expect(transition(next, input, rng, 9000)).toBe(next); expect(next.decisionDeadline).toBe(21_000);
  });
  it('rejects a Hit at or after expiry without mutating the input', () => {
    const state = deal('2', '10', '3', '7', '2'); const before = JSON.stringify(state);
    expect(() => transition(state, command(state, { type: 'Hit' }), rng, state.decisionDeadline!)).toThrow('Time is up');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('stands on expiry, settles once, and ignores early/repeated callbacks', () => {
    const state = deal('10', '10', '8', '7');
    expect(expireDecision(state, state.decisionDeadline! - 1)).toBe(state);
    const done = expireDecision(state, state.decisionDeadline!);
    expect(p(done).hands[0]).toMatchObject({ status: 'stood', timedOut: true, outcome: 'win' });
    expect(p(done).balance).toBe(2020); expect(done.decisionDeadline).toBeNull();
    expect(expireDecision(done, 99_000)).toBe(done); expect(state.phase).toBe('PLAYER_TURNS');
  });
  it('gives the next split hand a fresh 20 seconds after a delayed timeout', () => {
    const state = act(deal('8', '10', '8', '7', '3', '2'), { type: 'Split' });
    const next = expireDecision(state, 100_000);
    expect(p(next).hands[0]!.timedOut).toBe(true); expect(p(next).hands[1]!.status).toBe('playing');
    expect(project(next, id).activeHandId).toBe(p(next).hands[1]!.id); expect(next.decisionDeadline).toBe(120_000);
    expect(expireDecision(next, 100_000)).toBe(next);
  });
  it('a completed hand clears its timer, while standing a split hand starts the next timer', () => {
    const state = act(deal('8', '10', '8', '7', '3', '2'), { type: 'Split' });
    const next = transition(state, command(state, { type: 'Stand' }), rng, 4000);
    expect(next.decisionDeadline).toBe(24_000);
    const done = transition(next, command(next, { type: 'Double' }), rng, 5000);
    expect(done.decisionDeadline).toBeNull();
  });
  it('retains a persisted deadline after restoring state', () => {
    const state = deal('10', '10', '8', '7'); const restored = JSON.parse(JSON.stringify(state)) as RoomState;
    expect(expireDecision(restored, 30_000)).toEqual(expireDecision(state, 30_000));
  });
});
