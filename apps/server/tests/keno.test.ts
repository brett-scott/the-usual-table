import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,kenoSnapshotSchema,type KenoAction,type KenoSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { advanceKeno } from '@casual/keno';
import { kenoRoomAdapter,restoreKenoRoom,type KenoRoom } from '../src/games/keno';
import { bindings,http,origin } from './helpers';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/keno/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<KenoSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:KenoSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:KenoRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<KenoRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:KenoAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'keno',adapterVersion:1,command}));
    await expect.poll(()=>events.find(e=>e.commandId===command.id)).toBeDefined();return events.find(e=>e.commandId===command.id)!;
  }};
}
it('shares eight-seat Keno, authenticates commands/chat, and reveals no future numbers through eviction',async()=>{
 const initial=await create('public');const a=await connect(initial.session);try{
  const peer=await(await http(`/${initial.session.inviteId}/join`,undefined,{name:'Peer'})).json<TableSessionResponse<KenoSnapshot>>();const b=await connect(peer.session);try{
   expect(await b.send({type:'StartBetting'})).toMatchObject({type:'error',code:'INVALID_ACTION'});expect(await a.send({type:'StartBetting'})).toMatchObject({type:'ack'});const id=crypto.randomUUID();const action={type:'PlaceBet' as const,wager:{numbers:[1,2],amountUnits:1000}};await a.send(action,{id});await a.send(action,{id});expect((await view(initial.session)).players[0]!.balanceUnits).toBe(99000);expect(await a.send(action,{playerId:peer.session.playerId})).toMatchObject({type:'error',code:'SESSION_INVALID'});
   const chat=crypto.randomUUID();a.ws.send(JSON.stringify({type:'chat',protocol:1,id:chat,text:'Lucky numbers'}));await expect.poll(()=>b.events.some(e=>e.type==='chat'&&JSON.stringify(e).includes('Lucky numbers'))).toBe(true);
   for(let n=2;n<8;n++){const joined=await http(`/${initial.session.inviteId}/join`,undefined,{name:`Guest ${n}`});expect(joined.status).toBe(201);await joined.json();}const full=await http(`/${initial.session.inviteId}/join`,undefined,{name:'Ninth'});expect(full.status).toBe(409);await full.json();
   await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceKeno(r.engine,Date.now(),()=>0);});let snapshot=await view(initial.session);expect(snapshot.phase).toBe('drawing');expect(snapshot.revealed).toEqual([]);expect(snapshot).not.toHaveProperty('draw');expect(snapshot).not.toHaveProperty('engine');expect(snapshot.history).toEqual([]);expect(kenoSnapshotSchema.safeParse(snapshot).success).toBe(true);
   await evictDurableObject(bindings.ROOMS.getByName(initial.session.inviteId));expect((await view(peer.session)).revealed).toEqual([]);await edit(initial.session.inviteId,r=>{r.engine=advanceKeno(r.engine,r.engine.deadline!,()=>{throw Error('No redraw');});});snapshot=await view(initial.session);expect(snapshot.revealed).toEqual([1]);expect(snapshot.history).toEqual([]);
   await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=10000;r.engine.deadline!-=10000;});const final=await view(initial.session);expect(final.phase).toBe('results');expect(final.revealed).toEqual([1,2,3,4,5,6,7,8,9,10]);expect((await view(peer.session)).history).toEqual(final.history);expect(final.players[0]!.balanceUnits).toBe(115800);
  }finally{b.ws.close();}
 }finally{a.ws.close();}
});
it('settles the final departed ticket before deleting room, alarm and chat',async()=>{
 const initial=await create();const a=await connect(initial.session);try{
  await a.send({type:'StartBetting'});await a.send({type:'PlaceBet',wager:{numbers:[1],amountUnits:1000}});await edit(initial.session.inviteId,r=>{r.engine.deadline=Date.now();r.engine=advanceKeno(r.engine,Date.now(),()=>0);});await a.send({type:'Leave'});const hidden=await http(`/${initial.session.inviteId}/info`,undefined,undefined,'GET');expect(hidden.status).toBe(404);await hidden.json();await edit(initial.session.inviteId,r=>{r.engine.startedAt!-=10000;r.engine.deadline!-=10000;});await runDurableObjectAlarm(bindings.ROOMS.getByName(initial.session.inviteId));expect(await runInDurableObject(bindings.ROOMS.getByName(initial.session.inviteId),async(_instance,storage)=>({room:await storage.storage.get('room'),chat:await storage.storage.get('chat'),alarm:await storage.storage.getAlarm()}))).toEqual({room:undefined,chat:undefined,alarm:null});
 }finally{a.ws.close();}
});
it('validates restored draws and balances, pauses empty rounds, and preserves pre-close expiry on late alarms',()=>{
 let room=kenoRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});const apply=(action:KenoAction,now:number)=>{room=kenoRoomAdapter.apply(room,kenoRoomAdapter.parseCommand({id:crypto.randomUUID(),playerId:'one',roundId:room.engine.roundId,revision:room.revision,action}),()=>0,now);};expect(restoreKenoRoom(room).room).toEqual(room);apply({type:'StartBetting'},100);apply({type:'PlaceBet',wager:{numbers:[1,2],amountUnits:0}},101);room=kenoRoomAdapter.expire(room,()=>{throw Error('No bets');},15100);expect(room.engine.phase).toBe('waiting');apply({type:'StartBetting'},16000);apply({type:'PlaceBet',wager:{numbers:[1,2],amountUnits:1000}},16001);const disconnected=structuredClone(room);disconnected.members.one!.reservationDeadline=20000;expect(kenoRoomAdapter.expire(disconnected,()=>0,50000).engine.players).toEqual([]);
 room=kenoRoomAdapter.expire(room,()=>0,31000);expect(()=>apply({type:'NextRound'},31001)).toThrow('not available');expect(kenoRoomAdapter.nextAlarm(room)).toBe(32000);const corrupt=structuredClone(room);corrupt.engine.draw![0]=corrupt.engine.draw![1]!;const before=JSON.stringify(corrupt);expect(()=>restoreKenoRoom(corrupt)).toThrow('safely restored');expect(JSON.stringify(corrupt)).toBe(before);
});
