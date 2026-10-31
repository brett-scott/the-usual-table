import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { CHAT_CAPABILITY, chatCommandSchema, commandSchema, displayNameSchema, lobbyVisibilitySchema, playerIconSchema, type Command, type ServerEvent } from '@casual/protocol';
import { addChat, restoreChat } from './tableChat';
import { GameError } from '@casual/engine';
import { applyCommand, assertRule, collectSeats, disconnectMember, expireRoomDecisions, newMember, newRoom, nextAlarm, PRESENCE_MS, ROOM_IDLE_MS, roomSnapshot, type OnlineRoom } from './roomState';
import { restoreRoom } from './roomStorage';
import { beginWalletFunding, flushRoomWallet, fundedSeat, walletHasFunds } from './roomWallet';
import { walletBackend } from './walletBackend';
import { verifyPlayingAccount } from './accountPlay';
import { errorResponse, hashSecret, originAllowed, randomSecret, readJson, secureRandomIndex } from './security';
import type { Env } from './env';

interface Attachment { playerId: string; controllerId: string; chat?: boolean; accountId?: string }
const entryFields = { name: displayNameSchema, icon: playerIconSchema.optional(), funding: z.enum(['guest', 'account']).optional(),
  buyInUnits: z.number().int().min(1000).max(9_000_000_000_000).refine(value => value % 50 === 0).optional(), entryId: z.string().uuid().transform(value => value.toLowerCase()).optional() };
const validFunding = (body: { funding?: string; buyInUnits?: number; entryId?: string }) => body.funding === 'account'
  ? body.buyInUnits !== undefined && body.entryId !== undefined : body.buyInUnits === undefined && body.entryId === undefined;
const guestBody = z.object(entryFields).strict().refine(validFunding);
const createBody = z.object({ ...entryFields, visibility: lobbyVisibilitySchema.optional() }).strict().refine(validFunding);
const ticketBody = z.object({ claimId: z.string().uuid(), controllerId: z.string().uuid().optional(), claimVersion: z.number().int().nonnegative() }).strict();

