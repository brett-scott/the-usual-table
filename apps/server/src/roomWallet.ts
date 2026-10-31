import { z } from 'zod';
import { GameError } from '@casual/engine';
import { blackjackUnitsToWallet, walletUnitsToBlackjack, walletCommandSchema, walletReceiptSchema, walletSessionSchema,
  walletUnitsSchema, type ActionType, type WalletCommand, type WalletReceipt, type WalletSession, type WalletSummary } from '@casual/protocol';
import type { OnlineRoom } from './roomState';

export interface WalletGateway {
  execute(command: WalletCommand): Promise<WalletReceipt>;
  getWallet?(accountId: string): Promise<WalletSummary>;
}
export const WALLET_DELIVERY_TIMEOUT_MS = 3000;
const integer = z.number().int().nonnegative().safe();
const id = z.string().uuid();
export const roomWalletSchema = z.object({
  schema: z.literal(1),
  seats: z.record(id, z.object({
    sessionId: id, accountId: id, playerId: z.string().min(1).max(100),
    status: z.enum(['funding', 'active', 'returning', 'closed', 'cancelled', 'rejected']),
    version: integer, sequence: integer, stackUnits: walletUnitsSchema, lastRound: integer,
    leaveRequested: z.boolean(),
  }).strict()),
  outbox: z.array(z.object({ command: walletCommandSchema, after: walletSessionSchema }).strict()).max(32),
  retryAt: integer.nullable(), failures: integer, error: z.string().max(80).nullable(),
}).strict();
export type RoomWallet = z.infer<typeof roomWalletSchema>;
type FundedSeat = RoomWallet['seats'][string];
type OutboxEntry = RoomWallet['outbox'][number];
const terminal = (seat: FundedSeat) => ['closed', 'cancelled', 'rejected'].includes(seat.status);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new GameError('WALLET_STATE_INVALID', message);
}
export function fundedSeat(room: OnlineRoom, playerId: string) {
  return Object.values(room.wallet?.seats ?? {}).find(seat => seat.playerId === playerId && !terminal(seat))
    ?? Object.values(room.wallet?.seats ?? {}).find(seat => seat.playerId === playerId);
}
export function walletHasFunds(room: OnlineRoom) {
  return !!room.wallet && (room.wallet.outbox.length > 0 || Object.values(room.wallet.seats).some(seat => !terminal(seat)));
}
export function walletActions(room: OnlineRoom, playerId: string, actions: ActionType[]): ActionType[] {
  const seat = fundedSeat(room, playerId);
  if (!seat) return actions;
  // Always reject legacy refill, including during a pending or rejected account buy-in.
  const pending = seat.status !== 'active' || room.wallet!.outbox.some(entry => 'sessionId' in entry.command && entry.command.sessionId === seat.sessionId);
  return actions.filter(action => action !== 'Refill' && (!pending || ['Leave', 'StartBetting', 'NextRound', 'SitOut'].includes(action)));
}
function enqueue(room: OnlineRoom, seat: FundedSeat, command: WalletCommand, state: WalletSession['state'], stackUnits = seat.stackUnits) {
  check(room.wallet!.outbox.length < 32, 'The wallet outbox is full.');
  seat.version++;
  const after: WalletSession = { accountId: seat.accountId, sessionId: seat.sessionId, roomId: room.id,
    gameId: 'blackjack', funding: 'account', state, stackUnits, version: seat.version, resultSequence: seat.sequence };
  room.wallet!.outbox.push({ command: walletCommandSchema.parse(command), after: walletSessionSchema.parse(after) });
  room.wallet!.retryAt ??= 0;
}
const operation = (seat: FundedSeat) => ({ contract: 1 as const, operationId: crypto.randomUUID(), accountId: seat.accountId,
  sessionId: seat.sessionId, expectedVersion: seat.version });

