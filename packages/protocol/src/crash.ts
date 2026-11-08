import { appearanceSchema } from './profile';
import { z } from 'zod';
import { displayNameSchema, playerIconSchema } from './identity';
import { walletUnitsSchema } from './wallet';
import type { GameEntryRules } from './tablePlatform';

export const CRASH_RULES = {capacity:8,minPlayers:1,guestStartingChips:1000,minBuyInUnits:1000,buyInStepUnits:1000,accountFunding:'house'} as const satisfies GameEntryRules;
export const CRASH_BETTING_MS=10_000;
export const CRASH_RESULTS_MS=5_000;
export const CRASH_GROWTH_MS=10_000;
export const CRASH_PROGRESS_CAPABILITY='usual-crash-progress-v1';
export const CRASH_PROGRESS_INTERVAL_MS=250;
export const CRASH_MAX_MULTIPLIER=10_000; // Integer hundredths: 10,000 = 100.00x.
export const crashBetSchema=z.number().int().min(1000).max(100000).multipleOf(1000);
export const crashTargetSchema=z.number().int().min(101).max(CRASH_MAX_MULTIPLIER);
export const crashActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('StartBetting')}).strict(),
  z.object({type:z.literal('PlaceBet'),amountUnits:crashBetSchema,autoCashoutCents:crashTargetSchema.nullable()}).strict(),
  z.object({type:z.literal('CashOut')}).strict(),z.object({type:z.literal('Leave')}).strict(),z.object({type:z.literal('Refill')}).strict(),
]);
export type CrashAction=z.infer<typeof crashActionSchema>;
export const crashCommandSchema=z.object({id:z.string().uuid(),playerId:z.string().min(1).max(100),revision:z.number().int().nonnegative().safe(),
  roundId:z.number().int().nonnegative().safe(),action:crashActionSchema}).strict();
export const crashPlayerSchema=z.object({id:z.string().min(1).max(100),name:displayNameSchema,icon:playerIconSchema.optional(),seat:z.number().int().min(0).max(7),
  balanceUnits:walletUnitsSchema,betUnits:walletUnitsSchema.max(100000),autoCashoutCents:crashTargetSchema.nullable(),
  cashedOutCents:z.number().int().min(100).max(CRASH_MAX_MULTIPLIER).nullable(),returnedUnits:walletUnitsSchema}).strict();
export const crashOutcomeSchema=z.object({multiplierCents:z.number().int().min(100).max(CRASH_MAX_MULTIPLIER),capped:z.boolean()}).strict();
export const crashHistorySchema=z.array(crashOutcomeSchema.extend({roundId:z.number().int().positive().safe()})).max(10);
export const crashSnapshotSchema=z.object({gameId:z.literal('crash'),roomId:z.string().regex(/^[a-f0-9]{32}$/),you:z.string(),revision:z.number().int().nonnegative().safe(),
  claimVersion:z.number().int().nonnegative().safe(),managerId:z.string(),roundId:z.number().int().nonnegative().safe(),phase:z.enum(['waiting','betting','running','results']),
  bettingDeadline:z.number().int().nonnegative().safe().nullable(),startedAt:z.number().int().nonnegative().safe().nullable(),resultsDeadline:z.number().int().nonnegative().safe().nullable(),
  outcome:crashOutcomeSchema.nullable(),history:crashHistorySchema,
  progress:z.object({multiplierCents:z.number().int().min(100).max(CRASH_MAX_MULTIPLIER),elapsedMs:z.number().int().nonnegative().safe(),sampledAt:z.number().int().nonnegative().safe()}).strict().nullable().optional(),
  players:z.array(crashPlayerSchema.extend({connected:z.boolean(),leaving:z.boolean(),appearance:appearanceSchema.optional(),profileVersion:z.number().int().nonnegative().safe().optional()})).max(8),legalActions:z.array(z.enum(['StartBetting','PlaceBet','CashOut','Leave','Refill'])),
  wallet:z.object({status:z.string(),error:z.string().nullable()}).optional(),
}).strict();
export type CrashSnapshot=z.infer<typeof crashSnapshotSchema>;
