import { SELF, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { ROOM_IDLE_MS, type OnlineRoom } from '../src/roomState';
import { bindings, close, connect, create, edit, http, inspect, join, origin, rigShoe } from './helpers';

async function overdue(invite: string, kind: 'hand' | 'reservation' | 'presence', playerId?: string) {
  await edit(invite, room => {
    if (kind === 'hand') room.engine.decisionDeadline = Date.now() - 1;
    else if (kind === 'reservation') room.members[playerId!]!.reservationDeadline = Date.now() - 1;
    else room.members[playerId!]!.presenceDeadline = Date.now() - 1;
  });
  await runDurableObjectAlarm(bindings.ROOMS.getByName(invite));
}

it('reserves disconnected seats for 60 seconds and restores the same guest before expiry', async () => {
  const first = await create(); const a = await connect(first.session);
  const controllerId = await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.controllerId!);
  const shoe = (await a.last()).shoe;
  await close(a);
  const member = await inspect(first.session.inviteId, room => room.members[first.session.playerId]!);
  expect(member.connected).toBe(false); expect(member.reservationDeadline! - Date.now()).toBeGreaterThan(58_000);
  const resumed = await connect(first.session, { claimId: a.claimId, controllerId });
  try {
    expect((await resumed.last()).you).toBe(first.session.playerId); expect((await resumed.last()).shoe).toEqual(shoe);
    expect(await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.reservationDeadline)).toBeNull();
    // A delayed close from the old controller must not disconnect or extend the new one.
    await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async instance => {
      await instance.webSocketClose({ deserializeAttachment: () => ({ playerId: first.session.playerId, controllerId }) } as unknown as WebSocket);
    });
    expect((await resumed.last()).players[0]!.connected).toBe(true);
  } finally { await close(resumed); }
});

it('releases an expired uncommitted seat and invalidates its old credential', async () => {
  const first = await create(); const a = await connect(first.session); await close(a);
  await overdue(first.session.inviteId, 'reservation', first.session.playerId);
  expect((await http(`/${first.session.inviteId}/resume`, first.session)).status).toBe(401);
  const replacement = await join(first.session.inviteId, 'New guest');
  expect(replacement.session.playerId).not.toBe(first.session.playerId); expect(replacement.snapshot.players[0]).toMatchObject({ seat: 0, balance: 2000 });
  expect(replacement.snapshot.shoe.remaining).toBe(312);
});

it('also releases a seat created by HTTP that never connected', async () => {
  const first = await create(); await overdue(first.session.inviteId, 'reservation', first.session.playerId);
  expect(await inspect(first.session.inviteId, room => room.engine.players.length)).toBe(0);
  expect((await join(first.session.inviteId)).snapshot.players).toHaveLength(1);
});

it('detects silent connection loss and does not restart grace on repeated alarms', async () => {
  const first = await create(); const a = await connect(first.session);
  try {
    await overdue(first.session.inviteId, 'presence', first.session.playerId);
    const member = await inspect(first.session.inviteId, room => room.members[first.session.playerId]!);
    expect(member.connected).toBe(false); expect(member.reservationDeadline! - Date.now()).toBeGreaterThan(58_000);
    await runDurableObjectAlarm(bindings.ROOMS.getByName(first.session.inviteId));
    expect(await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.reservationDeadline)).toBe(member.reservationDeadline);
  } finally { await close(a); }
});

