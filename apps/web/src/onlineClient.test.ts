import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoom, project } from '@casual/engine';
import type { GameClient, ServerEvent, SessionResponse, Snapshot } from '@casual/protocol';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeSocket.instances.push(this); }
  send(message: string) { this.sent.push(message); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  emit(message: ServerEvent | unknown) { this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent); }
}
const controllerOne = '11111111-1111-4111-8111-111111111111';
const controllerTwo = '22222222-2222-4222-8222-222222222222';
const clients: GameClient[] = [];
let fetcher: ReturnType<typeof vi.fn>;
let browserWindow: EventTarget;
let network: { onLine: boolean };
function initial(): SessionResponse {
  const snapshot = project(createRoom('Guest', max => max - 1, Date.now()), 'practice-player');
  snapshot.room = { inviteId: 'a'.repeat(32), managerPlayerId: 'practice-player', bettingOpen: false, bettingDeadline: null, insuranceDeadline: null, claimVersion: 0 };
  return { snapshot, session: { inviteId: 'a'.repeat(32), playerId: 'practice-player', credential: 'b'.repeat(64) } };
}
function deliver(socket: FakeSocket, snapshot: Snapshot, revision: number, controllerId = controllerOne) {
  socket.emit({ type: 'connected', controllerId, serverTime: Date.now() });
  socket.emit({ type: 'snapshot', snapshot: { ...snapshot, revision }, serverTime: Date.now() });
}
async function start() {
  const { createOnlineClient } = await import('./onlineClient'); const response = initial();
  const client = createOnlineClient(response); clients.push(client); await vi.advanceTimersByTimeAsync(0);
  const socket = FakeSocket.instances.at(-1)!; deliver(socket, response.snapshot, 1);
  return { client, socket, snapshot: response.snapshot };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T00:00:00Z')); vi.resetModules();
  FakeSocket.instances = []; browserWindow = new EventTarget(); network = { onLine: true };
  vi.stubGlobal('window', browserWindow); vi.stubGlobal('navigator', network); vi.stubGlobal('location', { protocol: 'http:', hostname: '127.0.0.1' });
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(() => null) }); vi.stubGlobal('WebSocket', FakeSocket);
  fetcher = vi.fn(async () => Response.json({ ticket: 'c'.repeat(64) })); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('ignores late messages from a superseded connection and restores a full revision gap', async () => {
  const { client, socket, snapshot } = await start(); socket.close(); await vi.advanceTimersByTimeAsync(500);
  const replacement = FakeSocket.instances.at(-1)!; expect(replacement).not.toBe(socket); deliver(replacement, snapshot, 7, controllerTwo);
  socket.emit({ type: 'snapshot', snapshot: { ...snapshot, revision: 99 }, serverTime: Date.now() });
  expect(client.getSnapshot().revision).toBe(7); expect(client.getConnection().status).toBe('connected');
  const task = client.send({ type: 'PlaceBet', amount: 40 });
  const command = JSON.parse(replacement.sent.at(-1)!) as { id: string };
  socket.emit({ type: 'error', commandId: command.id, code: 'INVALID_ACTION', message: 'Old callback' });
  replacement.emit({ type: 'ack', commandId: command.id, revision: 8 }); await expect(task).resolves.toBeUndefined();
});
it('keeps heartbeats running even while other players send frequent snapshots', async () => {
  const { client, socket, snapshot } = await start();
  await vi.advanceTimersByTimeAsync(9000);
  socket.emit({ type: 'snapshot', snapshot: { ...snapshot, revision: 2 }, serverTime: Date.now() });
  await vi.advanceTimersByTimeAsync(1000); expect(socket.sent).toContain('ping'); expect(client.getConnection().status).toBe('connected');
});
it('an unacknowledged action is never replayed and its old timer cannot close the recovered socket', async () => {
  const { client, socket, snapshot } = await start();
  const task = client.send({ type: 'Hit' }); const rejected = expect(task).rejects.toThrow('unconfirmed');
  await vi.advanceTimersByTimeAsync(10_500); await rejected;
  const replacement = FakeSocket.instances.at(-1)!; deliver(replacement, snapshot, 4, controllerTwo);
  expect(replacement.sent).toEqual([]);
  const reconnectBody = JSON.parse(String(fetcher.mock.calls[1]![1].body)) as { claimId: string; controllerId: string };
  const firstBody = JSON.parse(String(fetcher.mock.calls[0]![1].body)) as { claimId: string };
  expect(reconnectBody.controllerId).toBe(controllerOne); expect(reconnectBody.claimId).toBe(firstBody.claimId);
  socket.emit({ type: 'replaced', message: 'Late old event' }); expect(client.getConnection().status).toBe('connected'); expect(replacement.readyState).toBe(1);
});
it('disposing a pending ticket request never creates a ghost controlling connection', async () => {
  let resolveTicket!: (value: Response) => void;
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { resolveTicket = resolve; }));
  const { createOnlineClient } = await import('./onlineClient'); const client = createOnlineClient(initial()); clients.push(client);
  client.dispose(); resolveTicket(Response.json({ ticket: 'c'.repeat(64) })); await vi.advanceTimersByTimeAsync(0);
  expect(FakeSocket.instances).toHaveLength(0);
});
it('replacement and incompatible data are terminal; focus and online events cannot steal the seat back', async () => {
  const { client, socket } = await start(); socket.emit({ type: 'replaced', message: 'A newer tab controls this seat.' });
  browserWindow.dispatchEvent(new Event('online')); browserWindow.dispatchEvent(new Event('focus')); client.reconnect?.(); await vi.advanceTimersByTimeAsync(60_000);
  expect(client.getConnection().status).toBe('replaced'); expect(fetcher).toHaveBeenCalledTimes(1);
  const another = await start(); another.socket.emit({ type: 'snapshot', snapshot: { protocol: 99 } });
  expect(another.client.getConnection().status).toBe('incompatible');
});
it('an offline event stops actions immediately and resumes only on the current connection attempt', async () => {
  const { client, socket, snapshot } = await start(); network.onLine = false;
  browserWindow.dispatchEvent(new Event('offline')); await expect(client.send({ type: 'Hit' })).rejects.toThrow('Reconnect');
  expect(client.getConnection().status).toBe('offline'); expect(socket.readyState).toBe(3);
  network.onLine = true; browserWindow.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0);
  const replacement = FakeSocket.instances.at(-1)!; deliver(replacement, snapshot, 5, controllerTwo); expect(client.getConnection().status).toBe('connected');
});
