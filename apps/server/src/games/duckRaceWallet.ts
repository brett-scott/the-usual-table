import { z } from 'zod';
import { duckWagerUnits } from '@casual/duck-race';
import { MAX_WALLET_UNITS,walletUnitsSchema } from '@casual/protocol';
import type { DuckRaceRoom } from './duckRace';
import { assertWalletState as check,fundedSeat,walletSeatTerminal as terminal,queueWalletOperation as queue,walletOperation as operation,flushTableWallet,type WalletGateway,type FundedSeat } from '../tableWallet';

export function duckRaceFunding(previous:DuckRaceRoom,playerId:string,accountId:string,buyInUnits:number,sessionId:string):DuckRaceRoom{
  z.string().uuid().parse(accountId);z.string().uuid().parse(sessionId);walletUnitsSchema.parse(buyInUnits);
  check(buyInUnits>=1000&&buyInUnits%1000===0,'Choose a buy-in of at least 10 chips in steps of 10.');
  const candidate=previous.engine.players.find(p=>p.id===playerId);
  check(candidate&&duckWagerUnits(candidate)===0&&previous.members[playerId]?.account?.id===accountId&&!previous.members[playerId]!.leaveAfterRound,'Fund only an owned, uncommitted seat.');
  check(!fundedSeat(previous,playerId)&&!Object.values(previous.wallet?.seats??{}).some(s=>!terminal(s)&&s.accountId===accountId),'This seat already has a funding decision.');
  const room=structuredClone(previous);room.wallet??={schema:1,seats:{},outbox:[],retryAt:null,failures:0,error:null};
  check(Object.keys(room.wallet.seats).length<128,'This room has reached its funded-session limit.');
  const seat:FundedSeat={sessionId,accountId,playerId,status:'funding',version:0,sequence:0,stackUnits:buyInUnits,lastRound:room.engine.roundId,leaveRequested:false};
  room.wallet.seats[sessionId]=seat;room.engine.players.find(p=>p.id===playerId)!.balanceUnits=0;
  queue(room,seat,{contract:1,operationId:crypto.randomUUID(),accountId,sessionId,kind:'allocate',gameId:'duck-race',roomId:room.id,funding:'account',amountUnits:buyInUnits},'pending_activation');
  queue(room,seat,{...operation(seat),kind:'activate'},'active');room.revision++;return room;
}
export function duckRaceWalletReady(room:DuckRaceRoom,id:string){
  const seat=fundedSeat(room,id);return !seat||seat.status==='active'&&!room.wallet!.outbox.some(e=>e.after.sessionId===seat.sessionId);
}
export function recordDuckRaceResult(room:DuckRaceRoom){
  if(room.engine.phase!=='results'||!room.wallet)return;
  for(const seat of Object.values(room.wallet.seats)){
    const p=room.engine.players.find(p=>p.id===seat.playerId);
    if(seat.status!=='active'||seat.lastRound>=room.engine.roundId||(!p||!duckWagerUnits(p)))continue;
    check(seat.stackUnits-duckWagerUnits(p)+p.returnedUnits===p.balanceUnits,'DuckRace stack and settlement disagree.');
    seat.stackUnits=p.balanceUnits;seat.sequence++;seat.lastRound=room.engine.roundId;
    queue(room,seat,{...operation(seat),kind:'settle',gameId:'duck-race',roomId:room.id,funding:'account',sequence:seat.sequence,roundId:String(room.engine.roundId),
      rulesetVersion:'duck-race-four-v1',wageredUnits:duckWagerUnits(p),returnedUnits:p.returnedUnits,
      duckRace:{duckIndex:p.wager.duckIndex!,winner:room.engine.winner!,duckCount:4}},'active');
  }
}
export function sealDuckRaceSeat(room:DuckRaceRoom,playerId:string){
  const seat=fundedSeat(room,playerId);if(!seat||terminal(seat)||seat.status==='returning')return true;
  seat.leaveRequested=true;if(seat.status==='funding')return false;
  const p=room.engine.players.find(p=>p.id===playerId)!;
  check(p.balanceUnits===seat.stackUnits,'Cannot return unsettled DuckRace chips.');seat.status='returning';
  queue(room,seat,{...operation(seat),kind:'request_return',finalSequence:seat.sequence,finalStackUnits:seat.stackUnits},'returning');
  queue(room,seat,{...operation(seat),kind:'complete_return'},'closed',0);return true;
}
export function flushDuckRaceWallet(room:DuckRaceRoom,gateway:WalletGateway|undefined,persist:()=>Promise<void>){
  return flushTableWallet(room,gateway,persist,(id,units)=>{const p=room.engine.players.find(p=>p.id===id);check(p&&p.balanceUnits===0&&duckWagerUnits(p)===0,'Activation cannot replace a live stack.');p.balanceUnits=units;});
}
export function validDuckRaceWallet(room:DuckRaceRoom){
  if(!room.wallet)return !Object.values(room.members).some(m=>m.account);
  const wallet=room.wallet;if(Object.keys(wallet.seats).length>128||(wallet.outbox.length===0)!==(wallet.retryAt===null))return false;
  const players=new Set<string>();const accounts=new Set<string>();const operations=new Set<string>();
  for(const [id,seat] of Object.entries(wallet.seats)){
    if(id!==seat.sessionId||seat.version<2||seat.lastRound>room.engine.roundId||seat.sequence>seat.lastRound)return false;
    if(!terminal(seat)){if(players.has(seat.playerId)||accounts.has(seat.accountId))return false;players.add(seat.playerId);accounts.add(seat.accountId);}
    const p=room.engine.players.find(p=>p.id===seat.playerId);
    if(p&&room.members[p.id]?.account?.id!==seat.accountId)return false;
    if((seat.status==='funding'||seat.status==='active')&&!p)return false;
    if(seat.status==='funding'&&(p!.balanceUnits!==0||duckWagerUnits(p!)!==0))return false;
    if(seat.status==='active'&&p){
      const committed=room.engine.phase==='betting'||room.engine.phase==='racing'?duckWagerUnits(p)-p.returnedUnits:0;
      if(p.balanceUnits+committed!==seat.stackUnits||seat.stackUnits>MAX_WALLET_UNITS)return false;
      if(room.engine.phase==='results'&&duckWagerUnits(p)>0&&seat.lastRound!==room.engine.roundId)return false;
    }
    const entries=wallet.outbox.filter(e=>e.after.sessionId===id);
    if(entries.length&&entries.at(-1)!.after.version!==seat.version||entries.some((e,i)=>i>0&&e.after.version!==entries[i-1]!.after.version+1))return false;
    if(terminal(seat)&&entries.length||seat.status==='funding'&&!entries.some(e=>['activate','cancel_allocation'].includes(e.command.kind))
      ||seat.status==='returning'&&entries.at(-1)?.command.kind!=='complete_return')return false;
  }
  for(const e of wallet.outbox){
    const seat=wallet.seats[e.after.sessionId];const c=e.command;
    if(!seat||!('sessionId' in c)||c.sessionId!==seat.sessionId||c.accountId!==seat.accountId||e.after.accountId!==seat.accountId||e.after.gameId!=='duck-race'||e.after.roomId!==room.id||operations.has(c.operationId))return false;
    operations.add(c.operationId);if(c.kind==='allocate'?e.after.version!==1:e.after.version!==c.expectedVersion+1)return false;
  }
  return Object.entries(room.members).every(([id,m])=>!m.account||fundedSeat(room,id)?.accountId===m.account.id);
}
