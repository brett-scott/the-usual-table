import { z } from 'zod';
import { CRASH_BETTING_MS,CRASH_RESULTS_MS,CRASH_GROWTH_MS,CRASH_MAX_MULTIPLIER,MAX_WALLET_UNITS,
  crashBetSchema,crashTargetSchema,crashPlayerSchema,crashOutcomeSchema,crashHistorySchema } from '@casual/protocol';

export const crashStateSchema=z.object({phase:z.enum(['waiting','betting','running','results']),roundId:z.number().int().nonnegative().safe(),
  deadline:z.number().int().nonnegative().safe().nullable(),startedAt:z.number().int().nonnegative().safe().nullable(),outcome:crashOutcomeSchema.nullable(),
  players:z.array(crashPlayerSchema).max(8),history:crashHistorySchema}).strict();
export type CrashState=z.infer<typeof crashStateSchema>;
export type CrashPlayer=CrashState['players'][number];
export type CrashRandom=(exclusiveMax:number)=>number;
export class CrashError extends Error { constructor(public code:string,message:string){super(message);} }
function requireRule(value:unknown,message:string):asserts value {if(!value)throw new CrashError('INVALID_ACTION',message);}
export function newCrash():CrashState{return{phase:'waiting',roundId:0,deadline:null,startedAt:null,outcome:null,players:[],history:[]};}
export function multiplierAt(startedAt:number,now:number){return Math.min(CRASH_MAX_MULTIPLIER,Math.max(100,Math.floor(100*Math.exp(Math.max(0,now-startedAt)/CRASH_GROWTH_MS))));}
/** First integer millisecond at which the authoritative multiplier reaches a target. */
export function targetTime(startedAt:number,target:number){return startedAt+Math.ceil(CRASH_GROWTH_MS*Math.log(target/100));}
export function drawOutcome(random:CrashRandom){
  const range=1_000_000_000;const draw=random(range);
  requireRule(Number.isInteger(draw)&&draw>=0&&draw<range,'Invalid random source.');
  // P(crash > m) ~= 0.97 / m. Ceil keeps exact-target ties on the losing side.
  const raw=Math.ceil(97*range/(range-draw));
  return {multiplierCents:Math.min(CRASH_MAX_MULTIPLIER,Math.max(100,raw)),capped:raw>CRASH_MAX_MULTIPLIER};
}
export function beginBetting(state:CrashState,now:number){
  requireRule(state.phase==='waiting'||state.phase==='results','A round is already in progress.');
  state.phase='betting';state.roundId++;state.deadline=now+CRASH_BETTING_MS;state.startedAt=null;state.outcome=null;
  for(const p of state.players){p.betUnits=0;p.autoCashoutCents=null;p.cashedOutCents=null;p.returnedUnits=0;}
}
export function placeBet(state:CrashState,player:CrashPlayer,amountUnits:number,autoCashoutCents:number|null,now:number){
  crashBetSchema.parse(amountUnits);if(autoCashoutCents!==null)crashTargetSchema.parse(autoCashoutCents);
  requireRule(state.phase==='betting'&&state.deadline!==null&&now<state.deadline,'Betting has closed.');
  requireRule(player.betUnits===0,'Your wager is already locked for this round.');
  requireRule(player.balanceUnits>=amountUnits,'You do not have enough table chips.');
  requireRule(player.balanceUnits+amountUnits*99<=MAX_WALLET_UNITS,'This wager could exceed the table balance limit.');
  player.betUnits=amountUnits;player.autoCashoutCents=autoCashoutCents;player.balanceUnits-=amountUnits;
}
function pay(player:CrashPlayer,cents:number){
  player.cashedOutCents=cents;player.returnedUnits=Math.floor(player.betUnits*cents/100);player.balanceUnits+=player.returnedUnits;
}
export function cashOut(state:CrashState,player:CrashPlayer,now:number){
  requireRule(state.phase==='running'&&state.startedAt!==null&&state.deadline!==null&&now<state.deadline,'The round has crashed.');
  requireRule(player.betUnits>0&&player.cashedOutCents===null,'You have no live wager to cash out.');
  pay(player,multiplierAt(state.startedAt,now));
}
/** Advance one phase at a time so the host durably records results before opening another round. */
export function advanceCrash(previous:CrashState,now:number,random:CrashRandom):CrashState{
  const state=structuredClone(previous);
  if(state.phase==='betting'&&state.deadline!==null&&now>=state.deadline){
    if(!state.players.some(p=>p.betUnits>0)){state.phase='waiting';state.deadline=null;return state;}
    state.phase='running';state.startedAt=state.deadline;state.outcome=drawOutcome(random);state.deadline=targetTime(state.startedAt,state.outcome.multiplierCents);
  }
  if(state.phase==='running'){
    const outcome=state.outcome!;const started=state.startedAt!;
    for(const p of state.players){
      const target=p.autoCashoutCents;
      if(p.betUnits>0&&p.cashedOutCents===null&&target!==null&&(target<outcome.multiplierCents||outcome.capped&&target===CRASH_MAX_MULTIPLIER)&&now>=targetTime(started,target))pay(p,target);
    }
    if(now>=state.deadline!){
      if(outcome.capped)for(const p of state.players)if(p.betUnits>0&&p.cashedOutCents===null)pay(p,CRASH_MAX_MULTIPLIER);
      state.phase='results';state.deadline=state.deadline!+CRASH_RESULTS_MS;
      state.history=[{roundId:state.roundId,...outcome},...state.history].slice(0,10);
    }
  }
  return JSON.stringify(state)===JSON.stringify(previous)?previous:state;
}
export function nextCrashAlarm(state:CrashState){
  const deadlines=[state.deadline];
  if(state.phase==='running')for(const p of state.players)if(p.betUnits>0&&p.cashedOutCents===null&&p.autoCashoutCents!==null
    &&(p.autoCashoutCents<state.outcome!.multiplierCents||state.outcome!.capped&&p.autoCashoutCents===CRASH_MAX_MULTIPLIER))deadlines.push(targetTime(state.startedAt!,p.autoCashoutCents));
  const pending=deadlines.filter((n):n is number=>n!==null);return pending.length?Math.min(...pending):null;
}
export function validCrashState(state:CrashState){
  if(new Set(state.players.map(p=>p.id)).size!==state.players.length||new Set(state.players.map(p=>p.seat)).size!==state.players.length)return false;
  if(state.phase==='waiting'&&(state.deadline!==null||state.outcome!==null||state.startedAt!==null))return false;
  if(state.phase==='betting'&&(state.deadline===null||state.outcome!==null||state.startedAt!==null))return false;
  if((state.phase==='running'||state.phase==='results')&&(!state.outcome||state.startedAt===null||state.deadline===null))return false;
  if(state.outcome?.capped&&state.outcome.multiplierCents!==CRASH_MAX_MULTIPLIER)return false;
  if(state.history.some((h,i)=>h.roundId>state.roundId||h.capped&&h.multiplierCents!==CRASH_MAX_MULTIPLIER||i>0&&h.roundId>=state.history[i-1]!.roundId))return false;
  if(state.phase==='results'&&(!state.history[0]||state.history[0].roundId!==state.roundId||state.history[0].multiplierCents!==state.outcome!.multiplierCents||state.history[0].capped!==state.outcome!.capped))return false;
  if(state.phase==='running'&&!state.players.some(p=>p.betUnits>0))return false;
  if(state.outcome&&state.deadline!==targetTime(state.startedAt!,state.outcome.multiplierCents)+(state.phase==='results'?CRASH_RESULTS_MS:0))return false;
  for(const p of state.players){
    if(state.phase==='waiting'&&p.betUnits!==0)return false;
    if(p.betUnits!==0&&!crashBetSchema.safeParse(p.betUnits).success)return false;
    if(!p.betUnits&&(p.returnedUnits!==0||p.cashedOutCents!==null||p.autoCashoutCents!==null))return false;
    if((state.phase==='waiting'||state.phase==='betting')&&(p.cashedOutCents!==null||p.returnedUnits!==0))return false;
    if(p.cashedOutCents===null&&p.returnedUnits!==0||p.cashedOutCents!==null&&p.returnedUnits!==Math.floor(p.betUnits*p.cashedOutCents/100))return false;
    if(p.cashedOutCents!==null&&(!state.outcome||p.cashedOutCents>=state.outcome.multiplierCents&&!(state.outcome.capped&&p.cashedOutCents===CRASH_MAX_MULTIPLIER)))return false;
  }
  return true;
}
