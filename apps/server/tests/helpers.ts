import { env } from 'cloudflare:workers';
import { SELF, runInDurableObject } from 'cloudflare:test';
import { createDecks, type Rank } from '@casual/engine';
import { expect } from 'vitest';
import type { Command, GuestSession, ServerEvent, SessionResponse, Snapshot } from '@casual/protocol';
import type { Env } from '../src/env';
import type { TableRoom } from '../src/tableRoom';
import type { OnlineRoom } from '../src/roomState';

export const origin = 'http://127.0.0.1:5173';
export const bindings = env as unknown as Env;
export async function http(path: string, session?: GuestSession, body?: unknown, method = 'POST') {
  return SELF.fetch(`https://example.test/api/v1/rooms${path}`, { method,
    headers: { Origin: origin, ...(session ? { Authorization: `Bearer ${session.credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
export async function create(name = 'Alex') { const response = await http('', undefined, { name }); expect(response.status).toBe(201); return response.json<SessionResponse>(); }
export async function join(invite: string, name = 'Alex') { const response = await http(`/${invite}/join`, undefined, { name }); expect(response.status).toBe(201); return response.json<SessionResponse>(); }
export async function snapshot(session: GuestSession) { const response = await http(`/${session.inviteId}/snapshot`, session, undefined, 'GET'); expect(response.status).toBe(200); return (await response.json<{ snapshot: Snapshot }>()).snapshot; }
export interface Peer { ws: WebSocket; events: ServerEvent[]; session: GuestSession; claimId: string; last(): Promise<Snapshot>; send(action: Command['action'], overrides?: Partial<Command>): Promise<ServerEvent> }
export async function connect(session: GuestSession, claim: { claimId: string; controllerId?: string } = { claimId: crypto.randomUUID() }): Promise<Peer> {
  const claimVersion = await inspect(session.inviteId, room => room.members[session.playerId]!.claimVersion);
  const ticketResponse = await http(`/${session.inviteId}/ticket`, session, { ...claim, claimVersion }); expect(ticketResponse.status).toBe(200);
  const { ticket } = await ticketResponse.json<{ ticket: string }>();
  const response = await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`, { headers: { Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `casual-v1, ticket.${ticket}` } });
  expect(response.status).toBe(101); const ws = response.webSocket!; ws.accept();
  const events: ServerEvent[] = []; ws.addEventListener('message', event => { events.push(JSON.parse(String(event.data)) as ServerEvent); });
  return { ws, events, session, claimId: claim.claimId, last: () => snapshot(session),
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
export async function close(...peers: Peer[]) { for (const peer of peers) peer.ws.close(1000, 'test complete'); await new Promise(resolve => setTimeout(resolve, 20)); }
export async function inspect<R>(invite: string, callback: (room: OnlineRoom) => R): Promise<R> {
  return runInDurableObject(bindings.ROOMS.getByName(invite), async (_instance: TableRoom, state: DurableObjectState) => callback((await state.storage.get<OnlineRoom>('room'))!));
}
export async function edit(invite: string, callback: (room: OnlineRoom) => void) {
  await runInDurableObject(bindings.ROOMS.getByName(invite), async (_instance, state) => { const room = (await state.storage.get<OnlineRoom>('room'))!; callback(room); await state.storage.put('room', room); });
}
export async function rigShoe(invite: string, ranks: Rank[]) {
  const rest = createDecks(); const cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
  await edit(invite, room => { room.engine.shoe.cards = cards; });
}
