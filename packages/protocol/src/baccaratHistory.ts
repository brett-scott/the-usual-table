import { z } from 'zod';
import { baccaratSideSchema } from './baccaratStatistics';
export const BACCARAT_ROADMAP_CAPABILITY='usual-baccarat-roadmap-v1';
export const BACCARAT_HISTORY_LIMIT=300;
const count=z.number().int().nonnegative().safe();
export const baccaratResultSchema=z.object({roundId:count.min(1),outcome:baccaratSideSchema,playerTotal:z.number().int().min(0).max(9),bankerTotal:z.number().int().min(0).max(9)}).strict();
export type BaccaratResult=z.infer<typeof baccaratResultSchema>;
export const baccaratRoadmapSchema=z.object({firstRoundId:count.min(1).nullable(),completedHands:count,playerWins:count,bankerWins:count,ties:count,bankerSixWins:count,
  currentSide:z.enum(['player','banker']).nullable(),currentStreak:count,longestPlayerStreak:count,longestBankerStreak:count,results:z.array(baccaratResultSchema).max(BACCARAT_HISTORY_LIMIT)}).strict();
export type BaccaratRoadmap=z.infer<typeof baccaratRoadmapSchema>;
export function emptyBaccaratRoadmap():BaccaratRoadmap{return{firstRoundId:null,completedHands:0,playerWins:0,bankerWins:0,ties:0,bankerSixWins:0,currentSide:null,currentStreak:0,longestPlayerStreak:0,longestBankerStreak:0,results:[]};}
/** Completed lobby results only. Ties mark the previous decision and do not break a Player/Banker streak. */
export function appendBaccaratResult(previous:BaccaratRoadmap,result:BaccaratResult):BaccaratRoadmap{
  const latest=previous.results[0];if(latest&&result.roundId<=latest.roundId){if(JSON.stringify(latest)===JSON.stringify(result))return previous;throw new Error('Baccarat history must advance in order.');}
  const next={...previous,firstRoundId:previous.firstRoundId??result.roundId,completedHands:previous.completedHands+1,results:[result,...previous.results].slice(0,BACCARAT_HISTORY_LIMIT)};
  if(result.outcome==='tie')next.ties++;
  else{if(result.outcome==='player')next.playerWins++;else{next.bankerWins++;if(result.bankerTotal===6)next.bankerSixWins++;}
    next.currentStreak=previous.currentSide===result.outcome?previous.currentStreak+1:1;next.currentSide=result.outcome;
    if(result.outcome==='player')next.longestPlayerStreak=Math.max(next.longestPlayerStreak,next.currentStreak);else next.longestBankerStreak=Math.max(next.longestBankerStreak,next.currentStreak);
  }return next;
}
export function seedBaccaratRoadmap(results:readonly BaccaratResult[]){return [...results].reverse().reduce(appendBaccaratResult,emptyBaccaratRoadmap());}
export function validBaccaratRoadmap(value:BaccaratRoadmap){
  if(value.completedHands!==value.playerWins+value.bankerWins+value.ties||value.bankerSixWins>value.bankerWins
    ||value.results.length!==Math.min(value.completedHands,BACCARAT_HISTORY_LIMIT)||value.longestPlayerStreak>value.playerWins||value.longestBankerStreak>value.bankerWins
    ||value.currentStreak>(value.currentSide==='player'?value.longestPlayerStreak:value.currentSide==='banker'?value.longestBankerStreak:0)
    ||(value.currentSide===null)!==(value.currentStreak===0)||(value.playerWins+value.bankerWins===0)!==(value.currentSide===null)||(!value.completedHands)!==(value.firstRoundId===null))return false;
  if(value.results.some((r,i)=>r.outcome!==(r.playerTotal===r.bankerTotal?'tie':r.playerTotal>r.bankerTotal?'player':'banker')||i>0&&r.roundId>=value.results[i-1]!.roundId))return false;
  if(value.firstRoundId!==null&&value.firstRoundId>value.results.at(-1)!.roundId)return false;
  const retained=seedBaccaratRoadmap(value.results);
  if(value.completedHands<=BACCARAT_HISTORY_LIMIT)return JSON.stringify(retained)===JSON.stringify(value);
  return retained.playerWins<=value.playerWins&&retained.bankerWins<=value.bankerWins&&retained.ties<=value.ties&&retained.bankerSixWins<=value.bankerSixWins
    &&(retained.currentSide===null||retained.currentSide===value.currentSide&&retained.currentStreak<=value.currentStreak);
}
