import { z } from 'zod';
import { score } from '@casual/engine';
import { blackjackUnitsToWallet,walletUnitsToBlackjack,walletUnitsSchema,type ActionType } from '@casual/protocol';
import type { OnlineRoom } from './roomState';
import { assertWalletState as check,queueWalletOperation as enqueue,walletOperation as operation,walletSeatTerminal as terminal,fundedSeat,flushTableWallet,WALLET_DELIVERY_TIMEOUT_MS,type WalletGateway,type FundedSeat } from './tableWallet';
export { roomWalletSchema,fundedSeat,walletHasFunds,WALLET_DELIVERY_TIMEOUT_MS } from './tableWallet';
export type { RoomWallet,WalletGateway } from './tableWallet';
const id=z.string().uuid();

export function walletActions(room: OnlineRoom, playerId: string, actions: ActionType[]): ActionType[] {
  const seat = fundedSeat(room, playerId);
  if (!seat) return actions;
  // Always reject legacy refill, including during a pending or rejected account buy-in.
  const pending = seat.status !== 'active' || room.wallet!.outbox.some(entry => 'sessionId' in entry.command && entry.command.sessionId === seat.sessionId);
  return actions.filter(action => action !== 'Refill' && (!pending || ['Leave', 'StartBetting', 'NextRound', 'SitOut'].includes(action)));
}
/** Trusted identity/seat authorization must precede this call. No browser account ID is accepted. */
export function beginWalletFunding(previous: OnlineRoom, playerId: string, accountId: string, buyInUnits: number, sessionId: string = crypto.randomUUID()): OnlineRoom {
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
  player.balance = 0; player.bet = 0; player.perfectPairsBet=0;delete player.perfectPairsRound;player.hands = [];
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
    const wageredUnits = blackjackUnitsToWallet(player.hands.reduce((sum, hand) => sum + hand.wager, (insurance?.wager ?? 0)+(player.perfectPairsRound?.wager??0)));
    const returnedUnits = blackjackUnitsToWallet(player.hands.reduce((sum, hand) => sum + hand.returned!, (insurance?.returned ?? 0)+(player.perfectPairsRound?.returned??0)));
    const finalStack = seat.stackUnits - wageredUnits + returnedUnits;
    check(finalStack === blackjackUnitsToWallet(player.balance), 'Engine and funded stack disagree.');
    seat.stackUnits = finalStack; seat.sequence++; seat.lastRound = room.engine.roundId;
    enqueue(room, seat, { ...operation(seat), kind: 'settle', funding: 'account', roomId: room.id, gameId: 'blackjack',
      sequence: seat.sequence, roundId: String(room.engine.roundId), rulesetVersion: player.perfectPairsRound?'blackjack-perfect-pairs-v2':'blackjack-six-deck-v1', wageredUnits, returnedUnits,
      blackjack: { hands: player.hands.length, wins: player.hands.filter(h => h.outcome === 'win' || h.outcome === 'blackjack').length,
        losses: player.hands.filter(h => h.outcome === 'loss').length, pushes: player.hands.filter(h => h.outcome === 'push').length,
        blackjacks: player.hands.filter(h => h.naturalEligible && h.cards.length === 2 && score(h.cards).total === 21).length,
        busts: player.hands.filter(h => score(h.cards).total > 21).length, doubles: player.hands.filter(h => h.wager === player.bet * 2).length,
        ...(player.perfectPairsRound?{perfectPairs:{wagerUnits:blackjackUnitsToWallet(player.perfectPairsRound.wager),returnedUnits:blackjackUnitsToWallet(player.perfectPairsRound.returned!),kind:player.perfectPairsRound.kind}}:{}),
        splits: player.hands.length - 1, insuranceTaken: !!insurance?.wager, insuranceWon: (insurance?.returned ?? 0) > 0 } }, 'active');
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

/** Blackjack alone converts canonical wallet units into its existing half-chip engine units. */
export function flushRoomWallet(room:OnlineRoom,gateway:WalletGateway|undefined,persist:()=>Promise<void>,now=Date.now(),timeoutMs=WALLET_DELIVERY_TIMEOUT_MS){
  return flushTableWallet(room,gateway,persist,(playerId,units)=>{
    const player=room.engine.players.find(p=>p.id===playerId);
    check(player&&player.balance===0&&player.hands.length===0,'Activation must not replace a live bankroll.');
    player.balance=walletUnitsToBlackjack(units);player.bet=Math.min(20,player.balance);
  },now,timeoutMs);
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
      const locked = unresolved ? player.hands.reduce((sum, hand) => sum + hand.wager - (hand.returned ?? 0), (insurance?.wager ?? 0) - (insurance?.returned ?? 0)+(player.perfectPairsRound?.wager??0)-(player.perfectPairsRound?.returned??0)) : 0;
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
