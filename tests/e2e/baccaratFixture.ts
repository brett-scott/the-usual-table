import { expect,type Page,type WebSocketRoute } from '@playwright/test';
import { BACCARAT_RULES,BACCARAT_ROADMAP_CAPABILITY,baccaratWagerUnits,type WalletSummary } from '@casual/protocol';
import { baccaratRoomAdapter,baccaratSnapshot,type BaccaratRoom } from '../../apps/server/src/games/baccarat';
import { newMember } from '../../apps/server/src/roomMembership';
import { accountId,providerFixture } from './authFixture';

/** Isolated browser transport fixture; no production outcome/clock controls are exposed. */
export async function baccaratFixture(page:Page,{saved=false,players=1}:{saved?:boolean;players?:number}={}){
  if(saved)await providerFixture(page,'google','success','Baccarat pilot');
  const roomId='b'.repeat(32);const playerId='pilot';let time=Date.now();let available=1000000;let created=false;let returns=0;
  let room:BaccaratRoom=baccaratRoomAdapter.create({roomId,player:{id:playerId,name:saved?'Baccarat pilot':'Pilot',seat:0},credentialHash:'c'.repeat(64),now:time,random:n=>n-1});
  const sockets=new Set<WebSocketRoute>();let holdingUpdates=false;let holdingCommands=false;let rejection:string|null=null;
  const queued:{socket:WebSocketRoute;raw:string}[]=[];let receivedBets=0;
  for(let i=1;i<players;i++){const id=`peer-${i}`;baccaratRoomAdapter.join(room,{id,name:`Flyer ${i}`,seat:i});room.members[id]=newMember('e'.repeat(64),time);}
  // Simulated connections stay present while multi-round tests fast-forward the fixture clock.
  for(const m of Object.values(room.members)){m.connected=true;m.controllerId='controller';m.presenceDeadline=time+3600000;m.reservationDeadline=null;}
  const wallet=():WalletSummary=>({contract:1,currency:'virtual-chips',unitsPerChip:100,accountId,status:'active',version:room.revision+1,availableUnits:available,
    atTablesUnits:created?room.engine.players[0]!.balanceUnits+(['betting','dealing'].includes(room.engine.phase)?baccaratWagerUnits(room.engine.players[0]!.wager)-room.engine.players[0]!.returnedUnits:0):0,pendingReturnUnits:0});
  function snapshot(){const value=baccaratSnapshot(room,playerId,{now:time,capabilities:[BACCARAT_ROADMAP_CAPABILITY]});if(saved){value.wallet={status:'active',error:null};value.legalActions=value.legalActions.filter(a=>a!=='Refill');}return value;}
  const session={inviteId:roomId,playerId,credential:'d'.repeat(64),...(saved?{funding:'account' as const}:{})};
  function broadcast(){if(holdingUpdates)return;for(const socket of sockets)socket.send(JSON.stringify({type:'game-snapshot',protocol:1,gameId:'baccarat',adapterVersion:2,snapshot:snapshot(),serverTime:time}));}
  function commandMessage(socket:WebSocketRoute,raw:string){
    const envelope=JSON.parse(raw);expect(envelope.gameId).toBe('baccarat');const command=baccaratRoomAdapter.parseCommand(envelope.command);
    if(command.action.type==='PlaceBet')receivedBets++;
    try{
      if(command.action.type==='PlaceBet'&&rejection){const message=rejection;rejection=null;socket.send(JSON.stringify({type:'error',commandId:command.id,code:'INVALID_ACTION',message,snapshot:snapshot()}));return;}
      room=baccaratRoomAdapter.apply(room,command,n=>n-1,time);
      if(command.action.type==='Leave'){if(created){if(saved)available+=room.engine.players[0]!.balanceUnits;created=false;returns++;}}
      else broadcast();socket.send(JSON.stringify({type:'ack',commandId:command.id,revision:room.revision}));
    }catch(error){socket.send(JSON.stringify({type:'error',commandId:command.id,code:'INVALID_ACTION',message:error instanceof Error?error.message:'Rejected fixture command',snapshot:snapshot()}));}
  }
  await page.route('**/api/v1/account/wallet',route=>route.fulfill({json:wallet()}));
  await page.route('**/api/v1/games/baccarat/lobbies',route=>route.fulfill({json:{gameId:'baccarat',lobbies:[]}}));
  await page.route(url=>url.pathname.startsWith('/api/v1/rooms/')||url.pathname==='/api/v1/games/baccarat/rooms',async route=>{
    const req=route.request();const path=new URL(req.url()).pathname;
    if(path.endsWith('/info')){await route.fulfill({json:{...BACCARAT_RULES,roomId,gameId:'baccarat',adapterVersion:2,visibility:'private'}});return;}
    if(saved)expect(req.headers().authorization).toMatch(/^Bearer [^.]+\.[^.]+\./);
    if(path.endsWith('/rooms')){const body=req.postDataJSON();expect(body).not.toHaveProperty('accountId');
      if(!created){created=true;if(saved){expect(body.funding).toBe('account');available-=body.buyInUnits;room.engine.players[0]!.balanceUnits=body.buyInUnits;}}
      await route.fulfill({status:201,json:{gameId:'baccarat',adapterVersion:2,session,snapshot:snapshot()}});
    }else if(path.endsWith('/resume'))await route.fulfill({json:{gameId:'baccarat',adapterVersion:2,snapshot:snapshot()}});
    else if(path.endsWith('/ticket'))await route.fulfill({json:{ticket:'a'.repeat(64)}});
    else if(path.endsWith('/authorize'))await route.fulfill({json:{expiresAt:time+3600000}});
    else throw new Error(`Unexpected Baccarat fixture route ${path}`);
  });
  await page.routeWebSocket('**/api/v1/rooms/*/socket',socket=>{
    sockets.add(socket);socket.onClose(()=>sockets.delete(socket));
    socket.send(JSON.stringify({type:'connected',controllerId:'11111111-1111-4111-8111-111111111111',serverTime:time}));broadcast();socket.send(JSON.stringify({type:'chat',messages:[]}));
    socket.onMessage(raw=>{
      if(raw==='ping'){socket.send(JSON.stringify({type:'pong',serverTime:time}));return;}if(raw==='snapshot'){broadcast();return;}
      if(holdingCommands){queued.push({socket,raw:String(raw)});return;}commandMessage(socket,String(raw));
    });
  });
  return{wallet,returns:()=>returns,state:()=>snapshot(),
    holdCommands(){holdingCommands=true;},releaseCommands(){holdingCommands=false;for(const item of queued.splice(0))commandMessage(item.socket,item.raw);},pendingCommands:()=>queued.length,receivedBets:()=>receivedBets,rejectNextBet(message:string){rejection=message;},
    holdUpdates(){holdingUpdates=true;},resumeUpdates(){holdingUpdates=false;broadcast();},
    arrange(ranks:string[]){const s=room.engine;for(let i=0;i<ranks.length;i++){const a=s.cursor+i;const b=s.shoe.findIndex((c,j)=>j>=a&&c.rank===ranks[i]);[s.shoe[a],s.shoe[b]]=[s.shoe[b]!,s.shoe[a]!];}},
    advance(ms:number){time+=ms;room=baccaratRoomAdapter.expire(room,n=>n-1,time);broadcast();},
    finish(){for(let i=0;i<8&&(room.engine.phase==='betting'||room.engine.phase==='dealing');i++){time=room.engine.deadline!;room=baccaratRoomAdapter.expire(room,n=>n-1,time);}broadcast();},
  };
}
