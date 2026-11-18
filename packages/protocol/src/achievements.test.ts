import {expect,it} from 'vitest';
import {blackjackRoundFactsSchema} from './blackjackStatistics';
import {baccaratRoundFactsSchema} from './baccaratStatistics';
import {crashRoundFactsSchema} from './crashStatistics';
import {EXPANDED_ACHIEVEMENTS} from './achievements';
it('keeps the approved catalogue unique with six goals per game and the exact chip rewards',()=>{
 expect(EXPANDED_ACHIEVEMENTS).toHaveLength(36);expect(new Set(EXPANDED_ACHIEVEMENTS.map(a=>a.id)).size).toBe(36);for(const a of EXPANDED_ACHIEVEMENTS)expect(a.rewardUnits).toBe(({Easy:50000,Medium:150000,Hard:500000,Master:1000000})[a.difficulty]);expect(EXPANDED_ACHIEVEMENTS.filter(a=>a.requiresNewFacts)).toHaveLength(4);for(const game of new Set(EXPANDED_ACHIEVEMENTS.map(a=>a.gameId)))expect(EXPANDED_ACHIEVEMENTS.filter(a=>a.gameId===game)).toHaveLength(6);
});
it('preserves unknown legacy facts and rejects impossible new achievement evidence',()=>{
 const blackjack={hands:2,wins:1,losses:1,pushes:0,blackjacks:0,busts:0,doubles:1,splits:1,insuranceTaken:false,insuranceWon:false};expect(blackjackRoundFactsSchema.parse(blackjack)).toEqual(blackjack);expect(blackjackRoundFactsSchema.safeParse({...blackjack,doubledHandsWon:2}).success).toBe(false);
 const crash={cashedOut:false,cashoutCents:null,crashCents:200,capped:false};expect(crashRoundFactsSchema.parse(crash)).toEqual(crash);expect(crashRoundFactsSchema.safeParse({...crash,cashoutMethod:'manual'}).success).toBe(false);expect(crashRoundFactsSchema.safeParse({cashedOut:true,cashoutCents:200,crashCents:300,capped:false,cashoutMethod:'ceiling'}).success).toBe(false);
 const baccarat={factsVersion:2,mainSide:'player',mainUnits:1000,tieUnits:0,playerPair:false,bankerPair:false,outcome:'player',playerTotal:9,bankerTotal:5,commissionUnits:0};expect(baccaratRoundFactsSchema.parse(baccarat)).toEqual(baccarat);expect(baccaratRoundFactsSchema.safeParse({...baccarat,initialTotals:{player:9,banker:8}}).success).toBe(false);
});
