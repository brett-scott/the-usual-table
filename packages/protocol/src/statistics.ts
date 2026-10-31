import { z } from 'zod';
import { gameIdSchema } from './games';

// Lifetime totals are decimal strings so accumulated units never lose integer precision in JSON/JavaScript.
const count = z.string().max(20).regex(/^(0|[1-9]\d*)$/);
const units = z.string().max(40).regex(/^(0|[1-9]\d*)$/);
const signedUnits = z.string().max(41).regex(/^(0|-?[1-9]\d*)$/);
export const gameStatisticsSchema = z.object({
  gameId: gameIdSchema, roundsPlayed: count, roundsWon: count, roundsLost: count, roundsEven: count,
  wageredUnits: units, returnedUnits: units, netUnits: signedUnits, bestRoundNetUnits: units,
}).strict().refine(game => {
  if ([game.roundsPlayed, game.roundsWon, game.roundsLost, game.roundsEven, game.netUnits, game.returnedUnits, game.wageredUnits]
    .some(value => typeof value !== 'string' || value.length > 41)) return false;
  try {
    return BigInt(game.roundsPlayed) === BigInt(game.roundsWon) + BigInt(game.roundsLost) + BigInt(game.roundsEven)
      && BigInt(game.netUnits) === BigInt(game.returnedUnits) - BigInt(game.wageredUnits);
  } catch { return false; }
}, 'Inconsistent game statistics');
export const accountStatisticsSchema = z.object({
  contract: z.literal(1), accountId: z.string().uuid(), unitsPerChip: z.literal(100), basis: z.literal('saved-rounds'),
  games: z.array(gameStatisticsSchema).max(8),
}).strict().refine(value => new Set(value.games.map(game => game.gameId)).size === value.games.length, 'Duplicate game statistics');
export type GameStatistics = z.infer<typeof gameStatisticsSchema>;
export type AccountStatistics = z.infer<typeof accountStatisticsSchema>;
