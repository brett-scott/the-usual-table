import { expect,type Page,type WebSocketRoute } from '@playwright/test';
import { CRASH_RULES,CRASH_PROGRESS_CAPABILITY,type WalletSummary } from '@casual/protocol';
import { crashRoomAdapter,crashSnapshot,type CrashRoom } from '../../apps/server/src/games/crash';
import { newMember } from '../../apps/server/src/roomMembership';
import { accountId,providerFixture } from './authFixture';

/** Isolated browser transport fixture; no production outcome/clock controls are exposed. */
export async function crashFixture(page:Page,{saved=false,players=1}:{saved?:boolean;players?:number}={}){
  if(saved)await providerFixture(page,'google','success','Crash pilot');
  const roomId='b'.repeat(32);const playerId='pilot';let time=Date.now();let available=1000000;let created=false;let returns=0;
  let room:CrashRoom=crashRoomAdapter.create({roomId,player:{id:playerId,name:saved?'Crash pilot':'Pilot',seat:0},credentialHash:'c'.repeat(64),now:time,random:()=>0});
  const sockets=new Set<WebSocketRoute>();let holdingUpdates=false;
  for(let i=1;i<players;i++){const id=`peer-${i}`;crashRoomAdapter.join(room,{id,name:`Flyer ${i}`,seat:i});room.members[id]=newMember('e'.repeat(64),time);}
  // Simulated connections stay present while multi-round tests fast-forward the fixture clock.
  for(const m of Object.values(room.members)){m.connected=true;m.controllerId='controller';m.presenceDeadline=time+3600000;m.reservationDeadline=null;}
  const wallet=():WalletSummary=>({contract:1,currency:'virtual-chips',unitsPerChip:100,accountId,status:'active',version:room.revision+1,availableUnits:available,
    atTablesUnits:created?room.engine.players[0]!.balanceUnits+(['betting','running'].includes(room.engine.phase)?room.engine.players[0]!.betUnits-room.engine.players[0]!.returnedUnits:0):0,pendingReturnUnits:0});
  function snapshot(){const value=crashSnapshot(room,playerId,{now:time,capabilities:[CRASH_PROGRESS_CAPABILITY]});if(saved){value.wallet={status:'active',error:null};value.legalActions=value.legalActions.filter(a=>a!=='Refill');}return value;}
  const session={inviteId:roomId,playerId,credential:'d'.repeat(64),...(saved?{funding:'account' as const}:{})};
  function broadcast(){if(holdingUpdates)return;for(const socket of sockets)socket.send(JSON.stringify({type:'game-snapshot',protocol:1,gameId:'crash',adapterVersion:1,snapshot:snapshot(),serverTime:time}));}
  await page.route('**/api/v1/account/wallet',route=>route.fulfill({json:wallet()}));
  await page.route('**/api/v1/games/crash/lobbies',route=>route.fulfill({json:{gameId:'crash',lobbies:[]}}));
  await page.route(url=>url.pathname.startsWith('/api/v1/rooms/')||url.pathname==='/api/v1/games/crash/rooms',async route=>{
    const req=route.request();const path=new URL(req.url()).pathname;
    if(path.endsWith('/profile-sync')){await route.fulfill({json:{ok:true}});return;}
    if(path.endsWith('/info')){await route.fulfill({json:{...CRASH_RULES,roomId,gameId:'crash',adapterVersion:1,visibility:'private'}});return;}
    if(saved)expect(req.headers().authorization).toMatch(/^Bearer [^.]+\.[^.]+\./);
    if(path.endsWith('/rooms')){const body=req.postDataJSON();expect(body).not.toHaveProperty('accountId');
      if(!created){created=true;if(saved){expect(body.funding).toBe('account');available-=body.buyInUnits;room.engine.players[0]!.balanceUnits=body.buyInUnits;}}
      await route.fulfill({status:201,json:{gameId:'crash',adapterVersion:1,session,snapshot:snapshot()}});
    }else if(path.endsWith('/resume'))await route.fulfill({json:{gameId:'crash',adapterVersion:1,snapshot:snapshot()}});
    else if(path.endsWith('/ticket'))await route.fulfill({json:{ticket:'a'.repeat(64)}});
    else if(path.endsWith('/authorize'))await route.fulfill({json:{expiresAt:time+3600000}});
    else throw new Error(`Unexpected Crash fixture route ${path}`);
  });
  await page.routeWebSocket('**/api/v1/rooms/*/socket',socket=>{
    sockets.add(socket);socket.onClose(()=>sockets.delete(socket));
    socket.send(JSON.stringify({type:'connected',controllerId:'11111111-1111-4111-8111-111111111111',serverTime:time}));broadcast();socket.send(JSON.stringify({type:'chat',messages:[]}));
    socket.onMessage(raw=>{
      if(raw==='ping'){socket.send(JSON.stringify({type:'pong',serverTime:time}));return;}if(raw==='snapshot'){broadcast();return;}
      const envelope=JSON.parse(String(raw));expect(envelope.gameId).toBe('crash');const command=crashRoomAdapter.parseCommand(envelope.command);
      room=crashRoomAdapter.apply(room,command,()=>0,time);
      if(command.action.type==='Leave'){if(created){if(saved)available+=room.engine.players[0]!.balanceUnits;created=false;returns++;}}
      else broadcast();socket.send(JSON.stringify({type:'ack',commandId:command.id,revision:room.revision}));
    });
  });
  return{wallet,returns:()=>returns,state:()=>snapshot(),
    holdUpdates(){holdingUpdates=true;},resumeUpdates(){holdingUpdates=false;broadcast();},
    fly(point:number){time=room.engine.deadline!;room=crashRoomAdapter.expire(room,()=>Math.floor(1_000_000_000-97_000_000_000/point),time);broadcast();},
    advance(ms:number){time+=ms;room=crashRoomAdapter.expire(room,()=>0,time);broadcast();},
    finish(){time=room.engine.deadline!;room=crashRoomAdapter.expire(room,()=>0,time);broadcast();},
  };
}
