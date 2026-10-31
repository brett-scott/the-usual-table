import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDecks, type Rank } from '@casual/engine';
import type { Action, Command } from '@casual/protocol';
import { applyCommand, collectSeats, expireRoomDecisions, newMember, newRoom, nextAlarm, roomActions, roomSnapshot, type OnlineRoom } from '../../../apps/server/src/roomState';
import { beginWalletFunding, flushRoomWallet, fundedSeat, recordWalletRound, validRoomWallet, walletHasFunds, type WalletGateway } from '../../../apps/server/src/roomWallet';
import { restoreRoom } from '../../../apps/server/src/roomStorage';
import { PostgresWalletStore } from './index';

let db: PGlite; let wallet: PostgresWalletStore;
beforeAll(async () => {
  db = await PGlite.create(); await db.exec(await readFile(new URL('../migrations/001_wallet.sql', import.meta.url), 'utf8'));
  wallet = new PostgresWalletStore(db, { welcome: { version: 'test-only', amountUnits: 100_000 } });
}, 30_000);
afterAll(async () => { await db?.close(); });
const random = (max: number) => max - 1;
const now = 1000;
function rig(room: OnlineRoom, ranks: Rank[]) {
  const rest = createDecks(); room.engine.shoe.cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
}
function command(room: OnlineRoom, action: Action): Command {
  return { protocol: 1, id: crypto.randomUUID(), revision: room.revision, roundId: room.engine.roundId,
    playerId: 'player', handId: room.engine.players[room.engine.activePlayer]?.hands[room.engine.activeHand]?.id, action };
}
function play(room: OnlineRoom, action: Action) { return applyCommand(room, command(room, action), random, now); }
async function fixture(fund = true) {
  const accountId = crypto.randomUUID(); await wallet.createAccount(accountId);
  if (fund) await wallet.execute({ contract: 1, operationId: crypto.randomUUID(), accountId, kind: 'claim_grant', source: 'welcome' });
  let room = newRoom('a'.repeat(32), 'player', 'Player', 'b'.repeat(64), random, now);
  room.members.player!.connected = true; room.members.player!.controllerId = 'controller';
  room.members.player!.reservationDeadline = null; room.members.player!.presenceDeadline = 100_000;
  room = beginWalletFunding(room, 'player', accountId, 20_000);
  let persisted = structuredClone(room);
  const flush = async (gateway: WalletGateway | undefined = wallet, at = now) => {
    // Models TableRoom.persist: cleanup and an atomic room/outbox save before each delivery.
    const save = async () => { collectSeats(room, at); persisted = structuredClone(room); };
    await save(); await flushRoomWallet(room, gateway, save, at);
  };
  return { accountId, get room() { return room; }, set room(value: OnlineRoom) { room = value; },
    flush, stored: () => structuredClone(persisted), reload: () => { room = restoreRoom(persisted, now).room; } };
}

it('funds a seat only after allocation/activation and never imports the guest bankroll', async () => {
  const f = await fixture();
  expect(f.room.schema).toBe(3); expect(f.room.engine.players[0]!.balance).toBe(0);
  expect(roomActions(f.room, 'player')).not.toContain('Refill');
  await f.flush();
  expect(f.room.engine.players[0]!.balance).toBe(400);
  expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 80_000, atTablesUnits: 20_000 });
  expect(f.room.wallet!.outbox).toEqual([]); expect(validRoomWallet(f.room)).toBe(true);
  expect(JSON.stringify(roomSnapshot(f.room, 'player'))).not.toContain(f.accountId);
  expect(JSON.stringify(roomSnapshot(f.room, 'player'))).not.toContain(fundedSeat(f.room, 'player')!.sessionId);
  const before = JSON.stringify(f.room);
  expect(() => beginWalletFunding(f.room, 'player', f.accountId, 20_000)).toThrow();
  expect(JSON.stringify(f.room)).toBe(before);
});

it('rejects fractional Blackjack buy-ins before reserving money and retains failed allocation decisions', async () => {
  const f = await fixture(false); await f.flush();
  expect(fundedSeat(f.room, 'player')!.status).toBe('rejected');
  expect(f.room.wallet!.outbox).toEqual([]); expect(f.room.engine.players[0]!.balance).toBe(0);
  expect(roomActions(f.room, 'player')).not.toContain('Refill');
  expect(walletHasFunds(f.room)).toBe(false);
  const guest = newRoom('c'.repeat(32), 'guest', 'Guest', 'd'.repeat(64), random, now);
  expect(() => beginWalletFunding(guest, 'guest', f.accountId, 1001)).toThrow('exact half-chip');
  expect(guest.schema).toBe(2); expect(guest.engine.players[0]!.balance).toBe(2000);
});

