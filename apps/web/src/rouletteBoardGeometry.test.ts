import { expect,it } from 'vitest';
import { ROULETTE_BETS,rouletteBet } from '@casual/protocol';
import { rouletteBoardSpot,ROULETTE_NUMBER_RANGES,type NumberBounds } from './rouletteBoardGeometry';
function portrait(start:number){const map=new Map<number,NumberBounds>([[0,{left:0,right:156,top:0,bottom:44}]]);for(let i=0;i<12;i++){const x=i%3*53,y=(Math.floor(i/3)+1)*47;map.set(start+i,{left:x,right:x+50,top:y,bottom:y+44});}return map;}
it('places corners and splits exactly on their shared number boundaries',()=>{
 const rects=portrait(1);expect(rouletteBoardSpot(rouletteBet('corner-1-2-4-5')!,rects,'portrait',1)).toEqual({x:51.5,y:92.5});expect(rouletteBoardSpot(rouletteBet('split-1-2')!,rects,'portrait',1)).toEqual({x:51.5,y:69});expect(rouletteBoardSpot(rouletteBet('split-1-4')!,rects,'portrait',1)).toEqual({x:25,y:92.5});
 expect(rouletteBoardSpot(rouletteBet('street-1-2-3')!,rects,'portrait',1)).toEqual({x:156,y:69});expect(rouletteBoardSpot(rouletteBet('six-line-1-2-3-4-5-6')!,rects,'portrait',1)).toEqual({x:156,y:92.5});
});
it('represents every legal group on at least one overlapping compact range without inventing adjacency',()=>{
 for(const bet of ROULETTE_BETS.filter(b=>!['straight','outside'].includes(b.kind)))expect(ROULETTE_NUMBER_RANGES.some(start=>rouletteBoardSpot(bet,portrait(start),'portrait',start)!==null),bet.id).toBe(true);
 expect(rouletteBoardSpot(rouletteBet('corner-10-11-13-14')!,portrait(1),'portrait',1)).toBeNull();expect(rouletteBoardSpot(rouletteBet('corner-10-11-13-14')!,portrait(10),'portrait',10)).not.toBeNull();
 expect(rouletteBoardSpot(rouletteBet('split-0-1')!,portrait(10),'portrait',10)).toBeNull();
});
it('places zero combinations at the actual zero boundary and rotates the same geometry for desktop',()=>{
 const phone=portrait(1);expect(rouletteBoardSpot(rouletteBet('split-0-2')!,phone,'portrait',1)).toEqual({x:78,y:45.5});expect(rouletteBoardSpot(rouletteBet('street-0-1-2')!,phone,'portrait',1)).toEqual({x:51.5,y:45.5});expect(rouletteBoardSpot(rouletteBet('corner-0-1-2-3')!,phone,'portrait',1)).toEqual({x:156,y:45.5});
 const wide=new Map<number,NumberBounds>([[0,{left:0,right:50,top:0,bottom:138}]]);for(let n=1;n<=6;n++){const x=(Math.floor((n-1)/3)+1)*53,y=(2-(n-1)%3)*47;wide.set(n,{left:x,right:x+50,top:y,bottom:y+44});}
 expect(rouletteBoardSpot(rouletteBet('corner-1-2-4-5')!,wide,'wide',1)).toEqual({x:104.5,y:92.5});expect(rouletteBoardSpot(rouletteBet('six-line-1-2-3-4-5-6')!,wide,'wide',1)).toEqual({x:104.5,y:138});expect(rouletteBoardSpot(rouletteBet('split-0-2')!,wide,'wide',1)).toEqual({x:51.5,y:69});
});
