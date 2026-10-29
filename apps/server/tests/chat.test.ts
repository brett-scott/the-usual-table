import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { ChatMessage, ServerEvent } from '@casual/protocol';
import { bindings, close, connect, create, inspect, join, rigShoe, type Peer } from './helpers';

async function message(peer: Peer, text: unknown, id = crypto.randomUUID(), extra = {}) {
  const result = new Promise<ServerEvent>(resolve => {
    const listener = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data)) as ServerEvent;
      if ((data.type === 'ack' || data.type === 'error') && data.commandId === id) { peer.ws.removeEventListener('message', listener); resolve(data); }
    }; peer.ws.addEventListener('message', listener);
  });
  peer.ws.send(JSON.stringify({ type: 'chat', protocol: 1, id, text, ...extra })); return result;
}
function history(peer: Peer): ChatMessage[] { return peer.events.filter(event => event.type === 'chat').at(-1)?.messages ?? []; }

it('shares chat only with capable current table guests and preserves game state/deadlines', async () => {
  const first = await create('Alex'); const second = await join(first.session.inviteId, 'Alex'); const other = await create('Other table');
  const a = await connect(first.session, undefined, true); const b = await connect(second.session, undefined, true); const c = await connect(other.session, undefined, true);
  const legacyGuest = await join(first.session.inviteId, 'Old client'); const legacy = await connect(legacyGuest.session);
  try {
    await rigShoe(first.session.inviteId, ['2', '3', '4', '6', '2', '3', '4', '10']);
    await a.send({ type: 'StartBetting' });
    for (const peer of [a, b, legacy]) await peer.send({ type: 'Ready' });
    expect((await a.last()).phase).toBe('PLAYER_TURNS');
    const before = await inspect(first.session.inviteId, room => ({ engine: room.engine, revision: room.revision }));
    expect((await message(a, '  Hello <script>alert(1)</script>  ')).type).toBe('ack');
    await expect.poll(() => history(b).length).toBe(1);
    expect(history(b)[0]).toMatchObject({ playerId: first.session.playerId, name: 'Alex', seat: 0, text: 'Hello <script>alert(1)</script>' });
    expect(history(c)).toEqual([]); expect(legacy.events.some(event => event.type === 'chat')).toBe(false);
    expect(await inspect(first.session.inviteId, room => ({ engine: room.engine, revision: room.revision }))).toEqual(before);
    expect(await message(a, 'spoof', crypto.randomUUID(), { playerId: second.session.playerId })).toMatchObject({ type: 'error', code: 'INVALID_CHAT' });
    expect(await message(a, '   ')).toMatchObject({ type: 'error', code: 'INVALID_CHAT' });
    expect(await message(a, 'x'.repeat(301))).toMatchObject({ type: 'error', code: 'INVALID_CHAT' });
  } finally { await close(a, b, c, legacy); }
});

it('keeps gameplay available when chat storage cannot be restored, and removes chat on idle expiry', async () => {
  const first = await create(); const a = await connect(first.session, undefined, true);
  try {
    await message(a, 'Saved');
    await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (_instance, state) => { await state.storage.put('chat', { schema: 99 }); });
    a.ws.send('snapshot');
    await expect.poll(() => a.events.some(event => event.type === 'error' && event.code === 'CHAT_UNAVAILABLE')).toBe(true);
    expect((await a.send({ type: 'StartBetting' })).type).toBe('ack');
  } finally { await close(a); }
  await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (instance, state) => {
    const room = await state.storage.get<import('../src/roomState').OnlineRoom>('room');
    room!.lastActivity = Date.now() - 25 * 60 * 60 * 1000; await state.storage.put('room', room);
    await instance.alarm();
    expect(await state.storage.get('chat')).toBeUndefined(); expect(await state.storage.get('room')).toBeUndefined();
  });
});

it('deduplicates retries, bounds flooding independently from actions and keeps history after hibernation', async () => {
  const first = await create(); const a = await connect(first.session, undefined, true);
  try {
    const id = crypto.randomUUID(); await message(a, 'Once', id); await message(a, 'Once', id);
    expect(history(a)).toHaveLength(1);
    for (let index = 0; index < 4; index++) expect((await message(a, `Message ${index}`)).type).toBe('ack');
    expect(await message(a, 'Too fast')).toMatchObject({ type: 'error', code: 'CHAT_RATE_LIMITED' });
    expect((await a.send({ type: 'StartBetting' })).type).toBe('ack');
    await evictDurableObject(bindings.ROOMS.getByName(first.session.inviteId));
    const second = await join(first.session.inviteId, 'Late guest'); const b = await connect(second.session, undefined, true);
    try { await expect.poll(() => history(b).length).toBe(5); expect(history(b)[0]!.text).toBe('Once'); }
    finally { await close(b); }
  } finally { await close(a); }
});

it('keeps at most 50 messages and rejects a displaced controller', async () => {
  const first = await create(); const a = await connect(first.session, undefined, true);
  const controllerId = await inspect(first.session.inviteId, room => room.members[first.session.playerId]!.controllerId!);
  try {
    for (let index = 0; index < 55; index++) {
      if (index % 5 === 0) await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async (_instance, state) => {
        const chat = await state.storage.get<{ rates: Record<string, { start: number; count: number }> }>('chat');
        if (chat) { chat.rates = {}; await state.storage.put('chat', chat); }
      });
      expect((await message(a, `Message ${index}`)).type).toBe('ack');
    }
    expect(history(a)).toHaveLength(50); expect(history(a)[0]!.text).toBe('Message 5');
    const b = await connect(first.session, undefined, true);
    try {
      const errors: ServerEvent[] = [];
      await runInDurableObject(bindings.ROOMS.getByName(first.session.inviteId), async instance => {
        await instance.webSocketMessage({ deserializeAttachment: () => ({ playerId: first.session.playerId, controllerId, chat: true }), send: (value: string) => errors.push(JSON.parse(value) as ServerEvent) } as unknown as WebSocket, JSON.stringify({ type: 'chat', protocol: 1, id: crypto.randomUUID(), text: 'Old controller' }));
      });
      expect(errors[0]).toMatchObject({ type: 'error', code: 'SESSION_INVALID' }); expect(history(b).some(item => item.text === 'Old controller')).toBe(false);
    } finally { await close(b); }
  } finally { await close(a); }
});
