import { z } from 'zod';
export const duckIndexSchema=z.number().int().min(0).max(3);
export const duckRaceStakeSchema=z.number().int().min(0).max(100000).multipleOf(1000);
export const duckRaceWagerSchema=z.object({duckIndex:duckIndexSchema.nullable(),amountUnits:duckRaceStakeSchema}).strict()
 .refine(w=>(w.duckIndex!==null)===(w.amountUnits>0),'Choose one duck and bet 10–1,000 chips in steps of 10.');
export const duckRaceRoundFactsSchema=z.object({duckIndex:duckIndexSchema,winner:duckIndexSchema,duckCount:z.literal(4)}).strict();
export type DuckRaceWager=z.infer<typeof duckRaceWagerSchema>;
