import { z } from 'zod';
import { GameError } from '@casual/engine';
import { walletCommandSchema,walletReceiptSchema,walletSessionSchema,walletUnitsSchema,type WalletCommand,type WalletReceipt,type WalletSession,type WalletSummary } from '@casual/protocol';
import type { HostedRoom } from './games/contracts';

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
export type FundedSeat = RoomWallet['seats'][string];
type OutboxEntry = RoomWallet['outbox'][number];
export const walletSeatTerminal = (seat: FundedSeat) => ['closed', 'cancelled', 'rejected'].includes(seat.status);
export function assertWalletState(value: unknown, message: string): asserts value {
  if (!value) throw new GameError('WALLET_STATE_INVALID', message);
}
export function fundedSeat(room: Pick<HostedRoom,'wallet'>, playerId: string) {
  return Object.values(room.wallet?.seats ?? {}).find(seat => seat.playerId === playerId && !walletSeatTerminal(seat))
    ?? Object.values(room.wallet?.seats ?? {}).find(seat => seat.playerId === playerId);
}
export function walletHasFunds(room: Pick<HostedRoom,'wallet'>) {
  return !!room.wallet && (room.wallet.outbox.length > 0 || Object.values(room.wallet.seats).some(seat => !walletSeatTerminal(seat)));
}
export function queueWalletOperation(room: HostedRoom, seat: FundedSeat, command: WalletCommand, state: WalletSession['state'], stackUnits = seat.stackUnits) {
  assertWalletState(room.wallet!.outbox.length < 32, 'The wallet outbox is full.');
  const parsed=walletCommandSchema.parse(command);
  assertWalletState('sessionId' in parsed&&parsed.sessionId===seat.sessionId&&parsed.accountId===seat.accountId,'Wallet operation belongs to another seat.');
  if(parsed.kind==='allocate'||parsed.kind==='settle')assertWalletState(parsed.gameId===(room.gameId??'blackjack')&&parsed.roomId===room.id,'Wallet operation belongs to another game or table.');
  const states={allocate:'pending_activation',activate:'active',settle:'active',cancel_allocation:'cancelled',request_return:'returning',complete_return:'closed'};
  assertWalletState(states[parsed.kind]===state,'Unexpected wallet lifecycle state.');
  const after=walletSessionSchema.parse({ accountId: seat.accountId, sessionId: seat.sessionId, roomId: room.id,
    gameId: room.gameId??'blackjack', funding: 'account', state, stackUnits, version: seat.version+1, resultSequence: seat.sequence });
  seat.version=after.version;
  room.wallet!.outbox.push({ command: parsed, after });
  room.wallet!.retryAt ??= 0;
}
export const walletOperation = (seat: FundedSeat) => ({ contract: 1 as const, operationId: crypto.randomUUID(), accountId: seat.accountId,
  sessionId: seat.sessionId, expectedVersion: seat.version });

function acknowledge(room: HostedRoom, entry: OutboxEntry, input: WalletReceipt,activateStack:(playerId:string,stackUnits:number)=>void) {
  const receipt = walletReceiptSchema.parse(input);
  assertWalletState(receipt.operationId === entry.command.operationId && receipt.wallet.accountId === entry.command.accountId
    && receipt.session && JSON.stringify(walletSessionSchema.parse(receipt.session)) === JSON.stringify(walletSessionSchema.parse(entry.after)), 'Unexpected wallet acknowledgement.');
  const seat = room.wallet!.seats[entry.after.sessionId]!;
  if (entry.command.kind === 'activate') {
    activateStack(seat.playerId,entry.after.stackUnits);
    seat.status = 'active';
  } else if (entry.command.kind === 'complete_return') { seat.status = 'closed'; seat.stackUnits = 0; }
  else if (entry.command.kind === 'cancel_allocation') { seat.status = 'cancelled'; seat.stackUnits = 0; }
  room.wallet!.outbox.shift(); room.wallet!.failures = 0; room.wallet!.error = null;
  room.wallet!.retryAt = room.wallet!.outbox.length ? 0 : null;
  room.revision++;
}

/** Save the room/outbox BEFORE calling this. Persist each acknowledgement before delivering the next. */
export async function flushTableWallet(room: HostedRoom, gateway: WalletGateway | undefined, persist: () => Promise<void>, activateStack:(playerId:string,stackUnits:number)=>void, now = Date.now(), timeoutMs = WALLET_DELIVERY_TIMEOUT_MS) {
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
          queueWalletOperation(room, seat, { ...walletOperation(seat), kind: 'cancel_allocation', rejectionId: crypto.randomUUID() }, 'cancelled', 0);
        }
        room.wallet.failures++;
        room.wallet.retryAt = now + Math.min(60_000, 1000 * 2 ** Math.min(room.wallet.failures, 6));
      }
      room.wallet.error = /^[A-Z_]{1,80}$/.test(code) ? code : 'WALLET_UNAVAILABLE';
      if (!room.wallet.outbox.length) room.wallet.retryAt = null;
      await persist(); return;
    }
    // Invalid replies retain the exact command for reconciliation; they are never proof of rejection.
    try { acknowledge(room, entry, receipt,activateStack); }
    catch {
      room.wallet.failures++; room.wallet.error = 'WALLET_ACK_INVALID';
      room.wallet.retryAt = now + Math.min(60_000, 1000 * 2 ** Math.min(room.wallet.failures, 6));
      await persist(); return;
    }
    // A local save failure after remote commit must propagate. Reload replays the durable command.
    await persist();
  }
}

