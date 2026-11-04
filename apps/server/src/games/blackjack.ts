import { BLACKJACK_TABLE_RULES,commandSchema } from '@casual/protocol';
import { GameError } from '@casual/engine';
import { applyCommand,collectSeats,expireRoomDecisions,newRoom,nextAlarm,roomSnapshot,type OnlineRoom } from '../roomState';
import { restoreRoom } from '../roomStorage';
import { beginWalletFunding,flushRoomWallet } from '../roomWallet';
import type { GameRoomAdapter } from './contracts';

/** Existing Blackjack rules, half-chip units and storage schemas remain owned by this adapter. */
export const blackjackRoomAdapter:GameRoomAdapter<OnlineRoom> = {
  ...BLACKJACK_TABLE_RULES,gameId:'blackjack',version:1,
  create({roomId,player,credentialHash,random,now}) {
    return {...newRoom(roomId,player.id,player.name,credentialHash,random,now,player.icon),gameId:'blackjack',adapterVersion:1};
  },
  restore:restoreRoom,players:room=>room.engine.players,lobbyPhase:room=>room.engine.phase==='BETTING'?'waiting':'playing',
  join(room,player) {
    const active=room.engine.players[room.engine.activePlayer]?.id;
    room.engine.players.push({...player,balance:BLACKJACK_TABLE_RULES.guestStartingChips*2,bet:room.engine.phase==='BETTING'?20:0,hands:[]});
    room.engine.players.sort((a,b)=>a.seat-b.seat);
    if(active)room.engine.activePlayer=room.engine.players.findIndex(p=>p.id===active);
  },
  snapshot:roomSnapshot,
  parseCommand(raw){const parsed=commandSchema.safeParse(raw);if(!parsed.success)throw new GameError('INVALID_COMMAND','Your Blackjack client needs to send a valid version-1 command.');return parsed.data;},
  apply:(room,command,random,now)=>applyCommand(room,commandSchema.parse(command),random,now),
  expire:expireRoomDecisions,collectSeats,nextAlarm,fund:beginWalletFunding,flushWallet:flushRoomWallet,
};
