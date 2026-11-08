import { appearanceSchema } from './profile';
import { z } from 'zod';
import { displayNameSchema,playerIconSchema } from './identity';
import { walletUnitsSchema } from './wallet';
import { roulettePocketSchema,rouletteWagerSchema } from './rouletteBets';
import type { GameEntryRules } from './tablePlatform';
export const ROULETTE_RULES={capacity:8,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:1000,accountFunding:'house'} as const satisfies GameEntryRules;
export const ROULETTE_BETTING_MS=15000,ROULETTE_SPIN_MS=8000,ROULETTE_RESULTS_MS=5000;
const integer=z.number().int().nonnegative().safe();
export const rouletteResultSchema=z.object({roundId:integer.min(1),winner:roulettePocketSchema}).strict();
export const rouletteCountsSchema=z.object({spins:integer,red:integer,black:integer,zero:integer,odd:integer,even:integer}).strict().refine(c=>c.spins===c.red+c.black+c.zero&&c.spins===c.odd+c.even+c.zero,'Inconsistent lobby counts.');
export const roulettePlayerSchema=z.object({id:z.string().min(1).max(100),name:displayNameSchema,icon:playerIconSchema.optional(),seat:integer.max(7),balanceUnits:walletUnitsSchema,wager:rouletteWagerSchema,returnedUnits:walletUnitsSchema}).strict();
export const rouletteActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('StartBetting')}).strict(),z.object({type:z.literal('PlaceBet'),wager:rouletteWagerSchema}).strict(),
 z.object({type:z.literal('NextRound')}).strict(),z.object({type:z.literal('Leave')}).strict(),z.object({type:z.literal('Refill')}).strict(),
]);
export type RouletteAction=z.infer<typeof rouletteActionSchema>;
export const rouletteCommandSchema=z.object({id:z.string().uuid(),playerId:z.string().min(1).max(100),revision:integer,roundId:integer,action:rouletteActionSchema}).strict();
export const rouletteSnapshotSchema=z.object({gameId:z.literal('roulette'),roomId:z.string().regex(/^[a-f0-9]{32}$/),you:z.string(),revision:integer,claimVersion:integer,managerId:z.string(),roundId:integer,
 phase:z.enum(['waiting','betting','spinning','results']),bettingDeadline:integer.nullable(),startedAt:integer.nullable(),resultsDeadline:integer.nullable(),
 winner:roulettePocketSchema.nullable(),history:z.array(rouletteResultSchema).max(20),counts:rouletteCountsSchema,
 players:z.array(roulettePlayerSchema.extend({connected:z.boolean(),leaving:z.boolean(),appearance:appearanceSchema.optional(),profileVersion:z.number().int().nonnegative().safe().optional()})).max(8),legalActions:z.array(z.enum(['StartBetting','PlaceBet','NextRound','Leave','Refill'])),
 wallet:z.object({status:z.string(),error:z.string().nullable()}).optional(),
}).strict();
export type RouletteSnapshot=z.infer<typeof rouletteSnapshotSchema>;
