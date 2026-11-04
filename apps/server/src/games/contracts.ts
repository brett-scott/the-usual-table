import type { GameId,GameEntryRules,LobbyVisibility,PlayerIcon } from '@casual/protocol';
import type { Member } from '../roomMembership';
import type { RoomWallet,WalletGateway } from '../tableWallet';
export type GameRandom = (exclusiveMax:number)=>number;
/** Transport, identity and financial lifecycle shared by every table. Engine state stays in its adapter. */
export interface HostedRoom {
  schema:number;id:string;revision:number;managerId:string;gameId?:GameId;adapterVersion?:number;visibility?:LobbyVisibility;
  members:Record<string,Member>;wallet?:RoomWallet;lastActivity:number;
  creation?:{entryId:string;buyInUnits:number;visibility:LobbyVisibility};
  tickets:{hash:string;playerId:string;expires:number;claimId:string;claimVersion:number}[];
  receipts:{id:string;playerId:string;revision:number}[];commandRates:Record<string,{start:number;count:number}>;
}
export interface SeatIdentity {id:string;name:string;seat:number;icon?:PlayerIcon}
export interface GameRoomCreation {roomId:string;player:SeatIdentity;credentialHash:string;now:number;random:GameRandom}
export interface ParsedGameCommand {id:string;playerId:string;action:{type:string}}
export interface GameRoomAdapter<R extends HostedRoom> extends GameEntryRules {
  gameId:GameId;version:number;capacity:number;minBuyInUnits:number;buyInStepUnits:number;
  /** House settlement is unsuitable for poker pot transfers. */
  accountFunding:'house'|'temporary-only';
  create(input:GameRoomCreation):R;restore(raw:unknown,now:number):{room:R;migrated:boolean};
  players(room:R):SeatIdentity[];lobbyPhase(room:R):'waiting'|'playing';join(room:R,player:SeatIdentity):void;
  snapshot(room:R,playerId:string):unknown;parseCommand(raw:unknown):ParsedGameCommand;
  apply(room:R,command:ParsedGameCommand,random:GameRandom,now:number):R;
  expire(room:R,random:GameRandom,now:number):R;collectSeats(room:R,now:number):boolean;nextAlarm(room:R):number|null;
  fund(room:R,playerId:string,accountId:string,buyInUnits:number,entryId:string):R;
  flushWallet(room:R,gateway:WalletGateway|undefined,persist:()=>Promise<void>):Promise<void>;
}
