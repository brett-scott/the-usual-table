import { expect,it } from 'vitest';
import { baccaratWagerUnits,type BaccaratAction,type BaccaratSnapshot,type ConnectionInfo,type TableClient } from '@casual/protocol';
import { BaccaratBettingController,addBaccaratChip,sameBaccaratWager } from './baccaratBettingController';
const empty=()=>({mainSide:null,mainUnits:0,tieUnits:0});
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(){
 let state:BaccaratSnapshot={gameId:'baccarat',roomId:'a'.repeat(32),you:'one',revision:1,claimVersion:0,managerId:'one',roundId:1,phase:'betting',bettingDeadline:Date.now()+15000,startedAt:null,resultsDeadline:null,cards:[],outcome:null,history:[],shoe:{decks:8,remaining:416,shuffled:true},players:[{id:'one',name:'One',seat:0,balanceUnits:500000,wager:empty(),returnedUnits:0,connected:true,leaving:false}],legalActions:['PlaceBet','Leave']};
 let connection:ConnectionInfo={status:'connected',message:'Connected'};const listeners=new Set<()=>void>();
 const calls:{action:BaccaratAction;resolve():void;reject(error:Error):void}[]=[];
 const client:TableClient<BaccaratSnapshot,BaccaratAction>={getSnapshot:()=>state,getConnection:()=>connection,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},dispose(){},send:action=>new Promise<void>((resolve,reject)=>{calls.push({action:structuredClone(action),resolve,reject});})};
 const controller=new BaccaratBettingController(client);const stop=controller.start();
 const notify=()=>{for(const listener of listeners)listener();};
 function confirm(index:number){const action=calls[index]!.action;if(action.type!=='PlaceBet')throw new Error('Expected bet');const own=state.players[0]!;state={...state,revision:state.revision+1,players:[{...own,balanceUnits:own.balanceUnits+baccaratWagerUnits(own.wager)-baccaratWagerUnits(action.wager),wager:structuredClone(action.wager)}]};notify();}
 return{controller,client,calls,stop,confirm,state:()=>state,update(change:Partial<BaccaratSnapshot>){state={...state,...change};notify();},connection(status:ConnectionInfo['status']){connection={status,message:status};notify();}};
}
it('adds whole selected chips, moves exclusive main stakes unchanged, and enforces each tile and total bankroll',()=>{
 let wager=empty() as BaccaratSnapshot['players'][number]['wager'];for(let i=0;i<10;i++)wager=addBaccaratChip(wager,'player',10,500000);expect(wager.mainUnits).toBe(10000);
 wager=addBaccaratChip(wager,'player',100,500000);expect(wager.mainUnits).toBe(20000);wager=addBaccaratChip(wager,'banker',1000,500000);expect(wager).toMatchObject({mainSide:'banker',mainUnits:20000});
 const before=structuredClone(wager);expect(()=>addBaccaratChip(wager,'banker',1000,500000)).toThrow('maximum');expect(wager).toEqual(before);
 const sides=addBaccaratChip(empty(),'playerPair',1000,500000);expect(()=>addBaccaratChip(sides,'tie',1000,100000)).toThrow('Not enough');
 expect(baccaratWagerUnits(addBaccaratChip(addBaccaratChip(addBaccaratChip(empty(),'banker',1000,500000),'tie',1000,500000),'playerPair',1000,500000))).toBe(300000);
});
it('serializes and coalesces rapid taps without losing increments or allowing stale acknowledgements to overwrite them',async()=>{
 const f=fixture();for(let i=0;i<10;i++)f.controller.add('player',10);expect(f.calls).toHaveLength(1);expect(f.controller.getSnapshot()).toMatchObject({pending:true,wager:{mainUnits:10000}});
 f.confirm(0);expect(f.controller.getSnapshot().wager.mainUnits).toBe(10000);f.calls[0]!.resolve();await tick();expect(f.calls).toHaveLength(2);expect(f.calls[1]!.action).toMatchObject({wager:{mainUnits:10000}});
 f.confirm(1);f.calls[1]!.resolve();await tick();expect(f.controller.getSnapshot()).toMatchObject({pending:false,wager:{mainUnits:10000},canUndo:true});f.stop();
});
it('keeps a wager pending until both its acknowledgement and authoritative snapshot arrive',async()=>{
 const f=fixture();f.controller.add('tie',100);f.calls[0]!.resolve();await tick();expect(f.controller.getSnapshot().pending).toBe(true);expect(f.state().players[0]!.wager.tieUnits).toBe(0);
 f.confirm(0);expect(f.controller.getSnapshot()).toMatchObject({pending:false,wager:{tieUnits:10000}});f.stop();
});
it('undoes individual taps, moves and Clear even while earlier writes are pending',async()=>{
 const f=fixture();f.controller.add('player',100);f.controller.add('banker',10);f.controller.undo();expect(f.controller.getSnapshot().wager).toMatchObject({mainSide:'player',mainUnits:10000});
 f.controller.clear();expect(baccaratWagerUnits(f.controller.getSnapshot().wager)).toBe(0);f.controller.undo();expect(f.controller.getSnapshot().wager).toMatchObject({mainSide:'player',mainUnits:10000});
 f.confirm(0);f.calls[0]!.resolve();await tick();expect(f.calls).toHaveLength(1);expect(f.controller.getSnapshot().pending).toBe(false);f.controller.undo();expect(f.calls).toHaveLength(2);expect(f.calls[1]!.action).toMatchObject({wager:{mainUnits:0}});f.stop();
});
it('reconciles server rejection to confirmed wagers and never blindly resends the failed command',async()=>{
 const f=fixture();f.controller.add('banker',100);f.controller.add('banker',100);f.calls[0]!.reject(new Error('Betting just closed'));await tick();expect(f.calls).toHaveLength(1);expect(f.controller.getSnapshot()).toMatchObject({pending:false,error:'Betting just closed',canUndo:false});expect(baccaratWagerUnits(f.controller.getSnapshot().wager)).toBe(0);f.stop();
});
it('discards queued intentions on disconnect and resumes only authoritative stakes, never old taps',async()=>{
 const f=fixture();f.controller.add('bankerPair',100);f.controller.add('tie',100);f.confirm(0);f.connection('reconnecting');expect(f.controller.getSnapshot()).toMatchObject({pending:false,canUndo:false,wager:{tieUnits:0}});
 f.calls[0]!.resolve();await tick();f.connection('connected');expect(f.calls).toHaveLength(1);expect(f.controller.getSnapshot().wager.sideBets!.bankerPairUnits).toBe(10000);f.stop();
});
it('never carries a queued bet or old response into a new round',async()=>{
 const f=fixture();f.controller.add('player',10);f.controller.add('tie',100);f.update({phase:'dealing',bettingDeadline:null,legalActions:['Leave']});expect(f.controller.getSnapshot().error).toContain('not placed');f.update({revision:2});expect(f.controller.getSnapshot().error).toContain('not placed');f.update({roundId:2,phase:'betting',bettingDeadline:Date.now()+15000,legalActions:['PlaceBet','Leave']});expect(f.controller.getSnapshot().error).toBe('');
 f.controller.add('superSix',10);f.calls[0]!.resolve();await tick();expect(f.calls).toHaveLength(2);expect(f.calls[1]!.action).toMatchObject({wager:{mainUnits:0,tieUnits:0,sideBets:{superSixUnits:1000}}});expect(f.controller.getSnapshot().pending).toBe(true);f.stop();
});
it('rejects a whole chip at the deadline and treats omitted legacy side fields as zero',()=>{
 const f=fixture();f.update({bettingDeadline:Date.now()-1});f.controller.add('player',100);expect(f.calls).toEqual([]);expect(f.controller.getSnapshot().error).toContain('closed');expect(sameBaccaratWager(empty(),{...empty(),sideBets:{playerPairUnits:0,bankerPairUnits:0,superSixUnits:0}})).toBe(true);f.stop();
});
