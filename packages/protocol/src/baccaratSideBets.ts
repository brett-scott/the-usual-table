/** Baccarat side-bet amounts use the wallet's integer hundredths of a virtual chip. */
export interface BaccaratSideBets {
  playerPairUnits:number;
  bankerPairUnits:number;
  superSixUnits:number;
}
export interface BaccaratPairOutcomes {playerPair:boolean;bankerPair:boolean}
export const BACCARAT_SIDE_BET_PROFIT={playerPair:11,bankerPair:11,superSix:12} as const;

/** Pairs compare ranks, not Baccarat point values or suits, and only the first two cards count. */
export function baccaratPairOutcomes(cards:readonly {side:'player'|'banker';card:{rank:string}}[]):BaccaratPairOutcomes {
  const pair=(side:'player'|'banker')=>{
    const hand=cards.filter(card=>card.side===side);
    if(hand.length<2)throw new Error('Both initial Baccarat hands must be revealed before settling pairs.');
    return hand[0]!.card.rank===hand[1]!.card.rank;
  };
  return{playerPair:pair('player'),bankerPair:pair('banker')};
}

/** Returned amounts include each winning stake. A tied six never wins Super 6. */
export function baccaratSideBetReturns(bets:BaccaratSideBets,result:BaccaratPairOutcomes&{outcome:'player'|'banker'|'tie';bankerTotal:number}):BaccaratSideBets {
  return{
    playerPairUnits:result.playerPair?bets.playerPairUnits*(BACCARAT_SIDE_BET_PROFIT.playerPair+1):0,
    bankerPairUnits:result.bankerPair?bets.bankerPairUnits*(BACCARAT_SIDE_BET_PROFIT.bankerPair+1):0,
    superSixUnits:result.outcome==='banker'&&result.bankerTotal===6?bets.superSixUnits*(BACCARAT_SIDE_BET_PROFIT.superSix+1):0,
  };
}