it('aggregates split/double stakes and payouts in one authoritative round result', async () => {
  const f = await fixture(); await f.flush();
  rig(f.room, ['5', '10', '5', '7', '4', '6', '10']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  f.room = play(f.room, { type: 'Split' }); f.room = play(f.room, { type: 'Double' }); f.room = play(f.room, { type: 'Stand' });
  expect(f.room.engine.phase).toBe('ROUND_COMPLETE');
  const entries = f.room.wallet!.outbox; expect(entries).toHaveLength(1);
  expect(entries[0]!.command).toMatchObject({ kind: 'settle', wageredUnits: 3000, returnedUnits: 4000, sequence: 1 });
  recordWalletRound(f.room); expect(f.room.wallet!.outbox).toHaveLength(1);
  await f.flush();
  expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 80_000, atTablesUnits: 21_000 });
  expect(f.room.engine.players[0]!.balance).toBe(420);
  f.reload(); expect(validRoomWallet(f.room)).toBe(true);
});

it('includes insurance exactly once when a dealer natural ends the round', async () => {
  const f = await fixture(); await f.flush(); rig(f.room, ['K', 'A', '9', 'Q']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  f.room = play(f.room, { type: 'InsuranceDecision', amount: 10 });
  expect(f.room.wallet!.outbox[0]!.command).toMatchObject({ kind: 'settle', wageredUnits: 1500, returnedUnits: 1500 });
  await f.flush(); expect((await wallet.getWallet(f.accountId)).atTablesUnits).toBe(20_000);
});

it('queues settlement from an expired hand before membership cleanup or the next round', async () => {
  const f = await fixture(); await f.flush(); rig(f.room, ['10', '10', '7', '8']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  f.room = play(f.room, { type: 'Leave' });
  collectSeats(f.room, now); expect(f.room.engine.players).toHaveLength(1);
  f.room = expireRoomDecisions(f.room, random, f.room.engine.decisionDeadline!);
  collectSeats(f.room, now);
  expect(f.room.engine.players).toEqual([]);
  expect(f.room.wallet!.outbox.map(entry => entry.command.kind)).toEqual(['settle', 'request_return', 'complete_return']);
  await f.flush(); expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 99_000, atTablesUnits: 0, pendingReturnUnits: 0 });
});

it('retries an acknowledged-lost result after reload and returns the final stack once', async () => {
  const f = await fixture(); await f.flush(); rig(f.room, ['A', '10', 'K', '8']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  const lostId = f.room.wallet!.outbox[0]!.command.operationId;
  let lost = true;
  const gateway: WalletGateway = { async execute(input) { const receipt = await wallet.execute(input); if (lost) { lost = false; throw new Error('lost acknowledgement'); } return receipt; } };
  await f.flush(gateway); f.reload();
  expect(f.room.wallet!.outbox[0]!.command.operationId).toBe(lostId);
  f.room = play(f.room, { type: 'Leave' }); collectSeats(f.room, now);
  await f.flush(wallet, 100_000);
  expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 101_500, atTablesUnits: 0, pendingReturnUnits: 0 });
  expect(f.room.wallet!.outbox).toEqual([]); expect(walletHasFunds(f.room)).toBe(false);
  await f.flush(wallet, 200_000);
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM wallet_private.results WHERE account_id = $1', [f.accountId]);
  expect(rows[0]!.count).toBe(1);
});

it('does not allow a second funded wager while a completed result is waiting for delivery', async () => {
  const f = await fixture(); await f.flush(); rig(f.room, ['A', '10', 'K', '8']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  f.room = play(f.room, { type: 'NextRound' });
  expect(roomActions(f.room, 'player')).not.toContain('Ready');
  expect(() => play(f.room, { type: 'Ready' })).toThrow();
  await f.flush(); expect(roomActions(f.room, 'player')).toContain('Ready');
});

it('keeps uncertain activation durable when a player leaves before its acknowledgement', async () => {
  const f = await fixture(); let lost = true;
  await f.flush({ async execute(input) { const receipt = await wallet.execute(input); if (input.kind === 'activate' && lost) { lost = false; throw new Error('activation reply lost'); } return receipt; } });
  f.reload(); expect(fundedSeat(f.room, 'player')!.status).toBe('funding');
  f.room = play(f.room, { type: 'Leave' }); collectSeats(f.room, now);
  expect(f.room.engine.players).toHaveLength(1);
  await f.flush(wallet, 100_000);
  expect(f.room.engine.players).toEqual([]);
  expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 100_000, atTablesUnits: 0 });
});

it('cancels a definitely rejected activation after account suspension without a timeout refund', async () => {
  const f = await fixture();
  await f.flush({ async execute(input) { const receipt = await wallet.execute(input); if (input.kind === 'allocate') await wallet.setAccountStatus(f.accountId, 'suspended'); return receipt; } });
  expect(f.room.wallet!.outbox.map(entry => entry.command.kind)).toEqual(['cancel_allocation']);
  f.reload(); await f.flush(wallet, 100_000);
  expect(fundedSeat(f.room, 'player')!.status).toBe('cancelled');
  expect(await wallet.getWallet(f.accountId)).toMatchObject({ availableUnits: 100_000, atTablesUnits: 0 });
});

