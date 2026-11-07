import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,rouletteSnapshotSchema,type RouletteAction,type RouletteSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { advanceRoulette } from '@casual/roulette';
import { rouletteRoomAdapter,restoreRouletteRoom,type RouletteRoom } from '../src/games/roulette';
import { bindings,http,origin } from './helpers';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/roulette/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<RouletteSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:RouletteSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:RouletteRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<RouletteRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:RouletteAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'roulette',adapterVersion:1,command}));
    await expect.poll(()=>events.find(e=>e.commandId===command.id)).toBeDefined();return events.find(e=>e.commandId===command.id)!;
  }};
}
it('uses shared eight-seat lobbies, own-seat commands and chat, and hides the future winner through eviction',async()=>{
 const initial=await create('public');expect(initial.gameId).toBe('roulette');const a=await connect(initial.session);
 try{const peer=await(await http(`/${initial.session.inviteId}/join`,undefined,{name:'Peer'})).json<TableSessionResponse<RouletteSnapshot>>();const b=await connect(peer.session);
  try{expect(await b.send({type:'StartBetting'})).toMatchObject({type:'error',code:'INVALID_ACTION'});expect(await a.send({type:'StartBetting'})).toMatchObject({type:'ack'});
   const id=crypto.randomUUID();const bet={type:'PlaceBet' as const,wager:[{betId:'straight-0',amountUnits:1000}]};expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect(await a.send(bet,{id})).toMatchObject({type:'ack'});expect((await view(initial.session)).players[0]!.balanceUnits).toBe(99000);expect(await a.send(bet,{playerId:peer.session.playerId})).toMatchObject({type:'error',code:'SESSION_INVALID'});
   const chatId=crypto.randomUUID();a.ws.send(JSON.stringify({type:'chat',protocol:1,id:chatId,text:'Go duck!'}));await expect.poll(()=>b.events.some(e=>e.type==='chat'&&JSON.stringify(e).includes('Go duck!'))).toBe(true);
   for(let i=2;i<8;i++){const joined=await http(`/${initial.session.inviteId}/join`,undefined,{name:`Guest ${i}`});expect(joined.status).toBe(201);await joined.json();}const full=await http(`/${initial.session.inviteId}/join`,undefined,{name:'Ninth'});expect(full.status).toBe(409);await full.json();
   await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceRoulette(r.engine,Date.now(),()=>0);});const running=await view(initial.session);expect(running.phase).toBe('spinning');expect(running.winner).toBeNull();expect(running).not.toHaveProperty('seeds');expect(running).not.toHaveProperty('engine');expect(rouletteSnapshotSchema.safeParse(running).success).toBe(true);
   await evictDurableObject(bindings.ROOMS.getByName(initial.session.inviteId));const resumed=await view(peer.session);expect(resumed.counts).toEqual(running.counts);expect(resumed.roundId).toBe(running.roundId);expect(resumed.winner).toBeNull();
   await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=8000;r.engine.deadline!-=8000;});const final=await view(initial.session);const shared=await view(peer.session);expect(final.phase).toBe('results');expect(final.winner).toBe(0);expect(shared.winner).toBe(final.winner);expect(shared.history).toEqual(final.history);expect(final.players[0]!.balanceUnits).toBe(135000);
  }finally{b.ws.close();}
 }finally{a.ws.close();}
});
it('finishes the last departed racing wager before deleting the room and chat',async()=>{
 const initial=await create();const a=await connect(initial.session);
 try{await a.send({type:'StartBetting'});await a.send({type:'PlaceBet',wager:[{betId:'straight-0',amountUnits:1000}]});await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceRoulette(r.engine,Date.now(),()=>0);});expect(await a.send({type:'Leave'})).toMatchObject({type:'ack'});const hidden=await http(`/${initial.session.inviteId}/info`,undefined,undefined,'GET');expect(hidden.status).toBe(404);await hidden.json();
  await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=8000;r.engine.deadline!-=8000;});await runDurableObjectAlarm(bindings.ROOMS.getByName(initial.session.inviteId));expect(await runInDurableObject(bindings.ROOMS.getByName(initial.session.inviteId),async(_instance,state)=>({room:await state.storage.get('room'),chat:await state.storage.get('chat'),alarm:await state.storage.getAlarm()}))).toEqual({room:undefined,chat:undefined,alarm:null});
 }finally{a.ws.close();}
});
it('rejects corrupt persisted races, payouts and account ownership without replacing balances',()=>{
 const room=rouletteRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:n=>n-1});expect(restoreRouletteRoom(room).room).toEqual(room);
 for(const change of [(r:RouletteRoom)=>{r.engine.counts.spins=1;},(r:RouletteRoom)=>{r.engine.phase='spinning';},(r:RouletteRoom)=>{r.engine.players[0]!.wager=[{betId:'invalid',amountUnits:1000}];},(r:RouletteRoom)=>{r.members.one!.account={id:crypto.randomUUID(),expiresAt:8000};}]){const bad=structuredClone(room);change(bad);const before=JSON.stringify(bad);expect(()=>restoreRouletteRoom(bad)).toThrowError(expect.objectContaining({code:'ROOM_STATE_INVALID'}));expect(JSON.stringify(bad)).toBe(before);}
});
it('cancels editable bets, pauses empty rounds and permits only settled results to be skipped',()=>{
 let room=rouletteRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});const apply=(action:RouletteAction,now:number)=>{room=rouletteRoomAdapter.apply(room,rouletteRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),()=>0,now);};
 apply({type:'StartBetting'},100);apply({type:'PlaceBet',wager:[{betId:'straight-0',amountUnits:1000}]},101);apply({type:'PlaceBet',wager:[]},102);expect(room.engine.players[0]!.balanceUnits).toBe(100000);room=rouletteRoomAdapter.expire(room,()=>{throw new Error('Empty draw');},15100);expect(room.engine.phase).toBe('waiting');
 apply({type:'StartBetting'},15200);apply({type:'PlaceBet',wager:[{betId:'straight-0',amountUnits:1000}]},15201);room=rouletteRoomAdapter.expire(room,()=>0,30200);expect(room.engine.phase).toBe('spinning');expect(()=>apply({type:'NextRound'},30201)).toThrow('not available');room=rouletteRoomAdapter.expire(room,()=>0,38200);apply({type:'NextRound'},38201);expect(room.engine.phase).toBe('betting');expect(room.engine.history).toHaveLength(1);
});
it('honors a reservation that expired before close even if the betting alarm arrives late',()=>{
 let room=rouletteRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});for(const action of [{type:'StartBetting'},{type:'PlaceBet',wager:[{betId:'red',amountUnits:1000}]}])room=rouletteRoomAdapter.apply(room,rouletteRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),()=>0,101);
 room.members.one!.reservationDeadline=10000;room=rouletteRoomAdapter.expire(room,()=>{throw new Error('Expired wager must not spin');},30000);expect(room.engine.phase).toBe('waiting');expect(room.engine.players).toEqual([]);expect(room.engine.counts.spins).toBe(0);
});
