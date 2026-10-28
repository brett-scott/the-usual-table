import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const displayNameSchema = z.string().trim().min(1, 'Enter your name.').max(24, 'Use at most 24 characters.');
const amount = z.number().int().nonnegative();
const actions = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PlaceBet'), amount }),
  z.object({ type: z.literal('Ready') }),
  z.object({ type: z.literal('Hit') }),
  z.object({ type: z.literal('Stand') }),
  z.object({ type: z.literal('Double') }),
  z.object({ type: z.literal('Split') }),
  z.object({ type: z.literal('InsuranceDecision'), amount }),
  z.object({ type: z.literal('NextRound') }),
  z.object({ type: z.literal('Refill') }),
  z.object({ type: z.literal('StartBetting') }),
  z.object({ type: z.literal('SitOut') }),
  z.object({ type: z.literal('Leave') }),
]);
export const commandSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION), id: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(), playerId: z.string().min(1).max(100),
  roundId: z.number().int().nonnegative(), handId: z.string().max(100).optional(), action: actions,
});
export type Action = z.infer<typeof actions>;
export type Command = z.infer<typeof commandSchema>;
export type ActionType = Action['type'];
export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export interface Card { id: string; rank: Rank; suit: Suit }
export type VisibleCard = Card | { hidden: true };
export type Phase = 'BETTING' | 'INSURANCE' | 'PLAYER_TURNS' | 'ROUND_COMPLETE';
export type Outcome = 'blackjack' | 'win' | 'push' | 'loss';
export interface PublicHand {
  id: string; cards: Card[]; total: number; soft: boolean; wager: number;
  status: 'playing' | 'stood' | 'bust'; timedOut?: boolean; outcome?: Outcome; returned?: number;
}
export interface PublicPlayer { id: string; name: string; seat: number; balance: number; bet: number; hands: PublicHand[]; connected?: boolean; ready?: boolean; sittingOut?: boolean; reservationDeadline?: number | null; leavingAfterRound?: boolean }
export interface RoomInfo { inviteId: string; managerPlayerId: string; bettingOpen: boolean; bettingDeadline: number | null; insuranceDeadline: number | null; claimVersion?: number }
/** All monetary fields use integer half-chip units: 20 = 10 displayed chips. */
export interface Snapshot {
  protocol: 1; revision: number; roundId: number; phase: Phase;
  you: string; room?: RoomInfo;
  players: PublicPlayer[]; dealer: VisibleCard[]; dealerTotal: number | null;
  activePlayerId: string | null; activeHandId: string | null; legalActions: ActionType[];
  decisionDeadline: number | null;
  insurance: { wager: number; returned: number } | null;
  shoe: { decks: 6; remaining: number; shuffled: boolean; shuffleNext: boolean };
}
/** Both practice and online adapters deliver public snapshots, never private engine state. */
export interface GameClient {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  send(action: Action): Promise<void>;
  getConnection(): ConnectionInfo;
  reconnect?(): void;
  dispose(): void;
}
export interface ConnectionInfo { status: 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'replaced' | 'expired' | 'invalid' | 'incompatible'; message: string; clockOffsetMs?: number }
export interface GuestSession { inviteId: string; playerId: string; credential: string }
export interface SessionResponse { session: GuestSession; snapshot: Snapshot }
export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot; serverTime: number }
  | { type: 'ack'; commandId: string; revision: number }
  | { type: 'error'; commandId?: string; code: string; message: string; snapshot?: Snapshot }
  | { type: 'replaced'; message: string }
  | ConnectionEvent;
// A controller ID proves continuation of this tab's connection, not guest identity.
export type ConnectionEvent = { type: 'connected'; controllerId: string; serverTime: number } | { type: 'pong'; serverTime: number };

const cardSchema = z.object({ id: z.string(), rank: z.enum(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']), suit: z.enum(['spades', 'hearts', 'diamonds', 'clubs']) });
const handSchema = z.object({ id: z.string(), cards: z.array(cardSchema), total: z.number(), soft: z.boolean(), wager: amount, status: z.enum(['playing', 'stood', 'bust']), timedOut: z.boolean().optional(), outcome: z.enum(['blackjack', 'win', 'push', 'loss']).optional(), returned: amount.optional() });
export const snapshotSchema = z.object({
  protocol: z.literal(1), revision: amount, roundId: amount, phase: z.enum(['BETTING', 'INSURANCE', 'PLAYER_TURNS', 'ROUND_COMPLETE']), you: z.string(),
  room: z.object({ inviteId: z.string(), managerPlayerId: z.string(), bettingOpen: z.boolean(), bettingDeadline: z.number().nullable(), insuranceDeadline: z.number().nullable(), claimVersion: amount.optional() }).optional(),
  players: z.array(z.object({ id: z.string(), name: z.string(), seat: z.number().int(), balance: amount, bet: amount, hands: z.array(handSchema), connected: z.boolean().optional(), ready: z.boolean().optional(), sittingOut: z.boolean().optional(), reservationDeadline: z.number().nullable().optional(), leavingAfterRound: z.boolean().optional() })).max(4),
  dealer: z.array(z.union([cardSchema, z.object({ hidden: z.literal(true) })])), dealerTotal: z.number().nullable(),
  activePlayerId: z.string().nullable(), activeHandId: z.string().nullable(), decisionDeadline: z.number().nullable(), legalActions: z.array(z.enum(['PlaceBet', 'Ready', 'Hit', 'Stand', 'Double', 'Split', 'InsuranceDecision', 'NextRound', 'Refill', 'StartBetting', 'SitOut', 'Leave'])),
  insurance: z.object({ wager: amount, returned: amount }).nullable(),
  shoe: z.object({ decks: z.literal(6), remaining: amount, shuffled: z.boolean(), shuffleNext: z.boolean() }),
});
export const sessionResponseSchema = z.object({ session: z.object({ inviteId: z.string().regex(/^[a-f0-9]{32}$/), playerId: z.string(), credential: z.string().regex(/^[a-f0-9]{64}$/) }), snapshot: snapshotSchema });
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: snapshotSchema, serverTime: z.number().finite() }),
  z.object({ type: z.literal('connected'), controllerId: z.string().uuid(), serverTime: z.number().finite() }),
  z.object({ type: z.literal('pong'), serverTime: z.number().finite() }),
  z.object({ type: z.literal('ack'), commandId: z.string().min(1).max(100), revision: amount }),
  z.object({ type: z.literal('error'), commandId: z.string().max(100).optional(), code: z.string().max(100), message: z.string().max(2000), snapshot: snapshotSchema.optional() }),
  z.object({ type: z.literal('replaced'), message: z.string().max(2000) }),
]);
