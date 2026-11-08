import {z} from 'zod';
export const KENO_PAYTABLE_CENTS:readonly (readonly number[])[]=[
 [0,388],[0,0,1681],[0,0,354,4000],[0,0,145,800,15000],[0,0,0,571,3000,60000],
 [0,0,0,294,1500,8000,150000],[0,0,0,156,800,4000,20000,400000],
 [0,0,0,0,591,2500,12000,100000,1000000],[0,0,0,0,297,1500,6000,35000,250000,1000000],
 [0,0,0,0,149,800,4000,20000,100000,500000,1000000],
];
export const kenoNumberSchema=z.number().int().min(1).max(40);
export const kenoNumbersSchema=z.array(kenoNumberSchema).max(10).refine(numbers=>numbers.every((n,i)=>i===0||n>numbers[i-1]!),'Choose distinct numbers in ascending order');
export const kenoDrawSchema=z.array(kenoNumberSchema).length(10).refine(numbers=>new Set(numbers).size===10,'Draw ten different numbers');
export const kenoWagerSchema=z.object({numbers:kenoNumbersSchema,amountUnits:z.number().int().min(0).max(100000).multipleOf(1000)}).strict().refine(w=>w.amountUnits===0||w.numbers.length>0,'Select 1–10 numbers before betting');
export const kenoRoundFactsSchema=z.object({numbers:kenoNumbersSchema.refine(n=>n.length>0),draw:kenoDrawSchema}).strict();
export type KenoWager=z.infer<typeof kenoWagerSchema>;
export const kenoRulesetSchema=z.enum(['keno-40-10-v1','keno-40-10-v2']);
export type KenoRuleset=z.infer<typeof kenoRulesetSchema>;
export const kenoMatches=(numbers:readonly number[],draw:readonly number[])=>numbers.filter(n=>draw.includes(n)).length;
export function kenoMultiplierCents(picks:number,matches:number){return KENO_PAYTABLE_CENTS[picks-1]?.[matches]??0;}
export function kenoReturned(wager:KenoWager,draw:readonly number[],ruleset:KenoRuleset='keno-40-10-v2'){
 kenoWagerSchema.parse(wager);kenoDrawSchema.parse(draw);
 const returned=wager.amountUnits*kenoMultiplierCents(wager.numbers.length,kenoMatches(wager.numbers,draw))/100;
 // Keep legacy receipts verifiable; new tickets always return complete chips (100 units).
 return ruleset==='keno-40-10-v1'?returned:Math.floor(returned/100)*100;
}
