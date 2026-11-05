import { BLACKJACK_TABLE_RULES,snapshotSchema,type Action,type GameClientAdapter,type Snapshot } from '@casual/protocol';
import { CRASH_RULES,CRASH_PROGRESS_CAPABILITY,crashSnapshotSchema,type CrashSnapshot,type CrashAction } from '@casual/protocol';
export const blackjackClientAdapter:GameClientAdapter<Snapshot,Action>={
  gameId:'blackjack',version:1,snapshotSchema,entry:BLACKJACK_TABLE_RULES,
  identity:s=>({playerId:s.you,roomId:s.room?.inviteId,revision:s.revision,claimVersion:s.room?.claimVersion??0,gameId:s.room?.gameId}),
  command:(s,action,playerId,id)=>({protocol:1,id,revision:s.revision,roundId:s.roundId,playerId,handId:s.activeHandId??undefined,action}),
};
export const crashClientAdapter:GameClientAdapter<CrashSnapshot,CrashAction>={
  gameId:'crash',version:1,snapshotSchema:crashSnapshotSchema,entry:CRASH_RULES,capabilities:[CRASH_PROGRESS_CAPABILITY],
  identity:s=>({playerId:s.you,roomId:s.roomId,revision:s.revision,claimVersion:s.claimVersion,gameId:s.gameId}),
  command:(s,action,playerId,id)=>({id,playerId,revision:s.revision,roundId:s.roundId,action}),
};
