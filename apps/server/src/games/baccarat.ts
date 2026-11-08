import { profileMemberFields } from '../profileMembership';
import { z } from 'zod';
import { GameError } from '@casual/engine';
import { newBaccarat,beginBaccaratBetting,setBaccaratBet,advanceBaccarat,clearBaccaratRound,emptyWager,wagerUnits,validBaccaratState,baccaratStateSchema,BaccaratError,type BaccaratState } from '@casual/baccarat';
import { BACCARAT_RULES,BACCARAT_ROADMAP_CAPABILITY,seedBaccaratRoadmap,legacyBaccaratWagerSchema,baccaratCommandSchema,type BaccaratSnapshot,type BaccaratAction } from '@casual/protocol';
import { newMember,disconnectMember } from '../roomMembership';
import { fundedSeat,roomWalletSchema,walletHasFunds } from '../tableWallet';
import { baccaratFunding,baccaratWalletReady,recordBaccaratResult,sealBaccaratSeat,flushBaccaratWallet,validBaccaratWallet } from './baccaratWallet';
import type { GameRoomAdapter,HostedRoom,SeatIdentity,SnapshotContext } from './contracts';
export interface BaccaratRoom extends HostedRoom{schema:1;gameId:'baccarat';adapterVersion:2;engine:BaccaratState}
function requireRule(value:unknown,code:string,message:string):asserts value{if(!value)throw new GameError(code,message);}
function player(identity:SeatIdentity){return{...identity,balanceUnits:BACCARAT_RULES.guestStartingChips*100,wager:emptyWager(),returnedUnits:0};}
export function baccaratActions(room:BaccaratRoom,id:string):BaccaratAction['type'][] {
 const p=room.engine.players.find(p=>p.id===id);const m=room.members[id];if(!p||!m||m.leaveAfterRound)return[];
 const actions:BaccaratAction['type'][]=['Leave'];
 if(room.managerId===id){if(room.engine.phase==='waiting')actions.push('StartBetting');if(room.engine.phase==='results')actions.push('NextRound');}
 if(baccaratWalletReady(room,id)){
  if(room.engine.phase==='betting'&&(p.balanceUnits+wagerUnits(p)>=1000||wagerUnits(p)>0))actions.push('PlaceBet');
  if(!fundedSeat(room,id)&&p.balanceUnits<1000&&!wagerUnits(p))actions.push('Refill');
 }return actions;
}
export function baccaratSnapshot(room:BaccaratRoom,id:string,context?:SnapshotContext):BaccaratSnapshot{
 requireRule(room.members[id],'SESSION_INVALID','Your seat is no longer available.');const e=room.engine;const seat=fundedSeat(room,id);
 return{gameId:'baccarat',roomId:room.id,you:id,revision:room.revision,claimVersion:room.members[id]!.claimVersion,managerId:room.managerId,roundId:e.roundId,phase:e.phase,
 bettingDeadline:e.phase==='betting'?e.deadline:null,startedAt:e.startedAt,resultsDeadline:e.phase==='results'?e.deadline:null,
 cards:e.deal.slice(0,e.revealed),outcome:e.phase==='results'?e.outcome:null,history:e.history,...(context?.capabilities.includes(BACCARAT_ROADMAP_CAPABILITY)?{roadmap:e.roadmap??seedBaccaratRoadmap(e.history)}:{}),
 shoe:{decks:8,remaining:416-e.cursor+e.deal.length-e.revealed,shuffled:e.shuffled},players:e.players.map(p=>({...p,connected:room.members[p.id]!.connected,leaving:room.members[p.id]!.leaveAfterRound})),
 legalActions:baccaratActions(room,id),...(seat?{wallet:{status:seat.status,error:room.wallet?.error??null}}:{})};
}
export function collectBaccaratSeats(room:BaccaratRoom,now:number){
 let changed=false;
 for(const p of [...room.engine.players]){
  const m=room.members[p.id]!;
  if(m.connected&&m.presenceDeadline!==null&&now>=m.presenceDeadline)changed=disconnectMember(room,p.id,m.presenceDeadline)||changed;
  if(!m.connected&&m.reservationDeadline!==null&&now>=m.reservationDeadline){m.reservationDeadline=null;m.leaveAfterRound=true;changed=true;}
  if(m.leaveAfterRound&&room.engine.phase==='betting'&&wagerUnits(p)>0){p.balanceUnits+=wagerUnits(p);p.wager=emptyWager();changed=true;}
  const committed=wagerUnits(p)>0&&room.engine.phase==='dealing';
  if(m.leaveAfterRound&&!committed&&sealBaccaratSeat(room,p.id)){
   room.engine.players=room.engine.players.filter(other=>other.id!==p.id);delete room.members[p.id];delete room.commandRates[p.id];room.tickets=room.tickets.filter(t=>t.playerId!==p.id);changed=true;
  }
 }
 if(!room.members[room.managerId]?.connected||room.members[room.managerId]?.leaveAfterRound){const manager=room.engine.players.find(p=>room.members[p.id]!.connected&&!room.members[p.id]!.leaveAfterRound)?.id??room.engine.players.find(p=>!room.members[p.id]!.leaveAfterRound)?.id??'';if(manager!==room.managerId){room.managerId=manager;changed=true;}}
 room.tickets=room.tickets.filter(t=>t.expires>now&&room.members[t.playerId]&&!room.members[t.playerId]!.leaveAfterRound);return changed;
}
const integer=z.number().int().nonnegative().safe();const time=integer.nullable();const id=z.string().min(1).max(100);const hash=z.string().regex(/^[a-f0-9]{64}$/);
const memberSchema=z.object({...profileMemberFields,hash,connected:z.boolean(),controllerId:id.nullable(),leaveAfterRound:z.boolean(),reservationDeadline:time,presenceDeadline:time,
  claimId:id.nullable(),claimVersion:integer,retiredClaims:z.array(id).max(8),account:z.object({id:z.string().uuid(),expiresAt:integer}).strict().optional()}).strict();
