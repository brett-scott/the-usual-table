import { BLACKJACK_TABLE_RULES,snapshotSchema,type Action,type GameClientAdapter,type Snapshot } from '@casual/protocol';
export const blackjackClientAdapter:GameClientAdapter<Snapshot,Action>={
  gameId:'blackjack',version:1,snapshotSchema,entry:BLACKJACK_TABLE_RULES,
  identity:s=>({playerId:s.you,roomId:s.room?.inviteId,revision:s.revision,claimVersion:s.room?.claimVersion??0,gameId:s.room?.gameId}),
  command:(s,action,playerId,id)=>({protocol:1,id,revision:s.revision,roundId:s.roundId,playerId,handId:s.activeHandId??undefined,action}),
};
