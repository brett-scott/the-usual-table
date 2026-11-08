import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { CHAT_CAPABILITY,GAME_ADAPTER_CAPABILITY, chatCommandSchema, displayNameSchema, lobbyVisibilitySchema, playerIconSchema, type TableServerEvent } from '@casual/protocol';
import { addChat, restoreChat } from './tableChat';
import { GameError } from '@casual/engine';
import { assertRule,disconnectMember,newMember,PRESENCE_MS,ROOM_IDLE_MS } from './roomMembership';
import { gameAdapters } from './games/registry';
import { parseGameCommand } from './games/commands';
import type { HostedRoom,GameRoomAdapter } from './games/contracts';
import { fundedSeat, walletHasFunds } from './tableWallet';
import { walletBackend } from './walletBackend';
import { verifyPlayingAccount } from './accountPlay';
import { errorResponse, hashSecret, originAllowed, randomSecret, readJson, secureRandomIndex } from './security';
import type { Env } from './env';
import { appearanceSchema, DEFAULT_APPEARANCE,PROFILE_CAPABILITY } from '@casual/protocol';
import { verifyAccountSession } from './accountAuth';
import { accountProfile, roomAccountProfile } from './playerProfiles';

interface Attachment { playerId: string; controllerId: string; chat?: boolean; accountId?: string; gameAdapter?:boolean;capabilities?:string[] }
const publicCapabilities=(values:readonly string[])=>values.filter(value=>/^usual-[a-z-]+-v\d+$/.test(value)&&value.length<=64).slice(0,8);
const entryFields = { name: displayNameSchema, icon: playerIconSchema.optional(), appearance:appearanceSchema.optional(), funding: z.enum(['guest', 'account']).optional(),
  buyInUnits: z.number().int().min(1).max(9_000_000_000_000).optional(), entryId: z.string().uuid().transform(value => value.toLowerCase()).optional() };
const validFunding = (body: { funding?: string; buyInUnits?: number; entryId?: string }) => body.funding === 'account'
  ? body.buyInUnits !== undefined && body.entryId !== undefined : body.buyInUnits === undefined && body.entryId === undefined;
const guestBody = z.object(entryFields).strict().refine(validFunding);
const createBody = z.object({ ...entryFields, visibility: lobbyVisibilitySchema.optional() }).strict().refine(validFunding);
const ticketBody = z.object({ claimId: z.string().uuid(), controllerId: z.string().uuid().optional(), claimVersion: z.number().int().nonnegative() }).strict();

