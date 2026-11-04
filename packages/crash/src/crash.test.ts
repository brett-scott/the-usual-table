import { expect,it } from 'vitest';
import { newCrash,beginBetting,placeBet,cashOut,advanceCrash,drawOutcome,multiplierAt,targetTime,nextCrashAlarm,validCrashState,crashStateSchema,type CrashState } from './index';

const randomFor=(cents:number)=>()=>Math.floor(1_000_000_000-97_000_000_000/cents);
function betting():CrashState{const state=newCrash();state.players.push({id:'one',name:'One',seat:0,balanceUnits:100000,betUnits:0,autoCashoutCents:null,cashedOutCents:null,returnedUnits:0});beginBetting(state,1000);return state;}
it('uses the approved exponential pacing and exact integer deadlines',()=>{
  expect(targetTime(0,200)).toBe(6932);expect(targetTime(0,1000)).toBe(23026);
  for(const target of [101,150,200,500,1000,9999,10000]){const at=targetTime(900,target);expect(multiplierAt(900,at)).toBeGreaterThanOrEqual(target);expect(multiplierAt(900,at-1)).toBeLessThan(target);}
});
it('samples a 3% immediate-crash tail and approximately 97% returns at fixed cash-out thresholds',()=>{
  expect(drawOutcome(()=>0)).toEqual({multiplierCents:100,capped:false});expect(drawOutcome(()=>999999999)).toEqual({multiplierCents:10000,capped:true});
  const draws=100000;let immediate=0;const survived=[0,0,0];
  for(let i=0;i<draws;i++){const outcome=drawOutcome(()=>i*10000+5000);if(outcome.multiplierCents===100)immediate++;
    [200,500,10000].forEach((target,k)=>{if(outcome.multiplierCents>target||outcome.capped)survived[k]=survived[k]!+1;});}
  expect(immediate/draws).toBeCloseTo(.03,4);
  [2,5,100].forEach((multiple,k)=>expect(survived[k]!/draws*multiple).toBeCloseTo(.97,3));
});
it('keeps one exact wager, rejects late/invalid/insufficient bets and pauses an empty window',()=>{
  const e=betting();placeBet(e,e.players[0]!,1000,150,1001);expect(e.players[0]!.balanceUnits).toBe(99000);
  expect(()=>placeBet(e,e.players[0]!,1000,null,1002)).toThrow('locked');
  const empty=betting();expect(()=>placeBet(empty,empty.players[0]!,1000,null,11000)).toThrow('closed');
  expect(()=>placeBet(empty,empty.players[0]!,1050,null,1001)).toThrow();
  empty.players[0]!.balanceUnits=500;expect(()=>placeBet(empty,empty.players[0]!,1000,null,1001)).toThrow('enough');
  expect(advanceCrash(empty,11000,randomFor(200)).phase).toBe('waiting');
});
it('honors auto targets before a delayed crash alarm, loses exact ties, and never pays twice',()=>{
  let e=betting();const second={...e.players[0]!,id:'two',seat:1};e.players.push(second);
  placeBet(e,e.players[0]!,1000,199,1001);placeBet(e,second,1000,200,1001);
  e=advanceCrash(e,11000,randomFor(200));expect(e.phase).toBe('running');expect(nextCrashAlarm(e)).toBe(targetTime(11000,199));
  e=advanceCrash(e,30000,randomFor(999));expect(e.phase).toBe('results');expect(e.players.map(p=>p.returnedUnits)).toEqual([1990,0]);
  expect(e.deadline).toBe(targetTime(11000,200)+5000);expect(validCrashState(e)).toBe(true);
  expect(advanceCrash(e,30001,randomFor(200))).toBe(e);expect(()=>cashOut(e,e.players[1]!,30001)).toThrow('crashed');
});
it('accepts a timely manual cash-out and rejects the crash millisecond and replay',()=>{
  let e=betting();placeBet(e,e.players[0]!,1000,null,1001);e=advanceCrash(e,11000,randomFor(200));
  const at=e.deadline!;const copy=structuredClone(e);cashOut(e,e.players[0]!,at-1);expect(e.players[0]!.returnedUnits).toBe(1990);
  expect(()=>cashOut(e,e.players[0]!,at-1)).toThrow('no live wager');expect(()=>cashOut(copy,copy.players[0]!,at)).toThrow('crashed');
  expect(advanceCrash(copy,at,randomFor(200)).players[0]!.returnedUnits).toBe(0);
});
it('pays surviving wagers automatically at the ceiling while a natural 100x crash still wins ties',()=>{
  for(const [draw,capped] of [[999999999,true],[990300000,false]] as const){
    let e=betting();placeBet(e,e.players[0]!,100000,10000,1001);e=advanceCrash(e,11000,()=>draw);expect(e.outcome).toEqual({multiplierCents:10000,capped});
    e=advanceCrash(e,e.deadline!,()=>0);expect(e.players[0]!.returnedUnits).toBe(capped?10000000:0);expect(validCrashState(e)).toBe(true);
  }
});
it('settles immediate crashes without a manual or auto cash-out opportunity',()=>{
  const e=betting();placeBet(e,e.players[0]!,1000,101,1001);const result=advanceCrash(e,11000,()=>0);
  expect(result.phase).toBe('results');expect(result.outcome?.multiplierCents).toBe(100);expect(result.players[0]!.balanceUnits).toBe(99000);
});
it('rejects inconsistent private phases, payouts and duplicate seats when restoring state',()=>{
  const e=betting();expect(validCrashState(e)).toBe(true);
  expect(validCrashState({...e,phase:'running'})).toBe(false);
  expect(validCrashState({...e,players:[e.players[0]!,e.players[0]!]})).toBe(false);
  const bad=structuredClone(e);bad.players[0]!.returnedUnits=1000;expect(validCrashState(bad)).toBe(false);
});
it('retains the newest ten completed crash values across rounds without exposing an unfinished flight',()=>{
  let state=betting();const completed:{roundId:number;multiplierCents:number;capped:boolean}[]=[];
  for(let i=0;i<12;i++){
    if(i>0)beginBetting(state,state.deadline!);
    const closes=state.deadline!;placeBet(state,state.players[0]!,1000,null,closes-1);
    const before=structuredClone(state.history);state=advanceCrash(state,closes,randomFor(150+i*50));
    expect(state.phase).toBe('running');expect(state.history).toEqual(before);
    state=advanceCrash(state,state.deadline!,()=>0);completed.unshift({roundId:state.roundId,...state.outcome!});
    state=crashStateSchema.parse(JSON.parse(JSON.stringify(state)));expect(validCrashState(state)).toBe(true);
    expect(state.history).toEqual(completed.slice(0,10));
  }
  expect(state.history.map(h=>h.roundId)).toEqual([12,11,10,9,8,7,6,5,4,3]);expect(newCrash().history).toEqual([]);
});
