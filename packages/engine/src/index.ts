import { commandSchema, displayNameSchema, type ActionType, type Card, type Command, type Outcome, type Phase, type Rank, type Snapshot, type Suit } from '@casual/protocol';

export type { Card, Rank, Suit } from '@casual/protocol';
export const RULES = { decks: 6, startingBalance: 2000, minBet: 20, maxBet: 200, betStep: 20, maxHands: 4 } as const;
export const CUT_CARD = 234;
export const HAND_DURATION_MS = 20_000;
/** 17 hands: at most 119 preterminal cards + one terminal card each. See docs/RULES.md. */
export const ROUND_RESERVE = 136;
export type RandomIndex = (exclusiveMax: number) => number;
export interface Shoe { cards: Card[]; cursor: number; number: number }
export interface Hand {
  id: string; cards: Card[]; wager: number; naturalEligible: boolean; splitAces: boolean;
  status: 'playing' | 'stood' | 'bust'; timedOut?: boolean; outcome?: Outcome; returned?: number;
}
export interface Player { id: string; name: string; seat: number; balance: number; bet: number; hands: Hand[] }
export interface RoomState {
  schema: 1; revision: number; roundId: number; phase: Phase; players: Player[];
  dealer: Card[]; revealed: boolean; activePlayer: number; activeHand: number;
  decisionDeadline: number | null;
  insurance: Record<string, { wager: number; decided: boolean; returned: number }>;
  shoe: Shoe; shuffled: boolean; settledRound: number; updatedAt: number;
  acceptedCommands: { id: string; playerId: string }[];
}
export class GameError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'GameError'; }
}
function requireRule(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GameError(code, message);
}
export function createDecks(): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return Array.from({ length: 6 }, (_, deck) => suits.flatMap(suit => ranks.map(rank => ({ id: `${deck}-${suit}-${rank}`, suit, rank })))).flat();
}
/** Caller supplies unbiased random integers. No clock or global RNG in the engine. */
export function createShoe(random: RandomIndex, number = 1): Shoe {
  const cards = createDecks();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = random(i + 1);
    requireRule(Number.isInteger(j) && j >= 0 && j <= i, 'INVALID_RANDOM', 'Invalid random source.');
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return { cards, cursor: 0, number };
}
export function score(cards: readonly Card[]) {
  let total = 0; let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') { aces++; total += 11; }
    else total += ['10', 'J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}
export function isNatural(hand: Hand) { return hand.naturalEligible && hand.cards.length === 2 && score(hand.cards).total === 21; }
function draw(state: RoomState) {
  const card = state.shoe.cards[state.shoe.cursor];
  requireRule(card, 'SHOE_EXHAUSTED', 'Shoe reserve exhausted.');
  state.shoe.cursor++;
  return card;
}
export function createRoom(name: string, random: RandomIndex, now = 0): RoomState {
  return {
    schema: 1, revision: 0, roundId: 0, phase: 'BETTING',
    players: [{ id: 'practice-player', name: displayNameSchema.parse(name), seat: 0, balance: 2000, bet: 20, hands: [] }],
    dealer: [], revealed: false, activePlayer: 0, activeHand: 0, decisionDeadline: null, insurance: {},
    shoe: createShoe(random), shuffled: true, settledRound: -1, updatedAt: now, acceptedCommands: [],
  };
}
function current(state: RoomState) { return state.players[state.activePlayer]?.hands[state.activeHand]; }
function updateDeadline(previous: RoomState, state: RoomState, now: number) {
  if (state.phase !== 'PLAYER_TURNS') state.decisionDeadline = null;
  else if (previous.phase !== 'PLAYER_TURNS' || current(previous)?.id !== current(state)?.id) state.decisionDeadline = now + HAND_DURATION_MS;
}
/** The future server can invoke this from a persisted alarm; callbacks may safely repeat. */
export function expireDecision(previous: RoomState, now: number): RoomState {
  if (previous.phase !== 'PLAYER_TURNS' || previous.decisionDeadline === null || now < previous.decisionDeadline) return previous;
  const state = structuredClone(previous);
  const hand = current(state)!;
  hand.status = 'stood'; hand.timedOut = true;
  advance(state);
  updateDeadline(previous, state, now);
  state.revision++; state.updatedAt = now;
  return state;
}
export function legalActions(state: RoomState, playerId: string): ActionType[] {
  const p = state.players.find(p => p.id === playerId);
  if (!p) return [];
  if (state.phase === 'BETTING') return ['PlaceBet', ...(p.balance >= p.bet && p.bet >= 20 ? ['Ready' as const] : []), ...(p.balance < 20 ? ['Refill' as const] : [])];
  if (state.phase === 'ROUND_COMPLETE') return ['NextRound', ...(p.balance < 20 ? ['Refill' as const] : [])];
  if (state.phase === 'INSURANCE') return state.insurance[p.id] && !state.insurance[p.id]!.decided ? ['InsuranceDecision'] : [];
  const hand = current(state);
  if (state.players[state.activePlayer]?.id !== p.id || !hand || hand.status !== 'playing') return [];
  const actions: ActionType[] = ['Hit', 'Stand'];
  if (hand.cards.length === 2 && p.balance >= hand.wager) {
    actions.push('Double');
    if (p.hands.length < 4 && !hand.splitAces && hand.cards[0]!.rank === hand.cards[1]!.rank) actions.push('Split');
  }
  return actions;
}
function settle(state: RoomState) {
  if (state.settledRound === state.roundId) return;
  state.revealed = true;
  const dealer = score(state.dealer); const dealerNatural = state.dealer.length === 2 && dealer.total === 21;
  for (const p of state.players) for (const h of p.hands) {
    const total = score(h.cards).total;
    let outcome: Outcome;
    if (total > 21) outcome = 'loss';
    else if (dealerNatural) outcome = isNatural(h) ? 'push' : 'loss';
    else if (isNatural(h)) outcome = 'blackjack';
    else if (dealer.bust || total > dealer.total) outcome = 'win';
    else outcome = total === dealer.total ? 'push' : 'loss';
    h.outcome = outcome;
    h.returned = outcome === 'blackjack' ? h.wager * 5 / 2 : outcome === 'win' ? h.wager * 2 : outcome === 'push' ? h.wager : 0;
    requireRule(Number.isInteger(h.returned), 'INVALID_ACCOUNTING', 'Payout must use integer half-chip units.');
    p.balance += h.returned;
  }
  state.settledRound = state.roundId; state.phase = 'ROUND_COMPLETE';
}
function dealerTurn(state: RoomState) {
  state.revealed = true;
  const needsDealer = state.players.some(p => p.hands.some(h => !isNatural(h) && !score(h.cards).bust));
  if (needsDealer) while (score(state.dealer).total < 17) state.dealer.push(draw(state));
  settle(state);
}
function advance(state: RoomState) {
  for (let pi = 0; pi < state.players.length; pi++) {
    const p = state.players[pi]!;
    const hi = p.hands.findIndex(h => h.status === 'playing');
    if (hi >= 0) { state.activePlayer = pi; state.activeHand = hi; state.phase = 'PLAYER_TURNS'; return; }
  }
  dealerTurn(state);
}
function finishPeek(state: RoomState) {
  const blackjack = score(state.dealer).total === 21;
  for (const p of state.players) {
    const insurance = state.insurance[p.id];
    if (insurance) { insurance.returned = blackjack ? insurance.wager * 3 : 0; p.balance += insurance.returned; }
  }
  if (blackjack) settle(state); else advance(state);
}
function deal(state: RoomState, random: RandomIndex) {
  requireRule(state.players.some(p => p.bet > 0 && p.balance >= p.bet), 'NO_WAGERS', 'Place a valid wager before dealing.');
  const needsShuffle = state.shoe.cursor >= CUT_CARD || state.shoe.cards.length - state.shoe.cursor < ROUND_RESERVE;
  state.shuffled = needsShuffle || state.shoe.cursor === 0;
  if (needsShuffle) state.shoe = createShoe(random, state.shoe.number + 1);
  state.roundId++; state.dealer = []; state.revealed = false; state.insurance = {};
  for (const p of state.players) {
    p.hands = [];
    if (p.bet > 0 && p.balance >= p.bet) {
      p.balance -= p.bet;
      p.hands = [{ id: `${state.roundId}:${p.id}:0`, cards: [], wager: p.bet, status: 'playing', naturalEligible: true, splitAces: false }];
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const p of state.players) if (p.hands[0]) p.hands[0].cards.push(draw(state));
    state.dealer.push(draw(state));
  }
  for (const p of state.players) if (p.hands[0] && isNatural(p.hands[0])) p.hands[0].status = 'stood';
  if (state.dealer[0]!.rank === 'A') {
    state.phase = 'INSURANCE';
    for (const p of state.players) if (p.hands.length) state.insurance[p.id] = { wager: 0, decided: false, returned: 0 };
  } else finishPeek(state);
}
/** Pure, transactional transition. Rejections leave input untouched; retries never debit/draw twice. */
export function transition(previous: RoomState, input: Command, random: RandomIndex, now = 0): RoomState {
  const parsed = commandSchema.safeParse(input);
  requireRule(parsed.success, 'INVALID_COMMAND', 'Invalid command.');
  const command = parsed.data;
  const pIndex = previous.players.findIndex(p => p.id === command.playerId);
  requireRule(pIndex >= 0, 'SESSION_INVALID', 'Unknown player.');
  if (previous.acceptedCommands.some(c => c.id === command.id && c.playerId === command.playerId)) return previous;
  requireRule(previous.decisionDeadline === null || now < previous.decisionDeadline, 'TURN_EXPIRED', 'Time is up. This hand stands automatically.');
  requireRule(command.revision === previous.revision && command.roundId === previous.roundId, 'STALE_STATE', 'The table changed. Try again.');
  requireRule(legalActions(previous, command.playerId).includes(command.action.type), 'INVALID_ACTION', 'This action is not available now.');
  const state = structuredClone(previous); const p = state.players[pIndex]!; const action = command.action;
  if (['Hit', 'Stand', 'Double', 'Split'].includes(action.type)) requireRule(command.handId === current(state)?.id, 'STALE_HAND', 'That hand is no longer active.');
  switch (action.type) {
    case 'PlaceBet':
      requireRule(action.amount >= 20 && action.amount <= 200 && action.amount % 20 === 0, 'INVALID_BET', 'Bet 10–100 chips in steps of 10.');
      requireRule(action.amount <= p.balance, 'INSUFFICIENT_FUNDS', 'Your balance is too low for that bet.');
      p.bet = action.amount; break;
    case 'Ready': deal(state, random); break;
    case 'InsuranceDecision': {
      const insurance = state.insurance[p.id]!;
      requireRule(action.amount <= p.bet / 2 && action.amount <= p.balance, 'INVALID_INSURANCE', 'Insurance may be up to half your original bet and available balance.');
      insurance.wager = action.amount; insurance.decided = true; p.balance -= action.amount;
      if (Object.values(state.insurance).every(i => i.decided)) finishPeek(state);
      break;
    }
    case 'Hit': {
      const h = current(state)!; h.cards.push(draw(state)); const total = score(h.cards).total;
      if (total >= 21) { h.status = total > 21 ? 'bust' : 'stood'; advance(state); }
      break;
    }
    case 'Stand': current(state)!.status = 'stood'; advance(state); break;
    case 'Double': {
      const h = current(state)!; p.balance -= h.wager; h.wager *= 2; h.cards.push(draw(state));
      h.status = score(h.cards).bust ? 'bust' : 'stood'; advance(state); break;
    }
    case 'Split': {
      const h = current(state)!; p.balance -= h.wager;
      const second = h.cards.pop()!; const aces = second.rank === 'A';
      h.naturalEligible = false; h.splitAces = aces; h.cards.push(draw(state));
      const other: Hand = { id: `${state.roundId}:${p.id}:${p.hands.length}`, cards: [second, draw(state)], wager: h.wager, naturalEligible: false, splitAces: aces, status: 'playing' };
      if (aces || score(h.cards).total === 21) h.status = 'stood';
      if (aces || score(other.cards).total === 21) other.status = 'stood';
      p.hands.splice(state.activeHand + 1, 0, other); advance(state); break;
    }
    case 'NextRound':
      state.phase = 'BETTING'; state.dealer = []; state.revealed = false; state.insurance = {};
      for (const player of state.players) { player.hands = []; player.bet = Math.min(player.bet, Math.floor(player.balance / 20) * 20); }
      break;
    case 'Refill': p.balance = 2000; p.bet = 20; break;
  }
  updateDeadline(previous, state, now);
  if (action.type === 'Hit' && state.phase === 'PLAYER_TURNS') state.decisionDeadline = now + HAND_DURATION_MS;
  state.revision++; state.updatedAt = now;
  state.acceptedCommands.push({ id: command.id, playerId: command.playerId });
  state.acceptedCommands = state.acceptedCommands.slice(-128);
  return state;
}
/** Explicit allowlist projection. A hidden card's rank/id never reaches the client. */
export function project(state: RoomState, playerId: string): Snapshot {
  requireRule(state.players.some(p => p.id === playerId), 'SESSION_INVALID', 'Unknown player.');
  return {
    protocol: 1, revision: state.revision, roundId: state.roundId, phase: state.phase, you: playerId,
    players: state.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, balance: p.balance, bet: p.bet,
      hands: p.hands.map(h => ({ id: h.id, cards: h.cards.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })), total: score(h.cards).total, soft: score(h.cards).soft, wager: h.wager, status: h.status, timedOut: h.timedOut, outcome: h.outcome, returned: h.returned })) })),
    dealer: state.dealer.map((c, i) => i === 1 && !state.revealed ? { hidden: true as const } : { id: c.id, rank: c.rank, suit: c.suit }),
    dealerTotal: state.revealed ? score(state.dealer).total : null,
    activePlayerId: state.phase === 'PLAYER_TURNS' ? state.players[state.activePlayer]!.id : null,
    activeHandId: state.phase === 'PLAYER_TURNS' ? current(state)!.id : null,
    decisionDeadline: state.decisionDeadline,
    legalActions: legalActions(state, playerId),
    insurance: state.insurance[playerId] ? { wager: state.insurance[playerId]!.wager, returned: state.insurance[playerId]!.returned } : null,
    shoe: { decks: 6, remaining: 312 - state.shoe.cursor, shuffled: state.shuffled, shuffleNext: state.shoe.cursor >= CUT_CARD || 312 - state.shoe.cursor < ROUND_RESERVE },
  };
}
