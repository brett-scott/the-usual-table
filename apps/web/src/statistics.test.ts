import { expect, it } from 'vitest';
import { accountStatisticsSchema } from '@casual/protocol';
import { statisticsChips,generalStatistics } from './AccountStatistics';

const accountId = 'a213ae22-a459-456d-976c-dc115e74abda';
const game = { gameId: 'blackjack', roundsPlayed: '1', roundsWon: '1', roundsLost: '0', roundsEven: '0', wageredUnits: '900719925474099100', returnedUnits: '900719925474099150', netUnits: '50', bestRoundNetUnits: '50' };
it('preserves lifetime amounts beyond Number precision and formats exact half chips/net signs', () => {
  expect(accountStatisticsSchema.parse({ contract: 1, accountId, unitsPerChip: 100, basis: 'saved-rounds', games: [game] }).games[0]?.wageredUnits).toBe(game.wageredUnits);
  expect(statisticsChips(game.wageredUnits)).toBe('9,007,199,254,740,991');
  expect(statisticsChips(game.returnedUnits)).toBe('9,007,199,254,740,991.5');
  expect(statisticsChips('-50', true)).toBe('−0.5'); expect(statisticsChips('50', true)).toBe('+0.5'); expect(statisticsChips('0', true)).toBe('0');
});
it.each([{ ...game, roundsPlayed: 'NaN' }, { ...game, netUnits: 'invalid' }, { ...game, roundsPlayed: '2' }, { ...game, wageredUnits: '-1' }])('rejects malformed and inconsistent aggregates without throwing from safeParse', invalid => {
  expect(accountStatisticsSchema.safeParse({ contract: 1, accountId, unitsPerChip: 100, basis: 'saved-rounds', games: [invalid] }).success).toBe(false);
});
it('aggregates general statistics exactly across games while retaining the best individual round',()=>{
  const summary=generalStatistics([{...game,gameId:'blackjack'},{...game,gameId:'baccarat',bestRoundNetUnits:'100',netUnits:'100'}]);
  expect(summary.roundsPlayed).toBe('2');expect(summary.wageredUnits).toBe('1801439850948198200');expect(summary.netUnits).toBe('150');expect(summary.bestRoundNetUnits).toBe('100');
});