export class TableRoom extends DurableObject<Env> {
  private game(room:HostedRoom){return gameAdapters.forRoom(room);}
  private validateFunding(game:GameRoomAdapter<HostedRoom>,body:{funding?:string;buyInUnits?:number}) {
    if(body.funding!=='account')return;
    assertRule(game.accountFunding==='house','GAME_UNAVAILABLE','Saved chips are not available for this game yet.');
    assertRule(body.buyInUnits!==undefined&&body.buyInUnits>=game.minBuyInUnits&&body.buyInUnits%game.buyInStepUnits===0,'INVALID_NAME','Choose a valid buy-in for this game.');
  }
  private snapshot(room:HostedRoom,playerId:string,capabilities:readonly string[]=[]){
    const snapshot=this.game(room).snapshot(room,playerId,{now:Date.now(),capabilities}) as {players:{id:string;icon?:import('@casual/protocol').PlayerIcon}[]};
    if(!capabilities.includes(PROFILE_CAPABILITY))return snapshot;
    return {...snapshot,players:snapshot.players.map(p=>({...p,appearance:room.members[p.id]?.appearance??(p.icon?{avatar:{kind:'emoji',id:p.icon},border:'none'}:DEFAULT_APPEARANCE),profileVersion:room.members[p.id]?.profileVersion??0}))};
  }
  private async bindProfile(request:Request,room:HostedRoom,playerId:string){
    if(!request.headers.has('Authorization'))return;
    const account=await verifyAccountSession(request,this.env);
    room.members[playerId]!.profileAccountId=account.accountId;
    // A missing profile migration must not cancel a funded table entry.
    try{const profile=await accountProfile(request,this.env);if(profile.accountId!==account.accountId)return;
      room.members[playerId]!.appearance=profile.appearance;room.members[playerId]!.profileVersion=profile.version;
    }catch{/* The editor/inspection exposes its own retry state; gameplay remains available. */}
  }
  private metadata(room:HostedRoom){const adapter=this.game(room);return {gameId:adapter.gameId,adapterVersion:adapter.version};}
  private sendSnapshot(ws:WebSocket,room:HostedRoom) {
    const adapter=this.game(room);const attachment=ws.deserializeAttachment() as Attachment;
    const snapshot=this.snapshot(room,attachment.playerId,attachment.capabilities);
    this.send(ws,attachment.gameAdapter?{type:'game-snapshot',protocol:1,gameId:adapter.gameId,adapterVersion:adapter.version,snapshot,serverTime:Date.now()}
      :{type:'snapshot',snapshot,serverTime:Date.now()});
  }
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
    const { room, migrated } = gameAdapters.restore(await this.ctx.storage.get<unknown>('room'), now);
    const live = new Set(this.ctx.getWebSockets().filter(ws => ws.readyState === 1).map(ws => (ws.deserializeAttachment() as Attachment).controllerId));
    let changed = migrated;
    for (const [id, member] of Object.entries(room.members)) {
      if (member.connected && !live.has(member.controllerId!)) changed = disconnectMember(room, id, Math.min(now, member.presenceDeadline ?? now)) || changed;
    }
    if (changed) { room.revision++; await this.save(room); this.broadcast(room); }
    return room;
  }
  private async save(room: HostedRoom) {
    await this.persist(room);
    await this.game(room).flushWallet(room, walletBackend(this.env, this.ctx), () => this.persist(room));
    if (this.emptyRoom(room)) return;
    this.publishLobby(room);
  }
  private emptyRoom(room: HostedRoom) {
    return this.game(room).players(room).length === 0 && !walletHasFunds(room);
  }
  private async deleteRoom(room: HostedRoom) {
    // Our compatibility date makes deleteAll remove both stored data and its alarm.
    await this.ctx.storage.deleteAll();
    this.publishLobby(room, true);
  }
  private async persist(room: HostedRoom) {
    if (this.game(room).collectSeats(room, Date.now())) room.revision++;
    if (this.emptyRoom(room)) { await this.deleteRoom(room); return; }
    const deadline = this.game(room).nextAlarm(room);
    await this.ctx.storage.transaction(async storage => {
      await storage.put('room', room);
      if (deadline !== null) await storage.setAlarm(Math.max(Date.now() + 1, deadline));
      else await storage.deleteAlarm();
    });
  }
  private publishLobby(room: HostedRoom, expired = false) {
    if (room.visibility !== 'public') return;
    const game=this.game(room);const players=game.players(room);const host = players.find(player => player.id === room.managerId);
    const visible = !expired && host && players.length < game.capacity && Object.values(room.members).some(member => member.connected && !member.leaveAfterRound);
    const report = visible ? { roomId: room.id, gameId: game.gameId, hostName: host.name, players: players.length, capacity: game.capacity, phase: game.lobbyPhase(room), updatedAt: 0 } : null;
    const signature = JSON.stringify(report); const now = Date.now();
    if (!expired && signature === this.lobbyReport && now - this.lobbyPublishedAt < 30_000) return;
    this.lobbyReport = signature; this.lobbyPublishedAt = now;
    // Discovery may lag or fail without interrupting table actions. Heartbeats renew its lease.
    this.ctx.waitUntil(this.env.LOBBIES.getByName(game.gameId).update(room.id, room.revision + (expired ? 1 : 0), report).catch(() => { this.lobbyPublishedAt = 0; }));
  }
  private send(ws: WebSocket, event: TableServerEvent) {
    try { ws.send(JSON.stringify(event)); } catch { /* The close callback handles presence. */ }
  }
  private broadcast(room: HostedRoom) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (!room.members[attachment.playerId]?.connected || room.members[attachment.playerId]?.controllerId !== attachment.controllerId) continue;
      this.sendSnapshot(ws,room);
    }
  }
  private async chatHistory(ws: WebSocket) {
    if (!(ws.deserializeAttachment() as Attachment).chat) return;
    try { this.send(ws, { type: 'chat', messages: restoreChat(await this.ctx.storage.get('chat')).messages }); }
    catch { this.send(ws, { type: 'error', code: 'CHAT_UNAVAILABLE', message: 'Table chat is unavailable. Your game can continue.' }); }
  }
  private async catchUp(room: HostedRoom) {
    const now = Date.now();
    const next = this.game(room).expire(room, secureRandomIndex, now);
    const changed = this.game(next).collectSeats(next, now);
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
  private async authenticate(request: Request, room: HostedRoom) {
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
        const capabilities=publicCapabilities((url.searchParams.get('capabilities')??'').split(','));
        if (url.pathname === '/api/v1/rooms' && request.method === 'POST') {
          const game=gameAdapters.available(request.headers.get('X-Game-Id')??'blackjack');
          const body = createBody.safeParse(await readJson(request)); assertRule(body.success, 'INVALID_NAME', 'Enter a display name of 1–24 characters and choose public or private.');
          this.validateFunding(game,body.data);
          const account = body.data.funding === 'account' ? await this.playingAccount(request) : undefined;
          const existing = await this.ctx.storage.get<HostedRoom>('room');
          if (existing && account) {
            const room = await this.catchUp(await this.load());
            const own = Object.keys(room.members).find(id => room.members[id]!.account?.id === account.id && !room.members[id]!.leaveAfterRound);
            assertRule(own, 'ACCOUNT_REQUIRED', 'This table entry belongs to another account.');
            assertRule(!room.creation || room.creation.buyInUnits === body.data.buyInUnits && room.creation.visibility === (body.data.visibility ?? 'private'),
              'ENTRY_CONFLICT', `This entry already used a ${room.creation?.visibility} table and ${(room.creation?.buyInUnits ?? 0) / 100} chips. Retry those settings.`);
            return Response.json({ ...this.metadata(room), session: { inviteId: room.id, playerId: own, credential: randomSecret(), funding: 'account' }, snapshot: this.snapshot(room, own,capabilities) });
          }
          assertRule(!existing, 'INVALID_REQUEST', 'This table already exists.');
          const credential = randomSecret(); const playerId = crypto.randomUUID(); const inviteId = request.headers.get('X-Room-Id')!;
          let room = game.create({roomId:inviteId,player:{id:playerId,name:body.data.name,seat:0,icon:body.data.icon},credentialHash:await hashSecret(credential),random:secureRandomIndex,now:Date.now()});
          room.visibility = body.data.visibility ?? 'private';
          room.members[playerId]!.appearance=body.data.appearance??(body.data.icon?{avatar:{kind:'emoji',id:body.data.icon},border:'none'}:DEFAULT_APPEARANCE);
          await this.bindProfile(request,room,playerId);
          if (account) {
            room.members[playerId]!.account = account; room = this.game(room).fund(room, playerId, account.id, body.data.buyInUnits!, body.data.entryId!);
            room.creation = { entryId: body.data.entryId!, buyInUnits: body.data.buyInUnits!, visibility: room.visibility! };
          }
          await this.save(room);
          return Response.json({ ...this.metadata(room), session: { inviteId, playerId, credential, ...(account ? { funding: 'account' } : {}) }, snapshot: this.snapshot(room, playerId,capabilities) }, { status: 201 });
        }
        const room = await this.catchUp(await this.load());
        // Closed rooms may still be settling hands/returns internally. Old invitations cannot revive them.
        assertRule(Object.values(room.members).some(member => !member.leaveAfterRound), 'ROOM_EXPIRED', 'This table has closed. Create a new table.');
        if(operation==='info'&&request.method==='GET'){
          const game=this.game(room);return Response.json({roomId:room.id,...this.metadata(room),capacity:game.capacity,minPlayers:game.minPlayers,guestStartingChips:game.guestStartingChips,minBuyInUnits:game.minBuyInUnits,
            buyInStepUnits:game.buyInStepUnits,accountFunding:game.accountFunding,visibility:room.visibility??'private'});
        }
        if (operation === 'join' && request.method === 'POST') {
          const body = guestBody.safeParse(await readJson(request)); assertRule(body.success, 'INVALID_NAME', 'Enter a display name of 1–24 characters.');
          this.validateFunding(this.game(room),body.data);
          const account = body.data.funding === 'account' ? await this.playingAccount(request) : undefined;
          if (account) {
            const own = Object.keys(room.members).find(id => room.members[id]!.account?.id === account.id);
            if (own) {
              assertRule(!room.members[own]!.leaveAfterRound, 'INVALID_ACTION', 'Your previous hand is finishing. Wait for your chips to return.');
              return Response.json({ ...this.metadata(room), session: { inviteId: room.id, playerId: own, credential: randomSecret(), funding: 'account' }, snapshot: this.snapshot(room, own,capabilities) });
            }
          }
          const game=this.game(room);const players=game.players(room);
          gameAdapters.available(game.gameId);
          assertRule(players.length < game.capacity, 'TABLE_FULL', 'This table is full. Create another table.');
          const credential = randomSecret(); const playerId = crypto.randomUUID();
          const seat=Array.from({length:game.capacity},(_,i)=>i).find(index=>!players.some(p=>p.seat===index))!;
          game.join(room,{id:playerId,name:body.data.name,icon:body.data.icon,seat});
          room.members[playerId] = newMember(await hashSecret(credential), Date.now());
          room.members[playerId]!.appearance=body.data.appearance??(body.data.icon?{avatar:{kind:'emoji',id:body.data.icon},border:'none'}:DEFAULT_APPEARANCE);
          await this.bindProfile(request,room,playerId);
          let next = room;
          if (account) { room.members[playerId]!.account = account; next = this.game(room).fund(room, playerId, account.id, body.data.buyInUnits!, body.data.entryId!); }
          next.revision++; next.lastActivity = Date.now(); await this.save(next); this.broadcast(next);
          return Response.json({ ...this.metadata(next), session: { inviteId: next.id, playerId, credential, ...(account ? { funding: 'account' } : {}) }, snapshot: this.snapshot(next, playerId,capabilities) }, { status: 201 });
        }
        if (operation === 'socket' && request.method === 'GET') {
          assertRule(request.headers.get('Upgrade')?.toLowerCase() === 'websocket', 'INVALID_REQUEST', 'A WebSocket connection is required.');
          const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(p => p.trim()) ?? [];
          assertRule(this.game(room).gameId==='blackjack'||protocols.includes(GAME_ADAPTER_CAPABILITY),'CLIENT_INCOMPATIBLE','Refresh the app to connect to this game.');
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
          server.serializeAttachment({ playerId, controllerId, chat: protocols.includes(CHAT_CAPABILITY),gameAdapter:protocols.includes(GAME_ADAPTER_CAPABILITY),capabilities:publicCapabilities(protocols), ...(account ? { accountId: account.id } : {}) } satisfies Attachment);
          this.ctx.acceptWebSocket(server, [playerId]); this.send(server, { type: 'connected', controllerId, serverTime: Date.now() }); this.broadcast(room);
          await this.chatHistory(server);
          return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'casual-v1' } });
        }
        const playerId = await this.authenticate(request, room);
        if(operation==='profile'&&request.method==='POST'){
          const parsed=z.object({playerId:z.string().min(1).max(100)}).strict().safeParse(await readJson(request));
          assertRule(parsed.success,'INVALID_REQUEST','Choose a player at this table.');const body=parsed.data;
          const target=this.game(room).players(room).find(p=>p.id===body.playerId);const member=room.members[body.playerId];
          assertRule(target&&member&&!member.leaveAfterRound,'PROFILE_UNAVAILABLE','This player has left the table.');
          const snapshot=this.game(room).snapshot(room,playerId,{now:Date.now(),capabilities}) as {players:{id:string;balance?:number;balanceUnits?:number}[]};
          const current=snapshot.players.find(p=>p.id===target.id)!;
          const accountId=member.profileAccountId??member.account?.id;
          let viewerId=room.members[playerId]?.account?.id;
          if(request.headers.has('X-Profile-Authorization')){
            const headers=new Headers(request.headers);headers.set('Authorization',request.headers.get('X-Profile-Authorization')!);
            try{viewerId=(await verifyAccountSession(new Request(request.url,{headers}),this.env)).accountId;}catch{/* Public inspection still requires valid seat membership. */}
          }
          return Response.json({contract:1,ownAccount:!!accountId&&viewerId===accountId,playerId:target.id,name:target.name,stackUnits:current.balanceUnits??current.balance!*50,
            funding:fundedSeat(room,target.id)?'saved':'temporary',profile:accountId?await roomAccountProfile(this.env,accountId):{kind:'guest',appearance:member.appearance??(target.icon?{avatar:{kind:'emoji',id:target.icon},border:'none'}:DEFAULT_APPEARANCE)}});
        }
        if(operation==='profile-sync'&&request.method==='POST'){
          const token=request.headers.get('X-Profile-Authorization');assertRule(token,'ACCOUNT_REQUIRED','Sign in to update your table picture.');
          const headers=new Headers(request.headers);headers.set('Authorization',token);
          const verified=await verifyAccountSession(new Request(request.url,{headers}),this.env);
          const member=room.members[playerId]!;
          assertRule(!member.profileAccountId||member.profileAccountId===verified.accountId,'ACCOUNT_REQUIRED','This profile belongs to another account.');
          const profile=await accountProfile(new Request(request.url,{headers}),this.env);
          assertRule(profile.accountId===verified.accountId,'ACCOUNT_REQUIRED','This profile could not be verified.');
          member.profileAccountId=verified.accountId;member.appearance=profile.appearance;member.profileVersion=profile.version;
          // Cosmetic persistence does not advance a game revision or alter game deadlines.
          await this.ctx.storage.put('room',room);this.broadcast(room);return Response.json({ok:true});
        }
        if (operation === 'authorize' && request.method === 'POST') {
          const body = z.object({ controllerId: z.string().uuid() }).strict().safeParse(await readJson(request));
          assertRule(body.success, 'INVALID_REQUEST', 'Send the current connection ID.');
          assertRule(room.members[playerId]!.account && room.members[playerId]!.controllerId === body.data.controllerId, 'SESSION_REPLACED', 'This connection no longer controls your account seat.');
          await this.save(room); return Response.json({ expiresAt: room.members[playerId]!.account!.expiresAt });
        }
        if ((operation === 'resume' && request.method === 'POST') || (operation === 'snapshot' && request.method === 'GET')) return Response.json({ ...this.metadata(room), snapshot: this.snapshot(room, playerId,capabilities) });
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
      let commandId: string | undefined; let room: HostedRoom | undefined; let playerId: string | undefined;
      let authenticated = false;let capabilities:string[]|undefined;
      try {
        const attachment = ws.deserializeAttachment() as Attachment; playerId = attachment.playerId;capabilities=attachment.capabilities;
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
        if (message === 'snapshot') { this.sendSnapshot(ws,room); await this.chatHistory(ws); return; }
        if (typeof message === 'string' && new TextEncoder().encode(message).length <= 8192 && attachment.chat) {
          let input: unknown; try { input = JSON.parse(message); } catch { /* Game command handling reports malformed JSON below. */ }
          if (input && typeof input === 'object' && 'type' in input && input.type === 'chat') {
            if ('id' in input && typeof input.id === 'string' && input.id.length <= 100) commandId = input.id;
            const parsed = chatCommandSchema.safeParse(input);
            assertRule(parsed.success, 'INVALID_CHAT', 'Write a message of 1–300 characters.');
            const chat = restoreChat(await this.ctx.storage.get('chat'));
            if (addChat(chat, room, playerId, parsed.data.id, parsed.data.text, Date.now(),this.game(room).players(room))) {
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
        const game=this.game(room);
        if(input&&typeof input==='object'&&'type' in input&&input.type==='game-command') {
          const nested='command' in input?input.command:undefined;
          if(nested&&typeof nested==='object'&&'id' in nested&&typeof nested.id==='string'&&nested.id.length<=100)commandId=nested.id;
        }
        const command=parseGameCommand(room,input); commandId = command.id;
        assertRule(command.playerId === playerId, 'SESSION_INVALID', 'You can only control your own seat.');
        const next = game.apply(room, command, secureRandomIndex, now);
        await this.save(next); room = next; this.broadcast(room);
        const receipt = room.receipts.find(r => r.id === command.id && r.playerId === playerId);
        this.send(ws, { type: 'ack', commandId: command.id, revision: receipt?.revision ?? room.revision });
        if (command.action.type === 'Leave') ws.close(1000, 'Left table');
      } catch (error) {
        const known = error instanceof GameError;
        this.send(ws, { type: 'error', commandId, code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Your action could not be completed. Please reconnect.',
          snapshot: authenticated && room && playerId && room.members[playerId] ? this.snapshot(room, playerId,capabilities) : undefined });
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
      let room: HostedRoom;
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
