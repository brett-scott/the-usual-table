import { expect,it } from 'vitest';
import { MAX_WALLET_UNITS,ROULETTE_BETS,ROULETTE_WHEEL,rouletteBet,rouletteColor,rouletteWagerSchema,rouletteReturned } from '@casual/protocol';
import { newRoulette,beginRouletteBetting,setRouletteBet,advanceRoulette,validRouletteState,rouletteStateSchema } from './index';
function table(){const s=newRoulette();s.players.push({id:'one',name:'One',seat:0,balanceUnits:1000000,wager:[],returnedUnits:0});beginRouletteBetting(s,100);return s;}
it('enumerates exactly the legal single-zero bets, colours and wheel order',()=>{
 expect(ROULETTE_BETS).toHaveLength(157);expect(new Set(ROULETTE_BETS.map(b=>b.id)).size).toBe(157);expect(new Set(ROULETTE_WHEEL).size).toBe(37);expect(ROULETTE_WHEEL[0]).toBe(0);expect(ROULETTE_WHEEL.slice(1,6)).toEqual([32,15,19,4,21]);
 expect(Array.from({length:37},(_,n)=>rouletteColor(n)).filter(c=>c==='red')).toHaveLength(18);expect(rouletteColor(0)).toBe('green');
 for(const id of ['split-0-1','split-0-2','split-0-3','street-0-1-2','street-0-2-3','corner-0-1-2-3','corner-2-3-5-6','six-line-31-32-33-34-35-36'])expect(rouletteBet(id)).toBeDefined();
 for(const id of ['split-2-4','split-0-4','street-2-3-4','corner-3-4-6-7','six-line-0-1-2-3-4-5'])expect(rouletteWagerSchema.safeParse([{betId:id,amountUnits:1000}]).success).toBe(false);
});
it('fits a maximum full-board wager inside the shared 8KB command boundary',()=>{
 const command={type:'game-command',protocol:1,gameId:'roulette',adapterVersion:1,command:{id:crypto.randomUUID(),playerId:'p'.repeat(100),revision:Number.MAX_SAFE_INTEGER,roundId:Number.MAX_SAFE_INTEGER,action:{type:'PlaceBet',wager:ROULETTE_BETS.map(b=>({betId:b.id,amountUnits:100000}))}}};
 expect(new TextEncoder().encode(JSON.stringify(command)).length).toBeLessThanOrEqual(8192);
});
it.each(ROULETTE_BETS.map(b=>[b.id,b.numbers,b.profit] as const))('settles %s correctly on every one of the 37 pockets',(id,numbers,profit)=>{
 let total=0;for(let n=0;n<37;n++){const value=rouletteReturned([{betId:id,amountUnits:1000}],n);expect(value).toBe(numbers.includes(n)?1000*(profit+1):0);total+=value;}expect(total).toBe(36000);
});
it('sums simultaneous legs, permits opposing bets and loses every nonzero outside bet on zero',()=>{
 const bets=[{betId:'straight-0',amountUnits:1000},{betId:'split-0-1',amountUnits:1000},{betId:'red',amountUnits:1000},{betId:'black',amountUnits:1000}];expect(rouletteReturned(bets,0)).toBe(54000);expect(rouletteReturned(bets,1)).toBe(20000);
 expect(rouletteReturned(ROULETTE_BETS.filter(b=>b.kind==='outside').map(b=>({betId:b.id,amountUnits:1000})),0)).toBe(0);
});
it('replaces and cancels wagers exactly, without a combined 1,000-chip cap; rejects bad stakes, duplicates and late edits',()=>{
 const s=table(),p=s.players[0]!;setRouletteBet(s,p,[{betId:'red',amountUnits:100000},{betId:'straight-7',amountUnits:100000}],101);expect(p.balanceUnits).toBe(800000);setRouletteBet(s,p,[{betId:'black',amountUnits:1000}],102);expect(p.balanceUnits).toBe(999000);setRouletteBet(s,p,[],103);expect(p.balanceUnits).toBe(1000000);
 for(const amountUnits of [0,999,1500,101000])expect(rouletteWagerSchema.safeParse([{betId:'red',amountUnits}]).success).toBe(false);expect(rouletteWagerSchema.safeParse([{betId:'red',amountUnits:1000},{betId:'red',amountUnits:1000}]).success).toBe(false);
 p.balanceUnits=1000;expect(()=>setRouletteBet(s,p,[{betId:'red',amountUnits:2000}],104)).toThrow('enough');expect(()=>setRouletteBet(s,p,[{betId:'red',amountUnits:1000}],15100)).toThrow('closed');p.balanceUnits=MAX_WALLET_UNITS;expect(()=>setRouletteBet(s,p,[{betId:'straight-0',amountUnits:1000}],105)).toThrow('limit');
});
it.each([0,1,18,19,36])('uses one uniform draw and exact 15/8/5-second boundaries, then settles only once: %s',winner=>{
 const s=table();setRouletteBet(s,s.players[0]!,[{betId:`straight-${winner}`,amountUnits:1000}],101);expect(advanceRoulette(s,15099,()=>{throw new Error('Early draw');})).toBe(s);const draws:number[]=[];const spin=advanceRoulette(s,15100,max=>{draws.push(max);return winner;});expect(draws).toEqual([37]);expect(spin.phase).toBe('spinning');expect(spin.deadline).toBe(23100);expect(advanceRoulette(spin,23099,()=>0)).toBe(spin);const result=advanceRoulette(spin,23100,()=>{throw new Error('Duplicate draw');});expect(result.players[0]!.returnedUnits).toBe(36000);expect(result.deadline).toBe(28100);expect(advanceRoulette(result,99999,()=>0)).toBe(result);expect(validRouletteState(result)).toBe(true);
});
it('pauses without drawing empty rounds and catches up delayed alarms with exactly one result',()=>{
 const s=table();expect(advanceRoulette(s,99999,()=>{throw new Error('Empty draw');}).phase).toBe('waiting');setRouletteBet(s,s.players[0]!,[{betId:'red',amountUnits:1000}],101);const result=advanceRoulette(s,99999,()=>0);expect(result.phase).toBe('results');expect(result.counts).toEqual({spins:1,red:0,black:0,zero:1,odd:0,even:0});
});
it('retains twenty results and cumulative counts; rejects inconsistent history, payouts, counts and restored bankrolls',()=>{
 let s=table();for(let i=0;i<22;i++){setRouletteBet(s,s.players[0]!,[{betId:'red',amountUnits:1000}],s.deadline!-1);s=advanceRoulette(s,s.deadline!+8000,()=>i%2?0:1);if(i<21)beginRouletteBetting(s,s.deadline!);}
 expect(s.history).toHaveLength(20);expect(s.counts).toEqual({spins:22,red:11,black:0,zero:11,odd:11,even:0});expect(validRouletteState(rouletteStateSchema.parse(s))).toBe(true);
 for(const change of [(bad:typeof s)=>bad.players[0]!.returnedUnits++,(bad:typeof s)=>bad.counts.black++,(bad:typeof s)=>bad.history[0]!.winner=36]){const bad=structuredClone(s);change(bad);expect(rouletteStateSchema.safeParse(bad).success&&validRouletteState(bad)).toBe(false);}
});
