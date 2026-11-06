import { z } from 'zod';
import { baccaratSideBetReturns,type BaccaratSideBets,type BaccaratPairOutcomes } from './baccaratSideBets';
export const baccaratSideSchema=z.enum(['player','banker','tie']);
const stake=z.number().int().min(0).max(100000).multipleOf(1000);
const mainFields={mainSide:z.enum(['player','banker']).nullable(),mainUnits:stake,tieUnits:stake};
export const legacyBaccaratWagerSchema=z.object(mainFields).strict()
  .refine(v=>(v.mainSide!==null)===(v.mainUnits>0)&&v.mainUnits+v.tieUnits<=100000,'Choose Player or Banker and an optional Tie, up to 1,000 chips total.');
export const baccaratSideBetsSchema=z.object({playerPairUnits:stake,bankerPairUnits:stake,superSixUnits:stake}).strict();
export const baccaratWagerSchema=z.object({...mainFields,sideBets:baccaratSideBetsSchema.optional()}).strict()
  .refine(v=>(v.mainSide!==null)===(v.mainUnits>0),'Choose Player or Banker. Each betting tile accepts 10–1,000 chips in steps of 10.');
const resultFields={outcome:baccaratSideSchema,playerTotal:z.number().int().min(0).max(9),bankerTotal:z.number().int().min(0).max(9),commissionUnits:z.literal(0)};
export const legacyBaccaratRoundFactsSchema=legacyBaccaratWagerSchema.safeExtend(resultFields).strict()
  .refine(v=>v.mainUnits+v.tieUnits>0&&v.outcome===(v.playerTotal===v.bankerTotal?'tie':v.playerTotal>v.bankerTotal?'player':'banker'),'Invalid Baccarat result');
export const baccaratSideRoundFactsSchema=baccaratWagerSchema.safeExtend({...resultFields,factsVersion:z.literal(2),playerPair:z.boolean(),bankerPair:z.boolean()}).strict()
  .refine(v=>baccaratWagerUnits(v)>0&&v.outcome===(v.playerTotal===v.bankerTotal?'tie':v.playerTotal>v.bankerTotal?'player':'banker'),'Invalid Baccarat result');
/** Preserve the exact old command shape for durable retries and operation hashes. */
export const baccaratRoundFactsSchema=z.union([legacyBaccaratRoundFactsSchema,baccaratSideRoundFactsSchema]);
export type BaccaratWager=z.infer<typeof baccaratWagerSchema>;
export type BaccaratFacts=z.infer<typeof baccaratRoundFactsSchema>;
export const emptyBaccaratSideBets=():BaccaratSideBets=>({playerPairUnits:0,bankerPairUnits:0,superSixUnits:0});
export const baccaratWagerUnits=(w:BaccaratWager)=>w.mainUnits+w.tieUnits+(w.sideBets?Object.values(w.sideBets).reduce((sum,units)=>sum+units,0):0);
/** No-commission rules: returned amounts include the stake. Whole ten-chip bets make half profits exact. */
export function baccaratReturned(f:BaccaratWager&{outcome:'player'|'banker'|'tie';bankerTotal:number}&Partial<BaccaratPairOutcomes>){
  const main=f.outcome==='tie'?f.mainUnits:f.mainSide===f.outcome?f.mainUnits*(f.outcome==='banker'&&f.bankerTotal===6?1.5:2):0;
  if(f.sideBets&& (typeof f.playerPair!=='boolean'||typeof f.bankerPair!=='boolean'))throw new Error('Baccarat pair outcomes are required for side-bet settlement.');
  const sides=f.sideBets?Object.values(baccaratSideBetReturns(f.sideBets,{...f,playerPair:f.playerPair!,bankerPair:f.bankerPair!})).reduce((sum,units)=>sum+units,0):0;
  return main+(f.outcome==='tie'?f.tieUnits*9:0)+sides;
}
