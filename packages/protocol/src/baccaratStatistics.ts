import { z } from 'zod';
export const baccaratSideSchema=z.enum(['player','banker','tie']);
const stake=z.number().int().min(0).max(100000).multipleOf(1000);
export const baccaratWagerSchema=z.object({mainSide:z.enum(['player','banker']).nullable(),mainUnits:stake,tieUnits:stake}).strict()
  .refine(v=>(v.mainSide!==null)===(v.mainUnits>0)&&v.mainUnits+v.tieUnits<=100000,'Choose Player or Banker and an optional Tie, up to 1,000 chips total.');
export const baccaratRoundFactsSchema=baccaratWagerSchema.safeExtend({outcome:baccaratSideSchema,playerTotal:z.number().int().min(0).max(9),bankerTotal:z.number().int().min(0).max(9),commissionUnits:z.literal(0)}).strict()
  .refine(v=>v.mainUnits+v.tieUnits>0&&v.outcome===(v.playerTotal===v.bankerTotal?'tie':v.playerTotal>v.bankerTotal?'player':'banker'),'Invalid Baccarat result');
export type BaccaratWager=z.infer<typeof baccaratWagerSchema>;
export type BaccaratFacts=z.infer<typeof baccaratRoundFactsSchema>;
/** No-commission rules: returned amounts include the stake. Whole ten-chip bets make half profits exact. */
export function baccaratReturned(f:BaccaratWager&{outcome:'player'|'banker'|'tie';bankerTotal:number}){
  const main=f.outcome==='tie'?f.mainUnits:f.mainSide===f.outcome?f.mainUnits*(f.outcome==='banker'&&f.bankerTotal===6?1.5:2):0;
  return main+(f.outcome==='tie'?f.tieUnits*9:0);
}
