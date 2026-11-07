import {expect,it} from 'vitest';
import {perfectPairKind,type Action,type Card,type Command} from '@casual/protocol';
import {createDecks,createRoom,transition,project,type RoomState} from './index';
const random=(max:number)=>max-1;
function send(state:RoomState,action:Action){const command:Command={protocol:1,id:crypto.randomUUID(),playerId:state.players[0]!.id,revision:state.revision,roundId:state.roundId,handId:project(state,state.players[0]!.id).activeHandId??undefined,action};return transition(state,command,random,1000);}
function fixture(a:Card['suit'],b:Card['suit'],secondRank:Card['rank']='8'){
  const state=createRoom('Player',random);state.players[0]!.balance=10000;
  const rest=createDecks();const pick=(rank:Card['rank'],suit?:Card['suit'])=>rest.splice(rest.findIndex(c=>c.rank===rank&&(!suit||c.suit===suit)),1)[0]!;
  state.shoe.cards=[pick('8',a),pick('10'),pick(secondRank,b),pick('7'),pick('3'),pick('2'),...rest];return state;
}
it.each([['spades','hearts','mixed',140],['spades','clubs','coloured',260],['spades','spades','perfect',520],['spades','hearts','none',0]] as const)('settles %s/%s %s exactly once',(a,b,kind,returned)=>{
  let state=fixture(a,b,kind==='none'?'9':'8');state=send(state,{type:'PlaceBet',amount:20,perfectPairsAmount:20});state=send(state,{type:'Ready'});
  expect(state.players[0]!.balance).toBe(9960);
  expect(project(state,state.players[0]!.id).players[0]!.perfectPairs).toEqual({wager:20});
  state=send(state,{type:'Stand'});expect(state.players[0]!.perfectPairsRound).toMatchObject({kind,returned});expect(project(state,state.players[0]!.id).players[0]!.roundResult?.net).toBe(returned-40+(kind==='none'?20:0));
  const balance=state.players[0]!.balance;state=send(state,{type:'NextRound'});expect(state.players[0]!.balance).toBe(balance);expect(state.players[0]!.perfectPairsBet).toBe(0);expect(state.players[0]!.perfectPairsRound).toBeUndefined();
});
it('uses original two cards after splitting and settles a single side wager',()=>{
  let state=fixture('spades','spades');state=send(state,{type:'PlaceBet',amount:20,perfectPairsAmount:20});state=send(state,{type:'Ready'});const opening=structuredClone(state.players[0]!.perfectPairsRound);
  state=send(state,{type:'Split'});while(state.phase==='PLAYER_TURNS')state=send(state,{type:'Stand'});
  expect(state.players[0]!.perfectPairsRound).toEqual({...opening,returned:520});expect(state.players[0]!.hands).toHaveLength(2);
});
it('validates the combined stack, per-target cap, main requirement and Clear transactionally',()=>{
  let state=fixture('spades','clubs');state.players[0]!.balance=4000;
  state=send(state,{type:'PlaceBet',amount:2000,perfectPairsAmount:2000});expect(state.players[0]!.balance).toBe(4000);
  for(const action of [{type:'PlaceBet',amount:2000,perfectPairsAmount:2020},{type:'PlaceBet',amount:0,perfectPairsAmount:20},{type:'PlaceBet',amount:2010,perfectPairsAmount:0}] as const)expect(()=>send(state,action)).toThrow();
  state.players[0]!.balance=3999;expect(()=>send(state,{type:'PlaceBet',amount:2000,perfectPairsAmount:2000})).toThrow();
  state=send(state,{type:'PlaceBet',amount:0,perfectPairsAmount:0});expect(project(state,state.players[0]!.id).legalActions).not.toContain('Ready');
});
it('does not classify two different ranks as a pair',()=>{expect(perfectPairKind([{rank:'K',suit:'hearts'},{rank:'Q',suit:'hearts'}])).toBe('none');});