/** Trusted identity/seat authorization must precede this call. No browser account ID is accepted. */
export function beginWalletFunding(previous: OnlineRoom, playerId: string, accountId: string, buyInUnits: number, sessionId = crypto.randomUUID()): OnlineRoom {
  id.parse(accountId); walletUnitsSchema.parse(buyInUnits);
  id.parse(sessionId);
  const chips = walletUnitsToBlackjack(buyInUnits);
  check(chips >= 20, 'A Blackjack buy-in must cover the minimum bet.');
  const candidate = previous.engine.players.find(player => player.id === playerId);
  check(candidate && candidate.hands.length === 0 && !previous.locked[playerId] && !previous.engine.insurance[playerId]?.wager
    && previous.members[playerId] && !previous.members[playerId]!.leaveAfterRound, 'Fund only a new, uncommitted seat.');
  check(!fundedSeat(previous, playerId), 'This seat already has a funding decision.');
  check(!Object.values(previous.wallet?.seats ?? {}).some(seat => seat.accountId === accountId && !terminal(seat)), 'This account already has a seat.');
  if (previous.members[playerId]!.account) check(Object.values(previous.wallet?.seats ?? {}).every(seat => terminal(seat)
    || previous.members[seat.playerId]?.account?.id === seat.accountId), 'Existing funded seats need compatible account ownership before adding account play.');
  const room = structuredClone(previous);
  room.schema = previous.members[playerId]!.account ? 4 : 3;
  room.wallet ??= { schema: 1, seats: {}, outbox: [], retryAt: null, failures: 0, error: null };
  // Retain completed records while the room lives; refuse an unbounded history rather than erase money.
  check(Object.keys(room.wallet.seats).length < 128, 'This room has reached its funded-session limit.');
  const seat: FundedSeat = { sessionId, accountId, playerId, status: 'funding',
    version: 0, sequence: 0, stackUnits: buyInUnits, lastRound: room.engine.roundId, leaveRequested: false };
  room.wallet.seats[seat.sessionId] = seat;
  const player = room.engine.players.find(p => p.id === playerId)!;
  // Discard the temporary guest bankroll. It never becomes saved account money.
  player.balance = 0; player.bet = 0; player.hands = [];
  enqueue(room, seat, { contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'allocate',
    sessionId: seat.sessionId, roomId: room.id, gameId: 'blackjack', funding: 'account', amountUnits: buyInUnits }, 'pending_activation');
  enqueue(room, seat, { ...operation(seat), kind: 'activate' }, 'active');
  room.revision++;
  return room;
}

/** Called as part of the same room transition that commits the authoritative engine settlement. */
export function recordWalletRound(room: OnlineRoom) {
  if (!room.wallet || room.engine.phase !== 'ROUND_COMPLETE' || room.engine.settledRound !== room.engine.roundId) return;
  for (const seat of Object.values(room.wallet.seats)) {
    const player = room.engine.players.find(p => p.id === seat.playerId);
    if (seat.status !== 'active' || seat.lastRound >= room.engine.roundId || !player?.hands.length) continue;
    const insurance = room.engine.insurance[player.id];
    check(player.hands.every(hand => hand.outcome !== undefined && hand.returned !== undefined), 'Cannot publish an unsettled hand.');
    const wageredUnits = blackjackUnitsToWallet(player.hands.reduce((sum, hand) => sum + hand.wager, insurance?.wager ?? 0));
    const returnedUnits = blackjackUnitsToWallet(player.hands.reduce((sum, hand) => sum + hand.returned!, insurance?.returned ?? 0));
    const finalStack = seat.stackUnits - wageredUnits + returnedUnits;
    check(finalStack === blackjackUnitsToWallet(player.balance), 'Engine and funded stack disagree.');
    seat.stackUnits = finalStack; seat.sequence++; seat.lastRound = room.engine.roundId;
    enqueue(room, seat, { ...operation(seat), kind: 'settle', funding: 'account', roomId: room.id, gameId: 'blackjack',
      sequence: seat.sequence, roundId: String(room.engine.roundId), rulesetVersion: 'blackjack-six-deck-v1', wageredUnits, returnedUnits }, 'active');
  }
}

