import { z } from 'zod';
import { DUCK_RACE_BETTING_MS,DUCK_RACE_RUNNING_MS,DUCK_RACE_RESULTS_MS,MAX_WALLET_UNITS,duckRaceDucksSchema,duckRacePlayerSchema,duckRaceResultSchema,duckRaceWagerSchema,duckIndexSchema,type DuckRaceWager,type DuckRaceSnapshot } from '@casual/protocol';
export type DuckRaceRandom=(exclusiveMax:number)=>number;
const integer=z.number().int().nonnegative().safe();const seed=integer.max(999999);
export const duckRaceStateSchema=z.object({phase:z.enum(['waiting','betting','racing','results']),roundId:integer,deadline:integer.nullable(),startedAt:integer.nullable(),
 ducks:duckRaceDucksSchema,winner:duckIndexSchema.nullable(),seeds:z.tuple([seed,seed,seed,seed]).nullable(),players:z.array(duckRacePlayerSchema).max(8),history:z.array(duckRaceResultSchema).max(10)}).strict();
export type DuckRaceState=z.infer<typeof duckRaceStateSchema>;
export type DuckRacePlayer=DuckRaceState['players'][number];
export class DuckRaceError extends Error{constructor(public code:string,message:string){super(message);}}
function check(value:unknown,message:string):asserts value{if(!value)throw new DuckRaceError('INVALID_ACTION',message);}
function draw(random:DuckRaceRandom,max:number){const value=random(max);check(Number.isInteger(value)&&value>=0&&value<max,'Invalid random source.');return value;}
export const DUCK_NAMES=['Sir Quacksalot','Puddles','Daisy','Quackpot','Waffles','Ducky Stardust','Pickles','Noodles','Bubbles','Captain Flap','Marshmallow','Waddles','Marmalade','Doodle','Peaches','Disco'];
export const emptyDuckWager=():DuckRaceWager=>({duckIndex:null,amountUnits:0});
export const duckWagerUnits=(p:DuckRacePlayer)=>p.wager.amountUnits;
export function newDuckRace(random:DuckRaceRandom):DuckRaceState{const pool=[...DUCK_NAMES];return{phase:'waiting',roundId:0,deadline:null,startedAt:null,winner:null,seeds:null,players:[],history:[],ducks:Array.from({length:4},(_,id)=>({id,name:pool.splice(draw(random,pool.length),1)[0]!}))};}
export function beginDuckBetting(state:DuckRaceState,now:number){check(state.phase==='waiting'||state.phase==='results','A race is already in progress.');state.phase='betting';state.roundId++;state.deadline=now+DUCK_RACE_BETTING_MS;state.startedAt=null;state.winner=null;state.seeds=null;for(const p of state.players){p.wager=emptyDuckWager();p.returnedUnits=0;}}
export function setDuckBet(state:DuckRaceState,p:DuckRacePlayer,wager:DuckRaceWager,now:number){duckRaceWagerSchema.parse(wager);check(state.phase==='betting'&&state.deadline!==null&&now<state.deadline,'Betting has closed.');const available=p.balanceUnits+duckWagerUnits(p);check(wager.amountUnits<=available,'You do not have enough table chips.');check(available+wager.amountUnits*3<=MAX_WALLET_UNITS,'This wager could exceed the table balance limit.');p.balanceUnits=available-wager.amountUnits;p.wager=structuredClone(wager);}
export function clearDuckRound(state:DuckRaceState){state.phase='waiting';state.deadline=null;state.startedAt=null;state.winner=null;state.seeds=null;for(const p of state.players){p.wager=emptyDuckWager();p.returnedUnits=0;}}
/** Public positions only: never export motion seeds or the future winner. Values are basis points. */
export function duckPositions(state:DuckRaceState,now:number):DuckRaceSnapshot['positions']{
 if(state.startedAt===null||state.winner===null||!state.seeds)return[0,0,0,0];
 if(state.phase==='results')return state.seeds.map((seed,i)=>i===state.winner?10000:9100+seed%600) as DuckRaceSnapshot['positions'];
 const t=Math.min(.9999,Math.max(0,(now-state.startedAt)/DUCK_RACE_RUNNING_MS));
 return state.seeds.map((seed,i)=>{const finish=i===state.winner?10000:9100+seed%600;const angle=seed/1000000*Math.PI*2;const variation=300*(Math.sin(2*Math.PI*t+angle)-Math.sin(angle))+120*(Math.sin(4*Math.PI*t+angle)-Math.sin(angle));return Math.floor(Math.max(0,Math.min(finish,finish*t+variation)));}) as DuckRaceSnapshot['positions'];
}
export function advanceDuckRace(previous:DuckRaceState,now:number,random:DuckRaceRandom):DuckRaceState{
 if(previous.deadline===null||now<previous.deadline||previous.phase==='results')return previous;const s=structuredClone(previous);
 if(s.phase==='betting'){if(!s.players.some(p=>duckWagerUnits(p)>0)){clearDuckRound(s);return s;}s.phase='racing';s.startedAt=s.deadline!;s.winner=draw(random,4);s.seeds=[draw(random,1000000),draw(random,1000000),draw(random,1000000),draw(random,1000000)];s.deadline=s.startedAt+DUCK_RACE_RUNNING_MS;}
 if(s.phase==='racing'&&now>=s.deadline!){s.phase='results';s.deadline!+=DUCK_RACE_RESULTS_MS;for(const p of s.players){p.returnedUnits=p.wager.duckIndex===s.winner?duckWagerUnits(p)*4:0;p.balanceUnits+=p.returnedUnits;}s.history=[{roundId:s.roundId,winner:s.winner!},...s.history].slice(0,10);}return s;
}
export function validDuckRaceState(s:DuckRaceState){
 if(new Set(s.players.map(p=>p.id)).size!==s.players.length||new Set(s.players.map(p=>p.seat)).size!==s.players.length||s.ducks.some(d=>!DUCK_NAMES.includes(d.name)))return false;
 if((s.phase==='betting'||s.phase==='racing')&&s.players.some(p=>p.balanceUnits+duckWagerUnits(p)*4>MAX_WALLET_UNITS))return false;
 if(s.history.some((h,i)=>h.roundId>s.roundId||i>0&&h.roundId>=s.history[i-1]!.roundId))return false;
 if(s.phase==='waiting'||s.phase==='betting')return s.startedAt===null&&s.winner===null&&s.seeds===null&&(s.phase==='waiting'?s.deadline===null:s.deadline!==null)&&s.players.every(p=>p.returnedUnits===0&&(s.phase!=='waiting'||duckWagerUnits(p)===0));
 if(s.startedAt===null||s.winner===null||!s.seeds||s.deadline!==s.startedAt+DUCK_RACE_RUNNING_MS+(s.phase==='results'?DUCK_RACE_RESULTS_MS:0))return false;
 if(s.phase==='racing')return s.players.some(p=>duckWagerUnits(p)>0)&&s.players.every(p=>p.returnedUnits===0);
 return s.history[0]?.roundId===s.roundId&&s.history[0]?.winner===s.winner&&s.players.every(p=>p.returnedUnits===(p.wager.duckIndex===s.winner?duckWagerUnits(p)*4:0));
}
