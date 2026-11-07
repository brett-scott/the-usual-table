import { expect,it } from 'vitest';
import { rouletteWagerUnits,type RouletteAction,type RouletteSnapshot,type ConnectionInfo,type TableClient } from '@casual/protocol';
import { RouletteBettingController,addRouletteChip,sameRouletteWager } from './rouletteBettingController';
const empty=()=>[];
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(){
 let state:RouletteSnapshot={gameId:'roulette',roomId:'a'.repeat(32),you:'one',revision:1,claimVersion:0,managerId:'one',roundId:1,phase:'betting',bettingDeadline:Date.now()+15000,startedAt:null,resultsDeadline:null,winner:null,history:[],counts:{spins:0,red:0,black:0,zero:0,odd:0,even:0},players:[{id:'one',name:'One',seat:0,balanceUnits:500000,wager:empty(),returnedUnits:0,connected:true,leaving:false}],legalActions:['PlaceBet','Leave']};
 let connection:ConnectionInfo={status:'connected',message:'Connected'};const listeners=new Set<()=>void>();
 const calls:{action:RouletteAction;resolve():void;reject(error:Error):void}[]=[];
 const client:TableClient<RouletteSnapshot,RouletteAction>={getSnapshot:()=>state,getConnection:()=>connection,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},dispose(){},send:action=>new Promise<void>((resolve,reject)=>{calls.push({action:structuredClone(action),resolve,reject});})};
 const controller=new RouletteBettingController(client);const stop=controller.start();
 const notify=()=>{for(const listener of listeners)listener();};
 function confirm(index:number){const action=calls[index]!.action;if(action.type!=='PlaceBet')throw new Error('Expected bet');const own=state.players[0]!;state={...state,revision:state.revision+1,players:[{...own,balanceUnits:own.balanceUnits+rouletteWagerUnits(own.wager)-rouletteWagerUnits(action.wager),wager:structuredClone(action.wager)}]};notify();}
 return{controller,client,calls,stop,confirm,state:()=>state,update(change:Partial<RouletteSnapshot>){state={...state,...change};notify();},connection(status:ConnectionInfo['status']){connection={status,message:status};notify();}};
}
it('stacks whole chips per bet, permits multiple bets above 1,000 combined and rejects insufficient funds or limits',()=>{
 let wager=addRouletteChip(empty(),'red',1000,500000);wager=addRouletteChip(wager,'black',1000,500000);expect(rouletteWagerUnits(wager)).toBe(200000);const before=structuredClone(wager);expect(()=>addRouletteChip(wager,'red',10,500000)).toThrow('maximum');expect(wager).toEqual(before);expect(()=>addRouletteChip(wager,'straight-0',1000,200000)).toThrow('Not enough');expect(()=>addRouletteChip(wager,'split-2-4',10,500000)).toThrow('valid');
});
it('coalesces rapid taps while requiring both server snapshot and acknowledgement',async()=>{
 const f=fixture();for(let i=0;i<10;i++)f.controller.add('straight-7',10);expect(f.calls).toHaveLength(1);expect(rouletteWagerUnits(f.controller.getSnapshot().wager)).toBe(10000);f.confirm(0);f.calls[0]!.resolve();await tick();expect(f.calls).toHaveLength(2);f.calls[1]!.resolve();await tick();expect(f.controller.getSnapshot().pending).toBe(true);f.confirm(1);expect(f.controller.getSnapshot().pending).toBe(false);expect(sameRouletteWager(f.controller.getSnapshot().wager,[{betId:'straight-7',amountUnits:10000}])).toBe(true);f.stop();
});
it('undoes individual changes and Clear while earlier requests are pending',async()=>{
 const f=fixture();f.controller.add('red',100);f.controller.add('black',100);f.controller.undo();expect(f.controller.getSnapshot().wager).toEqual([{betId:'red',amountUnits:10000}]);f.controller.clear();expect(f.controller.getSnapshot().wager).toEqual([]);f.controller.undo();f.confirm(0);f.calls[0]!.resolve();await tick();expect(f.controller.getSnapshot().pending).toBe(false);expect(f.calls).toHaveLength(1);f.stop();
});
it('discards failed or disconnected intentions without replaying unconfirmed chips',async()=>{
 const f=fixture();f.controller.add('red',100);f.calls[0]!.reject(new Error('Rejected'));await tick();expect(f.controller.getSnapshot()).toMatchObject({error:'Rejected',pending:false,wager:[],canUndo:false});f.controller.add('black',10);f.confirm(1);f.connection('reconnecting');f.calls[1]!.resolve();await tick();expect(f.controller.getSnapshot()).toMatchObject({pending:false,canUndo:false});f.connection('connected');expect(f.calls).toHaveLength(2);f.stop();
});
it('fences late receipts across betting deadlines, new rounds and disposal',async()=>{
 const f=fixture();f.controller.add('red',100);f.update({phase:'spinning',bettingDeadline:null,startedAt:Date.now(),legalActions:['Leave']});expect(f.controller.getSnapshot()).toMatchObject({pending:false,wager:[]});f.calls[0]!.resolve();await tick();f.update({phase:'betting',roundId:2,bettingDeadline:Date.now()+15000,legalActions:['PlaceBet','Leave']});expect(f.controller.getSnapshot().wager).toEqual([]);expect(f.calls).toHaveLength(1);f.controller.add('straight-0',10);f.stop();f.calls[1]!.resolve();await tick();expect(f.calls).toHaveLength(2);
});