it('keeps an expired seat through every unresolved split hand, then releases it exactly once', async () => {
  const first = await create(); const a = await connect(first.session);
  await rigShoe(first.session.inviteId, ['8', '10', '8', '7', '8', '8', '8', '8', '3', '2']);
  await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
  for (let index = 0; index < 3; index++) await a.send({ type: 'Split' });
  await close(a); await overdue(first.session.inviteId, 'reservation', first.session.playerId);
  expect(await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.leaveAfterRound)).toBe(true);
  expect(await inspect(first.session.inviteId, room => room.engine.players[0]!.hands.length)).toBe(4);
  await join(first.session.inviteId); await join(first.session.inviteId); await join(first.session.inviteId);
  expect((await http(`/${first.session.inviteId}/join`, undefined, { name: 'Too early' })).status).toBe(409);
  expect((await http(`/${first.session.inviteId}/resume`, first.session)).status).toBe(401);
  for (let index = 0; index < 4; index++) await overdue(first.session.inviteId, 'hand');
  const completed = await inspect(first.session.inviteId, room => ({ phase: room.engine.phase, settled: room.engine.settledRound, round: room.engine.roundId, cursor: room.engine.shoe.cursor, departed: room.members[first.session.playerId] }));
  expect(completed.phase).toBe('ROUND_COMPLETE'); expect(completed.settled).toBe(completed.round); expect(completed.departed).toBeUndefined();
  await runDurableObjectAlarm(bindings.ROOMS.getByName(first.session.inviteId));
  expect(await inspect(first.session.inviteId, room => room.engine.shoe.cursor)).toBe(completed.cursor);
  const next = await join(first.session.inviteId, 'Next seat one');
  expect(next.snapshot.players.find(p => p.id === next.session.playerId)).toMatchObject({ seat: 0, balance: 2000, hands: [] });
});

it('preserves a locked wager when its guest explicitly leaves before the deal', async () => {
  const first = await create(); const second = await join(first.session.inviteId);
  const a = await connect(first.session); const b = await connect(second.session);
  try {
    await rigShoe(first.session.inviteId, ['A', '2', '10', 'K', '3', '7']);
    await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' }); await a.send({ type: 'Leave' });
    expect(await inspect(first.session.inviteId, room => room.locked[first.session.playerId])).toBe('ready');
    await b.send({ type: 'Ready' });
    expect((await b.last()).players.find(p => p.id === first.session.playerId)!.hands).toHaveLength(1);
    expect(await b.send({ type: 'Stand' })).toMatchObject({ type: 'ack' });
    expect((await b.last()).phase).toBe('ROUND_COMPLETE'); expect((await b.last()).players.some(p => p.id === first.session.playerId)).toBe(false);
  } finally { await close(a, b); }
});

it('releases a sitting-out lower seat without changing another player’s active hand or deadline', async () => {
  const first = await create(); const second = await join(first.session.inviteId); const third = await join(first.session.inviteId);
  const a = await connect(first.session); const b = await connect(second.session); const c = await connect(third.session);
  try {
    await rigShoe(first.session.inviteId, ['2', '3', '10', '4', '5', '7']);
    await a.send({ type: 'StartBetting' }); await a.send({ type: 'SitOut' }); await b.send({ type: 'Ready' }); await c.send({ type: 'Ready' });
    const before = await b.last(); await close(a); await overdue(first.session.inviteId, 'reservation', first.session.playerId);
    const after = await b.last(); expect(after.activePlayerId).toBe(before.activePlayerId); expect(after.activeHandId).toBe(before.activeHandId); expect(after.decisionDeadline).toBe(before.decisionDeadline);
    expect(after.players).toHaveLength(2); expect(await b.send({ type: 'Hit' })).toMatchObject({ type: 'ack' });
  } finally { await close(a, b, c); }
});

it('rejects a superseded pending ticket and old-tab retries without taking control back', async () => {
  const first = await create(); const oldClaim = crypto.randomUUID(); const newClaim = crypto.randomUUID();
  const oldTicket = await (await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: oldClaim, claimVersion: 0 })).json<{ ticket: string }>();
  const newer = await connect(first.session, { claimId: newClaim });
  try {
    const response = await SELF.fetch(`https://example.test/api/v1/rooms/${first.session.inviteId}/socket`, { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `casual-v1, ticket.${oldTicket.ticket}` } });
    expect(response.status).toBe(401);
    const retried = await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: oldClaim, claimVersion: 0 }); expect(retried.status).toBe(409);
    expect(await retried.json()).toMatchObject({ code: 'SESSION_REPLACED' });
    expect(await newer.send({ type: 'StartBetting' })).toMatchObject({ type: 'ack' });
  } finally { await close(newer); }
});

