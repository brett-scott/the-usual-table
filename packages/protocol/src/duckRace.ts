import { z } from 'zod';
import { displayNameSchema,playerIconSchema } from './identity';
import { walletUnitsSchema } from './wallet';
import { duckIndexSchema,duckRaceWagerSchema } from './duckRaceStatistics';
import type { GameEntryRules } from './tablePlatform';
export const DUCK_RACE_RULES={capacity:8,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:1000,accountFunding:'house'} as const satisfies GameEntryRules;
export const DUCK_RACE_BETTING_MS=15000;
export const DUCK_RACE_RUNNING_MS=10000;
export const DUCK_RACE_RESULTS_MS=5000;
export const DUCK_RACE_PROGRESS_MS=200;
const integer=z.number().int().nonnegative().safe();
export const duckRaceDuckSchema=z.object({id:duckIndexSchema,name:z.string().min(1).max(24)}).strict();
export const duckRaceDucksSchema=z.array(duckRaceDuckSchema).length(4).refine(ducks=>ducks.every((duck,i)=>duck.id===i)&&new Set(ducks.map(d=>d.name)).size===4,'Invalid ducks');
export const duckRacePositionsSchema=z.tuple([integer.max(10000),integer.max(10000),integer.max(10000),integer.max(10000)]);
export const duckRaceResultSchema=z.object({roundId:integer.min(1),winner:duckIndexSchema}).strict();
export const duckRacePlayerSchema=z.object({id:z.string().min(1).max(100),name:displayNameSchema,icon:playerIconSchema.optional(),seat:integer.max(7),balanceUnits:walletUnitsSchema,wager:duckRaceWagerSchema,returnedUnits:walletUnitsSchema}).strict();
export const duckRaceActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('StartBetting')}).strict(),z.object({type:z.literal('PlaceBet'),wager:duckRaceWagerSchema}).strict(),
 z.object({type:z.literal('NextRound')}).strict(),z.object({type:z.literal('Leave')}).strict(),z.object({type:z.literal('Refill')}).strict(),
]);
export type DuckRaceAction=z.infer<typeof duckRaceActionSchema>;
export const duckRaceCommandSchema=z.object({id:z.string().uuid(),playerId:z.string().min(1).max(100),revision:integer,roundId:integer,action:duckRaceActionSchema}).strict();
export const duckRaceSnapshotSchema=z.object({gameId:z.literal('duck-race'),roomId:z.string().regex(/^[a-f0-9]{32}$/),you:z.string(),revision:integer,claimVersion:integer,managerId:z.string(),roundId:integer,
 phase:z.enum(['waiting','betting','racing','results']),bettingDeadline:integer.nullable(),startedAt:integer.nullable(),resultsDeadline:integer.nullable(),
 ducks:duckRaceDucksSchema,positions:duckRacePositionsSchema,sampledAt:integer,winner:duckIndexSchema.nullable(),history:z.array(duckRaceResultSchema).max(10),
 players:z.array(duckRacePlayerSchema.extend({connected:z.boolean(),leaving:z.boolean()})).max(8),legalActions:z.array(z.enum(['StartBetting','PlaceBet','NextRound','Leave','Refill'])),
 wallet:z.object({status:z.string(),error:z.string().nullable()}).optional(),
}).strict();
export type DuckRaceSnapshot=z.infer<typeof duckRaceSnapshotSchema>;
