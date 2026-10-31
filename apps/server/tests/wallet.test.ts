import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createDecks, type Rank } from '@casual/engine';
import { applyCommand, collectSeats, ROOM_IDLE_MS, roomSnapshot, type OnlineRoom } from '../src/roomState';
import { beginWalletFunding, type WalletGateway } from '../src/roomWallet';
import type { Env } from '../src/env';
import type { TableRoom } from '../src/tableRoom';
import type { Action, WalletCommand, WalletReceipt } from '@casual/protocol';
import { bindings, create, http } from './helpers';

type InternalRoom = { env: Env; save(room: OnlineRoom): Promise<void>; catchUp(room: OnlineRoom): Promise<OnlineRoom> };
function internals(instance: TableRoom) { return instance as unknown as InternalRoom; }
function play(room: OnlineRoom, playerId: string, action: Action) {
  return applyCommand(room, { protocol: 1, id: crypto.randomUUID(), revision: room.revision, roundId: room.engine.roundId,
    handId: room.engine.players[room.engine.activePlayer]?.hands[room.engine.activeHand]?.id, playerId, action }, max => max - 1, Date.now());
}
function rig(room: OnlineRoom, ranks: Rank[]) {
  const rest = createDecks(); room.engine.shoe.cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
}
function gateway(storage: DurableObjectStorage, inspect?: (room: OnlineRoom, command: WalletCommand) => void): WalletGateway {
  return { async execute(command) {
    const room = (await storage.get<OnlineRoom>('room'))!;
    // Delivery must always observe its command already persisted alongside the engine state.
    expect(room.wallet!.outbox[0]!.command).toEqual(command); inspect?.(room, command);
    const saved = await storage.get<WalletReceipt>(`test-receipt:${command.operationId}`);
    if (saved) return saved;
    const receipt: WalletReceipt = { operationId: command.operationId, session: room.wallet!.outbox[0]!.after,
      wallet: { contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId: command.accountId,
        status: 'active', version: 1, availableUnits: 80_000, atTablesUnits: 20_000, pendingReturnUnits: 0 } };
    await storage.put(`test-receipt:${command.operationId}`, receipt); return receipt;
  } };
}
async function withGateway(instance: TableRoom, service: WalletGateway | undefined, work: () => Promise<void>) {
  // Private test injection only; no account-identity endpoint or public test RPC is introduced.
  const target = internals(instance); const original = target.env;
  Object.defineProperty(instance, 'env', { configurable: true, value: { ...original, WALLET_SERVICE: service } });
  try { await work(); } finally { Object.defineProperty(instance, 'env', { configurable: true, value: original }); }
}
it('persists buy-in decisions before delivery, installs only allocated funds and rejects guest authorization for funded seats', async () => {
  const first = await create(); const accountId = crypto.randomUUID(); const stub = bindings.ROOMS.getByName(first.session.inviteId);
  await runInDurableObject(stub, async (instance: TableRoom, state) => {
    const funded = beginWalletFunding((await state.storage.get<OnlineRoom>('room'))!, first.session.playerId, accountId, 20_000);
    await withGateway(instance, gateway(state.storage, room => { expect(room.engine.players[0]!.balance).toBe(0); }), async () => { await internals(instance).save(funded); });
    const saved = (await state.storage.get<OnlineRoom>('room'))!;
    expect(saved.schema).toBe(3); expect(saved.engine.players[0]!.balance).toBe(400); expect(saved.wallet!.outbox).toEqual([]);
    expect(JSON.stringify(roomSnapshot(saved, first.session.playerId))).not.toContain(accountId);
  });
  const response = await http(`/${first.session.inviteId}/resume`, first.session);
  expect((await response.json<{ code: string }>()).code).toBe('ACCOUNT_REQUIRED');
});
it('keeps the settled round and return outbox together across eviction and lost acknowledgements', async () => {
  const first = await create(); const stub = bindings.ROOMS.getByName(first.session.inviteId);
  let resultId = '';
  await runInDurableObject(stub, async (instance: TableRoom, state) => {
    let room = beginWalletFunding((await state.storage.get<OnlineRoom>('room'))!, first.session.playerId, crypto.randomUUID(), 20_000);
    await withGateway(instance, gateway(state.storage), async () => { await internals(instance).save(room); });
    room.members[first.session.playerId]!.connected = true; room.members[first.session.playerId]!.controllerId = 'fixture';
    room.members[first.session.playerId]!.reservationDeadline = null; room.members[first.session.playerId]!.presenceDeadline = Date.now() + 60_000;
    rig(room, ['A', '10', 'K', '8']);
    room = play(room, first.session.playerId, { type: 'StartBetting' }); room = play(room, first.session.playerId, { type: 'Ready' });
    room = play(room, first.session.playerId, { type: 'Leave' }); collectSeats(room, Date.now());
    resultId = room.wallet!.outbox[0]!.command.operationId;
    const delegate = gateway(state.storage, current => { expect(current.engine.phase).toBe('ROUND_COMPLETE'); expect(current.engine.players).toEqual([]); });
    await withGateway(instance, { async execute(command) { await delegate.execute(command); throw new Error('reply lost'); } }, async () => { await internals(instance).save(room); });
    expect((await state.storage.get<OnlineRoom>('room'))!.wallet!.outbox.map(entry => entry.command.kind)).toEqual(['settle', 'request_return', 'complete_return']);
  });
  const closed = await http(`/${first.session.inviteId}/join`, undefined, { name: 'Late guest' });
  expect(closed.status).toBe(404); expect(await closed.json()).toMatchObject({ code: 'ROOM_EXPIRED' });
  await evictDurableObject(stub);
  await runInDurableObject(stub, async (instance: TableRoom, state) => {
    const room = (await state.storage.get<OnlineRoom>('room'))!;
    expect(room.wallet!.outbox[0]!.command.operationId).toBe(resultId); room.wallet!.retryAt = 0;
    await withGateway(instance, gateway(state.storage), async () => { await internals(instance).save(room); });
    expect(await state.storage.get('room')).toBeUndefined();
    expect(await state.storage.getAlarm()).toBeNull();
  });
});
it('does not expire financial state or spin an idle alarm while the account service is unavailable', async () => {
  const first = await create();
  await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (instance: TableRoom, state) => {
    const room = beginWalletFunding((await state.storage.get<OnlineRoom>('room'))!, first.session.playerId, crypto.randomUUID(), 20_000);
    room.lastActivity = Date.now() - ROOM_IDLE_MS - 1;
    room.members[first.session.playerId]!.leaveAfterRound = true; room.members[first.session.playerId]!.reservationDeadline = null;
    await withGateway(instance, undefined, async () => {
      await internals(instance).save(room); await internals(instance).catchUp(room);
    });
    const saved = (await state.storage.get<OnlineRoom>('room'))!;
    expect(saved.wallet!.outbox).toHaveLength(2); expect(saved.engine.players).toHaveLength(1);
    expect(saved.wallet!.retryAt).toBeGreaterThan(Date.now()); expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
  });
});
it('preserves funded records when an older storage version would discard wallet metadata', async () => {
  const first = await create(); const stub = bindings.ROOMS.getByName(first.session.inviteId);
  await runInDurableObject(stub, async (_instance, state) => {
    const room = beginWalletFunding((await state.storage.get<OnlineRoom>('room'))!, first.session.playerId, crypto.randomUUID(), 20_000);
    room.schema = 2; await state.storage.put('room', room);
  });
  const response = await http(`/${first.session.inviteId}/resume`, first.session);
  expect((await response.json<{ code: string }>()).code).toBe('ROOM_VERSION_UNSUPPORTED');
  await runInDurableObject(stub, async (_instance, state) => { expect((await state.storage.get<OnlineRoom>('room'))!.wallet!.outbox).toHaveLength(2); });
});
