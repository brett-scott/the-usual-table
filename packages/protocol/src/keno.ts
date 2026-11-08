import {z} from 'zod';
import {appearanceSchema} from './profile';
import {displayNameSchema,playerIconSchema} from './identity';
import {walletUnitsSchema} from './wallet';
import {kenoDrawSchema,kenoNumberSchema,kenoWagerSchema} from './kenoRules';
import type {GameEntryRules} from './tablePlatform';
export const KENO_PROFILE_CAPABILITY='usual-player-profiles-v3';
export const KENO_RULES={capacity:8,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:1000,accountFunding:'house'} as const satisfies GameEntryRules;
export const KENO_BETTING_MS=15000,KENO_REVEAL_MS=1000,KENO_RESULTS_MS=5000;
const integer=z.number().int().nonnegative().safe();
export const kenoPlayerSchema=z.object({id:z.string().min(1).max(100),name:displayNameSchema,icon:playerIconSchema.optional(),seat:integer.max(7),balanceUnits:walletUnitsSchema,wager:kenoWagerSchema,returnedUnits:walletUnitsSchema}).strict();
export const kenoResultSchema=z.object({roundId:integer.min(1),draw:kenoDrawSchema}).strict();
export const kenoActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('StartBetting')}).strict(),z.object({type:z.literal('PlaceBet'),wager:kenoWagerSchema}).strict(),
 z.object({type:z.literal('NextRound')}).strict(),z.object({type:z.literal('Leave')}).strict(),z.object({type:z.literal('Refill')}).strict(),
]);
export type KenoAction=z.infer<typeof kenoActionSchema>;
export const kenoCommandSchema=z.object({id:z.string().uuid(),playerId:z.string().min(1).max(100),revision:integer,roundId:integer,action:kenoActionSchema}).strict();
export const kenoSnapshotSchema=z.object({gameId:z.literal('keno'),roomId:z.string().regex(/^[a-f0-9]{32}$/),you:z.string(),revision:integer,claimVersion:integer,managerId:z.string(),roundId:integer,
 phase:z.enum(['waiting','betting','drawing','results']),bettingDeadline:integer.nullable(),startedAt:integer.nullable(),resultsDeadline:integer.nullable(),
 revealed:z.array(kenoNumberSchema).max(10).refine(numbers=>new Set(numbers).size===numbers.length),history:z.array(kenoResultSchema).max(10),
 players:z.array(kenoPlayerSchema.extend({connected:z.boolean(),leaving:z.boolean(),appearance:appearanceSchema.optional(),profileVersion:integer.optional()})).max(8),
 legalActions:z.array(z.enum(['StartBetting','PlaceBet','NextRound','Leave','Refill'])),wallet:z.object({status:z.string(),error:z.string().nullable()}).optional(),
}).strict();
export type KenoSnapshot=z.infer<typeof kenoSnapshotSchema>;