it('persists closed return decisions even when the final database commit succeeds but the room save fails', async () => {
  const f = await fixture(); await f.flush(); f.room = play(f.room, { type: 'Leave' }); collectSeats(f.room, now);
  let durable = structuredClone(f.room);
  await expect(flushRoomWallet(f.room, wallet, async () => {
    if (f.room.wallet!.outbox.length === 0) throw new Error('room save crashed');
    durable = structuredClone(f.room);
  }, now)).rejects.toThrow('room save crashed');
  f.room = restoreRoom(durable, now).room;
  expect(f.room.wallet!.outbox[0]!.command.kind).toBe('complete_return');
  await f.flush(); expect((await wallet.getWallet(f.accountId)).availableUnits).toBe(100_000);
});

it('keeps a retry alarm and financial state when the wallet service is missing', async () => {
  const f = await fixture();
  await flushRoomWallet(f.room, undefined, async () => {}, now);
  expect(f.room.wallet!.outbox).toHaveLength(2); expect(nextAlarm(f.room)).toBe(3000);
  expect(walletHasFunds(f.room)).toBe(true);
  expect(restoreRoom(f.room, now).room.wallet).toEqual(f.room.wallet);
});

it('bounds a hanging delivery and retains the original command for retry', async () => {
  const f = await fixture(); const original = f.room.wallet!.outbox[0]!.command;
  await flushRoomWallet(f.room, { execute: () => new Promise(() => {}) }, async () => {}, now, 10);
  expect(f.room.wallet!.outbox[0]!.command).toEqual(original); expect(f.room.wallet!.retryAt).toBe(3000);
  expect(f.room.engine.players[0]!.balance).toBe(0);
  await f.flush(wallet, 100_000); expect(fundedSeat(f.room, 'player')!.status).toBe('active');
});

it('retains commands when a reply belongs to the wrong operation rather than accepting its balance', async () => {
  const f = await fixture(); const original = f.room.wallet!.outbox[0]!.command;
  await f.flush({ async execute(input) { return { ...await wallet.execute(input), operationId: crypto.randomUUID() }; } });
  expect(f.room.wallet!.error).toBe('WALLET_ACK_INVALID'); expect(f.room.wallet!.outbox[0]!.command).toEqual(original);
  expect(f.room.engine.players[0]!.balance).toBe(0);
  f.reload(); await f.flush(wallet, 100_000);
  expect((await wallet.getWallet(f.accountId)).availableUnits).toBe(80_000);
});

it('keeps mixed Blackjack guest chips separate and guest refills available while account results wait', async () => {
  const f = await fixture(); await f.flush();
  f.room.engine.players.push({ id: 'guest', name: 'Guest', seat: 1, balance: 2000, bet: 20, hands: [] });
  f.room.members.guest = { ...newMember('c'.repeat(64), now), connected: true, controllerId: 'guest-controller', reservationDeadline: null, presenceDeadline: 100_000 };
  rig(f.room, ['10', '10', '10', '7', '7', '8']);
  f.room = play(f.room, { type: 'StartBetting' }); f.room = play(f.room, { type: 'Ready' });
  const guestAction = (action: Action) => { f.room = applyCommand(f.room, { ...command(f.room, action), playerId: 'guest' }, random, now); };
  guestAction({ type: 'Ready' }); f.room = play(f.room, { type: 'Stand' }); guestAction({ type: 'Stand' });
  expect(f.room.wallet!.outbox).toHaveLength(1);
  expect(f.room.wallet!.outbox[0]!.command.accountId).toBe(f.accountId);
  f.room.engine.players.find(player => player.id === 'guest')!.balance = 0;
  expect(roomActions(f.room, 'guest')).toContain('Refill'); guestAction({ type: 'Refill' });
  expect(f.room.engine.players.find(player => player.id === 'guest')!.balance).toBe(2000);
  expect(f.room.wallet!.outbox).toHaveLength(1);
  await f.flush(); expect((await wallet.getWallet(f.accountId)).atTablesUnits).toBe(19_000);
});

it('rejects corrupted funded state and rejects attempts to downgrade away its wallet records', async () => {
  const f = await fixture(); await f.flush();
  for (const damage of [
    (room: OnlineRoom) => { room.schema = 2; },
    (room: OnlineRoom) => { delete room.wallet; },
    (room: OnlineRoom) => { room.engine.players[0]!.balance++; },
    (room: OnlineRoom) => { fundedSeat(room, 'player')!.accountId = crypto.randomUUID(); room.wallet!.seats.bad = fundedSeat(room, 'player')!; },
  ]) {
    const copy = structuredClone(f.room); damage(copy); const before = JSON.stringify(copy);
    expect(() => restoreRoom(copy, now)).toThrow(); expect(JSON.stringify(copy)).toBe(before);
  }
});
