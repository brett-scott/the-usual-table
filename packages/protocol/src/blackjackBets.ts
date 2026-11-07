import { z } from 'zod';
import type { Card } from './index';
export const PERFECT_PAIR_PROFITS = { none:0, mixed:6, coloured:12, perfect:25 } as const;
export const perfectPairKindSchema=z.enum(['none','mixed','coloured','perfect']);
export type PerfectPairKind=z.infer<typeof perfectPairKindSchema>;
export function perfectPairKind(cards:readonly Pick<Card,'rank'|'suit'>[]):PerfectPairKind{
  const [a,b]=cards;if(!a||!b||a.rank!==b.rank)return 'none';
  if(a.suit===b.suit)return 'perfect';
  const red=(s:Card['suit'])=>s==='hearts'||s==='diamonds';
  return red(a.suit)===red(b.suit)?'coloured':'mixed';
}
export const perfectPairsSchema=z.object({wager:z.number().int().min(0).max(2000).multipleOf(20),kind:perfectPairKindSchema.optional(),returned:z.number().int().nonnegative().optional()});
export const blackjackBetAmountSchema=z.number().int().min(0).max(2000).multipleOf(20);