export class TableRoom extends DurableObject<Env> {
  private pending: Promise<unknown> = Promise.resolve();
  private lobbyReport = '';
  private lobbyPublishedAt = 0;
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  private async load() {
    const now = Date.now();
    const { room, migrated } = restoreRoom(await this.ctx.storage.get<unknown>('room'), now);
    const live = new Set(this.ctx.getWebSockets().filter(ws => ws.readyState === 1).map(ws => (ws.deserializeAttachment() as Attachment).controllerId));
    let changed = migrated;
    for (const [id, member] of Object.entries(room.members)) {
      if (member.connected && !live.has(member.controllerId!)) changed = disconnectMember(room, id, Math.min(now, member.presenceDeadline ?? now)) || changed;
    }
    if (changed) { room.revision++; await this.save(room); this.broadcast(room); }
    return room;
  }
  private async save(room: OnlineRoom) {
    await this.persist(room);
    await flushRoomWallet(room, walletBackend(this.env, this.ctx), () => this.persist(room));
    if (this.emptyRoom(room)) return;
    this.publishLobby(room);
  }
  private emptyRoom(room: OnlineRoom) {
    return room.engine.players.length === 0 && !walletHasFunds(room);
  }
  private async deleteRoom(room: OnlineRoom) {
    // Our compatibility date makes deleteAll remove both stored data and its alarm.
    await this.ctx.storage.deleteAll();
    this.publishLobby(room, true);
  }
  private async persist(room: OnlineRoom) {
    if (collectSeats(room, Date.now())) room.revision++;
    if (this.emptyRoom(room)) { await this.deleteRoom(room); return; }
    const deadline = nextAlarm(room);
    await this.ctx.storage.transaction(async storage => {
      await storage.put('room', room);
      if (deadline !== null) await storage.setAlarm(Math.max(Date.now() + 1, deadline));
      else await storage.deleteAlarm();
    });
  }
  private publishLobby(room: OnlineRoom, expired = false) {
    if (room.visibility !== 'public') return;
    const host = room.engine.players.find(player => player.id === room.managerId);
    const visible = !expired && host && room.engine.players.length < 4 && Object.values(room.members).some(member => member.connected && !member.leaveAfterRound);
    const report = visible ? { roomId: room.id, gameId: 'blackjack' as const, hostName: host.name, players: room.engine.players.length, capacity: 4, phase: room.engine.phase === 'BETTING' ? 'waiting' as const : 'playing' as const, updatedAt: 0 } : null;
    const signature = JSON.stringify(report); const now = Date.now();
    if (!expired && signature === this.lobbyReport && now - this.lobbyPublishedAt < 30_000) return;
    this.lobbyReport = signature; this.lobbyPublishedAt = now;
    // Discovery may lag or fail without interrupting table actions. Heartbeats renew its lease.
    this.ctx.waitUntil(this.env.LOBBIES.getByName('blackjack').update(room.id, room.revision + (expired ? 1 : 0), report).catch(() => { this.lobbyPublishedAt = 0; }));
  }
  private send(ws: WebSocket, event: ServerEvent) {
    try { ws.send(JSON.stringify(event)); } catch { /* The close callback handles presence. */ }
  }
  private broadcast(room: OnlineRoom) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (!room.members[attachment.playerId]?.connected || room.members[attachment.playerId]?.controllerId !== attachment.controllerId) continue;
      this.send(ws, { type: 'snapshot', snapshot: roomSnapshot(room, attachment.playerId), serverTime: Date.now() });
    }
  }
  private async chatHistory(ws: WebSocket) {
    if (!(ws.deserializeAttachment() as Attachment).chat) return;
    try { this.send(ws, { type: 'chat', messages: restoreChat(await this.ctx.storage.get('chat')).messages }); }
    catch { this.send(ws, { type: 'error', code: 'CHAT_UNAVAILABLE', message: 'Table chat is unavailable. Your game can continue.' }); }
  }
  private async catchUp(room: OnlineRoom) {
    const now = Date.now();
    const next = expireRoomDecisions(room, secureRandomIndex, now);
    const changed = collectSeats(next, now);
    if (changed) next.revision++;
    if (this.emptyRoom(next) || (!Object.values(next.members).some(m => m.connected) && now >= next.lastActivity + ROOM_IDLE_MS && !walletHasFunds(next))) {
      await this.deleteRoom(next);
      for (const ws of this.ctx.getWebSockets()) { this.send(ws, { type: 'error', code: 'ROOM_EXPIRED', message: 'This table has expired. Create a new table.' }); ws.close(4004, 'Table expired'); }
      throw new GameError('ROOM_EXPIRED', 'This table has expired. Create a new table.');
    }
    if (next !== room || changed) { await this.save(next); this.broadcast(next); }
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment; const member = next.members[attachment.playerId];
      if (member?.controllerId === attachment.controllerId && !member.connected) ws.close(4000, 'Connection timed out; reconnect');
      else if (!member) { this.send(ws, { type: 'error', code: 'SESSION_EXPIRED', message: 'Your seat reservation has expired. Join again or create a table.' }); ws.close(4004, 'Seat reservation expired'); }
    }
    return next;
  }
  private async authenticate(request: Request, room: OnlineRoom) {
    const credential = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!credential) {
      assertRule(request.headers.has('Authorization'), 'SESSION_INVALID', 'Your seat authorization is missing.');
      const account = await verifyPlayingAccount(request, this.env);
      const playerId = Object.keys(room.members).find(id => room.members[id]!.account?.id === account.id && !room.members[id]!.leaveAfterRound);
      assertRule(playerId && fundedSeat(room, playerId)?.accountId === account.id, 'ACCOUNT_REQUIRED', 'This account does not own a seat at this table.');
      room.members[playerId]!.account = account;
      return playerId;
    }
    assertRule(credential, 'SESSION_INVALID', 'Your guest session is missing or no longer valid.');
    const hash = await hashSecret(credential);
    const playerId = Object.keys(room.members).find(id => room.members[id]!.hash === hash && !room.members[id]!.leaveAfterRound);
    assertRule(playerId, 'SESSION_INVALID', 'Your guest session is no longer valid.');
    assertRule(!fundedSeat(room, playerId), 'ACCOUNT_REQUIRED', 'This seat requires account authorization.');
    return playerId;
  }
  async fetch(request: Request): Promise<Response> {
    return this.exclusive(async () => {
      try {
        assertRule(originAllowed(request, this.env.ALLOWED_ORIGINS, request.headers.get('Upgrade')?.toLowerCase() === 'websocket'), 'ORIGIN_DENIED', 'This website is not allowed to connect.');
        const url = new URL(request.url); const operation = url.pathname.split('/').at(-1);
        if (url.pathname === '/api/v1/rooms' && request.method === 'POST') {
          const body = createBody.safeParse(await readJson(request)); assertRule(body.success, 'INVALID_NAME', 'Enter a display name of 1–24 characters and choose public or private.');
          const account = body.data.funding === 'account' ? await this.playingAccount(request) : undefined;
          const existing = await this.ctx.storage.get<OnlineRoom>('room');
          if (existing && account) {
            const room = await this.catchUp(await this.load());
            const own = Object.keys(room.members).find(id => room.members[id]!.account?.id === account.id && !room.members[id]!.leaveAfterRound);
            assertRule(own, 'ACCOUNT_REQUIRED', 'This table entry belongs to another account.');
            assertRule(!room.creation || room.creation.buyInUnits === body.data.buyInUnits && room.creation.visibility === (body.data.visibility ?? 'private'),
              'ENTRY_CONFLICT', `This entry already used a ${room.creation?.visibility} table and ${(room.creation?.buyInUnits ?? 0) / 100} chips. Retry those settings.`);
            return Response.json({ session: { inviteId: room.id, playerId: own, credential: randomSecret(), funding: 'account' }, snapshot: roomSnapshot(room, own) });
          }
          assertRule(!existing, 'INVALID_REQUEST', 'This table already exists.');
          const credential = randomSecret(); const playerId = crypto.randomUUID(); const inviteId = request.headers.get('X-Room-Id')!;
          let room = newRoom(inviteId, playerId, body.data.name, await hashSecret(credential), secureRandomIndex, Date.now(), body.data.icon);
          room.gameId = 'blackjack'; room.visibility = body.data.visibility ?? 'private';
          if (account) {
            room.members[playerId]!.account = account; room = beginWalletFunding(room, playerId, account.id, body.data.buyInUnits!, body.data.entryId!);
            room.creation = { entryId: body.data.entryId!, buyInUnits: body.data.buyInUnits!, visibility: room.visibility! };
          }
          await this.save(room);
          return Response.json({ session: { inviteId, playerId, credential, ...(account ? { funding: 'account' } : {}) }, snapshot: roomSnapshot(room, playerId) }, { status: 201 });
        }
        const room = await this.catchUp(await this.load());
        // Closed rooms may still be settling hands/returns internally. Old invitations cannot revive them.
        assertRule(Object.values(room.members).some(member => !member.leaveAfterRound), 'ROOM_EXPIRED', 'This table has closed. Create a new table.');
        if (operation === 'join' && request.method === 'POST') {
          const body = guestBody.safeParse(await readJson(request)); assertRule(body.success, 'INVALID_NAME', 'Enter a display name of 1–24 characters.');
          const account = body.data.funding === 'account' ? await this.playingAccount(request) : undefined;
          if (account) {
            const own = Object.keys(room.members).find(id => room.members[id]!.account?.id === account.id);
            if (own) {
              assertRule(!room.members[own]!.leaveAfterRound, 'INVALID_ACTION', 'Your previous hand is finishing. Wait for your chips to return.');
              return Response.json({ session: { inviteId: room.id, playerId: own, credential: randomSecret(), funding: 'account' }, snapshot: roomSnapshot(room, own) });
            }
          }
          assertRule(room.engine.players.length < 4, 'TABLE_FULL', 'This table has four players already. Create another table.');
          const credential = randomSecret(); const playerId = crypto.randomUUID();
          const seat = [0, 1, 2, 3].find(index => !room.engine.players.some(p => p.seat === index))!;
          const activePlayerId = room.engine.players[room.engine.activePlayer]?.id;
          room.engine.players.push({ id: playerId, name: body.data.name, ...(body.data.icon ? { icon: body.data.icon } : {}), seat, balance: 2000, bet: room.engine.phase === 'BETTING' ? 20 : 0, hands: [] });
          room.engine.players.sort((a, b) => a.seat - b.seat);
          if (activePlayerId) room.engine.activePlayer = room.engine.players.findIndex(p => p.id === activePlayerId);
          room.members[playerId] = newMember(await hashSecret(credential), Date.now());
          let next = room;
          if (account) { room.members[playerId]!.account = account; next = beginWalletFunding(room, playerId, account.id, body.data.buyInUnits!, body.data.entryId!); }
          next.revision++; next.lastActivity = Date.now(); await this.save(next); this.broadcast(next);
          return Response.json({ session: { inviteId: next.id, playerId, credential, ...(account ? { funding: 'account' } : {}) }, snapshot: roomSnapshot(next, playerId) }, { status: 201 });
        }
        if (operation === 'socket' && request.method === 'GET') {
          assertRule(request.headers.get('Upgrade')?.toLowerCase() === 'websocket', 'INVALID_REQUEST', 'A WebSocket connection is required.');
          const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(p => p.trim()) ?? [];
          const ticket = protocols.find(p => /^ticket\.[a-f0-9]{64}$/.test(p))?.slice(7);
          assertRule(ticket && protocols.includes('casual-v1'), 'SESSION_INVALID', 'Request a new connection ticket.');
          const hash = await hashSecret(ticket); const index = room.tickets.findIndex(t => t.hash === hash && t.expires > Date.now());
          assertRule(index >= 0, 'TICKET_INVALID', 'Your connection ticket expired or was already used. Request a new ticket.');
          const claimed = room.tickets.splice(index, 1)[0]!; const { playerId } = claimed;
          assertRule(room.members[playerId] && !room.members[playerId]!.leaveAfterRound, 'SESSION_INVALID', 'Your guest session is no longer valid.');
          const account = room.members[playerId]!.account;
          assertRule(!fundedSeat(room, playerId) || account && account.expiresAt > Date.now() && account.id === fundedSeat(room, playerId)!.accountId, 'ACCOUNT_REQUIRED', 'This seat requires current account authorization.');
          const controllerId = crypto.randomUUID(); const member = room.members[playerId]!;
          assertRule(member.claimVersion === claimed.claimVersion && member.claimId === claimed.claimId, 'SESSION_REPLACED', 'A newer tab has claimed this seat.');
          member.controllerId = controllerId; member.connected = true; member.reservationDeadline = null; member.presenceDeadline = Date.now() + PRESENCE_MS;
          room.revision++; room.lastActivity = Date.now();
          await this.save(room);
          for (const previous of this.ctx.getWebSockets(playerId)) { this.send(previous, { type: 'replaced', message: 'This seat is now controlled by another tab.' }); previous.close(4001, 'Seat opened in another tab'); }
          const pair = new WebSocketPair(); const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
          server.serializeAttachment({ playerId, controllerId, chat: protocols.includes(CHAT_CAPABILITY), ...(account ? { accountId: account.id } : {}) } satisfies Attachment);
          this.ctx.acceptWebSocket(server, [playerId]); this.send(server, { type: 'connected', controllerId, serverTime: Date.now() }); this.broadcast(room);
          await this.chatHistory(server);
          return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'casual-v1' } });
        }
        const playerId = await this.authenticate(request, room);
        if (operation === 'authorize' && request.method === 'POST') {
          const body = z.object({ controllerId: z.string().uuid() }).strict().safeParse(await readJson(request));
          assertRule(body.success, 'INVALID_REQUEST', 'Send the current connection ID.');
          assertRule(room.members[playerId]!.account && room.members[playerId]!.controllerId === body.data.controllerId, 'SESSION_REPLACED', 'This connection no longer controls your account seat.');
          await this.save(room); return Response.json({ expiresAt: room.members[playerId]!.account!.expiresAt });
        }
        if ((operation === 'resume' && request.method === 'POST') || (operation === 'snapshot' && request.method === 'GET')) return Response.json({ snapshot: roomSnapshot(room, playerId) });
        if (operation === 'ticket' && request.method === 'POST') {
          const parsed = ticketBody.safeParse(await readJson(request));
          assertRule(parsed.success, 'CLIENT_INCOMPATIBLE', 'Refresh the app before reconnecting to this table.');
          const member = room.members[playerId]!; const claim = parsed.data;
          assertRule(!claim.controllerId || claim.controllerId === member.controllerId, 'SESSION_REPLACED', 'This seat is controlled by a newer tab.');
          assertRule(!member.retiredClaims.includes(claim.claimId), 'SESSION_REPLACED', 'A newer tab has claimed this seat.');
          if (member.claimId !== claim.claimId) {
            assertRule(member.claimVersion === claim.claimVersion, 'SESSION_REPLACED', 'A newer tab has claimed this seat. Refresh to deliberately claim it again.');
            if (member.claimId) member.retiredClaims = [...member.retiredClaims, member.claimId].slice(-8);
            member.claimId = claim.claimId; member.claimVersion++;
          }
          const ticket = randomSecret(); room.tickets = room.tickets.filter(t => t.expires > Date.now() && t.playerId !== playerId);
          room.tickets.push({ hash: await hashSecret(ticket), playerId, expires: Date.now() + 30_000, claimId: member.claimId, claimVersion: member.claimVersion });
          await this.save(room); return Response.json({ ticket });
        }
        throw new GameError('INVALID_REQUEST', 'This operation is not supported.');
      } catch (error) { return errorResponse(error); }
    });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.exclusive(async () => {
      let commandId: string | undefined; let room: OnlineRoom | undefined; let playerId: string | undefined;
      let authenticated = false;
      try {
        const attachment = ws.deserializeAttachment() as Attachment; playerId = attachment.playerId;
        room = await this.catchUp(await this.load());
        assertRule(room.members[playerId]?.controllerId === attachment.controllerId && room.members[playerId]?.connected, 'SESSION_INVALID', 'This connection no longer controls your seat.');
        const account = room.members[playerId]!.account;
        assertRule(!fundedSeat(room, playerId) || account && attachment.accountId === account.id && account.id === fundedSeat(room, playerId)!.accountId, 'ACCOUNT_REQUIRED', 'This seat requires account authorization.');
        assertRule(!account || account.expiresAt > Date.now(), 'ACCOUNT_SESSION_INVALID', 'Sign in again to continue with saved chips.');
        authenticated = true;
        if (message === 'ping') {
          room.members[playerId]!.presenceDeadline = Date.now() + PRESENCE_MS;
          await this.save(room); this.send(ws, { type: 'pong', serverTime: Date.now() }); return;
        }
        if (message === 'snapshot') { this.send(ws, { type: 'snapshot', snapshot: roomSnapshot(room, playerId), serverTime: Date.now() }); await this.chatHistory(ws); return; }
        if (typeof message === 'string' && new TextEncoder().encode(message).length <= 8192 && attachment.chat) {
          let input: unknown; try { input = JSON.parse(message); } catch { /* Game command handling reports malformed JSON below. */ }
          if (input && typeof input === 'object' && 'type' in input && input.type === 'chat') {
            if ('id' in input && typeof input.id === 'string' && input.id.length <= 100) commandId = input.id;
            const parsed = chatCommandSchema.safeParse(input);
            assertRule(parsed.success, 'INVALID_CHAT', 'Write a message of 1–300 characters.');
            const chat = restoreChat(await this.ctx.storage.get('chat'));
            if (addChat(chat, room, playerId, parsed.data.id, parsed.data.text, Date.now())) {
              room.lastActivity = Date.now();
              await this.ctx.storage.transaction(async storage => { await storage.put('chat', chat); await storage.put('room', room); });
              for (const peer of this.ctx.getWebSockets()) {
                const target = peer.deserializeAttachment() as Attachment;
                if (target.chat && room.members[target.playerId]?.connected && room.members[target.playerId]?.controllerId === target.controllerId) this.send(peer, { type: 'chat', messages: chat.messages });
              }
            } else await this.chatHistory(ws);
            this.send(ws, { type: 'ack', commandId: parsed.data.id, revision: room.revision }); return;
          }
        }
        const rate = room.commandRates[playerId]; const now = Date.now();
        room.commandRates[playerId] = !rate || now - rate.start >= 10_000 ? { start: now, count: 1 } : { start: rate.start, count: rate.count + 1 };
        await this.save(room); // Count rejected/malformed commands as well as accepted ones.
        assertRule(room.commandRates[playerId]!.count <= 60, 'RATE_LIMITED', 'Too many actions. Wait a moment and try again.');
        assertRule(typeof message === 'string' && new TextEncoder().encode(message).length <= 8192, 'MESSAGE_TOO_LARGE', 'Game messages must be JSON text under 8 KB.');
        let input: unknown; try { input = JSON.parse(message); } catch { throw new GameError('INVALID_COMMAND', 'Send a valid game command.'); }
        const parsed = commandSchema.safeParse(input); assertRule(parsed.success, 'INVALID_COMMAND', 'Your game client needs to send a valid version-1 command.');
        const command: Command = parsed.data; commandId = command.id;
        assertRule(command.playerId === playerId, 'SESSION_INVALID', 'You can only control your own seat.');
        const next = applyCommand(room, command, secureRandomIndex, now);
        await this.save(next); room = next; this.broadcast(room);
        const receipt = room.receipts.find(r => r.id === command.id && r.playerId === playerId);
        this.send(ws, { type: 'ack', commandId: command.id, revision: receipt?.revision ?? room.revision });
        if (command.action.type === 'Leave') ws.close(1000, 'Left table');
      } catch (error) {
        const known = error instanceof GameError;
        this.send(ws, { type: 'error', commandId, code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Your action could not be completed. Please reconnect.',
          snapshot: authenticated && room && playerId && room.members[playerId] ? roomSnapshot(room, playerId) : undefined });
      }
    });
  }
  async webSocketClose(ws: WebSocket) { return this.disconnect(ws); }
  private async playingAccount(request: Request) {
    assertRule(walletBackend(this.env, this.ctx), 'WALLET_NOT_CONNECTED', 'Saved-chip gameplay needs its database connection. Choose temporary chips or try again later.');
    return verifyPlayingAccount(request, this.env);
  }
  async webSocketError(ws: WebSocket) { return this.disconnect(ws); }
  private async disconnect(ws: WebSocket) {
    return this.exclusive(async () => {
      const attachment = ws.deserializeAttachment() as Attachment;
      let room: OnlineRoom;
      try { room = await this.load(); } catch (error) { if (error instanceof GameError) return; throw error; }
      if (room.members[attachment.playerId]?.controllerId !== attachment.controllerId || !disconnectMember(room, attachment.playerId, Date.now())) return;
      room.revision++;
      await this.save(room); this.broadcast(room);
    });
  }
  async alarm() {
    return this.exclusive(async () => {
      try { const room = await this.catchUp(await this.load()); await this.save(room); }
      catch (error) { if (!(error instanceof GameError && error.code === 'ROOM_EXPIRED')) throw error; }
    });
  }
}
