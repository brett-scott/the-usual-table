import { z } from 'zod';
import { createDecks, GameError } from '@casual/engine';
import { newMember, PRESENCE_MS, type OnlineRoom } from './roomState';

const integer = z.number().int().nonnegative().safe();
const time = integer.nullable();
const id = z.string().min(1).max(100);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const card = z.object({ id, rank: z.enum(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']), suit: z.enum(['spades', 'hearts', 'diamonds', 'clubs']) });
const hand = z.object({ id, cards: z.array(card).max(22), wager: integer, naturalEligible: z.boolean(), splitAces: z.boolean(), status: z.enum(['playing', 'stood', 'bust']), timedOut: z.boolean().optional(), outcome: z.enum(['blackjack', 'win', 'push', 'loss']).optional(), returned: integer.optional() });
const engine = z.object({
  schema: z.literal(1), revision: integer, roundId: integer, phase: z.enum(['BETTING', 'INSURANCE', 'PLAYER_TURNS', 'ROUND_COMPLETE']),
  players: z.array(z.object({ id, name: z.string().min(1).max(24), seat: integer.max(3), balance: integer, bet: integer.max(200), hands: z.array(hand).max(4) })).max(4),
  dealer: z.array(card).max(22), revealed: z.boolean(), activePlayer: integer.max(3), activeHand: integer.max(3), decisionDeadline: time,
  insurance: z.record(id, z.object({ wager: integer, decided: z.boolean(), returned: integer })),
  shoe: z.object({ cards: z.array(card).length(312), cursor: integer.max(312), number: integer.min(1) }),
  shuffled: z.boolean(), settledRound: z.number().int().min(-1), updatedAt: integer,
  acceptedCommands: z.array(z.object({ id, playerId: id })).max(128),
});
const oldMember = z.object({ hash, connected: z.boolean(), controllerId: id.nullable(), leaveAfterRound: z.boolean() });
const member = oldMember.extend({ reservationDeadline: time, presenceDeadline: time, claimId: id.nullable(), claimVersion: integer, retiredClaims: z.array(id).max(8) });
const common = {
  id: z.string().regex(/^[a-f0-9]{32}$/), revision: integer, managerId: z.string().max(100), engine,
  locked: z.record(id, z.enum(['ready', 'out'])), bettingDeadline: time, insuranceDeadline: time, lastActivity: integer,
  receipts: z.array(z.object({ id, playerId: id, revision: integer })).max(128),
  commandRates: z.record(id, z.object({ start: integer, count: integer })),
};
const currentSchema = z.object({ ...common, schema: z.literal(2), members: z.record(id, member), tickets: z.array(z.object({ hash, playerId: id, expires: integer, claimId: id, claimVersion: integer })).max(4) });
const legacySchema = z.object({ ...common, schema: z.literal(1), members: z.record(id, oldMember), tickets: z.array(z.object({ hash, playerId: id, expires: integer })).max(4) });
const physicalCards = new Map(createDecks().map(card => [card.id, card]));
function validateInvariants(room: OnlineRoom) {
  const players = room.engine.players;
  if (new Set(players.map(p => p.id)).size !== players.length || new Set(players.map(p => p.seat)).size !== players.length) return false;
  if (Object.keys(room.members).length !== players.length || players.some(p => !room.members[p.id])) return false;
  if (room.managerId && !room.members[room.managerId]) return false;
  const shoe = room.engine.shoe;
  if (new Set(shoe.cards.map(c => c.id)).size !== 312 || shoe.cards.some(c => { const physical = physicalCards.get(c.id); return !physical || c.rank !== physical.rank || c.suit !== physical.suit; })) return false;
  const visible = [...room.engine.dealer, ...players.flatMap(p => p.hands.flatMap(h => h.cards))];
  const dealt = new Set(shoe.cards.slice(0, shoe.cursor).map(c => c.id));
  if (new Set(visible.map(c => c.id)).size !== visible.length || visible.some(c => !dealt.has(c.id) || physicalCards.get(c.id)?.rank !== c.rank || physicalCards.get(c.id)?.suit !== c.suit)) return false;
  if (room.engine.phase === 'PLAYER_TURNS') {
    if (players[room.engine.activePlayer]?.hands[room.engine.activeHand]?.status !== 'playing' || room.engine.decisionDeadline === null) return false;
  } else if (room.engine.decisionDeadline !== null) return false;
  if (Object.values(room.members).some(m => m.connected ? !m.controllerId || m.presenceDeadline === null || m.reservationDeadline !== null : m.presenceDeadline !== null)) return false;
  return true;
}
/** Fail closed on unknown/corrupt state. No reset, replacement shoe, or destructive upgrade. */
export function restoreRoom(value: unknown, now: number): { room: OnlineRoom; migrated: boolean } {
  if (!value) throw new GameError('ROOM_EXPIRED', 'This table invitation has expired or does not exist. Create a new table.');
  const version = (value as { schema?: unknown }).schema;
  if (version !== 1 && version !== 2) throw new GameError('ROOM_VERSION_UNSUPPORTED', 'This table needs a different server version. Create another table.');
  let parsed: ReturnType<typeof currentSchema.safeParse>;
  if (version === 1) {
    const legacy = legacySchema.safeParse(value);
    if (!legacy.success) throw new GameError('ROOM_STATE_INVALID', 'This table could not be safely restored. Create another table.');
    parsed = currentSchema.safeParse({ ...legacy.data, schema: 2, tickets: [], members: Object.fromEntries(Object.entries(legacy.data.members).map(([playerId, previous]) => [playerId, {
      ...newMember(previous.hash, now), ...previous,
      presenceDeadline: previous.connected ? now + PRESENCE_MS : null,
      reservationDeadline: previous.connected || previous.leaveAfterRound ? null : now + 60_000,
    }])) });
  } else parsed = currentSchema.safeParse(value);
  if (!parsed.success || !validateInvariants(parsed.data)) throw new GameError('ROOM_STATE_INVALID', 'This table could not be safely restored. Create another table.');
  return { room: parsed.data, migrated: version === 1 };
}
