import { GameError } from '@casual/engine';
import { GAME_CATALOG,gameIdSchema,type GameId } from '@casual/protocol';
import { blackjackRoomAdapter } from './blackjack';
import { crashRoomAdapter } from './crash';
import { baccaratRoomAdapter } from './baccarat';
import type { GameRoomAdapter,HostedRoom } from './contracts';

/** Erase an adapter's private engine type only at the validated registry boundary. */
export function hostGame<R extends HostedRoom>(adapter:GameRoomAdapter<R>):GameRoomAdapter<HostedRoom> {
  function room(value:HostedRoom):R {
    if((value.gameId===undefined?'blackjack':value.gameId)!==adapter.gameId || (value.adapterVersion===undefined&&adapter.gameId==='blackjack'?1:value.adapterVersion)!==adapter.version)
      throw new GameError('ROOM_VERSION_UNSUPPORTED','This table needs its original game adapter version.');
    return value as R;
  }
  return {...adapter,create:input=>{const created=adapter.create(input);room(created);return created;},restore:(raw,now)=>{const restored=adapter.restore(raw,now);room(restored.room);return restored;},
    players:r=>adapter.players(room(r)),lobbyPhase:r=>adapter.lobbyPhase(room(r)),join:(r,p)=>adapter.join(room(r),p),
    snapshot:(r,p,context)=>adapter.snapshot(room(r),p,context),apply:(r,c,random,now)=>adapter.apply(room(r),c,random,now),
    expire:(r,random,now)=>adapter.expire(room(r),random,now),collectSeats:(r,now)=>adapter.collectSeats(room(r),now),
    nextAlarm:r=>adapter.nextAlarm(room(r)),fund:(r,p,a,u,e)=>adapter.fund(room(r),p,a,u,e),flushWallet:(r,g,p)=>adapter.flushWallet(room(r),g,p)};
}
export class GameAdapterRegistry {
  private readonly adapters=new Map<GameId,GameRoomAdapter<HostedRoom>>();
  constructor(adapters:GameRoomAdapter<HostedRoom>[],private readonly enabled:readonly GameId[]=GAME_CATALOG.filter(game=>game.status==='available').map(game=>game.id)) {
    for(const adapter of adapters){
      if(adapter.gameId==='texas-holdem'&&adapter.accountFunding==='house')throw new Error('Poker needs a transfer-backed funding adapter. Use temporary chips until then.');
      if(!gameIdSchema.safeParse(adapter.gameId).success || this.adapters.has(adapter.gameId) || !Number.isInteger(adapter.version) || adapter.version<1
        || !Number.isInteger(adapter.capacity)||adapter.capacity<1||adapter.capacity>12||!Number.isSafeInteger(adapter.buyInStepUnits)||adapter.buyInStepUnits<1
        || !Number.isSafeInteger(adapter.minBuyInUnits)||adapter.minBuyInUnits<1||adapter.minBuyInUnits%adapter.buyInStepUnits!==0
        || !Number.isInteger(adapter.minPlayers)||adapter.minPlayers<1||adapter.minPlayers>adapter.capacity
        || !Number.isSafeInteger(adapter.guestStartingChips*100)||adapter.guestStartingChips<=0
        || !['house','temporary-only'].includes(adapter.accountFunding)) throw new Error('Invalid or duplicate game adapter');
      this.adapters.set(adapter.gameId,Object.freeze(adapter));
    }
  }
  available(id:unknown) {
    const parsed=gameIdSchema.safeParse(id);const adapter=parsed.success?this.adapters.get(parsed.data):undefined;
    if(!adapter || !this.enabled.includes(adapter.gameId))throw new GameError('GAME_UNAVAILABLE','This game is not available yet.');
    return adapter;
  }
  forRoom(room:HostedRoom) {
    const id=room.gameId===undefined?'blackjack':room.gameId;const adapter=this.adapters.get(id);
    if(!adapter || (room.adapterVersion===undefined&&id==='blackjack'?1:room.adapterVersion)!==adapter.version)throw new GameError('ROOM_VERSION_UNSUPPORTED','This table needs its original game adapter version.');
    return adapter;
  }
  restore(value:unknown,now:number) {
    if(!value || typeof value!=='object')throw new GameError('ROOM_EXPIRED','This table invitation has expired or does not exist. Create a new table.');
    const metadata=value as HostedRoom;const adapter=this.forRoom(metadata);
    return adapter.restore(value,now);
  }
}
export const gameAdapters=new GameAdapterRegistry([hostGame(blackjackRoomAdapter),hostGame(crashRoomAdapter),hostGame(baccaratRoomAdapter)]);
