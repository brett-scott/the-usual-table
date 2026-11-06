import { expect,it } from 'vitest';
import { MAX_WALLET_UNITS,duckRaceWagerSchema } from '@casual/protocol';
import { newDuckRace,beginDuckBetting,setDuckBet,advanceDuckRace,duckPositions,validDuckRaceState,duckRaceStateSchema,emptyDuckWager } from './index';
function table(){const s=newDuckRace(n=>n-1);s.players.push({id:'one',name:'One',seat:0,balanceUnits:100000,wager:emptyDuckWager(),returnedUnits:0});beginDuckBetting(s,100);return s;}
it.each([0,1,2,3])('draws each equally likely winner with a single uniform four-way draw: %s',winner=>{
 const s=table();setDuckBet(s,s.players[0]!,{duckIndex:0,amountUnits:10000},101);const sizes:number[]=[];
 const racing=advanceDuckRace(s,15100,n=>{sizes.push(n);return n===4?winner:0;});expect(sizes).toEqual([4,1000000,1000000,1000000,1000000]);expect(racing.winner).toBe(winner);
 const result=advanceDuckRace(racing,25100,()=>{throw new Error('No second draw');});expect(result.players[0]!.returnedUnits).toBe(winner===0?40000:0);expect(result.players[0]!.balanceUnits).toBe(winner===0?130000:90000);expect(result.deadline).toBe(30100);expect(validDuckRaceState(result)).toBe(true);expect(advanceDuckRace(result,100000,()=>0)).toBe(result);
});
it('reserves only the current editable wager and refunds cancellation, respecting limits and the exact deadline',()=>{
 const s=table();const p=s.players[0]!;setDuckBet(s,p,{duckIndex:1,amountUnits:1000},101);setDuckBet(s,p,{duckIndex:2,amountUnits:100000},102);expect(p.balanceUnits).toBe(0);setDuckBet(s,p,emptyDuckWager(),103);expect(p.balanceUnits).toBe(100000);
 for(const amountUnits of [1,999,1500,101000])expect(duckRaceWagerSchema.safeParse({duckIndex:0,amountUnits}).success).toBe(false);
 expect(duckRaceWagerSchema.safeParse({duckIndex:null,amountUnits:1000}).success).toBe(false);
 p.balanceUnits=1000;expect(()=>setDuckBet(s,p,{duckIndex:0,amountUnits:2000},104)).toThrow('enough');expect(()=>setDuckBet(s,p,{duckIndex:0,amountUnits:1000},15100)).toThrow('closed');
 p.balanceUnits=MAX_WALLET_UNITS;expect(()=>setDuckBet(s,p,{duckIndex:0,amountUnits:1000},105)).toThrow('limit');
});
it('pauses empty rounds without using RNG or recording a result, and catches up a delayed race once',()=>{
 const s=table();const empty=advanceDuckRace(s,99999,()=>{throw new Error('No draw');});expect(empty.phase).toBe('waiting');expect(empty.history).toEqual([]);
 setDuckBet(s,s.players[0]!,{duckIndex:2,amountUnits:1000},101);const late=advanceDuckRace(s,99999,()=>2);expect(late.phase).toBe('results');expect(late.players[0]!.balanceUnits).toBe(103000);expect(late.history).toEqual([{roundId:1,winner:2}]);
});
it('publishes monotonic bounded motion and an exact finish for every seed, even after the deadline',()=>{
 for(const seed of [0,250000,500000,750000,999999]){const s=table();setDuckBet(s,s.players[0]!,{duckIndex:0,amountUnits:1000},101);const race=advanceDuckRace(s,15100,n=>n===4?2:seed);let previous=[0,0,0,0];
  for(let elapsed=0;elapsed<=12000;elapsed+=25){const positions=duckPositions(race,15100+elapsed);positions.forEach((value,i)=>{expect(value).toBeGreaterThanOrEqual(previous[i]!);expect(value).toBeLessThan(10000);});previous=positions;}
  expect(duckPositions(advanceDuckRace(race,25100,()=>0),25100)[2]).toBe(10000);
 }
});
it('retains only ten results and rejects inconsistent durable state',()=>{
 let s=table();for(let i=0;i<12;i++){setDuckBet(s,s.players[0]!,{duckIndex:0,amountUnits:1000},s.deadline!-1);s=advanceDuckRace(s,s.deadline!+10000,()=>0);if(i<11)beginDuckBetting(s,s.deadline!);}
 expect(s.history).toHaveLength(10);expect(s.history[0]!.roundId).toBe(12);expect(validDuckRaceState(duckRaceStateSchema.parse(s))).toBe(true);
 const bad=structuredClone(s);bad.players[0]!.returnedUnits--;expect(validDuckRaceState(bad)).toBe(false);bad.players[0]!.returnedUnits++;bad.ducks[0]!.name='Injected';expect(validDuckRaceState(bad)).toBe(false);
});
