import { z } from 'zod';
export const roulettePocketSchema=z.number().int().min(0).max(36);
export const ROULETTE_WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26] as const;
const red=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const rouletteColor=(n:number)=>n===0?'green':red.has(n)?'red':'black';
export type RouletteBetKind='straight'|'split'|'street'|'corner'|'six-line'|'outside';
export interface RouletteBet {id:string;label:string;kind:RouletteBetKind;numbers:readonly number[];profit:number}
const bets:RouletteBet[]=[];
const add=(kind:RouletteBetKind,numbers:number[],profit:number,label?:string,id?:string)=>{numbers.sort((a,b)=>a-b);bets.push({id:id??`${kind}-${numbers.join('-')}`,label:label??numbers.join(' / '),kind,numbers,profit});};
for(let n=0;n<=36;n++)add('straight',[n],35,String(n));
for(let n=1;n<=36;n++){if(n%3!==0)add('split',[n,n+1],17);if(n<=33)add('split',[n,n+3],17);}
for(const n of [1,2,3])add('split',[0,n],17);
for(let n=1;n<=34;n+=3)add('street',[n,n+1,n+2],11);
add('street',[0,1,2],11);add('street',[0,2,3],11);
for(let n=1;n<=32;n++)if(n%3!==0)add('corner',[n,n+1,n+3,n+4],8);
add('corner',[0,1,2,3],8);
for(let n=1;n<=31;n+=3)add('six-line',Array.from({length:6},(_,i)=>n+i),5);
const range=(start:number,length:number)=>Array.from({length},(_,i)=>start+i);
for(let i=1;i<=3;i++){add('outside',range((i-1)*12+1,12),2,`${i===1?'1st':i===2?'2nd':'3rd'} dozen`,`dozen-${i}`);add('outside',Array.from({length:12},(_,j)=>i+j*3),2,`Column ${i}`,`column-${i}`);}
add('outside',range(1,36).filter(n=>red.has(n)),1,'Red','red');add('outside',range(1,36).filter(n=>!red.has(n)),1,'Black','black');
add('outside',range(1,36).filter(n=>n%2===1),1,'Odd','odd');add('outside',range(1,36).filter(n=>n%2===0),1,'Even','even');
add('outside',range(1,18),1,'1–18','low');add('outside',range(19,18),1,'19–36','high');
export const ROULETTE_BETS:readonly RouletteBet[]=bets;
const betsById=new Map(bets.map(b=>[b.id,b]));
export const rouletteBet=(id:string)=>betsById.get(id);
export const rouletteBetIdSchema=z.string().max(40).refine(id=>!!rouletteBet(id),'Choose a valid Roulette bet.');
export const rouletteWagerSchema=z.array(z.object({betId:rouletteBetIdSchema,amountUnits:z.number().int().min(1000).max(100000).multipleOf(1000)}).strict()).max(157)
 .refine(w=>new Set(w.map(b=>b.betId)).size===w.length,'Duplicate Roulette bet.');
export type RouletteWager=z.infer<typeof rouletteWagerSchema>;
export const rouletteWagerUnits=(w:RouletteWager)=>w.reduce((sum,b)=>sum+b.amountUnits,0);
export const rouletteReturned=(w:RouletteWager,winner:number)=>w.reduce((sum,b)=>{const rule=rouletteBet(b.betId)!;return sum+(rule.numbers.includes(winner)?b.amountUnits*(rule.profit+1):0);},0);
export const rouletteStraightWin=(w:RouletteWager,winner:number)=>w.some(b=>b.betId===`straight-${winner}`);
export const rouletteRoundFactsSchema=z.object({bets:rouletteWagerSchema.refine(w=>w.length>0),winner:roulettePocketSchema}).strict();
