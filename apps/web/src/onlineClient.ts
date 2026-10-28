import { serverEventSchema, sessionResponseSchema, snapshotSchema, type Action, type ConnectionInfo, type GameClient, type GuestSession, type SessionResponse } from '@casual/protocol';

const apiBase = (import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:8787`).replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request(path: string, options: { session?: GuestSession; body?: unknown; method?: string; signal?: AbortSignal } = {}): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.session) headers.Authorization = `Bearer ${options.session.credential}`;
  const controller = new AbortController(); const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 10_000);
  try {
    let response: Response;
    try { response = await fetch(`${apiBase}/api/v1/rooms${path}`, { method: options.method ?? 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store', signal: controller.signal }); }
    catch { throw new ApiError('OFFLINE', 'The table service is unreachable. Check your connection and try again.'); }
    let json: { code?: string; message?: string };
    try { json = await response.json() as { code?: string; message?: string }; }
    catch { throw new ApiError('REQUEST_FAILED', 'The table service returned an invalid response. Please try again later.'); }
    if (!response.ok) throw new ApiError(json.code ?? 'REQUEST_FAILED', json.message ?? 'The table service could not complete your request.');
    return json;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
function parseSession(value: unknown) {
  const result = sessionResponseSchema.safeParse(value);
  if (!result.success) throw new ApiError('CLIENT_INCOMPATIBLE', 'This app version cannot read the table response. Refresh and try again.');
  return result.data;
}
export async function createGuest(name: string) { return parseSession(await request('', { body: { name } })); }
export async function joinGuest(invite: string, name: string) { return parseSession(await request(`/${invite}/join`, { body: { name } })); }
export async function resumeGuest(session: GuestSession, signal?: AbortSignal): Promise<SessionResponse> {
  const response = await request(`/${session.inviteId}/resume`, { session, signal }) as { snapshot: unknown };
  const parsed = snapshotSchema.safeParse(response.snapshot);
  if (!parsed.success) throw new ApiError('CLIENT_INCOMPATIBLE', 'This app version cannot restore your table. Refresh and try again.');
  return { session, snapshot: parsed.data };
}
export function savedSession(invite: string): GuestSession | null {
  try { const value = JSON.parse(localStorage.getItem(`casual-room:${invite}`) ?? 'null') as GuestSession | null;
    return value?.inviteId === invite && /^[a-f0-9]{64}$/.test(value.credential) && typeof value.playerId === 'string' ? value : null;
  } catch { return null; }
}
export function createOnlineClient(initial: SessionResponse): GameClient {
  const { session } = initial;
  try { localStorage.setItem(`casual-room:${session.inviteId}`, JSON.stringify(session)); } catch { /* The live seat still works without persistent browser storage. */ }
  let snapshot = initial.snapshot;
  let connection: ConnectionInfo = { status: 'connecting', message: 'Connecting to your table…' };
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const claimId = crypto.randomUUID();
  const claimVersion = initial.snapshot.room?.claimVersion ?? 0;
  let controllerId: string | undefined;
  let socket: WebSocket | undefined; let disposed = false; let terminal = false;
  let retry: ReturnType<typeof setTimeout> | undefined; let attempt = 0; let generation = 0;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined; let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let ticketRequest: AbortController | undefined; let lastReceived = Date.now();
  function notify() { for (const listener of listeners) listener(); }
  function setConnection(status: ConnectionInfo['status'], message: string) { connection = { ...connection, status, message }; notify(); }
  function rejectPending(message: string) {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(message)); }
    pending.clear();
  }
  function acceptSnapshot(value: unknown) {
    const next = snapshotSchema.parse(value);
    if (next.you !== session.playerId || next.room?.inviteId !== session.inviteId) throw new Error('Snapshot belongs to another seat.');
    // Every event is a complete snapshot, so revision gaps recover in one replacement.
    if (next.revision >= snapshot.revision) { snapshot = next; notify(); }
  }
  function stopAttempt() {
    generation++; ticketRequest?.abort(); ticketRequest = undefined;
    clearTimeout(retry); clearTimeout(handshakeTimer); clearTimeout(heartbeat);
    const old = socket; socket = undefined;
    try { old?.close(1000, 'Reconnecting'); } catch { /* A failed opening socket may already be closed. */ }
  }
  function fail(code: string, message: string) {
    terminal = true; stopAttempt(); rejectPending(message);
    const status = code === 'SESSION_REPLACED' ? 'replaced' : code === 'ROOM_EXPIRED' ? 'expired' : ['SESSION_INVALID', 'SESSION_EXPIRED'].includes(code) ? 'invalid' : 'incompatible';
    setConnection(status, message);
  }
  function lost(message: string) {
    if (disposed || terminal) return;
    stopAttempt(); rejectPending('Connection lost. Your action is unconfirmed; the current table will be restored.');
    if (!navigator.onLine) { setConnection('offline', 'You’re offline. Reconnect to restore your reserved seat.'); return; }
    setConnection('reconnecting', message);
    retry = setTimeout(() => void connect(), Math.min(10_000, 500 * 2 ** Math.min(attempt++, 5)));
  }
  function scheduleHeartbeat(current: WebSocket, version: number) {
    clearTimeout(heartbeat);
    heartbeat = setTimeout(() => {
      if (disposed || terminal || socket !== current || generation !== version) return;
      if (Date.now() - lastReceived >= 25_000) { lost('Checking your connection… Actions are paused.'); return; }
      try { current.send('ping'); scheduleHeartbeat(current, version); }
      catch { lost('Reconnecting… Actions are paused.'); }
    }, 10_000);
  }
  async function connect() {
    if (disposed || terminal) return;
    stopAttempt(); const version = generation;
    if (!navigator.onLine) { setConnection('offline', 'You’re offline. Reconnect to restore your reserved seat.'); return; }
    ticketRequest = new AbortController();
    try {
      const response = await request(`/${session.inviteId}/ticket`, { session, body: { claimId, controllerId, claimVersion }, signal: ticketRequest.signal }) as { ticket: string };
      if (disposed || terminal || version !== generation) return;
      if (!/^[a-f0-9]{64}$/.test(response.ticket)) { fail('CLIENT_INCOMPATIBLE', 'The table returned an invalid connection response. Refresh to reconnect.'); return; }
      const url = new URL(`${apiBase}/api/v1/rooms/${session.inviteId}/socket`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const current = new WebSocket(url, ['casual-v1', `ticket.${response.ticket}`]); socket = current;
      const active = () => !disposed && !terminal && socket === current && version === generation;
      handshakeTimer = setTimeout(() => { if (active()) lost('The connection timed out. Retrying…'); }, 10_000);
      current.onmessage = event => {
        if (!active()) return;
        try {
          const message = serverEventSchema.parse(JSON.parse(String(event.data)));
          lastReceived = Date.now();
          if (message.type === 'connected') { controllerId = message.controllerId; return; }
          if (message.type === 'pong') { connection = { ...connection, clockOffsetMs: message.serverTime - Date.now() }; return; }
          if (message.type === 'snapshot') {
            const becameConnected = connection.status !== 'connected';
            connection = { ...connection, clockOffsetMs: message.serverTime - Date.now() };
            acceptSnapshot(message.snapshot); attempt = 0; clearTimeout(handshakeTimer);
            setConnection('connected', 'Connected · Live table'); if (becameConnected) scheduleHeartbeat(current, version);
          } else if (message.type === 'ack') {
            const task = pending.get(message.commandId);
            if (task) { clearTimeout(task.timer); pending.delete(message.commandId); task.resolve(); }
          } else if (message.type === 'error') {
            if (['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REPLACED', 'ROOM_EXPIRED', 'CLIENT_INCOMPATIBLE', 'ROOM_VERSION_UNSUPPORTED', 'ROOM_STATE_INVALID'].includes(message.code)) { fail(message.code, message.message); return; }
            if (message.snapshot) acceptSnapshot(message.snapshot);
            const task = message.commandId ? pending.get(message.commandId) : undefined;
            if (task) { clearTimeout(task.timer); pending.delete(message.commandId!); task.reject(new ApiError(message.code, message.message)); }
          } else if (message.type === 'replaced') {
            fail('SESSION_REPLACED', message.message);
          }
        } catch { fail('CLIENT_INCOMPATIBLE', 'The table sent incompatible data. Refresh or create another table.'); }
      };
      current.onerror = () => { /* onclose performs snapshot recovery through a fresh ticket. */ };
      current.onclose = () => {
        if (active()) lost('Reconnecting… Actions are paused.');
      };
    } catch (error) {
      if (disposed || terminal || version !== generation) return;
      if (error instanceof ApiError && ['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REPLACED', 'ROOM_EXPIRED', 'CLIENT_INCOMPATIBLE', 'ROOM_VERSION_UNSUPPORTED', 'ROOM_STATE_INVALID'].includes(error.code)) { fail(error.code, error.message); return; }
      lost('The table service is unreachable. Retrying…');
    }
  }
  const wentOffline = () => lost('You’re offline. Reconnect to restore your reserved seat.');
  const wentOnline = () => { if (!terminal && !disposed && connection.status !== 'connected') void connect(); };
  const focused = () => {
    if (disposed || terminal) return;
    if (connection.status !== 'connected') { wentOnline(); return; }
    if (Date.now() - lastReceived >= 25_000) { lost('Checking your connection…'); return; }
    try { socket?.send('ping'); socket?.send('snapshot'); } catch { lost('Reconnecting… Actions are paused.'); }
  };
  window.addEventListener('offline', wentOffline); window.addEventListener('online', wentOnline); window.addEventListener('focus', focused);
  void connect();
  return {
    getSnapshot: () => snapshot, getConnection: () => connection,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send(action: Action) {
      if (disposed || connection.status !== 'connected' || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Reconnect before playing. Your action was not sent.'));
      const id = crypto.randomUUID();
      const target = socket; const version = generation;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Your action is unconfirmed. Reconnecting to check the current table.')); if (target === socket && version === generation) lost('Checking the current table…'); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        try { socket!.send(JSON.stringify({ protocol: 1, id, revision: snapshot.revision, roundId: snapshot.roundId, playerId: session.playerId, handId: snapshot.activeHandId ?? undefined, action })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error('Your action could not be sent. Please reconnect.')); }
      });
    },
    reconnect() { if (!disposed && !terminal && connection.status !== 'connected') void connect(); },
    dispose() {
      disposed = true; stopAttempt(); rejectPending('You left the table.'); listeners.clear();
      window.removeEventListener('offline', wentOffline); window.removeEventListener('online', wentOnline); window.removeEventListener('focus', focused);
    },
  };
}
