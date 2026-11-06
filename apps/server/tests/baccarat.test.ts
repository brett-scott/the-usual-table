import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,BACCARAT_ROADMAP_CAPABILITY,seedBaccaratRoadmap,baccaratSnapshotSchema,type BaccaratAction,type BaccaratSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { advanceBaccarat } from '@casual/baccarat';
import { baccaratRoomAdapter,restoreBaccaratRoom,type BaccaratRoom } from '../src/games/baccarat';
import { bindings,http,origin } from './helpers';
import { gameAdapters } from '../src/games/registry';
import { parseGameCommand } from '../src/games/commands';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/baccarat/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<BaccaratSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:BaccaratSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:BaccaratRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<BaccaratRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession,roadmap=false){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}${roadmap?`, ${BACCARAT_ROADMAP_CAPABILITY}`:''}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:BaccaratAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'baccarat',adapterVersion:2,command}));
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
it('persists expanded lobby roads through eviction and shares them with late joiners while legacy clients keep twenty results',async()=>{
 const initial=await create();const session=initial.session;
 const results=Array.from({length:35},(_,i)=>({roundId:35-i,outcome:'banker' as const,playerTotal:5,bankerTotal:6}));
 await edit(session.inviteId,r=>{r.engine.roundId=35;r.engine.history=results.slice(0,20);r.engine.roadmap=seedBaccaratRoadmap(results);});
 await evictDurableObject(bindings.ROOMS.getByName(session.inviteId));
 const legacy=await view(session);expect(legacy.history).toHaveLength(20);expect(legacy).not.toHaveProperty('roadmap');expect(baccaratSnapshotSchema.omit({roadmap:true}).strict().safeParse(legacy).success).toBe(true);
 const response=await http(`/${session.inviteId}/snapshot?capabilities=${BACCARAT_ROADMAP_CAPABILITY}`,session,undefined,'GET');expect(response.status).toBe(200);const confirmed=baccaratSnapshotSchema.parse((await response.json<{snapshot:BaccaratSnapshot}>()).snapshot);expect(confirmed.roadmap).toMatchObject({completedHands:35,bankerWins:35,bankerSixWins:35,currentStreak:35});expect(confirmed.roadmap!.results).toHaveLength(35);
 const joined=await http(`/${session.inviteId}/join?capabilities=${BACCARAT_ROADMAP_CAPABILITY}`,undefined,{name:'Late viewer'});expect(joined.status).toBe(201);expect((await joined.json<TableSessionResponse<BaccaratSnapshot>>()).snapshot.roadmap).toEqual(confirmed.roadmap);
 const socket=await connect(session,true);try{await expect.poll(()=>socket.events.find(e=>e.type==='game-snapshot')).toMatchObject({snapshot:{roadmap:{completedHands:35}}});}finally{socket.ws.close();}
});
it('migrates old twenty-result rooms without inventing earlier data or changing live cards, bets and balances',()=>{
 let room=baccaratRoomAdapter.create({roomId:'e'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});
 room=baccaratRoomAdapter.apply(room,baccaratRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',revision:room.revision,roundId:room.engine.roundId,action:{type:'StartBetting'}}),n=>n-1,101);
 const old=structuredClone(room);delete old.engine.roadmap;old.engine.roundId=50;old.engine.history=Array.from({length:20},(_,i)=>({roundId:49-i,outcome:'player',playerTotal:8,bankerTotal:6}));
 const before=structuredClone(old);const migrated=restoreBaccaratRoom(old);expect(migrated.migrated).toBe(true);expect(migrated.room.engine.roadmap).toMatchObject({firstRoundId:30,completedHands:20,playerWins:20});const after=structuredClone(migrated.room);delete after.engine.roadmap;expect(after).toEqual(before);expect(restoreBaccaratRoom(migrated.room).migrated).toBe(false);
 const bad=structuredClone(migrated.room);bad.engine.roadmap!.playerWins++;expect(()=>restoreBaccaratRoom(bad)).toThrow('inconsistent');
});
it('migrates explicitly supported version-one storage without replacing wagers, while rejecting old wire commands',()=>{
 const current=baccaratRoomAdapter.create({roomId:'d'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});
 const old={...structuredClone(current),adapterVersion:1};const before=structuredClone(old);
 const restored=gameAdapters.restore(old,101);expect(restored.migrated).toBe(true);expect(restored.room.adapterVersion).toBe(2);expect({...restored.room,adapterVersion:1}).toEqual(before);expect(old).toEqual(before);
 expect(()=>gameAdapters.restore({...old,adapterVersion:99},101)).toThrow('adapter version');
 expect(()=>parseGameCommand(restored.room,{type:'game-command',protocol:1,gameId:'baccarat',adapterVersion:1,command:{id:crypto.randomUUID(),playerId:'one',roundId:0,revision:0,action:{type:'StartBetting'}}})).toThrow('different game version');
 const invalid=structuredClone(old);invalid.engine.players[0]!.wager.sideBets={playerPairUnits:1000,bankerPairUnits:0,superSixUnits:0};expect(()=>gameAdapters.restore(invalid,101)).toThrow('inconsistent wagers');
});
