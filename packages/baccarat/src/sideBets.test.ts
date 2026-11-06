import { expect,it } from 'vitest';
import { baccaratPairOutcomes,baccaratSideBetReturns } from '../../protocol/src/baccaratSideBets';
import { newBaccarat,beginBaccaratBetting,setBaccaratBet } from './index';
const cards=(player:string[],banker:string[])=>[
  ...player.map(rank=>({side:'player' as const,card:{rank}})),
  ...banker.map(rank=>({side:'banker' as const,card:{rank}})),
];
it('pairs require the same rank among the first two cards, regardless of points or subsequent cards',()=>{
  expect(baccaratPairOutcomes(cards(['Q','Q'],['3','3','7']))).toEqual({playerPair:true,bankerPair:true});
  expect(baccaratPairOutcomes(cards(['10','K','10'],['A','2','A']))).toEqual({playerPair:false,bankerPair:false});
  expect(()=>baccaratPairOutcomes(cards(['Q'],['3','3']))).toThrow('initial');
});
it('pays 11:1 pair profits and 12:1 Super 6 profits with winning stakes returned separately',()=>{
  expect(baccaratSideBetReturns({playerPairUnits:1000,bankerPairUnits:2000,superSixUnits:3000},
    {playerPair:true,bankerPair:true,outcome:'banker',bankerTotal:6}))
    .toEqual({playerPairUnits:12000,bankerPairUnits:24000,superSixUnits:39000});
});
it('pairs settle independently of the main winner, and a tied six loses Super 6',()=>{
  const bets={playerPairUnits:1000,bankerPairUnits:1000,superSixUnits:1000};
  expect(baccaratSideBetReturns(bets,{playerPair:true,bankerPair:false,outcome:'tie',bankerTotal:6}))
    .toEqual({playerPairUnits:12000,bankerPairUnits:0,superSixUnits:0});
  for(const outcome of ['player','tie'] as const)expect(baccaratSideBetReturns(bets,{playerPair:false,bankerPair:false,outcome,bankerTotal:6}).superSixUnits).toBe(0);
  expect(baccaratSideBetReturns(bets,{playerPair:false,bankerPair:true,outcome:'banker',bankerTotal:7}).superSixUnits).toBe(0);
});
it('reserving side bets copies the caller wager so later draft edits cannot alter committed stakes',()=>{
 const state=newBaccarat(n=>n-1);const player={id:'one',name:'One',seat:0,balanceUnits:100000,wager:{mainSide:null,mainUnits:0,tieUnits:0},returnedUnits:0};state.players.push(player);beginBaccaratBetting(state,100);
 const wager={mainSide:null,mainUnits:0,tieUnits:0,sideBets:{playerPairUnits:1000,bankerPairUnits:0,superSixUnits:0}};setBaccaratBet(state,player,wager,101);wager.sideBets.playerPairUnits=100000;
 expect(state.players[0]!.wager.sideBets!.playerPairUnits).toBe(1000);expect(player.balanceUnits).toBe(99000);
});
