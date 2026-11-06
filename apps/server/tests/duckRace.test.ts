import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,duckRaceSnapshotSchema,type DuckRaceAction,type DuckRaceSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { advanceDuckRace } from '@casual/duck-race';
import { duckRaceRoomAdapter,restoreDuckRaceRoom,type DuckRaceRoom } from '../src/games/duckRace';
import { bindings,http,origin } from './helpers';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/duck-race/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<DuckRaceSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:DuckRaceSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:DuckRaceRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<DuckRaceRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:DuckRaceAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'duck-race',adapterVersion:1,command}));
    await expect.poll(()=>events.find(e=>e.commandId===command.id)).toBeDefined();return events.find(e=>e.commandId===command.id)!;
  }};
}
it('uses shared eight-seat lobbies, own-seat commands and chat, and hides the future winner through eviction',async()=>{
 const initial=await create('public');expect(initial.gameId).toBe('duck-race');const a=await connect(initial.session);
 try{const peer=await(await http(`/${initial.session.inviteId}/join`,undefined,{name:'Peer'})).json<TableSessionResponse<DuckRaceSnapshot>>();const b=await connect(peer.session);
  try{expect(await b.send({type:'StartBetting'})).toMatchObject({type:'error',code:'INVALID_ACTION'});expect(await a.send({type:'StartBetting'})).toMatchObject({type:'ack'});
   const id=crypto.randomUUID();const bet={type:'PlaceBet' as const,wager:{duckIndex:0,amountUnits:1000}};expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect((await view(initial.session)).players[0]!.balanceUnits).toBe(99000);expect(await a.send(bet,{playerId:peer.session.playerId})).toMatchObject({type:'error',code:'SESSION_INVALID'});
   const chatId=crypto.randomUUID();a.ws.send(JSON.stringify({type:'chat',protocol:1,id:chatId,text:'Go duck!'}));await expect.poll(()=>b.events.some(e=>e.type==='chat'&&JSON.stringify(e).includes('Go duck!'))).toBe(true);
   for(let i=2;i<8;i++){const joined=await http(`/${initial.session.inviteId}/join`,undefined,{name:`Guest ${i}`});expect(joined.status).toBe(201);await joined.json();}const full=await http(`/${initial.session.inviteId}/join`,undefined,{name:'Ninth'});expect(full.status).toBe(409);await full.json();
   await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceDuckRace(r.engine,Date.now(),()=>0);});const running=await view(initial.session);expect(running.phase).toBe('racing');expect(running.winner).toBeNull();expect(running).not.toHaveProperty('seeds');expect(running).not.toHaveProperty('engine');expect(duckRaceSnapshotSchema.safeParse(running).success).toBe(true);
   await evictDurableObject(bindings.ROOMS.getByName(initial.session.inviteId));const resumed=await view(peer.session);expect(resumed.ducks).toEqual(running.ducks);expect(resumed.roundId).toBe(running.roundId);expect(resumed.winner).toBeNull();
   await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=10000;r.engine.deadline!-=10000;});const final=await view(initial.session);const shared=await view(peer.session);expect(final.phase).toBe('results');expect(final.winner).toBe(0);expect(shared.winner).toBe(final.winner);expect(shared.history).toEqual(final.history);expect(final.players[0]!.balanceUnits).toBe(103000);
  }finally{b.ws.close();}
 }finally{a.ws.close();}
});
it('finishes the last departed racing wager before deleting the room and chat',async()=>{
 const initial=await create();const a=await connect(initial.session);
 try{await a.send({type:'StartBetting'});await a.send({type:'PlaceBet',wager:{duckIndex:0,amountUnits:1000}});await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceDuckRace(r.engine,Date.now(),()=>0);});expect(await a.send({type:'Leave'})).toMatchObject({type:'ack'});const hidden=await http(`/${initial.session.inviteId}/info`,undefined,undefined,'GET');expect(hidden.status).toBe(404);await hidden.json();
  await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=10000;r.engine.deadline!-=10000;});await runDurableObjectAlarm(bindings.ROOMS.getByName(initial.session.inviteId));expect(await runInDurableObject(bindings.ROOMS.getByName(initial.session.inviteId),async(_instance,state)=>({room:await state.storage.get('room'),chat:await state.storage.get('chat'),alarm:await state.storage.getAlarm()}))).toEqual({room:undefined,chat:undefined,alarm:null});
 }finally{a.ws.close();}
});
it('rejects corrupt persisted races, payouts and account ownership without replacing balances',()=>{
 const room=duckRaceRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});expect(restoreDuckRaceRoom(room).room).toEqual(room);
 for(const change of [(r:DuckRaceRoom)=>{r.engine.ducks[0]!.id=1;},(r:DuckRaceRoom)=>{r.engine.phase='racing';},(r:DuckRaceRoom)=>{r.engine.players[0]!.wager={duckIndex:null,amountUnits:1000};},(r:DuckRaceRoom)=>{r.members.one!.account={id:crypto.randomUUID(),expiresAt:10000};}]){const bad=structuredClone(room);change(bad);const before=JSON.stringify(bad);expect(()=>restoreDuckRaceRoom(bad)).toThrowError(expect.objectContaining({code:'ROOM_STATE_INVALID'}));expect(JSON.stringify(bad)).toBe(before);}
});
it('cancels editable bets, pauses empty rounds and permits only settled results to be skipped',()=>{
 let room=duckRaceRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});const apply=(action:DuckRaceAction,now:number)=>{room=duckRaceRoomAdapter.apply(room,duckRaceRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),()=>0,now);};
 apply({type:'StartBetting'},100);apply({type:'PlaceBet',wager:{duckIndex:0,amountUnits:1000}},101);apply({type:'PlaceBet',wager:{duckIndex:null,amountUnits:0}},102);expect(room.engine.players[0]!.balanceUnits).toBe(100000);room=duckRaceRoomAdapter.expire(room,()=>{throw new Error('Empty draw');},15100);expect(room.engine.phase).toBe('waiting');
 apply({type:'StartBetting'},15200);apply({type:'PlaceBet',wager:{duckIndex:0,amountUnits:1000}},15201);room=duckRaceRoomAdapter.expire(room,()=>0,30200);expect(room.engine.phase).toBe('racing');expect(()=>apply({type:'NextRound'},30201)).toThrow('not available');room=duckRaceRoomAdapter.expire(room,()=>0,40200);apply({type:'NextRound'},40201);expect(room.engine.phase).toBe('betting');expect(room.engine.history).toHaveLength(1);
});
it('honors pre-close reservation expiry on a late alarm and samples connected races every 200ms',()=>{
 let room=duckRaceRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});for(const action of [{type:'StartBetting'},{type:'PlaceBet',wager:{duckIndex:0,amountUnits:1000}}])room=duckRaceRoomAdapter.apply(room,duckRaceRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),()=>0,101);
 const disconnected=structuredClone(room);disconnected.members.one!.reservationDeadline=10000;const expired=duckRaceRoomAdapter.expire(disconnected,()=>0,30000);expect(expired.engine.phase).toBe('waiting');expect(expired.engine.players).toEqual([]);expect(expired.engine.history).toEqual([]);
 room.members.one!.connected=true;room.members.one!.controllerId='controller';room.members.one!.presenceDeadline=60000;room.members.one!.reservationDeadline=null;room=duckRaceRoomAdapter.expire(room,()=>0,15101);expect(duckRaceRoomAdapter.nextAlarm(room)).toBe(15301);const next=duckRaceRoomAdapter.expire(room,()=>0,15301);expect(next.revision).toBe(room.revision+1);expect(duckRaceSnapshotSchema.parse(duckRaceRoomAdapter.snapshot(next,'one',{now:15301,capabilities:[]})).positions[0]).toBeGreaterThan(0);
});
