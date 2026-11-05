import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,baccaratSnapshotSchema,type BaccaratAction,type BaccaratSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { advanceBaccarat } from '@casual/baccarat';
import { baccaratRoomAdapter,restoreBaccaratRoom,type BaccaratRoom } from '../src/games/baccarat';
import { bindings,http,origin } from './helpers';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/baccarat/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<BaccaratSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:BaccaratSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:BaccaratRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<BaccaratRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:BaccaratAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'baccarat',adapterVersion:1,command}));
    await expect.poll(()=>events.find(e=>e.commandId===command.id)).toBeDefined();return events.find(e=>e.commandId===command.id)!;
  }};
}
it('uses the shared eight-seat lobby, chat, invitation and own-seat command flow without exposing the shoe',async()=>{
 const initial=await create('public');const a=await connect(initial.session);
 try{
  const peer=await(await http(`/${initial.session.inviteId}/join`,undefined,{name:'Peer'})).json<TableSessionResponse<BaccaratSnapshot>>();const b=await connect(peer.session);
  try{expect(await b.send({type:'StartBetting'})).toMatchObject({type:'error',code:'INVALID_ACTION'});expect(await a.send({type:'StartBetting'})).toMatchObject({type:'ack'});
   const id=crypto.randomUUID();const bet={type:'PlaceBet' as const,wager:{mainSide:'banker' as const,mainUnits:1000,tieUnits:1000}};expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect((await view(initial.session)).players[0]!.balanceUnits).toBe(98000);
   expect(await a.send(bet,{playerId:peer.session.playerId})).toMatchObject({type:'error',code:'SESSION_INVALID'});
   const chatId=crypto.randomUUID();a.ws.send(JSON.stringify({type:'chat',protocol:1,id:chatId,text:'Player or Banker?'}));await expect.poll(()=>a.events.some(e=>e.type==='ack'&&e.commandId===chatId)).toBe(true);
   for(let i=2;i<8;i++){const joined=await http(`/${initial.session.inviteId}/join`,undefined,{name:`Guest ${i}`});expect(joined.status).toBe(201);await joined.json();}const full=await http(`/${initial.session.inviteId}/join`,undefined,{name:'Ninth'});expect(full.status).toBe(409);await full.json();
   await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now()+60000;});await evictDurableObject(bindings.ROOMS.getByName(initial.session.inviteId));expect((await view(initial.session)).players[0]!.balanceUnits).toBe(98000);
   await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceBaccarat(r.engine,Date.now(),n=>n-1);});const snapshot=await view(initial.session);expect(snapshot.cards).toHaveLength(1);expect(snapshot.shoe.remaining).toBe(415);expect(snapshot.outcome).toBeNull();expect(snapshot.shoe).not.toHaveProperty('cards');expect(snapshot).not.toHaveProperty('engine');expect(snapshot).not.toHaveProperty('deal');expect(baccaratSnapshotSchema.safeParse(snapshot).success).toBe(true);
  }finally{b.ws.close();}
 }finally{a.ws.close();}
});
it('finishes the final departed dealing wager before deleting its room and chat, and rejects the old invite',async()=>{
 const initial=await create();const a=await connect(initial.session);
 try{await a.send({type:'StartBetting'});await a.send({type:'PlaceBet',wager:{mainSide:'player',mainUnits:1000,tieUnits:0}});
  await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceBaccarat(r.engine,Date.now(),n=>n-1);});expect(await a.send({type:'Leave'})).toMatchObject({type:'ack'});expect((await http(`/${initial.session.inviteId}/info`,undefined,undefined,'GET')).status).toBe(404);
  await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=10000;r.engine.deadline!-=10000;});await runDurableObjectAlarm(bindings.ROOMS.getByName(initial.session.inviteId));
  expect(await runInDurableObject(bindings.ROOMS.getByName(initial.session.inviteId),async(_instance,state)=>({room:await state.storage.get('room'),chat:await state.storage.get('chat'),alarm:await state.storage.getAlarm()}))).toEqual({room:undefined,chat:undefined,alarm:null});
 }finally{a.ws.close();}
});
it('fails closed on corrupt Baccarat cards, outcomes, wagers or account ownership without resetting balances',()=>{
 const room=baccaratRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});expect(restoreBaccaratRoom(room).room).toEqual(room);
 for(const change of [(r:BaccaratRoom)=>{r.engine.shoe[0]!.id=r.engine.shoe[1]!.id;},(r:BaccaratRoom)=>{r.engine.phase='dealing';},(r:BaccaratRoom)=>{r.engine.players[0]!.wager={mainSide:null,mainUnits:1000,tieUnits:0};},(r:BaccaratRoom)=>{r.members.one!.account={id:crypto.randomUUID(),expiresAt:10000};}]){const bad=structuredClone(room);change(bad);const before=JSON.stringify(bad);expect(()=>restoreBaccaratRoom(bad)).toThrowError(expect.objectContaining({code:'ROOM_STATE_INVALID'}));expect(JSON.stringify(bad)).toBe(before);}
});
it('can cancel uncommitted wagers and lets only the host skip the settled results pause',()=>{
 let room=baccaratRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});const apply=(action:BaccaratAction,now:number)=>{room=baccaratRoomAdapter.apply(room,baccaratRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),n=>n-1,now);};
 apply({type:'StartBetting'},100);apply({type:'PlaceBet',wager:{mainSide:'banker',mainUnits:1000,tieUnits:0}},101);apply({type:'PlaceBet',wager:{mainSide:null,mainUnits:0,tieUnits:0}},102);expect(room.engine.players[0]!.balanceUnits).toBe(100000);
 apply({type:'PlaceBet',wager:{mainSide:'player',mainUnits:1000,tieUnits:0}},103);room=baccaratRoomAdapter.expire(room,n=>n-1,30000);expect(room.engine.phase).toBe('results');apply({type:'NextRound'},30001);expect(room.engine.phase).toBe('betting');expect(room.engine.roundId).toBe(2);expect(room.engine.history).toHaveLength(1);
});
it('respects a reservation expiring before the betting deadline even when both alarms arrive late',()=>{
 let room=baccaratRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});
 for(const action of [{type:'StartBetting'},{type:'PlaceBet',wager:{mainSide:'player',mainUnits:1000,tieUnits:0}}])room=baccaratRoomAdapter.apply(room,baccaratRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),n=>n-1,101);
 room.members.one!.reservationDeadline=10000;room=baccaratRoomAdapter.expire(room,n=>n-1,30000);expect(room.engine.phase).toBe('waiting');expect(room.engine.players).toEqual([]);expect(room.engine.history).toEqual([]);expect(room.engine.cursor).toBe(0);
});
