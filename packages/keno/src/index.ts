import {z} from 'zod';
import {KENO_BETTING_MS,KENO_REVEAL_MS,KENO_RESULTS_MS,MAX_WALLET_UNITS,kenoPlayerSchema,kenoResultSchema,kenoDrawSchema,kenoWagerSchema,kenoReturned,kenoRulesetSchema,KENO_PAYTABLE_CENTS,type KenoWager} from '@casual/protocol';
export type KenoRandom=(exclusiveMax:number)=>number;
const integer=z.number().int().nonnegative().safe();
export const kenoStateSchema=z.object({ruleset:kenoRulesetSchema.optional(),phase:z.enum(['waiting','betting','drawing','results']),roundId:integer,deadline:integer.nullable(),startedAt:integer.nullable(),draw:kenoDrawSchema.nullable(),revealedCount:integer.max(10),players:z.array(kenoPlayerSchema).max(8),history:z.array(kenoResultSchema).max(10)}).strict();
export type KenoState=z.infer<typeof kenoStateSchema>;export type KenoPlayer=KenoState['players'][number];
// Unversioned durable rounds retain their original pacing and payout until the next round.
const revealMs=(s:KenoState)=>s.ruleset==='keno-40-10-v2'?KENO_REVEAL_MS:500;
export class KenoError extends Error{constructor(public code:string,message:string){super(message);}}
function check(value:unknown,message:string):asserts value{if(!value)throw new KenoError('INVALID_ACTION',message);}
export const emptyKenoWager=(numbers:number[]=[]):KenoWager=>({numbers:[...numbers],amountUnits:0});
export const kenoWagerUnits=(p:KenoPlayer)=>p.wager.amountUnits;
export function newKeno():KenoState{return{ruleset:'keno-40-10-v2',phase:'waiting',roundId:0,deadline:null,startedAt:null,draw:null,revealedCount:0,players:[],history:[]};}
export function beginKenoBetting(s:KenoState,now:number){check(s.phase==='waiting'||s.phase==='results','A draw is already in progress.');s.ruleset='keno-40-10-v2';s.phase='betting';s.roundId++;s.deadline=now+KENO_BETTING_MS;s.startedAt=null;s.draw=null;s.revealedCount=0;for(const p of s.players){p.wager=emptyKenoWager(p.wager.numbers);p.returnedUnits=0;}}
export function setKenoBet(s:KenoState,p:KenoPlayer,wager:KenoWager,now:number){kenoWagerSchema.parse(wager);check(s.phase==='betting'&&s.deadline!==null&&now<s.deadline,'Betting has closed.');const available=p.balanceUnits+kenoWagerUnits(p);check(wager.amountUnits<=available,'Not enough table chips.');const maximum=Math.max(...(KENO_PAYTABLE_CENTS[wager.numbers.length-1]??[0]));check(available-wager.amountUnits+wager.amountUnits*maximum/100<=MAX_WALLET_UNITS,'This ticket could exceed the table balance limit.');p.balanceUnits=available-wager.amountUnits;p.wager=structuredClone(wager);}
export function clearKenoRound(s:KenoState){s.phase='waiting';s.deadline=null;s.startedAt=null;s.draw=null;s.revealedCount=0;for(const p of s.players){p.wager=emptyKenoWager(p.wager.numbers);p.returnedUnits=0;}}
export function drawKeno(random:KenoRandom){const pool=Array.from({length:40},(_,i)=>i+1);return Array.from({length:10},()=>{const index=random(pool.length);check(Number.isInteger(index)&&index>=0&&index<pool.length,'Invalid random source.');return pool.splice(index,1)[0]!;});}
export function advanceKeno(previous:KenoState,now:number,random:KenoRandom){
 if(previous.deadline===null||now<previous.deadline||previous.phase==='results')return previous;const s=structuredClone(previous);const interval=revealMs(s);
 if(s.phase==='betting'){if(!s.players.some(p=>kenoWagerUnits(p)>0)){clearKenoRound(s);return s;}s.phase='drawing';s.startedAt=s.deadline;s.draw=drawKeno(random);s.deadline=s.startedAt!+interval;}
 if(s.phase==='drawing'&&now>=s.deadline!){s.revealedCount=Math.min(10,Math.floor((now-s.startedAt!)/interval));s.deadline=s.startedAt!+(s.revealedCount+1)*revealMs(s);
  if(s.revealedCount===10){s.phase='results';s.deadline=now+KENO_RESULTS_MS;for(const p of s.players){p.returnedUnits=kenoReturned(p.wager,s.draw!,s.ruleset??'keno-40-10-v1');p.balanceUnits+=p.returnedUnits;}s.history=[{roundId:s.roundId,draw:s.draw!},...s.history].slice(0,10);}
 }return s;
}
export function validKenoState(s:KenoState){
 if(new Set(s.players.map(p=>p.id)).size!==s.players.length||new Set(s.players.map(p=>p.seat)).size!==s.players.length)return false;
 if(s.history.some((h,i)=>h.roundId>s.roundId||i>0&&h.roundId>=s.history[i-1]!.roundId))return false;
 if((s.phase==='betting'||s.phase==='drawing')&&s.players.some(p=>p.balanceUnits+kenoWagerUnits(p)*Math.max(...(KENO_PAYTABLE_CENTS[p.wager.numbers.length-1]??[0]))/100>MAX_WALLET_UNITS))return false;
 if(s.phase==='waiting'||s.phase==='betting')return s.startedAt===null&&s.draw===null&&s.revealedCount===0&&(s.phase==='waiting'?s.deadline===null:s.deadline!==null)&&s.players.every(p=>p.returnedUnits===0&&(s.phase!=='waiting'||kenoWagerUnits(p)===0));
 if(s.startedAt===null||!s.draw)return false;
 if(s.phase==='drawing')return s.revealedCount<10&&s.deadline===s.startedAt+(s.revealedCount+1)*revealMs(s)&&s.players.some(p=>kenoWagerUnits(p)>0)&&s.players.every(p=>p.returnedUnits===0);
 return s.revealedCount===10&&s.deadline!==null&&s.deadline>=s.startedAt+10*revealMs(s)+KENO_RESULTS_MS&&s.history[0]?.roundId===s.roundId&&JSON.stringify(s.history[0]?.draw)===JSON.stringify(s.draw)&&s.players.every(p=>p.returnedUnits===kenoReturned(p.wager,s.draw!,s.ruleset??'keno-40-10-v1'));
}
