import { SELF, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { LobbyDirectory } from '../src/lobbyDirectory';
import type { PublicLobby, SessionResponse } from '@casual/protocol';
import { bindings, close, connect, create, http, join, origin } from './helpers';

async function listed() {
  const response = await SELF.fetch('https://example.test/api/v1/games/blackjack/lobbies', { headers: { Origin: origin } });
  expect(response.status).toBe(200); return (await response.json<{ lobbies: PublicLobby[] }>()).lobbies;
}
async function publicTable() {
  const response = await http('', undefined, { name: 'Public host', visibility: 'public' });
  expect(response.status).toBe(201); return response.json<SessionResponse>();
}
it('serves the game catalog and rejects lobby discovery for unavailable games', async () => {
  const response = await SELF.fetch('https://example.test/api/v1/games', { headers: { Origin: origin } });
  const { games } = await response.json<{ games: { id: string; status: string }[] }>();
  expect(games.map(game => game.id)).toEqual(['blackjack', 'baccarat', 'roulette', 'texas-holdem', 'keno', 'duck-race', 'penguin-cross', 'crash']);
  expect(games.filter(game => game.status === 'available').map(game => game.id)).toEqual(['blackjack']);
  for (const id of ['baccarat', 'roulette', 'texas-holdem', 'keno', 'duck-race', 'penguin-cross', 'crash', 'unknown']) {
    const result = await SELF.fetch(`https://example.test/api/v1/games/${id}/lobbies`, { headers: { Origin: origin } });
    expect(result.status).toBe(400); expect(await result.json()).toMatchObject({ code: 'GAME_UNAVAILABLE' });
  }
});
it('lists only connected opt-in public tables and preserves private invitation rooms', async () => {
  const hidden = await create('Private host'); const a = await connect(hidden.session);
  const visible = await publicTable(); const b = await connect(visible.session);
  try {
    expect(hidden.snapshot.room?.visibility).toBe('private'); expect(visible.snapshot.room?.gameId).toBe('blackjack');
    await expect.poll(async () => (await listed()).some(lobby => lobby.roomId === visible.session.inviteId)).toBe(true);
    const entries = await listed(); expect(entries.some(lobby => lobby.roomId === hidden.session.inviteId)).toBe(false);
    const lobby = entries.find(lobby => lobby.roomId === visible.session.inviteId)!;
    expect(lobby).toMatchObject({ hostName: 'Public host', players: 1, capacity: 4, gameId: 'blackjack', phase: 'waiting' });
    const text = JSON.stringify(entries); expect(text).not.toContain(visible.session.credential); expect(text).not.toContain('credential'); expect(text).not.toContain('balance'); expect(text).not.toContain('cards');
    await evictDurableObject(bindings.LOBBIES.getByName('blackjack'));
    expect((await listed()).some(lobby => lobby.roomId === visible.session.inviteId)).toBe(true);
    await b.send({ type: 'StartBetting' }); await b.send({ type: 'Ready' });
    await expect.poll(async () => (await listed()).find(lobby => lobby.roomId === visible.session.inviteId)?.phase).toBe('playing');
  } finally { await close(a, b); }
});
it('removes full tables from discovery and exposes them again after a seat leaves', async () => {
  const first = await publicTable(); const guests = [first, await join(first.session.inviteId), await join(first.session.inviteId), await join(first.session.inviteId)];
  const peers = await Promise.all(guests.map(guest => connect(guest.session)));
  try {
    await expect.poll(async () => (await listed()).some(lobby => lobby.roomId === first.session.inviteId)).toBe(false);
    expect(await peers[3]!.send({ type: 'Leave' })).toMatchObject({ type: 'ack' });
    await expect.poll(async () => (await listed()).find(lobby => lobby.roomId === first.session.inviteId)?.players).toBe(3);
  } finally { await close(...peers); }
});
it('expires stale reports and does not resurrect removed lobbies from delayed updates', async () => {
  const directory = bindings.LOBBIES.getByName('blackjack'); const id = 'a'.repeat(32);
  const report: PublicLobby = { roomId: id, gameId: 'blackjack', hostName: 'Host', players: 1, capacity: 4, phase: 'waiting', updatedAt: 0 };
  await directory.update(id, 10, report); await directory.update(id, 9, { ...report, hostName: 'Stale host' });
  expect((await directory.list()).find(lobby => lobby.roomId === id)?.hostName).toBe('Host');
  await directory.update(id, 11, null); await directory.update(id, 10, report); await directory.update(id, 11, report);
  expect((await directory.list()).some(lobby => lobby.roomId === id)).toBe(false);
  await directory.update(id, 12, report);
  await runInDurableObject(directory, async (_instance: LobbyDirectory, state) => { state.storage.sql.exec('UPDATE lobbies SET expires = ? WHERE id = ?', Date.now() - 1, id); });
  expect((await directory.list()).some(lobby => lobby.roomId === id)).toBe(false);
});
it('defaults restored old rooms to private and rejects invalid table visibility', async () => {
  const first = await create();
  await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (_instance, state) => {
    const room = await state.storage.get<import('../src/roomState').OnlineRoom>('room'); delete room!.visibility; delete room!.gameId; await state.storage.put('room', room);
  });
  const response = await http(`/${first.session.inviteId}/resume`, first.session);
  expect((await response.json<{ snapshot: SessionResponse['snapshot'] }>()).snapshot.room).toMatchObject({ visibility: 'private', gameId: 'blackjack' });
  const invalid = await http('', undefined, { name: 'Host', visibility: 'secret' }); expect(invalid.status).toBe(400);
});

it.each(['private', 'public'] as const)('deletes a %s room, chat and alarm after the last Leave acknowledgement', async visibility => {
  const response = await http('', undefined, { name: 'Host', visibility });
  expect(response.status).toBe(201); const first = await response.json<SessionResponse>();
  const second = await join(first.session.inviteId); const a = await connect(first.session); const b = await connect(second.session);
  const stub = bindings.ROOMS.getByName(first.session.inviteId);
  try {
    if (visibility === 'public') await expect.poll(async () => (await listed()).some(lobby => lobby.roomId === first.session.inviteId)).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => { await state.storage.put({ chat: { messages: [] }, extra: 'temporary room metadata' }); });
    expect(await a.send({ type: 'Leave' })).toMatchObject({ type: 'ack' });
    expect((await b.last()).players).toHaveLength(1);
    expect(await b.send({ type: 'Leave' })).toMatchObject({ type: 'ack' });
    expect(await runInDurableObject(stub, async (_instance, state) => ({ keys: (await state.storage.list()).size, alarm: await state.storage.getAlarm() }))).toEqual({ keys: 0, alarm: null });
    if (visibility === 'public') await expect.poll(async () => (await listed()).some(lobby => lobby.roomId === first.session.inviteId)).toBe(false);
    for (const [operation, method, body] of [['join', 'POST', { name: 'Late' }], ['resume', 'POST', undefined], ['snapshot', 'GET', undefined]] as const) {
      const rejected = await http(`/${first.session.inviteId}/${operation}`, first.session, body, method);
      expect(rejected.status).toBe(404); expect(await rejected.json()).toMatchObject({ code: 'ROOM_EXPIRED' });
    }
    await evictDurableObject(stub); await runDurableObjectAlarm(stub);
    expect(await runInDurableObject(stub, (_instance, state) => state.storage.get('room'))).toBeUndefined();
  } finally { await close(a, b); }
});