/** Only call after locked wagers and in-flight hands finish. False retains an activating seat. */
export function sealWalletSeat(room: OnlineRoom, playerId: string): boolean {
  const seat = fundedSeat(room, playerId);
  if (!seat || terminal(seat) || seat.status === 'returning') return true;
  seat.leaveRequested = true;
  // An activation may have committed remotely with its acknowledgement lost. Always reconcile it.
  if (seat.status === 'funding') return false;
  const player = room.engine.players.find(p => p.id === playerId)!;
  check(seat.stackUnits === blackjackUnitsToWallet(player.balance), 'Cannot seal unreconciled table funds.');
  seat.status = 'returning';
  enqueue(room, seat, { ...operation(seat), kind: 'request_return', finalSequence: seat.sequence, finalStackUnits: seat.stackUnits }, 'returning');
  enqueue(room, seat, { ...operation(seat), kind: 'complete_return' }, 'closed', 0);
  return true;
}

function acknowledge(room: OnlineRoom, entry: OutboxEntry, input: WalletReceipt) {
  const receipt = walletReceiptSchema.parse(input);
  check(receipt.operationId === entry.command.operationId && receipt.wallet.accountId === entry.command.accountId
    && receipt.session && JSON.stringify(walletSessionSchema.parse(receipt.session)) === JSON.stringify(walletSessionSchema.parse(entry.after)), 'Unexpected wallet acknowledgement.');
  const seat = room.wallet!.seats[entry.after.sessionId]!;
  if (entry.command.kind === 'activate') {
    const player = room.engine.players.find(p => p.id === seat.playerId);
    check(player && player.balance === 0 && player.hands.length === 0, 'Activation must not replace a live bankroll.');
    player.balance = walletUnitsToBlackjack(entry.after.stackUnits); player.bet = Math.min(20, player.balance);
    seat.status = 'active';
  } else if (entry.command.kind === 'complete_return') { seat.status = 'closed'; seat.stackUnits = 0; }
  else if (entry.command.kind === 'cancel_allocation') { seat.status = 'cancelled'; seat.stackUnits = 0; }
  room.wallet!.outbox.shift(); room.wallet!.failures = 0; room.wallet!.error = null;
  room.wallet!.retryAt = room.wallet!.outbox.length ? 0 : null;
  room.revision++;
}