const roomSchema=z.object({schema:z.literal(1),gameId:z.literal('baccarat'),adapterVersion:z.union([z.literal(1),z.literal(2)]),visibility:z.enum(['public','private']).optional(),id:z.string().regex(/^[a-f0-9]{32}$/),
  revision:integer,managerId:z.string().max(100),engine:baccaratStateSchema,members:z.record(id,memberSchema),lastActivity:integer,wallet:roomWalletSchema.optional(),
  tickets:z.array(z.object({hash,playerId:id,expires:integer,claimId:id,claimVersion:integer}).strict()).max(8),
  receipts:z.array(z.object({id,playerId:id,revision:integer}).strict()).max(128),commandRates:z.record(id,z.object({start:integer,count:integer}).strict()),
  creation:z.object({entryId:z.string().uuid(),buyInUnits:integer.min(1000).max(9_000_000_000_000),visibility:z.enum(['public','private'])}).strict().optional(),
}).strict();
export function restoreBaccaratRoom(raw:unknown):{room:BaccaratRoom;migrated:boolean}{
  const parsed=roomSchema.safeParse(raw);requireRule(parsed.success,'ROOM_STATE_INVALID','This Baccarat table could not be safely restored.');const room={...parsed.data,adapterVersion:2 as const};
  const e=room.engine;
  requireRule(parsed.data.adapterVersion!==1||e.players.every(p=>legacyBaccaratWagerSchema.safeParse(p.wager).success),'ROOM_STATE_INVALID','This older Baccarat table has inconsistent wagers.');
  requireRule(validBaccaratState(e)&&validBaccaratWallet(room)&&Object.keys(room.members).length===e.players.length&&e.players.every(p=>room.members[p.id])
    &&(!room.managerId||room.members[room.managerId])&&Object.values(room.members).every(m=>m.connected?!!m.controllerId&&m.presenceDeadline!==null&&m.reservationDeadline===null:m.presenceDeadline===null)
    &&(!room.creation||room.wallet?.seats[room.creation.entryId]&&room.creation.visibility===(room.visibility??'private')),'ROOM_STATE_INVALID','This Baccarat table has inconsistent state.');
  const migrated=e.roadmap===undefined||parsed.data.adapterVersion===1;if(e.roadmap===undefined)e.roadmap=seedBaccaratRoadmap(e.history);return{room,migrated};
}
export const baccaratRoomAdapter:GameRoomAdapter<BaccaratRoom>={
 ...BACCARAT_RULES,gameId:'baccarat',version:2,storedVersions:[1],
 create(input){const engine=newBaccarat(input.random);engine.players.push(player(input.player));return{schema:1,gameId:'baccarat',adapterVersion:2,id:input.roomId,revision:0,managerId:input.player.id,engine,members:{[input.player.id]:newMember(input.credentialHash,input.now)},lastActivity:input.now,tickets:[],receipts:[],commandRates:{}};},
 restore:restoreBaccaratRoom,players:r=>r.engine.players,lobbyPhase:r=>r.engine.phase==='waiting'||r.engine.phase==='betting'?'waiting':'playing',join(r,p){r.engine.players.push(player(p));r.engine.players.sort((a,b)=>a.seat-b.seat);},snapshot:baccaratSnapshot,
 parseCommand(raw){const parsed=baccaratCommandSchema.safeParse(raw);requireRule(parsed.success,'INVALID_COMMAND','Send a valid Baccarat command.');return parsed.data;},
 apply(previous,input,_random,now){
  const command=baccaratCommandSchema.parse(input);const{playerId,action}=command;
  requireRule(previous.members[playerId],'SESSION_INVALID','Your seat is no longer available.');if(previous.receipts.some(r=>r.id===command.id&&r.playerId===playerId))return previous;
  requireRule(command.roundId===previous.engine.roundId&&command.revision<=previous.revision,'STALE_STATE','The round changed. Review the table and try again.');
  requireRule(baccaratActions(previous,playerId).includes(action.type),'INVALID_ACTION','This action is not available for your seat now.');
  const room=structuredClone(previous);const p=room.engine.players.find(p=>p.id===playerId)!;
  try{switch(action.type){
   case 'StartBetting':beginBaccaratBetting(room.engine,now);break;
   case 'NextRound':recordBaccaratResult(room);collectBaccaratSeats(room,now);beginBaccaratBetting(room.engine,now);break;
   case 'PlaceBet':setBaccaratBet(room.engine,p,action.wager,now);break;
   case 'Refill':p.balanceUnits=BACCARAT_RULES.guestStartingChips*100;break;
   case 'Leave':{if(room.engine.phase==='betting'&&room.engine.deadline!==null&&now>=room.engine.deadline)throw new BaccaratError('STALE_STATE','Betting just closed. Review the table and try again.');const m=room.members[playerId]!;m.connected=false;m.leaveAfterRound=true;m.presenceDeadline=null;m.reservationDeadline=null;break;}
  }}catch(error){if(error instanceof BaccaratError)throw new GameError(error.code,error.message);throw error;}
  room.revision++;room.lastActivity=now;room.receipts=[...room.receipts,{id:command.id,playerId,revision:room.revision}].slice(-128);return room;
 },
 expire(previous,random,now){
  // A delayed alarm must still expire a reservation that ended before bets became committed.
  let base=previous;if(previous.engine.phase==='betting'&&previous.engine.deadline!==null){const candidate=structuredClone(previous);if(collectBaccaratSeats(candidate,Math.min(now,previous.engine.deadline-1)))base=candidate;}
  const engine=advanceBaccarat(base.engine,now,random);const resultsOver=previous.engine.phase==='results'&&previous.engine.deadline!==null&&now>=previous.engine.deadline;
  if(engine===base.engine&&!resultsOver&&base===previous)return previous;const room=structuredClone(base);room.engine=engine===base.engine?structuredClone(engine):engine;
  recordBaccaratResult(room);
  if(resultsOver){collectBaccaratSeats(room,now);if(Object.values(room.members).some(m=>m.connected&&!m.leaveAfterRound))beginBaccaratBetting(room.engine,now);else clearBaccaratRound(room.engine);}
  room.revision++;room.lastActivity=now;return room;
 },collectSeats:collectBaccaratSeats,
 nextAlarm(room){const times=[room.engine.deadline,...Object.values(room.members).flatMap(m=>[m.presenceDeadline,m.reservationDeadline])];if(room.wallet?.outbox.length)times.push(room.wallet.retryAt??0);if(!Object.values(room.members).some(m=>m.connected)&&!walletHasFunds(room))times.push(room.lastActivity+86400000);const pending=times.filter((t):t is number=>t!==null);return pending.length?Math.min(...pending):null;},
 fund:baccaratFunding,flushWallet:flushBaccaratWallet,
};