it('rejects an old controller proof after replacement and keeps host transfer stable on reconnect', async () => {
  const first = await create(); const second = await join(first.session.inviteId);
  const a = await connect(first.session); const b = await connect(second.session);
  const oldController = await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.controllerId!);
  const replacement = await connect(first.session);
  try {
    expect((await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: a.claimId, controllerId: oldController, claimVersion: 0 })).status).toBe(409);
    await close(replacement);
    expect((await b.last()).room!.managerPlayerId).toBe(second.session.playerId);
    const again = await connect(first.session);
    try { expect((await again.last()).room!.managerPlayerId).toBe(second.session.playerId); }
    finally { await close(again); }
  } finally { await close(a, b, replacement); }
});

it.each(['turn', 'insurance', 'split', 'settled'] as const)('retains shoe, wagers, receipts and deadlines through %s hibernation', async mode => {
  const first = await create(); const a = await connect(first.session);
  try {
    await rigShoe(first.session.inviteId, mode === 'insurance' ? ['9', 'A', '7', '9'] : mode === 'split' ? ['8', '10', '8', '7', '3', '2'] : ['2', '10', '3', '7', '2']);
    await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
    if (mode === 'split') await a.send({ type: 'Split' });
    const commandId = crypto.randomUUID();
    if (mode === 'settled') await a.send({ type: 'Stand' }, { id: commandId });
    const before = await a.last(); const receipts = await inspect(first.session.inviteId, room => room.receipts.length);
    await evictDurableObject(bindings.ROOMS.getByName(first.session.inviteId));
    const after = await a.last(); expect(after).toEqual(before);
    expect(await inspect(first.session.inviteId, room => room.receipts.length)).toBe(receipts);
    if (mode === 'settled') {
      await a.send({ type: 'Stand' }, { id: commandId, revision: 0 }); expect((await a.last()).players).toEqual(before.players);
    } else if (mode === 'insurance') {
      await edit(first.session.inviteId, room => { room.insuranceDeadline = Date.now() - 1; }); await runDurableObjectAlarm(bindings.ROOMS.getByName(first.session.inviteId));
      expect((await a.last()).phase).toBe('PLAYER_TURNS');
    } else {
      await overdue(first.session.inviteId, 'hand'); expect((await a.last()).shoe.remaining).toBeLessThanOrEqual(before.shoe.remaining);
    }
  } finally { await close(a); }
});

it('recovers a process restart with lost sockets without resetting the game', async () => {
  const first = await create(); const a = await connect(first.session);
  await rigShoe(first.session.inviteId, ['2', '10', '3', '7']); await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
  const before = await a.last(); await evictDurableObject(bindings.ROOMS.getByName(first.session.inviteId), { webSockets: 'close' });
  const resumed = await connect(first.session);
  try { const after = await resumed.last(); expect(after.shoe).toEqual(before.shoe); expect(after.players[0]!.hands).toEqual(before.players[0]!.hands); expect(after.decisionDeadline).toBe(before.decisionDeadline); }
  finally { await close(a, resumed); }
});

it('does not extend idle expiry with cleanup alarms and atomically removes an expired room/alarm', async () => {
  const first = await create(); const activity = Date.now() - ROOM_IDLE_MS + 90_000;
  await edit(first.session.inviteId, room => { room.lastActivity = activity; room.members[first.session.playerId]!.reservationDeadline = Date.now() - 1; });
  const stub = bindings.ROOMS.getByName(first.session.inviteId);
  await runDurableObjectAlarm(stub); await runDurableObjectAlarm(stub);
  expect(await inspect(first.session.inviteId, room => room.lastActivity)).toBe(activity);
  const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()); expect(alarm).toBe(activity + ROOM_IDLE_MS);
  await edit(first.session.inviteId, room => { room.lastActivity = Date.now() - ROOM_IDLE_MS - 1; }); await runDurableObjectAlarm(stub);
  expect((await http(`/${first.session.inviteId}/join`, undefined, { name: 'Late' })).status).toBe(404);
  expect(await runInDurableObject(stub, async (_instance, state) => ({ value: await state.storage.get('room'), alarm: await state.storage.getAlarm() }))).toEqual({ value: undefined, alarm: null });
});

