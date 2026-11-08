import { z } from 'zod';
import { gameIdSchema, type GameId } from './games';
import type { ChatFeed, ChatMessage, ConnectionInfo, GuestSession } from './index';

export const GAME_ADAPTER_CAPABILITY = 'usual-game-adapter-v1';
export interface GameEntryRules {capacity:number;minPlayers:number;guestStartingChips:number;minBuyInUnits:number;buyInStepUnits:number;accountFunding:'house'|'temporary-only'}
export const BLACKJACK_TABLE_RULES={capacity:4,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:50,accountFunding:'house'} as const satisfies GameEntryRules;
export const tableInfoSchema=z.object({roomId:z.string().regex(/^[a-f0-9]{32}$/),gameId:gameIdSchema,adapterVersion:z.number().int().min(1).max(1000),
  capacity:z.number().int().min(1).max(12),minPlayers:z.number().int().min(1).max(12),guestStartingChips:z.number().finite().positive(),minBuyInUnits:z.number().int().positive().safe(),buyInStepUnits:z.number().int().positive().safe(),
  accountFunding:z.enum(['house','temporary-only']),visibility:z.enum(['public','private'])}).strict();
export type TableInfo=z.infer<typeof tableInfoSchema>;
export const gameCommandEnvelopeSchema = z.object({type:z.literal('game-command'),protocol:z.literal(1),gameId:gameIdSchema,
  adapterVersion:z.number().int().min(1).max(1000),command:z.unknown()}).strict();
export interface TableSessionResponse<S> {session:GuestSession;snapshot:S;gameId?:GameId;adapterVersion?:number}
export interface TableClient<S,A> {
  readProfile?(playerId:string,signal?:AbortSignal):Promise<import('./profile').RoomProfile>;
  syncProfile?():Promise<void>;
  getSnapshot():S;send(action:A):Promise<void>;subscribe(listener:()=>void):()=>void;getConnection():ConnectionInfo;
  reconnect?():void;getChat?():ChatFeed;markChatRead?():void;sendChat?(text:string):Promise<void>;dispose():void;
}
export interface GameClientAdapter<S,A> {
  gameId:GameId;version:number;snapshotSchema:z.ZodType<S>;entry:GameEntryRules;
  capabilities?:readonly string[];
  identity(snapshot:S):{playerId:string;roomId:string|undefined;revision:number;claimVersion:number;gameId?:GameId};
  command(snapshot:S,action:A,playerId:string,id:string):unknown;
}
export type TableServerEvent<S=unknown> =
  | {type:'chat';messages:ChatMessage[]}
  | {type:'snapshot';snapshot:S;serverTime:number}
  | {type:'game-snapshot';protocol:1;gameId:GameId;adapterVersion:number;snapshot:S;serverTime:number}
  | {type:'ack';commandId:string;revision:number}
  | {type:'error';commandId?:string;code:string;message:string;snapshot?:S}
  | {type:'replaced';message:string}
  | {type:'connected';controllerId:string;serverTime:number}
  | {type:'pong';serverTime:number};
