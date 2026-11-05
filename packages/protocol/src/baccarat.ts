import { z } from 'zod';
import { displayNameSchema,playerIconSchema } from './identity';
import { walletUnitsSchema } from './wallet';
import { baccaratWagerSchema,baccaratSideSchema } from './baccaratStatistics';
import type { GameEntryRules } from './tablePlatform';
export const BACCARAT_RULES={capacity:8,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:1000,accountFunding:'house'} as const satisfies GameEntryRules;
export const BACCARAT_BETTING_MS=15000;
export const BACCARAT_RESULTS_MS=5000;
export const BACCARAT_CARD_STEP_MS=1100; // 280ms deal, 320ms flip, then 500ms pause.
export const BACCARAT_CARD_READY_MS=600;
export const baccaratCardSchema=z.object({id:z.string().min(1).max(60),rank:z.enum(['A','2','3','4','5','6','7','8','9','10','J','Q','K']),suit:z.enum(['spades','hearts','diamonds','clubs'])}).strict();
const integer=z.number().int().nonnegative().safe();
export const baccaratActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('StartBetting')}).strict(),z.object({type:z.literal('PlaceBet'),wager:baccaratWagerSchema}).strict(),
  z.object({type:z.literal('NextRound')}).strict(),z.object({type:z.literal('Leave')}).strict(),z.object({type:z.literal('Refill')}).strict(),
]);
export type BaccaratAction=z.infer<typeof baccaratActionSchema>;
export const baccaratCommandSchema=z.object({id:z.string().uuid(),playerId:z.string().min(1).max(100),revision:integer,roundId:integer,action:baccaratActionSchema}).strict();
export const baccaratPlayerSchema=z.object({id:z.string().min(1).max(100),name:displayNameSchema,icon:playerIconSchema.optional(),seat:z.number().int().min(0).max(7),
  balanceUnits:walletUnitsSchema,wager:baccaratWagerSchema,returnedUnits:walletUnitsSchema}).strict();
export const baccaratResultSchema=z.object({roundId:integer.min(1),outcome:baccaratSideSchema,playerTotal:z.number().int().min(0).max(9),bankerTotal:z.number().int().min(0).max(9)}).strict();
export const baccaratDealSchema=z.object({side:z.enum(['player','banker']),card:baccaratCardSchema}).strict();
export const baccaratSnapshotSchema=z.object({gameId:z.literal('baccarat'),roomId:z.string().regex(/^[a-f0-9]{32}$/),you:z.string(),revision:integer,claimVersion:integer,managerId:z.string(),roundId:integer,
  phase:z.enum(['waiting','betting','dealing','results']),bettingDeadline:integer.nullable(),startedAt:integer.nullable(),resultsDeadline:integer.nullable(),
  cards:z.array(baccaratDealSchema).max(6),outcome:baccaratResultSchema.nullable(),history:z.array(baccaratResultSchema).max(20),
  shoe:z.object({decks:z.literal(8),remaining:z.number().int().min(0).max(416),shuffled:z.boolean()}).strict(),
  players:z.array(baccaratPlayerSchema.extend({connected:z.boolean(),leaving:z.boolean()})).max(8),legalActions:z.array(z.enum(['StartBetting','PlaceBet','NextRound','Leave','Refill'])),
  wallet:z.object({status:z.string(),error:z.string().nullable()}).optional(),
}).strict();
export type BaccaratSnapshot=z.infer<typeof baccaratSnapshotSchema>;
