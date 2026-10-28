import { env } from 'cloudflare:workers';
import { SELF, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { createDecks, type Rank } from '@casual/engine';
import { describe, expect, it } from 'vitest';
import type { Command, GuestSession, ServerEvent, SessionResponse, Snapshot } from '@casual/protocol';
import type { Env } from '../src/env';
import type { TableRoom } from '../src/tableRoom';
import type { OnlineRoom } from '../src/roomState';

const origin = 'http://127.0.0.1:5173';
const bindings = env as unknown as Env;

it('bounds streamed HTTP bodies before forwarding an expired invitation', async () => {
  for (const [text, code] of [[JSON.stringify({ name: 'Guest' }), 'ROOM_EXPIRED'], ['x'.repeat(8193), 'MESSAGE_TOO_LARGE']] as const) {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      const bytes = new TextEncoder().encode(text);
      controller.enqueue(bytes.slice(0, 10)); controller.enqueue(bytes.slice(10)); controller.close();
    } });
    const response = await SELF.fetch(`https://example.test/api/v1/rooms/${'0'.repeat(32)}/join`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: stream });
    expect(response.status).toBe(code === 'ROOM_EXPIRED' ? 404 : 400);
    expect(await response.json()).toMatchObject({ code });
  }
});

async function http(path: string, session?: GuestSession, body?: unknown, method = 'POST') {
  return SELF.fetch(`https://example.test/api/v1/rooms${path}`, { method,
    headers: { Origin: origin, ...(session ? { Authorization: `Bearer ${session.credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function create(name = 'Alex') { const response = await http('', undefined, { name }); expect(response.status).toBe(201); return response.json<SessionResponse>(); }
async function join(invite: string, name = 'Alex') { const response = await http(`/${invite}/join`, undefined, { name }); expect(response.status).toBe(201); return response.json<SessionResponse>(); }
async function snapshot(session: GuestSession) { const response = await http(`/${session.inviteId}/snapshot`, session, undefined, 'GET'); expect(response.status).toBe(200); return (await response.json<{ snapshot: Snapshot }>()).snapshot; }
interface Peer { ws: WebSocket; events: ServerEvent[]; session: GuestSession; last(): Promise<Snapshot>; send(action: Command['action'], overrides?: Partial<Command>): Promise<ServerEvent> }
async function connect(session: GuestSession): Promise<Peer> {
  const claimVersion = await inspect(session.inviteId, room => room.members[session.playerId]!.claimVersion);
  const ticketResponse = await http(`/${session.inviteId}/ticket`, session, { claimId: crypto.randomUUID(), claimVersion }); const { ticket } = await ticketResponse.json<{ ticket: string }>();
  const response = await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`, { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `casual-v1, ticket.${ticket}` } });
  expect(response.status).toBe(101); const ws = response.webSocket!; ws.accept();
  const events: ServerEvent[] = []; ws.addEventListener('message', event => { events.push(JSON.parse(String(event.data)) as ServerEvent); });
  return { ws, events, session, last: () => snapshot(session),
    async send(action, overrides = {}) {
      const state = await snapshot(session); const id = crypto.randomUUID();
      const command: Command = { protocol: 1, id, revision: state.revision, roundId: state.roundId, handId: state.activeHandId ?? undefined, playerId: session.playerId, action, ...overrides };
      const result = new Promise<ServerEvent>(resolve => {
        const listener = (event: MessageEvent) => { const message = JSON.parse(String(event.data)) as ServerEvent;
          if ((message.type === 'ack' || message.type === 'error') && message.commandId === command.id) { ws.removeEventListener('message', listener); resolve(message); }
        }; ws.addEventListener('message', listener);
      }); ws.send(JSON.stringify(command)); return result;
    },
  };
}
async function close(...peers: Peer[]) { for (const peer of peers) peer.ws.close(1000, 'test complete'); await new Promise(resolve => setTimeout(resolve, 20)); }
async function inspect<R>(invite: string, callback: (room: OnlineRoom) => R): Promise<R> {
  return runInDurableObject(bindings.ROOMS.getByName(invite), async (_instance: TableRoom, state: DurableObjectState) => callback((await state.storage.get<OnlineRoom>('room'))!));
}
async function rigShoe(invite: string, ranks: Rank[]) {
  const rest = createDecks(); const cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
  await runInDurableObject(bindings.ROOMS.getByName(invite), async (_instance, state) => {
    const room = (await state.storage.get<OnlineRoom>('room'))!; room.engine.shoe.cards = cards; await state.storage.put('room', room);
  });
}

describe('authoritative guest rooms', () => {
  it('creates four unique seats with duplicate names and rejects a fifth', async () => {
    const first = await create(); const guests = [first, await join(first.session.inviteId), await join(first.session.inviteId), await join(first.session.inviteId)];
    expect(new Set(guests.map(g => g.session.playerId)).size).toBe(4);
    const full = await http(`/${first.session.inviteId}/join`, undefined, { name: 'Fifth' }); expect(full.status).toBe(409); expect(await full.json()).toMatchObject({ code: 'TABLE_FULL' });
    const state = await snapshot(first.session); expect(state.players.map(p => p.seat)).toEqual([0, 1, 2, 3]);
    expect(state.players.every(p => p.name === 'Alex')).toBe(true);
    const stored = await inspect(first.session.inviteId, room => JSON.stringify(room));
    for (const guest of guests) expect(stored).not.toContain(guest.session.credential);
  });
  it('rejects bad origins, invalid sessions, invalid names and oversized messages', async () => {
    const denied = await SELF.fetch('https://example.test/api/v1/rooms', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Alex' }) }); expect(denied.status).toBe(403);
    expect((await http('', undefined, { name: '<'.repeat(25) })).status).toBe(400);
    const first = await create(); const invalid = await http(`/${first.session.inviteId}/snapshot`, { ...first.session, credential: 'f'.repeat(64) }, undefined, 'GET'); expect(invalid.status).toBe(401);
    expect((await http('', undefined, { name: 'x'.repeat(9000) })).status).toBe(400);
  });
  it('resumes the same seat and requires fresh single-use socket tickets', async () => {
    const first = await create(); const response = await http(`/${first.session.inviteId}/resume`, first.session); expect(response.status).toBe(200);
    expect((await response.json<{ snapshot: Snapshot }>()).snapshot.you).toBe(first.session.playerId);
    const ticketResponse = await http(`/${first.session.inviteId}/ticket`, first.session, { claimId: crypto.randomUUID(), claimVersion: 0 }); const { ticket } = await ticketResponse.json<{ ticket: string }>();
    const options = { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `casual-v1, ticket.${ticket}` } };
    const connected = await SELF.fetch(`https://example.test/api/v1/rooms/${first.session.inviteId}/socket`, options); expect(connected.status).toBe(101); connected.webSocket!.accept();
    const reused = await SELF.fetch(`https://example.test/api/v1/rooms/${first.session.inviteId}/socket`, options); expect(reused.status).toBe(401); connected.webSocket!.close();
  });
  it('locks wagers, rejects wrong-seat and stale commands, and completes a shared round', async () => {
    const first = await create(); const second = await join(first.session.inviteId);
    const a = await connect(first.session); const b = await connect(second.session);
    try {
      expect(await b.send({ type: 'StartBetting' })).toMatchObject({ type: 'error', code: 'INVALID_ACTION' });
      expect(await a.send({ type: 'StartBetting' })).toMatchObject({ type: 'ack' });
      expect(await a.send({ type: 'PlaceBet', amount: 40 }, { playerId: second.session.playerId })).toMatchObject({ type: 'error', code: 'SESSION_INVALID' });
      const before = await a.last(); const commandId = crypto.randomUUID();
      expect(await a.send({ type: 'Ready' }, { id: commandId })).toMatchObject({ type: 'ack' });
      expect((await a.last()).players.find(p => p.id === first.session.playerId)!.balance).toBe(2000);
      expect(await a.send({ type: 'PlaceBet', amount: 40 })).toMatchObject({ type: 'error', code: 'INVALID_ACTION' });
      expect(await b.send({ type: 'Ready' }, { revision: before.revision })).toMatchObject({ type: 'error', code: 'STALE_STATE' });
      expect(await a.send({ type: 'Ready' }, { id: commandId, revision: 0 })).toMatchObject({ type: 'ack' });
      expect(await b.send({ type: 'Ready' })).toMatchObject({ type: 'ack' });
      let state = await a.last();
      if (state.phase !== 'ROUND_COMPLETE') {
        expect(state.dealer[1]).toEqual({ hidden: true });
        const json = JSON.stringify(state); expect(json).not.toContain('credential'); expect(json).not.toContain('cursor'); expect(json).not.toContain('tickets');
      }
      if (state.phase === 'INSURANCE') { await a.send({ type: 'InsuranceDecision', amount: 0 }); await b.send({ type: 'InsuranceDecision', amount: 0 }); }
      state = await a.last();
      for (let step = 0; state.phase !== 'ROUND_COMPLETE' && step < 10; step++) {
        const active = state.activePlayerId === first.session.playerId ? a : b;
        const other = active === a ? b : a;
        expect(await other.send({ type: 'Hit' })).toMatchObject({ type: 'error', code: 'INVALID_ACTION' });
        expect(await active.send({ type: 'Stand' })).toMatchObject({ type: 'ack' }); state = await a.last();
      }
      expect(state.phase).toBe('ROUND_COMPLETE'); const other = await b.last();
      expect(other.players).toEqual(state.players); expect(other.dealer).toEqual(state.dealer); expect(other.shoe).toEqual(state.shoe);
      const stored = await inspect(first.session.inviteId, room => room.engine.shoe.cursor);
      await a.send({ type: 'NextRound' }); expect((await a.last()).shoe.remaining).toBe(312 - stored);
    } finally { await close(a, b); }
  });
  it('persists an active deadline and applies a durable timeout alarm once', async () => {
    const first = await create(); const a = await connect(first.session);
    try {
      await rigShoe(first.session.inviteId, ['10', '10', '8', '7']);
      await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
      expect((await a.last()).phase).toBe('PLAYER_TURNS');
        const stub = bindings.ROOMS.getByName(first.session.inviteId);
        await runInDurableObject(stub, async (_instance, storageState) => { const room = (await storageState.storage.get<OnlineRoom>('room'))!; room.engine.decisionDeadline = Date.now() - 1; await storageState.storage.put('room', room); });
        await runDurableObjectAlarm(stub);
        const done = await a.last(); expect(done.phase).toBe('ROUND_COMPLETE'); expect(done.players[0]!.hands[0]!.timedOut).toBe(true);
        const balances = done.players.map(p => p.balance); await runDurableObjectAlarm(stub); expect((await a.last()).players.map(p => p.balance)).toEqual(balances);
    } finally { await close(a); }
  });
  it('deduplicates a Hit before stale checks, serializes simultaneous commands, and survives hibernation', async () => {
    const first = await create(); const a = await connect(first.session);
    try {
      await rigShoe(first.session.inviteId, ['2', '10', '3', '7', '2', '2']);
      await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
      const before = await a.last(); const id = crypto.randomUUID();
      const one = await a.send({ type: 'Hit' }, { id }); expect(one.type).toBe('ack');
      const after = await a.last(); expect(after.shoe.remaining).toBe(before.shoe.remaining - 1);
      const deadline = after.decisionDeadline;
      await a.send({ type: 'Hit' }, { id, revision: before.revision });
      expect((await a.last()).shoe).toEqual(after.shoe); expect((await a.last()).decisionDeadline).toBe(deadline);
      const simultaneous = await Promise.all([a.send({ type: 'Hit' }, { revision: after.revision }), a.send({ type: 'Stand' }, { revision: after.revision })]);
      expect(simultaneous.filter(event => event.type === 'ack')).toHaveLength(1);
      expect(simultaneous.filter(event => event.type === 'error' && event.code === 'STALE_STATE')).toHaveLength(1);
      const prior = await a.last(); const stub = bindings.ROOMS.getByName(first.session.inviteId);
      await evictDurableObject(stub);
      const resumed = await a.last(); expect(resumed.shoe).toEqual(prior.shoe); expect(resumed.players).toEqual(prior.players); expect(resumed.decisionDeadline).toEqual(prior.decisionDeadline);
      if (resumed.phase === 'PLAYER_TURNS') expect(await a.send({ type: 'Stand' })).toMatchObject({ type: 'ack' });
      expect((await a.last()).phase).toBe('ROUND_COMPLETE');
    } finally { await close(a); }
  });
  it('keeps the hole card and upcoming shoe private, and mid-round guests wait for the next round', async () => {
    const first = await create(); const a = await connect(first.session);
    try {
      await rigShoe(first.session.inviteId, ['2', '10', '3', '7', '2']); await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
      const state = await a.last(); const hole = await inspect(first.session.inviteId, room => room.engine.dealer[1]!.id);
      const upcoming = await inspect(first.session.inviteId, room => room.engine.shoe.cards[room.engine.shoe.cursor]!.id);
      expect(state.dealer[1]).toEqual({ hidden: true }); expect(JSON.stringify(state)).not.toContain(hole); expect(JSON.stringify(state)).not.toContain(upcoming);
      const joined = await join(first.session.inviteId, 'Late guest'); const b = await connect(joined.session);
      try {
        const late = await b.last(); expect(late.players.find(p => p.id === joined.session.playerId)!.hands).toHaveLength(0);
        expect(await b.send({ type: 'Ready' })).toMatchObject({ type: 'error', code: 'INVALID_ACTION' });
        await a.send({ type: 'Stand' }); await a.send({ type: 'NextRound' });
        expect((await b.last()).legalActions).toContain('Ready');
      } finally { await close(b); }
    } finally { await close(a); }
  });
  it('replaces a controlling connection and transfers host controls when the host leaves', async () => {
    const first = await create(); const second = await join(first.session.inviteId);
    const old = await connect(first.session); const b = await connect(second.session); const replacement = await connect(first.session);
    try {
      await new Promise(resolve => setTimeout(resolve, 20)); expect(old.events.some(e => e.type === 'replaced')).toBe(true);
      expect(await replacement.send({ type: 'Leave' })).toMatchObject({ type: 'ack' });
      const state = await b.last(); expect(state.players).toHaveLength(1); expect(state.room!.managerPlayerId).toBe(second.session.playerId);
      expect(await b.send({ type: 'StartBetting' })).toMatchObject({ type: 'ack' });
    } finally { await close(old, b, replacement); }
  });
  it('returns to the lobby without drawing when every player sits out', async () => {
    const first = await create(); const a = await connect(first.session);
    try {
      await a.send({ type: 'StartBetting' }); await a.send({ type: 'SitOut' });
      const state = await a.last(); expect(state.phase).toBe('BETTING'); expect(state.room!.bettingOpen).toBe(false);
      expect(state.shoe.remaining).toBe(312); expect(state.players[0]!.balance).toBe(2000); expect(state.players[0]!.hands).toHaveLength(0);
    } finally { await close(a); }
  });
  it('deals only locked wagers at the betting deadline', async () => {
    const first = await create(); const second = await join(first.session.inviteId); const a = await connect(first.session); const b = await connect(second.session);
    try {
      await rigShoe(first.session.inviteId, ['2', '10', '3', '7']);
      await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
      const stub = bindings.ROOMS.getByName(first.session.inviteId);
      await runInDurableObject(stub, async (_instance, state) => { const room = (await state.storage.get<OnlineRoom>('room'))!; room.bettingDeadline = Date.now() - 1; await state.storage.put('room', room); });
      await runDurableObjectAlarm(stub);
      const state = await a.last(); expect(state.phase).toBe('PLAYER_TURNS');
      expect(state.players.find(p => p.id === first.session.playerId)).toMatchObject({ balance: 1980 });
      expect(state.players.find(p => p.id === second.session.playerId)).toMatchObject({ balance: 2000, hands: [] });
    } finally { await close(a, b); }
  });
  it('declines insurance at its deadline before resolving the dealer peek', async () => {
    const first = await create(); const a = await connect(first.session);
    try {
      await rigShoe(first.session.inviteId, ['A', 'A', 'K', 'Q']); await a.send({ type: 'StartBetting' }); await a.send({ type: 'Ready' });
      expect((await a.last()).phase).toBe('INSURANCE'); expect((await a.last()).dealer[1]).toEqual({ hidden: true });
      const stub = bindings.ROOMS.getByName(first.session.inviteId);
      await runInDurableObject(stub, async (_instance, state) => { const room = (await state.storage.get<OnlineRoom>('room'))!; room.insuranceDeadline = Date.now() - 1; await state.storage.put('room', room); });
      await runDurableObjectAlarm(stub);
      const state = await a.last(); expect(state.phase).toBe('ROUND_COMPLETE'); expect(state.insurance).toEqual({ wager: 0, returned: 0 });
      expect(state.players[0]!.balance).toBe(2000); expect(state.players[0]!.hands[0]!.outcome).toBe('push');
    } finally { await close(a); }
  });
  it('preserves the active player when a mid-round guest takes a lower-numbered vacant seat', async () => {
    const first = await create(); const second = await join(first.session.inviteId);
    const a = await connect(first.session); const b = await connect(second.session);
    try {
      await a.send({ type: 'Leave' });
      await rigShoe(first.session.inviteId, ['2', '10', '3', '7']);
      await b.send({ type: 'StartBetting' }); await b.send({ type: 'Ready' });
      const before = await b.last(); expect(before.activePlayerId).toBe(second.session.playerId);
      const third = await join(first.session.inviteId, 'New seat one');
      const after = await b.last(); expect(after.players.find(p => p.id === third.session.playerId)!.seat).toBe(0);
      expect(after.activePlayerId).toBe(before.activePlayerId); expect(after.activeHandId).toBe(before.activeHandId); expect(after.decisionDeadline).toBe(before.decisionDeadline);
      expect(await b.send({ type: 'Stand' })).toMatchObject({ type: 'ack' }); expect((await b.last()).phase).toBe('ROUND_COMPLETE');
    } finally { await close(a, b); }
  });
});
