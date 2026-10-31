import { z } from 'zod';
import { gameIdSchema } from './games';

/** Virtual play chips only. These units have no purchase or real-money redemption value. */
export const WALLET_CONTRACT_VERSION = 1;
export const WALLET_UNITS_PER_CHIP = 100;
export const MAX_WALLET_UNITS = 9_000_000_000_000;
export const walletUnitsSchema = z.number().int().min(0).max(MAX_WALLET_UNITS);
const positiveUnits = walletUnitsSchema.min(1);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const id = z.string().uuid();
const label = z.string().min(1).max(100);
const base = { contract: z.literal(1), operationId: id, accountId: id };
const session = { sessionId: id, expectedVersion: version };

/** Internal trusted-server commands, never proof of authentication or a browser API. */
export const walletCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('claim_grant'), source: z.enum(['welcome', 'daily']) }).strict(),
  z.object({ ...base, kind: z.literal('allocate'), sessionId: id, roomId: label, gameId: gameIdSchema,
    funding: z.literal('account'), amountUnits: positiveUnits }).strict(),
  z.object({ ...base, ...session, kind: z.literal('activate') }).strict(),
  // Only after a durable room rejection fences this allocation from subsequent activation.
  z.object({ ...base, ...session, kind: z.literal('cancel_allocation'), rejectionId: id }).strict(),
  z.object({ ...base, ...session, kind: z.literal('settle'), gameId: gameIdSchema, roomId: label,
    funding: z.literal('account'), sequence: version, roundId: label, rulesetVersion: label,
    wageredUnits: positiveUnits, returnedUnits: walletUnitsSchema }).strict(),
  // The room must seal play and persist this final watermark before sending this command.
  z.object({ ...base, ...session, kind: z.literal('request_return'),
    finalSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), finalStackUnits: walletUnitsSchema }).strict(),
  z.object({ ...base, ...session, kind: z.literal('complete_return') }).strict(),
]);
export type WalletCommand = z.infer<typeof walletCommandSchema>;
export const walletSessionSchema = z.object({
  sessionId: id, accountId: id, roomId: label, gameId: gameIdSchema, funding: z.literal('account'),
  state: z.enum(['pending_activation', 'active', 'returning', 'closed', 'cancelled']),
  stackUnits: walletUnitsSchema, version, resultSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type WalletSession = z.infer<typeof walletSessionSchema>;
export const walletSummarySchema = z.object({
  contract: z.literal(1), currency: z.literal('virtual-chips'), unitsPerChip: z.literal(100), accountId: id,
  status: z.enum(['active', 'suspended']), version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  availableUnits: walletUnitsSchema, atTablesUnits: walletUnitsSchema, pendingReturnUnits: walletUnitsSchema,
});
export type WalletSummary = z.infer<typeof walletSummarySchema>;
export const walletReceiptSchema = z.object({ operationId: id, wallet: walletSummarySchema, session: walletSessionSchema.nullable() });
export type WalletReceipt = z.infer<typeof walletReceiptSchema>;

/** Existing Blackjack snapshots remain in half-chip units; never reinterpret their stored values. */
export function blackjackUnitsToWallet(halfChips: number): number {
  return walletUnitsSchema.parse(walletUnitsSchema.parse(halfChips) * 50);
}
export function walletUnitsToBlackjack(units: number): number {
  walletUnitsSchema.parse(units);
  if (units % 50 !== 0) throw new Error('Blackjack requires exact half-chip amounts.');
  return units / 50;
}
