import { z } from 'zod';
import { GameError } from '@casual/engine';
import { newCrash,beginBetting,placeBet,cashOut,advanceCrash,nextCrashAlarm,validCrashState,crashStateSchema,CrashError,multiplierAt,targetTime,type CrashState } from '@casual/crash';
import { CRASH_RULES,CRASH_PROGRESS_CAPABILITY,CRASH_PROGRESS_INTERVAL_MS,crashCommandSchema,type CrashSnapshot,type CrashAction } from '@casual/protocol';
import { newMember,disconnectMember } from '../roomMembership';
import { fundedSeat,roomWalletSchema,walletHasFunds } from '../tableWallet';
import { crashFunding,crashWalletReady,recordCrashResult,sealCrashSeat,flushCrashWallet,validCrashWallet } from './crashWallet';
import type { GameRoomAdapter,HostedRoom,SeatIdentity,SnapshotContext } from './contracts';

export interface CrashRoom extends HostedRoom {schema:1;gameId:'crash';adapterVersion:1;engine:CrashState}
function requireRule(value:unknown,code:string,message:string):asserts value{if(!value)throw new GameError(code,message);}
function player(identity:SeatIdentity){return{...identity,balanceUnits:CRASH_RULES.guestStartingChips*100,betUnits:0,autoCashoutCents:null,cashedOutCents:null,returnedUnits:0};}
export function crashActions(room:CrashRoom,id:string):CrashAction['type'][] {
  const p=room.engine.players.find(p=>p.id===id);const m=room.members[id];if(!p||!m||m.leaveAfterRound)return[];
  const actions:CrashAction['type'][]=['Leave'];
  if(room.engine.phase==='waiting'&&room.managerId===id)actions.push('StartBetting');
  if(crashWalletReady(room,id)){
    if(room.engine.phase==='betting'&&!p.betUnits&&p.balanceUnits>=1000)actions.push('PlaceBet');
    if(room.engine.phase==='running'&&p.betUnits>0&&p.cashedOutCents===null)actions.push('CashOut');
    if(!fundedSeat(room,id)&&p.balanceUnits<1000&&!p.betUnits)actions.push('Refill');
  }
  return actions;
}
export function crashSnapshot(room:CrashRoom,id:string,context?:SnapshotContext):CrashSnapshot{
  requireRule(room.members[id],'SESSION_INVALID','Your seat is no longer available.');const e=room.engine;const seat=fundedSeat(room,id);
  let progress:CrashSnapshot['progress']=null;
  if(e.phase==='running'&&context){
    // Serialization can follow slow persistence/wallet delivery. Never publish past the private crash, even then.
    const multiplierCents=Math.min(multiplierAt(e.startedAt!,context.now),Math.max(100,e.outcome!.multiplierCents-1));
    progress={multiplierCents,elapsedMs:targetTime(0,multiplierCents),sampledAt:context.now};
  }
  return{gameId:'crash',roomId:room.id,you:id,revision:room.revision,claimVersion:room.members[id]!.claimVersion,managerId:room.managerId,roundId:e.roundId,phase:e.phase,
    bettingDeadline:e.phase==='betting'?e.deadline:null,startedAt:e.startedAt,resultsDeadline:e.phase==='results'?e.deadline:null,
    outcome:e.phase==='results'?e.outcome:null,history:e.history,...(context?.capabilities.includes(CRASH_PROGRESS_CAPABILITY)?{progress}:{}),players:e.players.map(p=>({...p,connected:room.members[p.id]!.connected,leaving:room.members[p.id]!.leaveAfterRound})),
    legalActions:crashActions(room,id),...(seat?{wallet:{status:seat.status,error:room.wallet?.error??null}}:{})};
}
export function collectCrashSeats(room:CrashRoom,now:number){
  let changed=false;
  for(const p of [...room.engine.players]){
    const m=room.members[p.id]!;
    if(m.connected&&m.presenceDeadline!==null&&now>=m.presenceDeadline)changed=disconnectMember(room,p.id,m.presenceDeadline)||changed;
    if(!m.connected&&m.reservationDeadline!==null&&now>=m.reservationDeadline){m.reservationDeadline=null;m.leaveAfterRound=true;changed=true;}
    const committed=p.betUnits>0&&(room.engine.phase==='betting'||room.engine.phase==='running');
    if(m.leaveAfterRound&&!committed&&sealCrashSeat(room,p.id)){
      room.engine.players=room.engine.players.filter(other=>other.id!==p.id);delete room.members[p.id];delete room.commandRates[p.id];room.tickets=room.tickets.filter(t=>t.playerId!==p.id);changed=true;
    }
  }
  if(!room.members[room.managerId]?.connected||room.members[room.managerId]?.leaveAfterRound){
    const manager=room.engine.players.find(p=>room.members[p.id]!.connected&&!room.members[p.id]!.leaveAfterRound)?.id??room.engine.players.find(p=>!room.members[p.id]!.leaveAfterRound)?.id??'';
    if(manager!==room.managerId){room.managerId=manager;changed=true;}
  }
  room.tickets=room.tickets.filter(t=>t.expires>now&&room.members[t.playerId]&&!room.members[t.playerId]!.leaveAfterRound);return changed;
}
const integer=z.number().int().nonnegative().safe();const time=integer.nullable();const id=z.string().min(1).max(100);const hash=z.string().regex(/^[a-f0-9]{64}$/);
const memberSchema=z.object({hash,connected:z.boolean(),controllerId:id.nullable(),leaveAfterRound:z.boolean(),reservationDeadline:time,presenceDeadline:time,
  claimId:id.nullable(),claimVersion:integer,retiredClaims:z.array(id).max(8),account:z.object({id:z.string().uuid(),expiresAt:integer}).strict().optional()}).strict();