/** Save the room/outbox BEFORE calling this. Persist each acknowledgement before delivering the next. */
export async function flushRoomWallet(room: OnlineRoom, gateway: WalletGateway | undefined, persist: () => Promise<void>, now = Date.now(), timeoutMs = WALLET_DELIVERY_TIMEOUT_MS) {
  if (!room.wallet?.outbox.length || (room.wallet.retryAt !== null && room.wallet.retryAt > now)) return;
  for (let delivered = 0; room.wallet.outbox.length && delivered < 32; delivered++) {
    const entry = room.wallet.outbox[0]!;
    let receipt: WalletReceipt;
    try {
      if (!gateway) throw new Error('Wallet service unavailable');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        receipt = await Promise.race([gateway.execute(entry.command), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Wallet delivery timed out')), timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'WALLET_UNAVAILABLE';
      const seat = room.wallet.seats[entry.after.sessionId]!;
      // These explicit rejections prove that this allocation operation did not reserve funds.
      if (entry.command.kind === 'allocate' && ['INSUFFICIENT_FUNDS', 'ACCOUNT_SUSPENDED', 'ACCOUNT_NOT_FOUND', 'SESSION_EXISTS'].includes(code)) {
        room.wallet.outbox = room.wallet.outbox.filter(item => item.after.sessionId !== seat.sessionId);
        seat.status = 'rejected'; seat.stackUnits = 0; room.revision++;
      } else {
        // A retry of a committed activation returns its receipt before suspension is checked.
        if (entry.command.kind === 'activate' && code === 'ACCOUNT_SUSPENDED') {
          room.wallet.outbox.shift(); seat.version = entry.command.expectedVersion;
          enqueue(room, seat, { ...operation(seat), kind: 'cancel_allocation', rejectionId: crypto.randomUUID() }, 'cancelled', 0);
        }
        room.wallet.failures++;
        room.wallet.retryAt = now + Math.min(60_000, 1000 * 2 ** Math.min(room.wallet.failures, 6));
      }
      room.wallet.error = /^[A-Z_]{1,80}$/.test(code) ? code : 'WALLET_UNAVAILABLE';
      if (!room.wallet.outbox.length) room.wallet.retryAt = null;
      await persist(); return;
    }
    // Invalid replies retain the exact command for reconciliation; they are never proof of rejection.
    try { acknowledge(room, entry, receipt); }
    catch {
      room.wallet.failures++; room.wallet.error = 'WALLET_ACK_INVALID';
      room.wallet.retryAt = now + Math.min(60_000, 1000 * 2 ** Math.min(room.wallet.failures, 6));
      await persist(); return;
    }
    // A local save failure after remote commit must propagate. Reload replays the durable command.
    await persist();
  }
}

/** Storage validation must reject inconsistent financial state rather than resetting a room. */
export function validRoomWallet(room: OnlineRoom): boolean {
  if (!room.wallet) return room.schema === 2;
  if (![3, 4].includes(room.schema) || Object.keys(room.wallet.seats).length > 128) return false;
  if ((room.wallet.outbox.length === 0) !== (room.wallet.retryAt === null)) return false;
  const livePlayers = new Set<string>(); const liveAccounts = new Set<string>(); const operationIds = new Set<string>();
  for (const [sessionId, seat] of Object.entries(room.wallet.seats)) {
    if (sessionId !== seat.sessionId || seat.version < 2) return false;
    if (!terminal(seat)) {
      if (livePlayers.has(seat.playerId) || liveAccounts.has(seat.accountId)) return false;
      livePlayers.add(seat.playerId); liveAccounts.add(seat.accountId);
    }
    const player = room.engine.players.find(p => p.id === seat.playerId);
    if (room.schema === 4 && player && !room.members[seat.playerId]?.account) return false;
    if (room.members[seat.playerId]?.account && room.members[seat.playerId]!.account!.id !== seat.accountId) return false;
    if (['funding', 'active'].includes(seat.status) && !player) return false;
    if (seat.status === 'funding' && (player!.balance !== 0 || player!.hands.length !== 0)) return false;
    if (seat.status === 'active' && player) {
      const insurance = room.engine.insurance[player.id];
      const unresolved = room.engine.phase !== 'BETTING' && room.engine.phase !== 'ROUND_COMPLETE';
      const locked = unresolved ? player.hands.reduce((sum, hand) => sum + hand.wager - (hand.returned ?? 0), (insurance?.wager ?? 0) - (insurance?.returned ?? 0)) : 0;
      if ((player.balance + locked) * 50 !== seat.stackUnits) return false;
    }
    const entries = room.wallet.outbox.filter(entry => entry.after.sessionId === sessionId);
    if (entries.length && entries.at(-1)!.after.version !== seat.version) return false;
    if (entries.some((entry, index) => index > 0 && entry.after.version !== entries[index - 1]!.after.version + 1)) return false;
    if (terminal(seat) && entries.length) return false;
    if (seat.status === 'funding' && !entries.some(entry => ['activate', 'cancel_allocation'].includes(entry.command.kind))) return false;
    if (seat.status === 'returning' && entries.at(-1)?.command.kind !== 'complete_return') return false;
  }
  for (const entry of room.wallet.outbox) {
    const seat = room.wallet.seats[entry.after.sessionId]; const command = entry.command;
    if (!seat || !('sessionId' in command) || command.sessionId !== seat.sessionId || command.accountId !== seat.accountId
      || entry.after.accountId !== seat.accountId || entry.after.roomId !== room.id || entry.after.gameId !== 'blackjack'
      || operationIds.has(command.operationId)) return false;
    operationIds.add(command.operationId);
    if (command.kind === 'allocate' ? entry.after.version !== 1 : entry.after.version !== command.expectedVersion + 1) return false;
  }
  return true;
}
