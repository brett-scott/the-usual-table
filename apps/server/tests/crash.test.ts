import { SELF,evictDurableObject,runInDurableObject,runDurableObjectAlarm } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { GAME_ADAPTER_CAPABILITY,type CrashAction,type CrashSnapshot,type GuestSession,type TableSessionResponse } from '@casual/protocol';
import { targetTime } from '@casual/crash';
import { crashRoomAdapter,restoreCrashRoom,type CrashRoom } from '../src/games/crash';
import { bindings,http,origin } from './helpers';

async function create(visibility='private'){
  const result=await SELF.fetch('https://example.test/api/v1/games/crash/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Pilot',visibility})});
  expect(result.status).toBe(201);return result.json<TableSessionResponse<CrashSnapshot>>();
}
async function view(session:GuestSession){const response=await http(`/${session.inviteId}/snapshot`,session,undefined,'GET');expect(response.status).toBe(200);return(await response.json<{snapshot:CrashSnapshot}>()).snapshot;}
async function edit(invite:string,change:(r:CrashRoom)=>void){return runInDurableObject(bindings.ROOMS.getByName(invite),async(_instance,state)=>{const room=(await state.storage.get<CrashRoom>('room'))!;change(room);await state.storage.put('room',room);});}
async function connect(session:GuestSession){
  const initial=await view(session);const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:initial.claimVersion});
  const result=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}, ${GAME_ADAPTER_CAPABILITY}, casual-chat-v1`}});
  expect(result.status).toBe(101);const ws=result.webSocket!;ws.accept();
  const events:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{events.push(JSON.parse(String(event.data)));});
  return{ws,events,async send(action:CrashAction,overrides:Record<string,unknown>={}){
    const s=await view(session);const command={id:crypto.randomUUID(),playerId:session.playerId,roundId:s.roundId,revision:s.revision,action,...overrides};
    ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'crash',adapterVersion:1,command}));
    await expect.poll(()=>events.find(e=>e.commandId===command.id)).toBeDefined();return events.find(e=>e.commandId===command.id)!;
  }};
}
it('creates an eight-seat Crash table with separate public discovery, chat and legacy-client rejection',async()=>{
  const initial=await create('public');const session=initial.session;const a=await connect(session);
  try{
    for(let i=1;i<8;i++)expect((await http(`/${session.inviteId}/join`,undefined,{name:`Player ${i}`})).status).toBe(201);
    expect((await view(session)).players.map(p=>p.seat)).toEqual([0,1,2,3,4,5,6,7]);
    expect((await http(`/${session.inviteId}/join`,undefined,{name:'Ninth'})).status).toBe(409);
    const id=crypto.randomUUID();a.ws.send(JSON.stringify({type:'chat',protocol:1,id,text:'Ready to fly'}));await expect.poll(()=>a.events.some(e=>e.type==='ack'&&e.commandId===id)).toBe(true);
    const chat=a.events.find(e=>e.type==='chat'&&JSON.stringify(e).includes('Ready to fly'));expect(chat).toBeDefined();
    const blackjack=await SELF.fetch('https://example.test/api/v1/games/blackjack/lobbies',{headers:{Origin:origin}});expect(JSON.stringify(await blackjack.json())).not.toContain(session.inviteId);
    const ticket=await http(`/${session.inviteId}/ticket`,session,{claimId:crypto.randomUUID(),claimVersion:(await view(session)).claimVersion});
    const response=await SELF.fetch(`https://example.test/api/v1/rooms/${session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${(await ticket.json<{ticket:string}>()).ticket}`}});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'CLIENT_INCOMPATIBLE'});
  }finally{a.ws.close();}
});
it('keeps outcomes private, deduplicates wagers and cash-outs, and enforces host and seat ownership',async()=>{
  const initial=await create();const session=initial.session;const joined=await(await http(`/${session.inviteId}/join`,undefined,{name:'Peer'})).json<TableSessionResponse<CrashSnapshot>>();
  const a=await connect(session);const b=await connect(joined.session);
  try{
    expect(await b.send({type:'StartBetting'})).toMatchObject({type:'error',code:'INVALID_ACTION'});
    expect(await a.send({type:'StartBetting'})).toMatchObject({type:'ack'});
    const id=crypto.randomUUID();expect(await a.send({type:'PlaceBet',amountUnits:1000,autoCashoutCents:null},{id})).toMatchObject({type:'ack'});
    expect(await a.send({type:'PlaceBet',amountUnits:1000,autoCashoutCents:null},{id})).toMatchObject({type:'ack'});
    expect((await view(session)).players[0]!.balanceUnits).toBe(99000);
    expect(await a.send({type:'PlaceBet',amountUnits:1000,autoCashoutCents:null},{playerId:joined.session.playerId})).toMatchObject({type:'error',code:'SESSION_INVALID'});
    await edit(session.inviteId,r=>{r.engine.phase='running';r.engine.startedAt=Date.now();r.engine.outcome={multiplierCents:1000,capped:false};r.engine.deadline=targetTime(r.engine.startedAt,1000);});
    const running=await view(session);expect(running.outcome).toBeNull();expect(running).not.toHaveProperty('deadline');expect(running).not.toHaveProperty('engine');
    const cashId=crypto.randomUUID();expect(await a.send({type:'CashOut'},{id:cashId})).toMatchObject({type:'ack'});const balance=(await view(session)).players[0]!.balanceUnits;
    expect(await a.send({type:'CashOut'},{id:cashId})).toMatchObject({type:'ack'});expect((await view(session)).players[0]!.balanceUnits).toBe(balance);
    expect(await a.send({type:'CashOut'})).toMatchObject({type:'error',code:'INVALID_ACTION'});
    await evictDurableObject(bindings.ROOMS.getByName(session.inviteId));expect((await view(session)).players[0]!.balanceUnits).toBe(balance);
  }finally{a.ws.close();b.ws.close();}
});
it('finishes departed live wagers through delayed alarms, rejects old invitations and deletes all final room state',async()=>{
  const initial=await create();const session=initial.session;const a=await connect(session);
  try{
    await a.send({type:'StartBetting'});await a.send({type:'PlaceBet',amountUnits:1000,autoCashoutCents:150});
    expect(await a.send({type:'Leave'})).toMatchObject({type:'ack'});
    expect((await http(`/${session.inviteId}/info`,undefined,undefined,'GET')).status).toBe(404);
    await edit(session.inviteId,r=>{r.engine.phase='running';r.engine.startedAt=Date.now()-10000;r.engine.outcome={multiplierCents:200,capped:false};r.engine.deadline=targetTime(r.engine.startedAt,200);});
    await runDurableObjectAlarm(bindings.ROOMS.getByName(session.inviteId));
    expect(await runInDurableObject(bindings.ROOMS.getByName(session.inviteId),async(_instance,state)=>({room:await state.storage.get('room'),chat:await state.storage.get('chat'),alarm:await state.storage.getAlarm()}))).toEqual({room:undefined,chat:undefined,alarm:null});
  }finally{a.ws.close();}
});
it('fails closed on corrupt Crash accounting, phase and ownership instead of resetting chips',()=>{
  const room=crashRoomAdapter.create({roomId:'f'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'a'.repeat(64),now:100,random:()=>0});
  expect(restoreCrashRoom(room).room).toEqual(room);
  for(const mutate of [(r:CrashRoom)=>{r.engine.players[0]!.balanceUnits=-1;},(r:CrashRoom)=>{r.engine.phase='running';},(r:CrashRoom)=>{r.members.one!.account={id:crypto.randomUUID(),expiresAt:1000};},(r:CrashRoom)=>{r.engine.players[0]!.returnedUnits=1000;}]){
    const bad=structuredClone(room);mutate(bad);const before=JSON.stringify(bad);expect(()=>restoreCrashRoom(bad)).toThrowError(expect.objectContaining({code:'ROOM_STATE_INVALID'}));expect(JSON.stringify(bad)).toBe(before);
  }
});
