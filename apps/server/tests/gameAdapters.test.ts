import { expect,it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { z } from 'zod';
import { BLACKJACK_TABLE_RULES,GAME_ADAPTER_CAPABILITY,tableInfoSchema } from '@casual/protocol';
import { GameAdapterRegistry,hostGame,gameAdapters } from '../src/games/registry';
import { blackjackRoomAdapter } from '../src/games/blackjack';
import { parseGameCommand } from '../src/games/commands';
import type { GameRoomAdapter,HostedRoom,SeatIdentity } from '../src/games/contracts';
import { newMember,disconnectMember } from '../src/roomMembership';
import { create,origin,http,inspect } from './helpers';

// A non-card conformance fixture. It is never registered in the deployed Worker.
interface CounterRoom extends HostedRoom {seats:SeatIdentity[];roundKey:string;counter:number;deadline:number|null;secret:string}
const counterCommand=z.object({id:z.string().uuid(),playerId:z.string(),roundKey:z.literal('spin-A'),action:z.object({type:z.literal('Increment')})}).strict();
const counter:GameRoomAdapter<CounterRoom>={
  gameId:'baccarat',version:7,capacity:6,minPlayers:2,guestStartingChips:75,minBuyInUnits:1000,buyInStepUnits:100,accountFunding:'temporary-only',
  create:input=>({schema:100,id:input.roomId,revision:0,gameId:'baccarat',adapterVersion:7,managerId:input.player.id,
    members:{[input.player.id]:newMember(input.credentialHash,input.now)},lastActivity:input.now,tickets:[],receipts:[],commandRates:{},
    seats:[input.player],roundKey:'spin-A',counter:0,deadline:input.now+500,secret:'private draw'}),
  restore(raw){if(!raw||typeof raw!=='object'||!('counter' in raw)||!Number.isInteger(raw.counter))throw new Error('Invalid counter state');return{room:raw as CounterRoom,migrated:false};},
  players:r=>r.seats,lobbyPhase:r=>r.deadline===null?'waiting':'playing',join:(r,p)=>{r.seats.push(p);},
  snapshot:(r,id)=>({you:id,revision:r.revision,roundKey:r.roundKey,counter:r.counter}),parseCommand:raw=>counterCommand.parse(raw),
  apply:(r,command)=>({...r,counter:r.counter+(counterCommand.parse(command).action.type==='Increment'?1:0),revision:r.revision+1}),
  expire:(r,_random,now)=>r.deadline!==null&&r.deadline<=now?{...r,deadline:null,revision:r.revision+1}:r,
  collectSeats:r=>{const before=r.seats.length;r.seats=r.seats.filter(p=>!r.members[p.id]?.leaveAfterRound);return before!==r.seats.length;},nextAlarm:r=>r.deadline,
  fund:()=>{throw new Error('No house funding for this adapter');},flushWallet:async()=>{},
};
it('hosts a non-card adapter with its own version, capacity, round key, commands, timer and private projection',()=>{
  const registry=new GameAdapterRegistry([hostGame(blackjackRoomAdapter),hostGame(counter)],['blackjack','baccarat']);
  const adapter=registry.available('baccarat');let room=adapter.create({roomId:'a'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'b'.repeat(64),now:100,random:()=>0});
  expect(adapter.capacity).toBe(6);expect(adapter.buyInStepUnits).toBe(100);
  adapter.join(room,{id:'two',name:'Two',seat:5});room.members.two=newMember('c'.repeat(64),100);
  expect(adapter.players(room).map(p=>p.seat)).toEqual([0,5]);expect(adapter.nextAlarm(room)).toBe(600);
  const command={id:crypto.randomUUID(),playerId:'one',roundKey:'spin-A',action:{type:'Increment'}};
  const envelope={type:'game-command',protocol:1,gameId:'baccarat',adapterVersion:7,command};
  room=adapter.apply(room,parseGameCommand(room,envelope,registry),()=>0,200);
  expect(adapter.snapshot(room,'one')).toEqual({you:'one',revision:1,roundKey:'spin-A',counter:1});
  expect(JSON.stringify(adapter.snapshot(room,'one'))).not.toContain('private draw');
  room=registry.restore(JSON.parse(JSON.stringify(room)),300).room;room=adapter.expire(room,()=>0,600);
  expect(adapter.lobbyPhase(room)).toBe('waiting');expect(adapter.nextAlarm(room)).toBeNull();
  room.members.one!.connected=true;room.members.one!.controllerId='controller';room.members.one!.presenceDeadline=1000;
  expect(disconnectMember(room,'one',700)).toBe(true);expect(room.members.one!.reservationDeadline).toBe(60700);
  expect(()=>parseGameCommand(room,{...envelope,gameId:'blackjack'},registry)).toThrow('different game');
  expect(()=>parseGameCommand(room,{...envelope,adapterVersion:1},registry)).toThrow('different game version');
  expect(()=>parseGameCommand(room,command,registry)).toThrow('versioned game command');
  expect(()=>adapter.fund(room,'one',crypto.randomUUID(),1000,crypto.randomUUID())).toThrow('No house funding');
});
it('keeps future games unavailable and rejects unknown or corrupted stored adapter identities without resetting them',()=>{
  for(const id of ['roulette','texas-holdem','keno','penguin-cross','unknown'])expect(()=>gameAdapters.available(id)).toThrow('not available');
  const room=blackjackRoomAdapter.create({roomId:'a'.repeat(32),player:{id:'one',name:'One',seat:0},credentialHash:'b'.repeat(64),now:100,random:max=>max-1});
  expect(gameAdapters.restore(room,100).room.id).toBe(room.id);
  for(const metadata of [{gameId:'roulette'},{gameId:null},{adapterVersion:9},{adapterVersion:null}]){
    const invalid={...room,...metadata};const before=JSON.stringify(invalid);expect(()=>gameAdapters.restore(invalid,100)).toThrow('adapter version');expect(JSON.stringify(invalid)).toBe(before);
  }
  const legacy={...room};delete legacy.gameId;delete legacy.adapterVersion;expect(gameAdapters.restore(legacy,100).room.id).toBe(room.id);
  expect(()=>new GameAdapterRegistry([hostGame(blackjackRoomAdapter),hostGame(blackjackRoomAdapter)])).toThrow('duplicate');
  expect(()=>new GameAdapterRegistry([hostGame({...counter,gameId:'texas-holdem',accountFunding:'house'})])).toThrow('transfer-backed');
});
it('creates a game-scoped table, exposes only entry metadata and ignores a spoofed game header',async()=>{
  const response=await SELF.fetch('https://api.test/api/v1/games/blackjack/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Game-Id':'roulette'},body:JSON.stringify({name:'Adapter host',visibility:'private'})});
  expect(response.status).toBe(201);const created=await response.json<{gameId:string;adapterVersion:number;session:{inviteId:string}}>();
  expect(created).toMatchObject({gameId:'blackjack',adapterVersion:1});
  const info=await http(`/${created.session.inviteId}/info`,undefined,undefined,'GET');expect(info.status).toBe(200);
  expect(tableInfoSchema.parse(await info.json())).toEqual({roomId:created.session.inviteId,gameId:'blackjack',adapterVersion:1,visibility:'private',...BLACKJACK_TABLE_RULES});
  const unavailable=await SELF.fetch('https://api.test/api/v1/games/roulette/rooms',{method:'POST',headers:{Origin:origin},body:JSON.stringify({name:'No engine'})});
  expect(unavailable.status).toBe(400);expect(await unavailable.json()).toMatchObject({code:'GAME_UNAVAILABLE'});
});
it('negotiates versioned snapshots while legacy Blackjack clients retain their wire format',async()=>{
  const initial=await create('Versioned');const ticket=await http(`/${initial.session.inviteId}/ticket`,initial.session,{claimId:crypto.randomUUID(),claimVersion:0});
  const token=await ticket.json<{ticket:string}>();
  const response=await SELF.fetch(`https://api.test/api/v1/rooms/${initial.session.inviteId}/socket`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`casual-v1, ticket.${token.ticket}, ${GAME_ADAPTER_CAPABILITY}`}});
  expect(response.status).toBe(101);const ws=response.webSocket!;ws.accept();
  const received:Record<string,unknown>[]=[];ws.addEventListener('message',event=>{received.push(JSON.parse(String(event.data)));});ws.send('snapshot');
  await expect.poll(()=>received.some(event=>event.type==='game-snapshot')).toBe(true);
  expect(received.find(event=>event.type==='game-snapshot')).toMatchObject({gameId:'blackjack',adapterVersion:1,protocol:1});
  const state=await inspect(initial.session.inviteId,r=>r);const id=crypto.randomUUID();
  ws.send(JSON.stringify({type:'game-command',protocol:1,gameId:'roulette',adapterVersion:1,command:{protocol:1,id,playerId:initial.session.playerId,revision:state.revision,roundId:0,action:{type:'StartBetting'}}}));
  await expect.poll(()=>received.some(event=>event.type==='error'&&event.commandId===id&&event.code==='WRONG_GAME')).toBe(true);
  expect(await inspect(initial.session.inviteId,r=>r.bettingDeadline)).toBeNull();
  ws.close(1000,'done');
  // Existing runtime suites exercise untagged legacy creation, commands and snapshots.
});
