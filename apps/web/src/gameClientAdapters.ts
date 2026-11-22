import { BET_CANCELLATION_CAPABILITY,BLACKJACK_TABLE_RULES,snapshotSchema,type Action,type GameClientAdapter,type Snapshot } from '@casual/protocol';
import { CRASH_RULES,CRASH_PROGRESS_CAPABILITY,crashSnapshotSchema,type CrashSnapshot,type CrashAction } from '@casual/protocol';
import { PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY } from '@casual/protocol';

export interface RoomGameClientAdapter<S,A> extends GameClientAdapter<S,A> {
 roundStart(snapshot:S):{isHost:boolean;allowed:boolean;action:A;label:string}|null;
}

const startBetting={type:'StartBetting'} as const;
function roundStart(state:{phase:string;you:string;managerId:string;legalActions:readonly string[]}){
 return state.phase==='waiting'?{isHost:state.managerId===state.you,allowed:state.legalActions.includes(startBetting.type),action:startBetting,label:'Start rounds'}:null;
}

export const blackjackClientAdapter:RoomGameClientAdapter<Snapshot,Action>={
  gameId:'blackjack',version:1,snapshotSchema,entry:BLACKJACK_TABLE_RULES,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY,BET_CANCELLATION_CAPABILITY],
  roundStart:s=>s.phase==='BETTING'&&s.room&&!s.room.bettingOpen
    ?{isHost:s.room.managerPlayerId===s.you,allowed:s.legalActions.includes(startBetting.type),action:startBetting,label:'Open betting'}:null,
  identity:s=>({playerId:s.you,roomId:s.room?.inviteId,revision:s.revision,claimVersion:s.room?.claimVersion??0,gameId:s.room?.gameId}),
  command:(s,action,playerId,id)=>({protocol:1,id,revision:s.revision,roundId:s.roundId,playerId,handId:s.activeHandId??undefined,action}),
};
export const crashClientAdapter:RoomGameClientAdapter<CrashSnapshot,CrashAction>={
  gameId:'crash',version:1,snapshotSchema:crashSnapshotSchema,entry:CRASH_RULES,capabilities:[CRASH_PROGRESS_CAPABILITY,PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY,BET_CANCELLATION_CAPABILITY],
  roundStart,
  identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
  command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action}),
};

import { BACCARAT_RULES,BACCARAT_ROADMAP_CAPABILITY,baccaratSnapshotSchema,type BaccaratSnapshot,type BaccaratAction } from '@casual/protocol';
export const baccaratClientAdapter:RoomGameClientAdapter<BaccaratSnapshot,BaccaratAction>={gameId:'baccarat',version:2,capabilities:[BACCARAT_ROADMAP_CAPABILITY,PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY],snapshotSchema:baccaratSnapshotSchema,entry:BACCARAT_RULES,roundStart,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
 command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};

import { DUCK_RACE_RULES,duckRaceSnapshotSchema,type DuckRaceSnapshot,type DuckRaceAction } from '@casual/protocol';
export const duckRaceClientAdapter:RoomGameClientAdapter<DuckRaceSnapshot,DuckRaceAction>={gameId:'duck-race',version:1,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY],snapshotSchema:duckRaceSnapshotSchema,entry:DUCK_RACE_RULES,roundStart,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
 command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};

import { ROULETTE_RULES,ROULETTE_REPLAY_CAPABILITY,ROULETTE_RESULT_TIMING_CAPABILITY,rouletteSnapshotSchema,type RouletteSnapshot,type RouletteAction } from '@casual/protocol';
export const rouletteClientAdapter:RoomGameClientAdapter<RouletteSnapshot,RouletteAction>={gameId:'roulette',version:1,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY,ROULETTE_REPLAY_CAPABILITY,ROULETTE_RESULT_TIMING_CAPABILITY],snapshotSchema:rouletteSnapshotSchema,entry:ROULETTE_RULES,roundStart,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};

import {KENO_RULES,kenoSnapshotSchema,type KenoSnapshot,type KenoAction} from '@casual/protocol';
export const kenoClientAdapter:RoomGameClientAdapter<KenoSnapshot,KenoAction>={gameId:'keno',version:1,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY,KENO_PROFILE_CAPABILITY],snapshotSchema:kenoSnapshotSchema,entry:KENO_RULES,roundStart,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};
