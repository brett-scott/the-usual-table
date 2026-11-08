import { BLACKJACK_TABLE_RULES,snapshotSchema,type Action,type GameClientAdapter,type Snapshot } from '@casual/protocol';
import { CRASH_RULES,CRASH_PROGRESS_CAPABILITY,crashSnapshotSchema,type CrashSnapshot,type CrashAction } from '@casual/protocol';
import { PROFILE_CAPABILITY,COLLECTION_CAPABILITY } from '@casual/protocol';
export const blackjackClientAdapter:GameClientAdapter<Snapshot,Action>={
  gameId:'blackjack',version:1,snapshotSchema,entry:BLACKJACK_TABLE_RULES,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY],
  identity:s=>({playerId:s.you,roomId:s.room?.inviteId,revision:s.revision,claimVersion:s.room?.claimVersion??0,gameId:s.room?.gameId}),
  command:(s,action,playerId,id)=>({protocol:1,id,revision:s.revision,roundId:s.roundId,playerId,handId:s.activeHandId??undefined,action}),
};
export const crashClientAdapter:GameClientAdapter<CrashSnapshot,CrashAction>={
  gameId:'crash',version:1,snapshotSchema:crashSnapshotSchema,entry:CRASH_RULES,capabilities:[CRASH_PROGRESS_CAPABILITY,PROFILE_CAPABILITY,COLLECTION_CAPABILITY],
  identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
  command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action}),
};

import { BACCARAT_RULES,BACCARAT_ROADMAP_CAPABILITY,baccaratSnapshotSchema,type BaccaratSnapshot,type BaccaratAction } from '@casual/protocol';
export const baccaratClientAdapter:GameClientAdapter<BaccaratSnapshot,BaccaratAction>={gameId:'baccarat',version:2,capabilities:[BACCARAT_ROADMAP_CAPABILITY,PROFILE_CAPABILITY,COLLECTION_CAPABILITY],snapshotSchema:baccaratSnapshotSchema,entry:BACCARAT_RULES,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
 command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};

import { DUCK_RACE_RULES,duckRaceSnapshotSchema,type DuckRaceSnapshot,type DuckRaceAction } from '@casual/protocol';
export const duckRaceClientAdapter:GameClientAdapter<DuckRaceSnapshot,DuckRaceAction>={gameId:'duck-race',version:1,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY],snapshotSchema:duckRaceSnapshotSchema,entry:DUCK_RACE_RULES,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
 command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};

import { ROULETTE_RULES,rouletteSnapshotSchema,type RouletteSnapshot,type RouletteAction } from '@casual/protocol';
export const rouletteClientAdapter:GameClientAdapter<RouletteSnapshot,RouletteAction>={gameId:'roulette',version:1,capabilities:[PROFILE_CAPABILITY,COLLECTION_CAPABILITY],snapshotSchema:rouletteSnapshotSchema,entry:ROULETTE_RULES,
 identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action})};
