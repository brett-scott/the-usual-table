import {it,expect} from 'vitest';
import {KENO_PAYTABLE_CENTS,MAX_WALLET_UNITS,kenoReturned,kenoWagerSchema,kenoRoundFactsSchema} from '@casual/protocol';
import {newKeno,beginKenoBetting,setKenoBet,advanceKeno,drawKeno,validKenoState,kenoStateSchema} from './index';
function setup(){const s=newKeno();s.players.push({id:'one',name:'Alex',seat:0,balanceUnits:100000,wager:{numbers:[],amountUnits:0},returnedUnits:0});beginKenoBetting(s,0);return s;}
function choose(n:number,k:number){if(k<0||k>n)return 0n;let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-k+i)/BigInt(i);return v;}
it('matches the approved exact paytable and keeps every row near 97% theoretical return',()=>{
 expect(KENO_PAYTABLE_CENTS).toEqual([[0,388],[0,0,1681],[0,0,354,4000],[0,0,145,800,15000],[0,0,0,571,3000,60000],[0,0,0,294,1500,8000,150000],[0,0,0,156,800,4000,20000,400000],[0,0,0,0,591,2500,12000,100000,1000000],[0,0,0,0,297,1500,6000,35000,250000,1000000],[0,0,0,0,149,800,4000,20000,100000,500000,1000000]]);
 const denominator=choose(40,10);for(let picks=1;picks<=10;picks++){const counts=Array.from({length:picks+1},(_,hits)=>choose(picks,hits)*choose(40-picks,10-hits));expect(counts.reduce((a,b)=>a+b,0n)).toBe(denominator);const numerator=counts.reduce((sum,n,h)=>sum+n*BigInt(KENO_PAYTABLE_CENTS[picks-1]![h]!),0n);expect(Number(numerator)/Number(denominator)).toBeGreaterThan(96.9);expect(Number(numerator)/Number(denominator)).toBeLessThan(97.1);}
});
it('rounds returns down to whole chips for every pick/match/stake combination, including the 10m-chip cap',()=>{
 for(let picks=1;picks<=10;picks++)for(let hits=0;hits<=picks;hits++)for(let amount=1000;amount<=100000;amount+=1000){const numbers=Array.from({length:picks},(_,i)=>i+1);const draw=[...numbers.slice(0,hits),...Array.from({length:10-hits},(_,i)=>picks+i+1)];const returned=kenoReturned({numbers,amountUnits:amount},draw);expect(returned).toBe(Math.floor(amount*KENO_PAYTABLE_CENTS[picks-1]![hits]!/10000)*100);expect(returned%100).toBe(0);}
 expect(kenoReturned({numbers:[1,2,3,4,5,6,7,8],amountUnits:100000},[1,2,3,4,5,6,7,8,9,10])).toBe(1000000000);
});
it('validates unique number selection, stakes and complete distinct draws',()=>{
 for(const wager of [{numbers:[1,1],amountUnits:1000},{numbers:[2,1],amountUnits:1000},{numbers:[41],amountUnits:1000},{numbers:[],amountUnits:1000},{numbers:[1],amountUnits:999},{numbers:[1],amountUnits:101000}])expect(kenoWagerSchema.safeParse(wager).success).toBe(false);
 expect(kenoWagerSchema.parse({numbers:[1,2],amountUnits:0}).numbers).toEqual([1,2]);expect(kenoRoundFactsSchema.safeParse({numbers:[1],draw:Array(10).fill(1)}).success).toBe(false);
});
it('floors total returns rather than the multiplier and preserves legacy receipts',()=>{
 const draw=[1,2,3,4,5,6,7,8,9,10];
 expect(kenoReturned({numbers:[1],amountUnits:1000},draw)).toBe(3800);
 expect(kenoReturned({numbers:[1],amountUnits:3000},draw)).toBe(11600);
 expect(kenoReturned({numbers:[1,2],amountUnits:1000},draw)).toBe(16800);
 expect(kenoReturned({numbers:[1],amountUnits:10000},draw)).toBe(38800);
 expect(kenoReturned({numbers:[1],amountUnits:1000},draw,'keno-40-10-v1')).toBe(3880);
});
it('reveals only at one-second boundaries, settles once, retains numbers without repeating a wager',()=>{
 let s=setup();setKenoBet(s,s.players[0]!,{numbers:[1,2],amountUnits:1000},1);expect(s.players[0]!.balanceUnits).toBe(99000);expect(advanceKeno(s,14999,()=>{throw Error('early');})).toBe(s);
 s=advanceKeno(s,15000,()=>0);expect(s.phase).toBe('drawing');expect(s.revealedCount).toBe(0);expect(s.players[0]!.returnedUnits).toBe(0);expect(validKenoState(s)).toBe(true);
 expect(advanceKeno(s,15999,()=>0)).toBe(s);for(let n=1;n<=10;n++){s=advanceKeno(s,15000+n*1000,()=>{throw Error('redraw');});expect(s.revealedCount).toBe(n);expect(validKenoState(kenoStateSchema.parse(s))).toBe(true);}
 expect(s.phase).toBe('results');expect(s.players[0]!.returnedUnits).toBe(16800);expect(s.players[0]!.balanceUnits).toBe(115800);expect(advanceKeno(s,30000,()=>0)).toBe(s);beginKenoBetting(s,30000);expect(s.players[0]!.wager).toEqual({numbers:[1,2],amountUnits:0});
});
it('refunds edits/cancellation, pauses empty rounds and rejects late, unaffordable or overflowing bets',()=>{
 const s=setup(),p=s.players[0]!;setKenoBet(s,p,{numbers:[1],amountUnits:100000},1);expect(p.balanceUnits).toBe(0);setKenoBet(s,p,{numbers:[2],amountUnits:1000},2);expect(p.balanceUnits).toBe(99000);setKenoBet(s,p,{numbers:[2],amountUnits:0},3);expect(p.balanceUnits).toBe(100000);expect(advanceKeno(s,15000,()=>{throw Error('empty');}).phase).toBe('waiting');
 expect(()=>setKenoBet(s,p,{numbers:[1],amountUnits:1000},15000)).toThrow('closed');p.balanceUnits=0;expect(()=>setKenoBet(s,p,{numbers:[1],amountUnits:1000},4)).toThrow('enough');p.balanceUnits=MAX_WALLET_UNITS;expect(()=>setKenoBet(s,p,{numbers:[1],amountUnits:1000},4)).toThrow('limit');
});
it('rejects bad randomness and corrupt state, and retains ten unique recent draws',()=>{
 expect(()=>drawKeno(()=>40)).toThrow('random');expect(()=>drawKeno(()=>.5)).toThrow('random');expect(drawKeno(()=>0)).toEqual([1,2,3,4,5,6,7,8,9,10]);let s=setup();for(let i=0;i<12;i++){if(i)beginKenoBetting(s,i*30000);setKenoBet(s,s.players[0]!,{numbers:[40],amountUnits:1000},i*30000+1);s=advanceKeno(s,i*30000+25000,()=>0);}expect(s.history.map(h=>h.roundId)).toEqual([12,11,10,9,8,7,6,5,4,3]);expect(validKenoState(s)).toBe(true);s.revealedCount=9;expect(validKenoState(s)).toBe(false);
});
