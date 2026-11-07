import type { RouletteBet } from '@casual/protocol';
export type RouletteBoardLayout='wide'|'portrait'|'landscape';
export const ROULETTE_NUMBER_RANGES=[1,10,19,25] as const;
export interface NumberBounds {left:number;top:number;right:number;bottom:number}
const center=(r:NumberBounds)=>({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2});
/** Only legal catalogue bets whose covered numbers are on this physical board get a spot. */
export function rouletteBoardSpot(bet:RouletteBet,rects:ReadonlyMap<number,NumberBounds>,layout:RouletteBoardLayout,start:number):{x:number;y:number}|null{
 if(bet.kind==='straight'||bet.kind==='outside'||bet.numbers.some(n=>!rects.has(n))||bet.numbers.includes(0)&&start!==1)return null;
 const boxes=bet.numbers.map(n=>rects.get(n)!);const numbered=bet.numbers.filter(n=>n!==0).map(n=>rects.get(n)!);
 const left=Math.min(...numbered.map(r=>r.left)),right=Math.max(...numbered.map(r=>r.right)),top=Math.min(...numbered.map(r=>r.top)),bottom=Math.max(...numbered.map(r=>r.bottom));
 if(bet.numbers.includes(0)){
  const zero=rects.get(0)!;
  if(layout==='portrait')return{x:bet.kind==='corner'?right:(left+right)/2,y:(zero.bottom+top)/2};
  return{x:(zero.right+left)/2,y:bet.kind==='corner'?bottom:(top+bottom)/2};
 }
 if(bet.kind==='split'){const a=center(boxes[0]!),b=center(boxes[1]!);return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
 if(bet.kind==='corner')return{x:(left+right)/2,y:(top+bottom)/2};
 return layout==='portrait'?{x:right,y:(top+bottom)/2}:{x:(left+right)/2,y:bottom};
}
