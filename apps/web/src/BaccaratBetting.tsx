import type { RefObject } from 'react';
import { baccaratPairOutcomes,baccaratSideBetReturns,emptyBaccaratSideBets,type BaccaratSnapshot,type BaccaratWager } from '@casual/protocol';
import { WagerChips } from './WagerChips';
import type { ChipDenomination } from './BettingChips';
import s from './BaccaratBetting.module.css';

export type BaccaratBetTile='player'|'banker'|'tie'|'playerPair'|'bankerPair'|'superSix';
const number=(units:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(units/100);
const tiles=[
 {id:'player',name:'Player',payout:'1:1',side:false},
 {id:'tie',name:'Tie',payout:'8:1',side:false},
 {id:'banker',name:'Banker',payout:'1:1 · ½ on 6',side:false},
 {id:'playerPair',name:'Player Pair',payout:'11:1',side:true},
 {id:'superSix',name:'Super 6',payout:'12:1',side:true},
 {id:'bankerPair',name:'Banker Pair',payout:'11:1',side:true},
] as const;

export function BaccaratBettingBoard({wager,denomination,enabled,pending,result,cards,roundId,reducedMotion,shoeRef,onBet}:{
 wager:BaccaratWager;denomination:ChipDenomination;enabled:boolean;pending:boolean;
 result:BaccaratSnapshot['outcome'];cards:BaccaratSnapshot['cards'];roundId:number;reducedMotion:boolean;
 shoeRef?:RefObject<HTMLDivElement|null>;onBet(tile:BaccaratBetTile):void;
}){
 const sideBets=wager.sideBets??emptyBaccaratSideBets();
 const pairResult=result?baccaratPairOutcomes(cards):{playerPair:false,bankerPair:false};
 const sideReturns=result?baccaratSideBetReturns(sideBets,{...result,...pairResult}):emptyBaccaratSideBets();
 return <div className={s.board} aria-label="Your table wagers" data-pending={pending} data-waiting-surface>
  {tiles.map(tile=>{
   const amount=tile.id==='player'||tile.id==='banker'?wager.mainSide===tile.id?wager.mainUnits:0:tile.id==='tie'?wager.tieUnits:tile.id==='playerPair'?sideBets.playerPairUnits:tile.id==='bankerPair'?sideBets.bankerPairUnits:sideBets.superSixUnits;
   const move=enabled&&(tile.id==='player'||tile.id==='banker')&&wager.mainUnits>0&&wager.mainSide!==tile.id;
   const hint=move?`Move ${number(wager.mainUnits)} here`:amount===100000?'Tile limit reached':`+${denomination.toLocaleString()} chips`;
   const returned=!result?0:tile.id==='player'||tile.id==='banker'?result.outcome==='tie'?amount:result.outcome===tile.id?amount*(tile.id==='banker'&&result.bankerTotal===6?1.5:2):0:tile.id==='tie'?result.outcome==='tie'?amount*9:0:tile.id==='playerPair'?sideReturns.playerPairUnits:tile.id==='bankerPair'?sideReturns.bankerPairUnits:sideReturns.superSixUnits;
   return <button key={tile.id} type="button" className={s.tile} data-bet-tile={tile.id} data-side-bet={tile.side} data-selected={amount>0} data-amount={amount} disabled={!enabled} aria-label={`Bet on ${tile.name}`} aria-description={`${number(amount)} chips on ${tile.name}. ${enabled?hint:'Betting is closed.'} Pays ${tile.payout} profit.`} title={enabled?hint:`${tile.name}: ${number(amount)} chips`} onClick={()=>onBet(tile.id)}>
    <span className={s.tileHeading}><span>{tile.name}</span><small>{tile.payout}</small></span>
    <span className={s.stakeLine}>
     <span className={s.stack} key={`${tile.id}-${roundId}`}><WagerChips amount={amount/50} returned={returned/50} settled={!!result} reducedMotion={reducedMotion} compact/></span>
     <strong>{amount?number(amount):'—'}</strong>
    </span>
    {enabled&&<span className={s.tapHint} data-move={move}>{hint}</span>}
   </button>;
  })}
  {shoeRef&&<div ref={shoeRef} className={s.shoe} aria-hidden="true">♠</div>}
 </div>;
}
