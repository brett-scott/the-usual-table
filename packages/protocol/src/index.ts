import { z } from 'zod';
import { gameIdSchema, lobbyVisibilitySchema, type GameId, type LobbyVisibility } from './games';
export * from './games';
export * from './wallet';
export * from './auth';

export const PROTOCOL_VERSION = 1;
export const RESULTS_DURATION_MS = 10_000;
export const DEALER_REVEAL_STEP_MS = 500;
export const CARD_DEAL_MS = 280;
export const CARD_FLIP_MS = 320;
export const INITIAL_CARD_STEP_MS = 360;
export const CHAT_MAX_LENGTH = 300;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_CAPABILITY = 'casual-chat-v1';
export const chatTextSchema = z.string().trim().min(1, 'Write a message first.').max(CHAT_MAX_LENGTH, `Use at most ${CHAT_MAX_LENGTH} characters.`);
export const chatCommandSchema = z.object({ type: z.literal('chat'), protocol: z.literal(1), id: z.string().uuid(), text: chatTextSchema }).strict();
export const chatMessageSchema = z.object({ id: z.string().uuid(), playerId: z.string().min(1).max(100), name: z.string().min(1).max(24), seat: z.number().int().min(0).max(3), text: chatTextSchema, sentAt: z.number().int().nonnegative().safe() });
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export interface ChatFeed { messages: ChatMessage[]; available: boolean; unread: number; problem?: string; liveMessages?: { message: ChatMessage; receivedAt: number }[] }
/** Display text only: duplicates are allowed. Account/player IDs determine ownership. */
export const displayNameSchema = z.string().trim().min(1, 'Enter your name.').max(24, 'Use at most 24 characters.');
export const PLAYER_ICONS = [
  { emoji: '😎', label: 'Sunglasses' }, { emoji: '🦊', label: 'Fox' },
  { emoji: '🐱', label: 'Cat' }, { emoji: '🐶', label: 'Dog' },
  { emoji: '🐼', label: 'Panda' }, { emoji: '🐸', label: 'Frog' },
  { emoji: '🦁', label: 'Lion' }, { emoji: '🦉', label: 'Owl' },
  { emoji: '🦄', label: 'Unicorn' }, { emoji: '🐙', label: 'Octopus' },
  { emoji: '🤖', label: 'Robot' }, { emoji: '👽', label: 'Alien' },
  { emoji: '🎩', label: 'Top hat' }, { emoji: '🍀', label: 'Clover' },
  { emoji: '🔥', label: 'Fire' }, { emoji: '⭐', label: 'Star' },
] as const;
export const playerIconSchema = z.enum(PLAYER_ICONS.map(icon => icon.emoji), { error: 'Choose an available player icon.' });
export type PlayerIcon = z.infer<typeof playerIconSchema>;
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
export interface PublicPlayer { id: string; name: string; icon?: PlayerIcon; seat: number; balance: number; bet: number; hands: PublicHand[]; connected?: boolean; ready?: boolean; sittingOut?: boolean; reservationDeadline?: number | null; leavingAfterRound?: boolean; roundResult?: { net: number; outcome: 'won' | 'lost' | 'even' | 'out' } }
export interface RoomInfo { inviteId: string; managerPlayerId: string; bettingOpen: boolean; bettingDeadline: number | null; insuranceDeadline: number | null; claimVersion?: number; gameId?: GameId; visibility?: LobbyVisibility }
/** All monetary fields use integer half-chip units: 20 = 10 displayed chips. */
export interface Snapshot {
  protocol: 1; revision: number; roundId: number; phase: Phase;
  you: string; room?: RoomInfo;
  wallet?: { status: 'funding' | 'active' | 'returning' | 'closed' | 'cancelled' | 'rejected'; stackUnits: number; error: string | null };
  players: PublicPlayer[]; dealer: VisibleCard[]; dealerTotal: number | null;
  activePlayerId: string | null; activeHandId: string | null; legalActions: ActionType[];
  decisionDeadline: number | null;
  roundDeadline?: number | null;
  insurance: { wager: number; returned: number } | null;
  shoe: { decks: 6; remaining: number; shuffled: boolean; shuffleNext: boolean };
}
/** Fixed presentation allowance before the shared ten-second results window. */
export function resultsRevealDelay(previous: Snapshot, next: Snapshot) {
  if (!previous.dealer.length) {
    const participants = next.players.filter(p => p.hands.length).length;
    return (2 * (participants + 1) - 1) * INITIAL_CARD_STEP_MS + CARD_DEAL_MS + CARD_FLIP_MS;
  }
  const known = new Set(previous.players.flatMap(p => p.hands.flatMap(h => h.cards.map(card => card.id))));
  const newPlayerCards = next.players.flatMap(p => p.hands.flatMap(h => h.cards)).filter(card => !known.has(card.id)).length;
  const hole = previous.dealer.some(card => 'hidden' in card) ? CARD_FLIP_MS : 0;
  return newPlayerCards * INITIAL_CARD_STEP_MS + hole + Math.max(0, next.dealer.length - previous.dealer.length) * (DEALER_REVEAL_STEP_MS + CARD_DEAL_MS + CARD_FLIP_MS);
}
/** Both practice and online adapters deliver public snapshots, never private engine state. */
export interface GameClient {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  send(action: Action): Promise<void>;
  getConnection(): ConnectionInfo;
  reconnect?(): void;
  getChat?(): ChatFeed;
  markChatRead?(): void;
  sendChat?(text: string): Promise<void>;
  dispose(): void;
}
export interface ConnectionInfo { status: 'connected' | 'connecting' | 'reconnecting' | 'offline' | 'replaced' | 'expired' | 'invalid' | 'incompatible'; message: string; clockOffsetMs?: number }
export interface GuestSession { inviteId: string; playerId: string; credential: string; funding?: 'account' }
export interface SessionResponse { session: GuestSession; snapshot: Snapshot }
export type ServerEvent =
  | { type: 'chat'; messages: ChatMessage[] }
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
  wallet: z.object({ status: z.enum(['funding', 'active', 'returning', 'closed', 'cancelled', 'rejected']), stackUnits: z.number().int().nonnegative().safe(), error: z.string().nullable() }).optional(),
  protocol: z.literal(1), revision: amount, roundId: amount, phase: z.enum(['BETTING', 'INSURANCE', 'PLAYER_TURNS', 'ROUND_COMPLETE']), you: z.string(),
  room: z.object({ inviteId: z.string(), managerPlayerId: z.string(), bettingOpen: z.boolean(), bettingDeadline: z.number().nullable(), insuranceDeadline: z.number().nullable(), claimVersion: amount.optional(), gameId: gameIdSchema.optional(), visibility: lobbyVisibilitySchema.optional() }).optional(),
  players: z.array(z.object({ id: z.string(), name: z.string(), icon: playerIconSchema.optional(), seat: z.number().int(), balance: amount, bet: amount, hands: z.array(handSchema), connected: z.boolean().optional(), ready: z.boolean().optional(), sittingOut: z.boolean().optional(), reservationDeadline: z.number().nullable().optional(), leavingAfterRound: z.boolean().optional(), roundResult: z.object({ net: z.number().int(), outcome: z.enum(['won', 'lost', 'even', 'out']) }).optional() })).max(4),
  dealer: z.array(z.union([cardSchema, z.object({ hidden: z.literal(true) })])), dealerTotal: z.number().nullable(),
  activePlayerId: z.string().nullable(), activeHandId: z.string().nullable(), decisionDeadline: z.number().nullable(), legalActions: z.array(z.enum(['PlaceBet', 'Ready', 'Hit', 'Stand', 'Double', 'Split', 'InsuranceDecision', 'NextRound', 'Refill', 'StartBetting', 'SitOut', 'Leave'])),
  roundDeadline: z.number().nullable().optional(),
  insurance: z.object({ wager: amount, returned: amount }).nullable(),
  shoe: z.object({ decks: z.literal(6), remaining: amount, shuffled: z.boolean(), shuffleNext: z.boolean() }),
});
export const sessionResponseSchema = z.object({ session: z.object({ inviteId: z.string().regex(/^[a-f0-9]{32}$/), playerId: z.string(), credential: z.string().regex(/^[a-f0-9]{64}$/), funding: z.literal('account').optional() }), snapshot: snapshotSchema });
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), messages: z.array(chatMessageSchema).max(CHAT_HISTORY_LIMIT) }),
  z.object({ type: z.literal('snapshot'), snapshot: snapshotSchema, serverTime: z.number().finite() }),
  z.object({ type: z.literal('connected'), controllerId: z.string().uuid(), serverTime: z.number().finite() }),
  z.object({ type: z.literal('pong'), serverTime: z.number().finite() }),
  z.object({ type: z.literal('ack'), commandId: z.string().min(1).max(100), revision: amount }),
  z.object({ type: z.literal('error'), commandId: z.string().max(100).optional(), code: z.string().max(100), message: z.string().max(2000), snapshot: snapshotSchema.optional() }),
  z.object({ type: z.literal('replaced'), message: z.string().max(2000) }),
]);
