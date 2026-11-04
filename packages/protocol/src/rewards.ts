import { z } from 'zod';
import { walletSummarySchema } from './wallet';
export const allowanceSchema = z.object({
  contract: z.literal(1), accountId: z.string().uuid(), amountUnits: z.literal(100000), cooldownMs: z.literal(86400000),
  serverNow: z.number().int().nonnegative().safe(), nextEligibleAt: z.number().int().nonnegative().safe().nullable(),
  canClaim: z.boolean(), claimed: z.boolean(), wallet: walletSummarySchema.nullable(),
}).strict().refine(value => !value.wallet || value.wallet.accountId === value.accountId, 'Wallet owner mismatch');
export type Allowance = z.infer<typeof allowanceSchema>;
