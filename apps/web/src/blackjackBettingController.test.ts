import {expect,it} from 'vitest';
import {createRoom,project} from '@casual/engine';
import type {Action,GameClient,ConnectionInfo,Snapshot} from '@casual/protocol';
import {BlackjackBettingController,addBlackjackChip} from './blackjackBettingController';
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(){
  let state:Snapshot=project(createRoom('Player',max=>max-1),'practice-player');state.players[0]!.balance=6000;
  let connection:ConnectionInfo={status:'connected',message:'Connected'};const listeners=new Set<()=>void>();
  const calls:{action:Action;resolve():void;reject(error:Error):void}[]=[];
  const client:GameClient={getSnapshot:()=>state,getConnection:()=>connection,subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},dispose(){},send:action=>new Promise((resolve,reject)=>calls.push({action,resolve,reject}))};
  const controller=new BlackjackBettingController(client),stop=controller.start();const notify=()=>{for(const fn of listeners)fn();};
  return {controller,calls,stop,confirm(i:number){const action=calls[i]!.action;if(action.type!=='PlaceBet')throw Error('Expected bet');state={...state,revision:state.revision+1,players:[{...state.players[0]!,bet:action.amount,perfectPairs:{wager:action.perfectPairsAmount??0}}]};notify();},update(change:Partial<Snapshot>){state={...state,...change};notify();},disconnect(){connection={status:'reconnecting',message:'Reconnecting'};notify();}};
}
it('supports two 1,000-chip targets without a combined cap and requires a main bet',()=>{
  let wager=addBlackjackChip({amount:0,perfectPairsAmount:0},'main',1000,4000);wager=addBlackjackChip(wager,'pair',1000,4000);expect(wager).toEqual({amount:2000,perfectPairsAmount:2000});
  expect(()=>addBlackjackChip(wager,'main',10,6000)).toThrow('maximum');expect(()=>addBlackjackChip({amount:0,perfectPairsAmount:0},'pair',10,4000)).toThrow('main bet');expect(()=>addBlackjackChip({amount:2000,perfectPairsAmount:0},'pair',10,2000)).toThrow('Not enough');
});
it('coalesces fast alternating target taps and waits for both acknowledgement and authoritative snapshot',async()=>{
  const f=fixture();for(let i=0;i<10;i++){f.controller.add('main',10);f.controller.add('pair',10);}expect(f.calls).toHaveLength(1);expect(f.controller.getSnapshot().wager).toEqual({amount:220,perfectPairsAmount:200});
  f.confirm(0);f.calls[0]!.resolve();await tick();expect(f.calls).toHaveLength(2);f.calls[1]!.resolve();await tick();expect(f.controller.getSnapshot().pending).toBe(true);f.confirm(1);expect(f.controller.getSnapshot().pending).toBe(false);f.stop();
});
it('supports Undo and Clear during in-flight edits and does not replay edits after disconnect',async()=>{
  const f=fixture();f.controller.add('pair',10);f.controller.clear();f.controller.undo();expect(f.controller.getSnapshot().wager.perfectPairsAmount).toBe(20);f.controller.undo();expect(f.controller.getSnapshot().wager).toEqual({amount:20,perfectPairsAmount:0});
  f.disconnect();f.calls[0]!.resolve();await tick();expect(f.controller.getSnapshot()).toMatchObject({pending:false,canUndo:false,wager:{amount:20,perfectPairsAmount:0}});f.stop();
});
it('rejects an old server capability and fences late acknowledgements after Ready',async()=>{
  const f=fixture();f.update({blackjackBettingVersion:undefined});f.controller.add('pair',10);expect(f.calls).toHaveLength(0);f.update({blackjackBettingVersion:2});f.controller.add('pair',10);f.update({legalActions:['Stand'],phase:'PLAYER_TURNS'});f.calls[0]!.resolve();await tick();expect(f.controller.getSnapshot().pending).toBe(false);expect(f.calls).toHaveLength(1);f.stop();
});
