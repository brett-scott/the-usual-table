import { CHAT_CAPABILITY,GAME_ADAPTER_CAPABILITY,gameServerEventSchema,tableInfoSchema,tableSessionResponseSchema, chatTextSchema, lobbyListSchema, sessionResponseSchema, snapshotSchema, type GameId,type GameClientAdapter,type TableClient,type TableSessionResponse,type LobbyVisibility, type PlayerIcon, type ChatFeed, type ConnectionInfo, type GameClient, type GuestSession, type SessionResponse } from '@casual/protocol';
import { browserAuth } from './authClient';
import { blackjackClientAdapter } from './gameClientAdapters';

const apiBase = (import.meta.env.VITE_API_BASE_URL || `${location.protocol}//${location.hostname}:8787`).replace(/\/$/, '');
const temporarySessions = new Map<string, GuestSession>();
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request(path: string, options: { gameId?:GameId;session?: GuestSession; account?: boolean; body?: unknown; method?: string; signal?: AbortSignal } = {}): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.account || options.session?.funding === 'account') {
    try { headers.Authorization = `Bearer ${await browserAuth().accessToken()}`; }
    catch { throw new ApiError('ACCOUNT_SESSION_INVALID', 'Sign in again to use your saved chips.'); }
  } else if (options.session) headers.Authorization = `Bearer ${options.session.credential}`;
  const controller = new AbortController(); const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 10_000);
  try {
    let response: Response;
    try { response = await fetch(`${apiBase}/api/v1/${options.gameId?`games/${options.gameId}/rooms`:'rooms'}${path}`, { method: options.method ?? 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store', signal: controller.signal }); }
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
export async function createGuest(name: string, icon?: PlayerIcon, visibility?: LobbyVisibility) { return parseSession(await request('', { body: { name, icon, visibility } })); }
export async function createAccountTable(name: string, icon: PlayerIcon | undefined, visibility: LobbyVisibility, buyInUnits: number, entryId: string) {
  return parseSession(await request('', { account: true, body: { name, icon, visibility, funding: 'account', buyInUnits, entryId } }));
}
export async function joinAccountTable(invite: string, name: string, icon: PlayerIcon | undefined, buyInUnits: number, entryId: string) {
  return parseSession(await request(`/${invite}/join`, { account: true, body: { name, icon, funding: 'account', buyInUnits, entryId } }));
}
export async function listLobbies(signal?: AbortSignal,gameId:GameId='blackjack') {
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 8000);
  let response: Response;
  try { response = await fetch(`${apiBase}/api/v1/games/${gameId}/lobbies`, { signal: controller.signal, cache: 'no-store' }); }
  catch { throw new Error('The table browser is unavailable. You can still create a private table or play solo.'); }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  if (!response.ok) throw new Error(response.status === 429 ? 'Please wait a moment before refreshing tables.' : 'The table browser is unavailable. Try again shortly.');
  const parsed=lobbyListSchema.parse(await response.json());if(parsed.gameId!==gameId||parsed.lobbies.some(lobby=>lobby.gameId!==gameId))throw new Error('The table browser returned a different game.');
  return parsed.lobbies;
}
export async function tableInfo(invite:string,signal?:AbortSignal){const info=tableInfoSchema.parse(await request(`/${invite}/info`,{method:'GET',signal}));if(info.roomId!==invite)throw new ApiError('CLIENT_INCOMPATIBLE','This invitation returned another table.');return info;}
function parseGameSession<S,A>(value:unknown,adapter:GameClientAdapter<S,A>):TableSessionResponse<S>{
  const parsed=tableSessionResponseSchema(adapter.snapshotSchema).parse(value);
  if(parsed.gameId!==adapter.gameId||parsed.adapterVersion!==adapter.version)throw new ApiError('CLIENT_INCOMPATIBLE','This table needs a different game client.');
  const identity=adapter.identity(parsed.snapshot);
  if(identity.roomId!==parsed.session.inviteId||identity.playerId!==parsed.session.playerId||identity.gameId&&identity.gameId!==adapter.gameId)throw new ApiError('CLIENT_INCOMPATIBLE','This response belongs to another table or game.');
  return {...parsed,session:{...parsed.session,gameId:adapter.gameId,adapterVersion:adapter.version}};
}
export async function createGameTable<S,A>(adapter:GameClientAdapter<S,A>,entry:{name:string;icon?:PlayerIcon;visibility:LobbyVisibility;funding?:'account';buyInUnits?:number;entryId?:string}){
  return parseGameSession(await request('',{gameId:adapter.gameId,account:entry.funding==='account',body:entry}),adapter);
}
export async function joinGameTable<S,A>(adapter:GameClientAdapter<S,A>,invite:string,entry:{name:string;icon?:PlayerIcon;funding?:'account';buyInUnits?:number;entryId?:string}){
  return parseGameSession(await request(`/${invite}/join`,{account:entry.funding==='account',body:entry}),adapter);
}
export async function resumeTableSession<S,A>(session:GuestSession,adapter:GameClientAdapter<S,A>,signal?:AbortSignal){
  const value=await request(`/${session.inviteId}/resume`,{session,signal}) as {snapshot:unknown;gameId?:GameId;adapterVersion?:number};
  return parseGameSession({...value,session},adapter);
}
export async function joinGuest(invite: string, name: string, icon?: PlayerIcon) { return parseSession(await request(`/${invite}/join`, { body: { name, icon } })); }
export async function resumeGuest(session: GuestSession, signal?: AbortSignal): Promise<SessionResponse> {
  const response = await request(`/${session.inviteId}/resume`, { session, signal }) as { snapshot: unknown };
  const parsed = snapshotSchema.safeParse(response.snapshot);
  if (!parsed.success) throw new ApiError('CLIENT_INCOMPATIBLE', 'This app version cannot restore your table. Refresh and try again.');
  return { session, snapshot: parsed.data };
}
export function savedSession(invite: string): GuestSession | null {
  try { const value = JSON.parse(localStorage.getItem(`casual-room:${invite}`) ?? 'null') as GuestSession | null;
    return value?.inviteId === invite && /^[a-f0-9]{64}$/.test(value.credential) && typeof value.playerId === 'string' ? value : temporarySessions.get(invite) ?? null;
  } catch { return temporarySessions.get(invite) ?? null; }
}
export function lastTable(): GuestSession | null {
  try { const invite = localStorage.getItem('casual-last-room'); return invite && /^[a-f0-9]{32}$/.test(invite) ? savedSession(invite) : null; }
  catch { return null; }
}
export function rememberSession(session: GuestSession) {
  temporarySessions.set(session.inviteId, session);
  try { localStorage.setItem(`casual-room:${session.inviteId}`, JSON.stringify(session)); localStorage.setItem('casual-last-room', session.inviteId); } catch { /* The current tab can still play without persistent storage. */ }
}
export function forgetSession(invite: string) {
  temporarySessions.delete(invite);
  try { localStorage.removeItem(`casual-room:${invite}`); if (localStorage.getItem('casual-last-room') === invite) localStorage.removeItem('casual-last-room'); } catch { /* Best effort. */ }
}
export function createTableClient<S,A>(initial:TableSessionResponse<S>,adapter:GameClientAdapter<S,A>):TableClient<S,A> {
  if((initial.gameId??'blackjack')!==adapter.gameId || (initial.adapterVersion??1)!==adapter.version)throw new ApiError('CLIENT_INCOMPATIBLE','This table needs a different game client.');
  const { session } = initial;
  let snapshot = adapter.snapshotSchema.parse(initial.snapshot);
  const initialIdentity=adapter.identity(snapshot);
  if(initialIdentity.playerId!==session.playerId||initialIdentity.roomId!==session.inviteId||initialIdentity.gameId&&initialIdentity.gameId!==adapter.gameId)throw new ApiError('CLIENT_INCOMPATIBLE','This response belongs to another seat or game.');
  rememberSession(session);
  const eventSchema=gameServerEventSchema(adapter.snapshotSchema);
  let chat: ChatFeed = { messages: [], available: false, unread: 0 };
  let hasChatHistory = false;
  let connection: ConnectionInfo = { status: 'connecting', message: 'Connecting to your table…' };
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; chat?: boolean }>();
  const claimId = crypto.randomUUID();
  const claimVersion = adapter.identity(snapshot).claimVersion;
  let controllerId: string | undefined;
  let socket: WebSocket | undefined; let disposed = false; let terminal = false;
  let retry: ReturnType<typeof setTimeout> | undefined; let attempt = 0; let generation = 0;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined; let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let ticketRequest: AbortController | undefined; let lastReceived = Date.now();
  let lastAuthorized = Date.now();
  const auth = session.funding === 'account' ? browserAuth() : undefined;
  const owner = auth?.getSnapshot().account?.accountId;
  const unsubscribeAccount = auth?.subscribe(() => { if (auth.getSnapshot().account?.accountId !== owner) fail('ACCOUNT_SESSION_INVALID', 'Sign in to the same account to restore this seat.'); });
  function notify() { for (const listener of listeners) listener(); }
  function setConnection(status: ConnectionInfo['status'], message: string) { connection = { ...connection, status, message }; notify(); }
  function rejectPending(message: string) {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(task.chat ? 'Message delivery is unconfirmed. Check table chat after reconnecting before sending again.' : message)); }
    pending.clear();
  }
  function acceptSnapshot(value: unknown) {
    const next = adapter.snapshotSchema.parse(value);const identity=adapter.identity(next);
    if (identity.playerId !== session.playerId || identity.roomId !== session.inviteId || identity.gameId&&identity.gameId!==adapter.gameId) throw new Error('Snapshot belongs to another seat or game.');
    // Every event is a complete snapshot, so revision gaps recover in one replacement.
    if (identity.revision >= adapter.identity(snapshot).revision) { snapshot = next; notify(); }
  }
  function stopAttempt() {
    generation++; ticketRequest?.abort(); ticketRequest = undefined;
    clearTimeout(retry); clearTimeout(handshakeTimer); clearTimeout(heartbeat);
    const old = socket; socket = undefined;
    try { old?.close(1000, 'Reconnecting'); } catch { /* A failed opening socket may already be closed. */ }
  }
  function fail(code: string, message: string) {
    terminal = true; stopAttempt(); rejectPending(message);
    const status = code === 'SESSION_REPLACED' ? 'replaced' : code === 'ROOM_EXPIRED' ? 'expired' : ['SESSION_INVALID', 'SESSION_EXPIRED', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_REQUIRED', 'ACCOUNT_SUSPENDED'].includes(code) ? 'invalid' : 'incompatible';
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
    heartbeat = setTimeout(async () => {
      if (disposed || terminal || socket !== current || generation !== version) return;
      if (Date.now() - lastReceived >= 25_000) { lost('Checking your connection… Actions are paused.'); return; }
      if (auth && Date.now() - lastAuthorized >= 30_000) {
        try {
          await request(`/${session.inviteId}/authorize`, { session, body: { controllerId } }); lastAuthorized = Date.now();
          if (disposed || terminal || socket !== current || generation !== version) return;
        } catch (error) {
          if (error instanceof ApiError && ['ACCOUNT_SESSION_INVALID', 'ACCOUNT_REQUIRED', 'ACCOUNT_SUSPENDED', 'SESSION_REPLACED'].includes(error.code)) fail(error.code, error.message);
          else lost('Checking your account connection… Actions are paused.');
          return;
        }
      }
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
      lastAuthorized = Date.now();
      if (disposed || terminal || version !== generation) return;
      if (!/^[a-f0-9]{64}$/.test(response.ticket)) { fail('CLIENT_INCOMPATIBLE', 'The table returned an invalid connection response. Refresh to reconnect.'); return; }
      const url = new URL(`${apiBase}/api/v1/rooms/${session.inviteId}/socket`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const current = new WebSocket(url, ['casual-v1', `ticket.${response.ticket}`, CHAT_CAPABILITY,GAME_ADAPTER_CAPABILITY]); socket = current;
      const active = () => !disposed && !terminal && socket === current && version === generation;
      handshakeTimer = setTimeout(() => { if (active()) lost('The connection timed out. Retrying…'); }, 10_000);
      current.onmessage = event => {
        if (!active()) return;
        try {
          const message = eventSchema.parse(JSON.parse(String(event.data)));
          lastReceived = Date.now();
          if (message.type === 'chat') {
            // Count arrivals before notifying React: consecutive history/live frames
            // may be rendered together, but must not erase unread messages.
            const known = new Set(chat.messages.map(entry => entry.id));
            const arrivals = hasChatHistory ? message.messages.filter(entry => !known.has(entry.id)) : [];
            const fresh = arrivals.filter(entry => entry.playerId !== session.playerId).length;
            hasChatHistory = true;
            const now = Date.now(); const serverNow = now + (connection.clockOffsetMs ?? 0);
            const liveMessages = [...(chat.liveMessages ?? []).filter(entry => entry.receivedAt + 5000 > now), ...arrivals.filter(entry => entry.sentAt >= serverNow - 5000).map(message => ({ message, receivedAt: now }))].slice(-20);
            chat = { messages: message.messages, available: true, unread: Math.min(50, chat.unread + fresh), liveMessages };
            notify(); return;
          }
          if (message.type === 'connected') { controllerId = message.controllerId; return; }
          if (message.type === 'pong') { connection = { ...connection, clockOffsetMs: message.serverTime - Date.now() }; return; }
          if (message.type === 'snapshot'||message.type==='game-snapshot') {
            if(message.type==='game-snapshot'&&(message.gameId!==adapter.gameId||message.adapterVersion!==adapter.version))throw new Error('Wrong game snapshot');
            if(message.type==='snapshot'&&adapter.gameId!=='blackjack')throw new Error('Missing game identity');
            const becameConnected = connection.status !== 'connected';
            connection = { ...connection, clockOffsetMs: message.serverTime - Date.now() };
            acceptSnapshot(message.snapshot); attempt = 0; clearTimeout(handshakeTimer);
            setConnection('connected', 'Connected · Live table'); if (becameConnected) scheduleHeartbeat(current, version);
          } else if (message.type === 'ack') {
            const task = pending.get(message.commandId);
            if (task) { clearTimeout(task.timer); pending.delete(message.commandId); task.resolve(); }
          } else if (message.type === 'error') {
            if (message.code === 'CHAT_UNAVAILABLE') { chat = { ...chat, available: false, problem: message.message }; notify(); }
            if (['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REPLACED', 'ROOM_EXPIRED', 'CLIENT_INCOMPATIBLE', 'ROOM_VERSION_UNSUPPORTED', 'ROOM_STATE_INVALID', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_REQUIRED', 'ACCOUNT_SUSPENDED'].includes(message.code)) { fail(message.code, message.message); return; }
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
      if (error instanceof ApiError && ['SESSION_INVALID', 'SESSION_EXPIRED', 'SESSION_REPLACED', 'ROOM_EXPIRED', 'CLIENT_INCOMPATIBLE', 'ROOM_VERSION_UNSUPPORTED', 'ROOM_STATE_INVALID', 'ACCOUNT_SESSION_INVALID', 'ACCOUNT_REQUIRED', 'ACCOUNT_SUSPENDED'].includes(error.code)) { fail(error.code, error.message); return; }
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
    getSnapshot: () => snapshot, getConnection: () => connection, getChat: () => chat,
    markChatRead() { if (chat.unread) { chat = { ...chat, unread: 0 }; notify(); } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send(action: A) {
      if (disposed || connection.status !== 'connected' || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Reconnect before playing. Your action was not sent.'));
      const id = crypto.randomUUID();
      const target = socket; const version = generation;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Your action is unconfirmed. Reconnecting to check the current table.')); if (target === socket && version === generation) lost('Checking the current table…'); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        try { socket!.send(JSON.stringify({type:'game-command',protocol:1,gameId:adapter.gameId,adapterVersion:adapter.version,command:adapter.command(snapshot,action,session.playerId,id)})); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error('Your action could not be sent. Please reconnect.')); }
      });
    },
    sendChat(text: string) {
      const parsed = chatTextSchema.safeParse(text);
      if (!parsed.success) return Promise.reject(new Error('Write a message of 1–300 characters.'));
      if (disposed || !chat.available || connection.status !== 'connected' || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Reconnect to table chat before sending.'));
      const id = crypto.randomUUID(); const target = socket; const version = generation;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id); reject(new Error('Message delivery is unconfirmed. Check chat before sending again.'));
          if (target === socket && version === generation) lost('Reconnecting to check the table…');
        }, 10_000);
        pending.set(id, { resolve, reject, timer, chat: true });
        try { target.send(JSON.stringify({ type: 'chat', protocol: 1, id, text: parsed.data })); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error('Your message could not be sent. Reconnect and try again.')); }
      });
    },
    reconnect() { if (!disposed && !terminal && connection.status !== 'connected') void connect(); },
    dispose() {
      disposed = true; unsubscribeAccount?.(); stopAttempt(); rejectPending('You left the table.'); listeners.clear();
      window.removeEventListener('offline', wentOffline); window.removeEventListener('online', wentOnline); window.removeEventListener('focus', focused);
    },
  };
}
export function createOnlineClient(initial:SessionResponse):GameClient {return createTableClient(initial,blackjackClientAdapter);}
