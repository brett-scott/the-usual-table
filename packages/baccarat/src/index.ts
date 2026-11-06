import { z } from 'zod';
import { BACCARAT_BETTING_MS,BACCARAT_RESULTS_MS,BACCARAT_CARD_STEP_MS,BACCARAT_CARD_READY_MS,MAX_WALLET_UNITS,
  baccaratPairOutcomes,baccaratWagerUnits,baccaratRoadmapSchema,emptyBaccaratRoadmap,appendBaccaratResult,seedBaccaratRoadmap,validBaccaratRoadmap,baccaratCardSchema,baccaratDealSchema,baccaratPlayerSchema,baccaratResultSchema,baccaratWagerSchema,baccaratReturned,type BaccaratWager } from '@casual/protocol';
export type BaccaratRandom=(exclusiveMax:number)=>number;
export const baccaratStateSchema=z.object({phase:z.enum(['waiting','betting','dealing','results']),roundId:z.number().int().nonnegative().safe(),
  deadline:z.number().int().nonnegative().safe().nullable(),startedAt:z.number().int().nonnegative().safe().nullable(),
  shoe:z.array(baccaratCardSchema).length(416),cursor:z.number().int().min(0).max(416),generation:z.number().int().positive().safe(),shuffled:z.boolean(),
  deal:z.array(baccaratDealSchema).max(6),revealed:z.number().int().min(0).max(6),outcome:baccaratResultSchema.nullable(),
  players:z.array(baccaratPlayerSchema).max(8),history:z.array(baccaratResultSchema).max(20),roadmap:baccaratRoadmapSchema.optional()}).strict();
