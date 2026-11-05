import { expect,it } from 'vitest';
import { baccaratReturned,baccaratRoundFactsSchema,BACCARAT_CARD_STEP_MS,BACCARAT_CARD_READY_MS } from '@casual/protocol';
import { newBaccarat,baccaratTotal,bankerDraws,beginBaccaratBetting,setBaccaratBet,advanceBaccarat,validBaccaratState,type BaccaratState } from './index';
function table(ranks:string[]=[]){const s=newBaccarat(n=>n-1);s.players.push({id:'one',name:'One',seat:0,balanceUnits:100000,wager:{mainSide:null,mainUnits:0,tieUnits:0},returnedUnits:0});ranks.forEach((rank,i)=>{const j=s.shoe.findIndex((c,j)=>j>=i&&c.rank===rank);[s.shoe[i],s.shoe[j]]=[s.shoe[j]!,s.shoe[i]!];});beginBaccaratBetting(s,100);return s;}
function finish(s:BaccaratState){s=advanceBaccarat(s,15100,n=>n-1);return advanceBaccarat(s,s.startedAt!+(s.deal.length-1)*BACCARAT_CARD_STEP_MS+BACCARAT_CARD_READY_MS,n=>n-1);}
it('shuffles eight complete decks with stable distinct physical cards and exact modulo-ten scoring',()=>{
 const s=table();expect(new Set(s.shoe.map(c=>c.id)).size).toBe(416);for(const rank of ['A','2','K'])expect(s.shoe.filter(c=>c.rank===rank)).toHaveLength(32);
 expect(baccaratTotal(s.shoe.filter(c=>['A','9','K'].includes(c.rank)).slice(0,3))).toBe(0);expect(validBaccaratState(s)).toBe(true);expect(()=>newBaccarat(n=>n)).toThrow('random');
});
it('covers every Banker third-card decision, including the no-Player-third-card branch',()=>{
 const draws=[Array.from({length:10},(_,i)=>i),Array.from({length:10},(_,i)=>i),Array.from({length:10},(_,i)=>i),[0,1,2,3,4,5,6,7,9],[2,3,4,5,6,7],[4,5,6,7],[6,7],[],[],[]];
 for(let banker=0;banker<=9;banker++){for(let third=0;third<=9;third++)expect(bankerDraws(banker,third),`Banker ${banker}, third ${third}`).toBe(draws[banker]!.includes(third));expect(bankerDraws(banker,null)).toBe(banker<=5);}
});
it('stands on naturals, draws in Player/Banker order and preserves all third-card rules',()=>{
 for(const ranks of [['4','2','4','3'],['2','3','3','3','J'],['A','2','A','2','6','7']]){let s=table(ranks);setBaccaratBet(s,s.players[0]!,{mainSide:'banker',mainUnits:1000,tieUnits:1000},101);s=finish(s);expect(validBaccaratState(s)).toBe(true);expect(s.deal.slice(0,4).map(c=>c.side)).toEqual(['player','banker','player','banker']);if(ranks[0]==='4')expect(s.deal).toHaveLength(4);}
});
it('pays exact no-commission Banker six, ordinary Banker/Player, Tie plus pushed main bets',()=>{
 const cases=[{ranks:['2','3','3','3','J'],side:'banker' as const,tie:0,returned:1500},{ranks:['3','4','4','5'],side:'banker' as const,tie:0,returned:2000},{ranks:['3','2','4','4'],side:'player' as const,tie:1000,returned:2000},{ranks:['4','4','4','4'],side:'banker' as const,tie:1000,returned:10000}];
 for(const c of cases){let s=table(c.ranks);setBaccaratBet(s,s.players[0]!,{mainSide:c.side,mainUnits:1000,tieUnits:c.tie},101);s=finish(s);expect(s.players[0]!.returnedUnits).toBe(c.returned);expect(s.players[0]!.balanceUnits).toBe(100000-1000-c.tie+c.returned);expect(validBaccaratState(s)).toBe(true);expect(advanceBaccarat(s,1e9,n=>n-1)).toBe(s);}
});
it('edits and cancels wagers without duplicating debits, rejects limits, insufficient chips and deadline ties',()=>{
 const s=table();const p=s.players[0]!;setBaccaratBet(s,p,{mainSide:'player',mainUnits:50000,tieUnits:10000},101);setBaccaratBet(s,p,{mainSide:'banker',mainUnits:1000,tieUnits:0},102);expect(p.balanceUnits).toBe(99000);
 setBaccaratBet(s,p,{mainSide:null,mainUnits:0,tieUnits:0},103);expect(p.balanceUnits).toBe(100000);
 for(const wager of [{mainSide:'player',mainUnits:100000,tieUnits:1000},{mainSide:null,mainUnits:1000,tieUnits:0},{mainSide:'banker',mainUnits:1500,tieUnits:0}] as const)expect(()=>setBaccaratBet(s,p,wager,104)).toThrow();
 p.balanceUnits=1000;expect(()=>setBaccaratBet(s,p,{mainSide:'player',mainUnits:2000,tieUnits:0},104)).toThrow('enough');expect(()=>setBaccaratBet(s,p,{mainSide:'player',mainUnits:1000,tieUnits:0},15100)).toThrow('closed');
});
it('does not deal or consume the shoe when no one bets, and reshuffles only between hands when fewer than six cards remain',()=>{
 let s=table();s=advanceBaccarat(s,15100,n=>n-1);expect(s.phase).toBe('waiting');expect(s.cursor).toBe(0);expect(s.deal).toEqual([]);
 beginBaccaratBetting(s,20000);s.cursor=411;setBaccaratBet(s,s.players[0]!,{mainSide:null,mainUnits:0,tieUnits:1000},20001);s=advanceBaccarat(s,35000,n=>n-1);expect(s.generation).toBe(2);expect(s.shuffled).toBe(true);expect(validBaccaratState(s)).toBe(true);
});
it('reveals one card at each deadline, retains a full five-second results window and rejects corrupt saved outcomes',()=>{
 let s=table(['4','4','4','4']);setBaccaratBet(s,s.players[0]!,{mainSide:null,mainUnits:0,tieUnits:1000},101);s=advanceBaccarat(s,15100,n=>n-1);expect(s.revealed).toBe(1);expect(s.players[0]!.returnedUnits).toBe(0);
 for(let i=1;i<4;i++){s=advanceBaccarat(s,15100+i*1100,n=>n-1);expect(s.revealed).toBe(i+1);expect(validBaccaratState(s)).toBe(true);}s=advanceBaccarat(s,19000,n=>n-1);expect(s.phase).toBe('results');expect(s.deadline).toBe(24000);
 const bad=structuredClone(s);bad.outcome!.bankerTotal=7;expect(validBaccaratState(bad)).toBe(false);bad.outcome=s.outcome;bad.players[0]!.returnedUnits++;expect(validBaccaratState(bad)).toBe(false);
});
it('validates trusted outcome facts against totals and supports main pushes plus Tie wins without commission',()=>{
 const facts={mainSide:'player' as const,mainUnits:1000,tieUnits:1000,outcome:'tie' as const,playerTotal:8,bankerTotal:8,commissionUnits:0 as const};expect(baccaratRoundFactsSchema.safeParse(facts).success).toBe(true);expect(baccaratReturned(facts)).toBe(10000);expect(baccaratRoundFactsSchema.safeParse({...facts,bankerTotal:7}).success).toBe(false);
});