const roomSchema=z.object({schema:z.literal(1),gameId:z.literal('crash'),adapterVersion:z.literal(1),visibility:z.enum(['public','private']).optional(),id:z.string().regex(/^[a-f0-9]{32}$/),
  revision:integer,managerId:z.string().max(100),engine:crashStateSchema,members:z.record(id,memberSchema),lastActivity:integer,wallet:roomWalletSchema.optional(),
  tickets:z.array(z.object({hash,playerId:id,expires:integer,claimId:id,claimVersion:integer}).strict()).max(8),
  receipts:z.array(z.object({id,playerId:id,revision:integer}).strict()).max(128),commandRates:z.record(id,z.object({start:integer,count:integer}).strict()),
  creation:z.object({entryId:z.string().uuid(),buyInUnits:integer.min(1000).max(9_000_000_000_000),visibility:z.enum(['public','private'])}).strict().optional(),
}).strict();
export function restoreCrashRoom(raw:unknown):{room:CrashRoom;migrated:boolean}{
  const parsed=roomSchema.safeParse(raw);requireRule(parsed.success,'ROOM_STATE_INVALID','This Crash table could not be safely restored.');const room=parsed.data;
  const e=room.engine;
  requireRule(validCrashState(e)&&validCrashWallet(room)&&Object.keys(room.members).length===e.players.length&&e.players.every(p=>room.members[p.id])
    &&(!room.managerId||room.members[room.managerId])&&Object.values(room.members).every(m=>m.connected?!!m.controllerId&&m.presenceDeadline!==null&&m.reservationDeadline===null:m.presenceDeadline===null)
    &&(!room.creation||room.wallet?.seats[room.creation.entryId]&&room.creation.visibility===(room.visibility??'private')),'ROOM_STATE_INVALID','This Crash table has inconsistent state.');
  return{room,migrated:false};
}
export const crashRoomAdapter:GameRoomAdapter<CrashRoom>={
  ...CRASH_RULES,gameId:'crash',version:1,
  create(input){const engine=newCrash();engine.players.push(player(input.player));return{schema:1,gameId:'crash',adapterVersion:1,id:input.roomId,revision:0,managerId:input.player.id,engine,
    members:{[input.player.id]:newMember(input.credentialHash,input.now)},lastActivity:input.now,tickets:[],receipts:[],commandRates:{}};},
  restore:restoreCrashRoom,players:r=>r.engine.players,lobbyPhase:r=>r.engine.phase==='waiting'||r.engine.phase==='betting'?'waiting':'playing',
  join(r,p){r.engine.players.push(player(p));r.engine.players.sort((a,b)=>a.seat-b.seat);},snapshot:crashSnapshot,
  parseCommand(raw){const parsed=crashCommandSchema.safeParse(raw);requireRule(parsed.success,'INVALID_COMMAND','Send a valid Crash command.');return parsed.data;},
  apply(previous,input,_random,now){
    const command=crashCommandSchema.parse(input);const {playerId,action}=command;
    requireRule(previous.members[playerId],'SESSION_INVALID','Your seat is no longer available.');
    if(previous.receipts.some(r=>r.id===command.id&&r.playerId===playerId))return previous;
    // Other players' cash-outs/bets must not invalidate a timely action on your live wager.
    requireRule(command.roundId===previous.engine.roundId&&command.revision<=previous.revision,'STALE_STATE','The round changed. Review the table and try again.');
    requireRule(crashActions(previous,playerId).includes(action.type),'INVALID_ACTION','This action is not available for your seat now.');
    const room=structuredClone(previous);const p=room.engine.players.find(p=>p.id===playerId)!;
    try{switch(action.type){
      case 'StartBetting':beginBetting(room.engine,now);break;
      case 'PlaceBet':placeBet(room.engine,p,action.amountUnits,action.autoCashoutCents,now);break;
      case 'CashOut':cashOut(room.engine,p,now);break;
      case 'Refill':p.balanceUnits=CRASH_RULES.guestStartingChips*100;break;
      case 'Leave':{const m=room.members[playerId]!;m.connected=false;m.leaveAfterRound=true;m.presenceDeadline=null;m.reservationDeadline=null;break;}
    }}catch(error){if(error instanceof CrashError)throw new GameError(error.code,error.message);throw error;}
    room.revision++;room.lastActivity=now;room.receipts=[...room.receipts,{id:command.id,playerId,revision:room.revision}].slice(-128);return room;
  },
  expire(previous,random,now){
    const engine=advanceCrash(previous.engine,now,random);const resultsOver=previous.engine.phase==='results'&&previous.engine.deadline!==null&&now>=previous.engine.deadline;
    const progressDue=engine.phase==='running'&&Object.values(previous.members).some(m=>m.connected&&!m.leaveAfterRound)&&now>=previous.lastActivity+CRASH_PROGRESS_INTERVAL_MS;
    if(engine===previous.engine&&!resultsOver&&!progressDue)return previous;
    const room=structuredClone(previous);room.engine=engine===previous.engine?structuredClone(engine):engine;
    recordCrashResult(room);
    if(resultsOver){
      collectCrashSeats(room,now);
      if(Object.values(room.members).some(m=>m.connected&&!m.leaveAfterRound))beginBetting(room.engine,now);
      else{room.engine.phase='waiting';room.engine.deadline=null;room.engine.startedAt=null;room.engine.outcome=null;for(const p of room.engine.players){p.betUnits=0;p.autoCashoutCents=null;p.cashedOutCents=null;p.returnedUnits=0;}}
    }
    room.revision++;room.lastActivity=now;return room;
  },collectSeats:collectCrashSeats,
  nextAlarm(room){const times=[nextCrashAlarm(room.engine),...Object.values(room.members).flatMap(m=>[m.presenceDeadline,m.reservationDeadline])];
    if(room.engine.phase==='running'&&Object.values(room.members).some(m=>m.connected&&!m.leaveAfterRound))times.push(room.lastActivity+CRASH_PROGRESS_INTERVAL_MS);
    if(room.wallet?.outbox.length)times.push(room.wallet.retryAt??0);
    if(!Object.values(room.members).some(m=>m.connected)&&!walletHasFunds(room))times.push(room.lastActivity+86_400_000);
    const pending=times.filter((t):t is number=>t!==null);return pending.length?Math.min(...pending):null;},
  fund:crashFunding,flushWallet:flushCrashWallet,
};