it('does not overwrite unknown or corrupt stored rooms or expose private state in errors', async () => {
  for (const kind of ['future', 'corrupt'] as const) {
    const first = await create(); const stub = bindings.ROOMS.getByName(first.session.inviteId);
    await runInDurableObject(stub, async (_instance, state) => {
      const room = (await state.storage.get<OnlineRoom>('room'))!;
      const damaged = kind === 'future' ? { ...room, schema: 99 } : { ...room, engine: { ...room.engine, shoe: { ...room.engine.shoe, cards: [] } } };
      await state.storage.put('room', damaged);
    });
    const before = await runInDurableObject(stub, async (_instance, state) => JSON.stringify(await state.storage.get('room')));
    const response = await http(`/${first.session.inviteId}/resume`, first.session);
    expect(response.status).toBe(kind === 'future' ? 409 : 503); const text = await response.text();
    expect(text).not.toContain(first.session.credential); expect(text).not.toContain('shoe'); expect(text).not.toContain('hash');
    const after = await runInDurableObject(stub, async (_instance, state) => JSON.stringify(await state.storage.get('room'))); expect(after).toBe(before);
  }
});

it('stale claims remain rejected even after the bounded retired-claim history rolls over', async () => {
  const first = await create(); const oldClaim = crypto.randomUUID();
  await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: oldClaim, claimVersion: 0 });
  for (let version = 1; version <= 9; version++) {
    const result = await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: crypto.randomUUID(), claimVersion: version }); expect(result.status).toBe(200);
  }
  expect(await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.retiredClaims.includes(oldClaim))).toBe(false);
  const stale = await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: oldClaim, claimVersion: 0 });
  expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'SESSION_REPLACED' });
});

it('migrates an active version-1 room atomically without losing its hand, receipt, deadline or shoe', async () => {
  const first = await create(); const a = await connect(first.session);
  try {
    await rigShoe(first.session.inviteId, ['2', '10', '3', '7', '2']); await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
    const commandId = crypto.randomUUID(); await a.send({ type: 'Hit' }, { id: commandId });
    const before = await a.last();
    await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (_instance, state) => {
      const room = (await state.storage.get<OnlineRoom>('room'))!;
      const members = Object.fromEntries(Object.entries(room.members).map(([id, m]) => [id, { hash: m.hash, connected: m.connected, controllerId: m.controllerId, leaveAfterRound: m.leaveAfterRound }]));
      await state.storage.put('room', { ...room, schema: 1, members, tickets: [] });
    });
    const restored = await a.last(); expect(restored.shoe).toEqual(before.shoe); expect(restored.players).toEqual(before.players); expect(restored.decisionDeadline).toBe(before.decisionDeadline);
    expect(await inspect(first.session.inviteId, room => room.schema)).toBe(2);
    expect(await a.send({ type: 'Hit' }, { id: commandId, revision: 0 })).toMatchObject({ type: 'ack' });
    expect((await a.last()).shoe).toEqual(before.shoe);
  } finally { await close(a); }
});

it('heartbeats renew only the presence lease, preserving game revision, activity time and deadline', async () => {
  const first = await create(); const a = await connect(first.session);
  try {
    const before = await inspect(first.session.inviteId, room => ({ revision: room.revision, activity: room.lastActivity, presence: room.members[first.session.playerId]!.presenceDeadline }));
    const pong = new Promise<void>(resolve => a.ws.addEventListener('message', event => { if ((JSON.parse(String(event.data)) as { type: string }).type === 'pong') resolve(); }, { once: true }));
    a.ws.send('ping'); await pong;
    const after = await inspect(first.session.inviteId, room => ({ revision: room.revision, activity: room.lastActivity, presence: room.members[first.session.playerId]!.presenceDeadline }));
    expect(after.revision).toBe(before.revision); expect(after.activity).toBe(before.activity); expect(after.presence!).toBeGreaterThanOrEqual(before.presence!);
  } finally { await close(a); }
});