export type BaccaratState=z.infer<typeof baccaratStateSchema>;
export type BaccaratPlayer=BaccaratState['players'][number];
export class BaccaratError extends Error{constructor(public code:string,message:string){super(message);}}
function check(value:unknown,message:string):asserts value{if(!value)throw new BaccaratError('INVALID_ACTION',message);}
export const emptyWager=():BaccaratWager=>({mainSide:null,mainUnits:0,tieUnits:0});
export const wagerUnits=(p:BaccaratPlayer)=>baccaratWagerUnits(p.wager);
function shuffledShoe(random:BaccaratRandom,generation:number){
  const cards:BaccaratState['shoe']=[];for(let d=0;d<8;d++)for(const suit of ['spades','hearts','diamonds','clubs'] as const)for(const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'] as const)cards.push({id:`${generation}-${d}-${suit}-${rank}`,rank,suit});
  for(let i=cards.length-1;i>0;i--){const j=random(i+1);check(Number.isInteger(j)&&j>=0&&j<=i,'Invalid random source.');[cards[i],cards[j]]=[cards[j]!,cards[i]!];}return cards;
}
export function newBaccarat(random:BaccaratRandom):BaccaratState{return{phase:'waiting',roundId:0,deadline:null,startedAt:null,shoe:shuffledShoe(random,1),cursor:0,generation:1,shuffled:true,deal:[],revealed:0,outcome:null,players:[],history:[],roadmap:emptyBaccaratRoadmap()};}
export function baccaratTotal(cards:z.infer<typeof baccaratCardSchema>[]){return cards.reduce((sum,c)=>sum+(c.rank==='A'?1:['10','J','Q','K'].includes(c.rank)?0:Number(c.rank)),0)%10;}
export function bankerDraws(total:number,playerThird:number|null){
  if(playerThird===null)return total<=5;
  return total<=2||total===3&&playerThird!==8||total===4&&playerThird>=2&&playerThird<=7||total===5&&playerThird>=4&&playerThird<=7||total===6&&(playerThird===6||playerThird===7);
}
function planDeal(state:BaccaratState){
  const deal:BaccaratState['deal']=[];const take=(side:'player'|'banker')=>{const card=state.shoe[state.cursor++];check(card,'The shoe must contain enough cards.');deal.push({side,card});return card;};
  const player=[take('player')];const banker=[take('banker')];player.push(take('player'));banker.push(take('banker'));
  if(baccaratTotal(player)<8&&baccaratTotal(banker)<8){
    let third:number|null=null;if(baccaratTotal(player)<=5){const card=take('player');player.push(card);third=baccaratTotal([card]);}
    if(bankerDraws(baccaratTotal(banker),third))banker.push(take('banker'));
  }
  state.deal=deal;const playerTotal=baccaratTotal(player);const bankerTotal=baccaratTotal(banker);
  state.outcome={roundId:state.roundId,outcome:playerTotal===bankerTotal?'tie':playerTotal>bankerTotal?'player':'banker',playerTotal,bankerTotal};
}
export function beginBaccaratBetting(state:BaccaratState,now:number){
  check(state.phase==='waiting'||state.phase==='results','A round is already in progress.');
  state.phase='betting';state.roundId++;state.deadline=now+BACCARAT_BETTING_MS;state.startedAt=null;state.deal=[];state.revealed=0;state.outcome=null;
  for(const p of state.players){p.wager=emptyWager();p.returnedUnits=0;}
}
export function setBaccaratBet(state:BaccaratState,p:BaccaratPlayer,wager:BaccaratWager,now:number){
  baccaratWagerSchema.parse(wager);check(state.phase==='betting'&&state.deadline!==null&&now<state.deadline,'Betting has closed.');
  const available=p.balanceUnits+wagerUnits(p);const total=baccaratWagerUnits(wager);
  const maximumProfit=wager.mainUnits+wager.tieUnits*8+(wager.sideBets?(wager.sideBets.playerPairUnits+wager.sideBets.bankerPairUnits)*11+wager.sideBets.superSixUnits*12:0);
  check(total<=available,'You do not have enough table chips.');check(available+maximumProfit<=MAX_WALLET_UNITS,'This wager could exceed the table balance limit.');
  p.balanceUnits=available-total;p.wager=structuredClone(wager);
}
export function clearBaccaratRound(state:BaccaratState){state.phase='waiting';state.deadline=null;state.startedAt=null;state.deal=[];state.revealed=0;state.outcome=null;for(const p of state.players){p.wager=emptyWager();p.returnedUnits=0;}}
/** One completed round is retained until its results have been durably recorded by the adapter. */
export function advanceBaccarat(previous:BaccaratState,now:number,random:BaccaratRandom):BaccaratState{
  if(previous.deadline===null||now<previous.deadline||previous.phase==='results')return previous;
  const s=structuredClone(previous);
  if(s.phase==='betting'){
    if(!s.players.some(p=>wagerUnits(p)>0)){clearBaccaratRound(s);return s;}
    s.shuffled=s.shoe.length-s.cursor<6;if(s.shuffled){s.generation++;s.shoe=shuffledShoe(random,s.generation);s.cursor=0;}
    s.startedAt=s.deadline;s.phase='dealing';planDeal(s);
  }
  if(s.phase==='dealing'){
    const start=s.startedAt!;s.revealed=Math.min(s.deal.length,1+Math.floor(Math.max(0,now-start)/BACCARAT_CARD_STEP_MS));
    const ready=start+(s.deal.length-1)*BACCARAT_CARD_STEP_MS+BACCARAT_CARD_READY_MS;
    if(now>=ready){s.phase='results';s.deadline=ready+BACCARAT_RESULTS_MS;for(const p of s.players){p.returnedUnits=baccaratReturned({...p.wager,...s.outcome!,...baccaratPairOutcomes(s.deal)});p.balanceUnits+=p.returnedUnits;}s.roadmap=appendBaccaratResult(s.roadmap??seedBaccaratRoadmap(s.history),s.outcome!);s.history=[s.outcome!,...s.history].slice(0,20);}
    else s.deadline=s.revealed<s.deal.length?start+s.revealed*BACCARAT_CARD_STEP_MS:ready;
  }
  return s;
}
export function validBaccaratState(s:BaccaratState){
  if(s.roadmap&&(!validBaccaratRoadmap(s.roadmap)||JSON.stringify(s.roadmap.results.slice(0,20))!==JSON.stringify(s.history)))return false;
  if(new Set(s.players.map(p=>p.id)).size!==s.players.length||new Set(s.players.map(p=>p.seat)).size!==s.players.length||new Set(s.shoe.map(c=>c.id)).size!==416)return false;
  const expected=new Map<string,string>();for(let d=0;d<8;d++)for(const suit of ['spades','hearts','diamonds','clubs'])for(const rank of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])expected.set(`${s.generation}-${d}-${suit}-${rank}`,`${suit}-${rank}`);
  if(s.shoe.some(c=>expected.get(c.id)!==`${c.suit}-${c.rank}`))return false;
  if(s.history.some((h,i)=>h.roundId>s.roundId||h.outcome!==(h.playerTotal===h.bankerTotal?'tie':h.playerTotal>h.bankerTotal?'player':'banker')||i>0&&h.roundId>=s.history[i-1]!.roundId))return false;
  if(s.phase==='waiting'||s.phase==='betting'){
    if(s.phase==='waiting'?s.deadline!==null:s.deadline===null)return false;
    if(s.startedAt!==null||s.outcome!==null||s.deal.length||s.revealed)return false;
    return s.players.every(p=>p.returnedUnits===0&&(s.phase!=='waiting'||wagerUnits(p)===0));
  }
  if(s.startedAt===null||s.deadline===null||!s.outcome||s.revealed<1||s.revealed>s.deal.length||s.outcome.roundId!==s.roundId)return false;
  // Reconstruct this deal from the same immutable shoe position, including every third-card rule.
  const planned=structuredClone(s);planned.cursor=s.cursor-s.deal.length;if(planned.cursor<0)return false;
  try{planDeal(planned);}catch{return false;}
  if(JSON.stringify(planned.deal)!==JSON.stringify(s.deal)||JSON.stringify(planned.outcome)!==JSON.stringify(s.outcome))return false;
  const ready=s.startedAt+(s.deal.length-1)*BACCARAT_CARD_STEP_MS+BACCARAT_CARD_READY_MS;
  if(s.phase==='results'){
    if(s.revealed!==s.deal.length||s.deadline!==ready+BACCARAT_RESULTS_MS||JSON.stringify(s.history[0])!==JSON.stringify(s.outcome))return false;
    return s.players.every(p=>p.returnedUnits===baccaratReturned({...p.wager,...s.outcome!,...baccaratPairOutcomes(s.deal)}));
  }
  return s.deadline===(s.revealed<s.deal.length?s.startedAt+s.revealed*BACCARAT_CARD_STEP_MS:ready)&&s.players.some(p=>wagerUnits(p)>0)&&s.players.every(p=>p.returnedUnits===0);
}
