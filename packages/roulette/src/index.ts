import { z } from 'zod';
import { ROULETTE_BETTING_MS,ROULETTE_SPIN_MS,ROULETTE_RESULTS_MS,MAX_WALLET_UNITS,roulettePlayerSchema,rouletteResultSchema,rouletteCountsSchema,roulettePocketSchema,rouletteWagerSchema,rouletteWagerUnits,rouletteReturned,rouletteColor,type RouletteWager } from '@casual/protocol';
const integer=z.number().int().nonnegative().safe();
export const rouletteStateSchema=z.object({phase:z.enum(['waiting','betting','spinning','results']),roundId:integer,deadline:integer.nullable(),startedAt:integer.nullable(),
 winner:roulettePocketSchema.nullable(),players:z.array(roulettePlayerSchema).max(8),history:z.array(rouletteResultSchema).max(20),counts:rouletteCountsSchema}).strict();
export type RouletteState=z.infer<typeof rouletteStateSchema>;
export type RoulettePlayer=RouletteState['players'][number];
export class RouletteError extends Error{constructor(public code:string,message:string){super(message);}}
function check(value:unknown,message:string):asserts value{if(!value)throw new RouletteError('INVALID_ACTION',message);}
export const emptyRouletteWager=():RouletteWager=>[];
export const rouletteStake=(p:RoulettePlayer)=>rouletteWagerUnits(p.wager);
export const rouletteMaximumReturn=(w:RouletteWager)=>Math.max(...Array.from({length:37},(_,n)=>rouletteReturned(w,n)));
export function newRoulette():RouletteState{return{phase:'waiting',roundId:0,deadline:null,startedAt:null,winner:null,players:[],history:[],counts:{spins:0,red:0,black:0,zero:0,odd:0,even:0}};}
export function beginRouletteBetting(s:RouletteState,now:number){check(s.phase==='waiting'||s.phase==='results','A spin is already in progress.');s.phase='betting';s.roundId++;s.deadline=now+ROULETTE_BETTING_MS;s.startedAt=null;s.winner=null;for(const p of s.players){p.wager=[];p.returnedUnits=0;}}
export function setRouletteBet(s:RouletteState,p:RoulettePlayer,wager:RouletteWager,now:number){rouletteWagerSchema.parse(wager);check(s.phase==='betting'&&s.deadline!==null&&now<s.deadline,'Betting has closed.');const available=p.balanceUnits+rouletteStake(p);const stake=rouletteWagerUnits(wager);check(stake<=available,'You do not have enough table chips.');check(available-stake+rouletteMaximumReturn(wager)<=MAX_WALLET_UNITS,'This wager could exceed the table balance limit.');p.balanceUnits=available-stake;p.wager=structuredClone(wager).sort((a,b)=>a.betId.localeCompare(b.betId));}
export function clearRouletteRound(s:RouletteState){s.phase='waiting';s.deadline=null;s.startedAt=null;s.winner=null;for(const p of s.players){p.wager=[];p.returnedUnits=0;}}
export function advanceRoulette(previous:RouletteState,now:number,random:(max:number)=>number):RouletteState{
 if(previous.deadline===null||now<previous.deadline||previous.phase==='results')return previous;const s=structuredClone(previous);
 if(s.phase==='betting'){if(!s.players.some(p=>rouletteStake(p)>0)){clearRouletteRound(s);return s;}const winner=random(37);check(Number.isInteger(winner)&&winner>=0&&winner<37,'Invalid random source.');s.phase='spinning';s.startedAt=s.deadline!;s.winner=winner;s.deadline=s.startedAt+ROULETTE_SPIN_MS;}
 if(s.phase==='spinning'&&now>=s.deadline!){s.phase='results';s.deadline!+=ROULETTE_RESULTS_MS;for(const p of s.players){p.returnedUnits=rouletteReturned(p.wager,s.winner!);p.balanceUnits+=p.returnedUnits;}
  s.history=[{roundId:s.roundId,winner:s.winner!},...s.history].slice(0,20);s.counts.spins++;if(s.winner===0)s.counts.zero++;else{s.counts[rouletteColor(s.winner!)==='red'?'red':'black']++;s.counts[s.winner!%2?'odd':'even']++;}
 }return s;
}
export function validRouletteState(s:RouletteState){
 if(new Set(s.players.map(p=>p.id)).size!==s.players.length||new Set(s.players.map(p=>p.seat)).size!==s.players.length)return false;
 if(s.history.length!==Math.min(20,s.counts.spins)||s.counts.spins>s.roundId||s.history.some((h,i)=>h.roundId>s.roundId||i>0&&h.roundId>=s.history[i-1]!.roundId))return false;
 const recent={red:0,black:0,zero:0,odd:0,even:0};for(const h of s.history){if(h.winner===0)recent.zero++;else{recent[rouletteColor(h.winner)==='red'?'red':'black']++;recent[h.winner%2?'odd':'even']++;}}
 if((Object.keys(recent) as (keyof typeof recent)[]).some(k=>s.counts[k]<recent[k]||s.counts.spins<=20&&s.counts[k]!==recent[k]))return false;
 if((s.phase==='betting'||s.phase==='spinning')&&s.players.some(p=>p.balanceUnits+rouletteMaximumReturn(p.wager)>MAX_WALLET_UNITS))return false;
 if(s.phase==='waiting'||s.phase==='betting')return s.startedAt===null&&s.winner===null&&(s.phase==='waiting'?s.deadline===null:s.deadline!==null)&&s.players.every(p=>p.returnedUnits===0&&(s.phase!=='waiting'||rouletteStake(p)===0));
 if(s.startedAt===null||s.winner===null||s.deadline!==s.startedAt+ROULETTE_SPIN_MS+(s.phase==='results'?ROULETTE_RESULTS_MS:0))return false;
 if(s.phase==='spinning')return s.players.some(p=>rouletteStake(p)>0)&&s.players.every(p=>p.returnedUnits===0);
 return s.history[0]?.roundId===s.roundId&&s.history[0]?.winner===s.winner&&s.players.every(p=>p.returnedUnits===rouletteReturned(p.wager,s.winner!)&&p.balanceUnits>=p.returnedUnits);
}
