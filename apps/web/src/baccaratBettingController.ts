import { baccaratWagerUnits,emptyBaccaratSideBets,type BaccaratAction,type BaccaratSnapshot,type BaccaratWager,type TableClient } from '@casual/protocol';
export type BaccaratBetTile='player'|'banker'|'tie'|'playerPair'|'bankerPair'|'superSix';
export type BaccaratChip=10|100|1000;
const sideFields={playerPair:'playerPairUnits',bankerPair:'bankerPairUnits',superSix:'superSixUnits'} as const;
const empty=():BaccaratWager=>({mainSide:null,mainUnits:0,tieUnits:0,sideBets:emptyBaccaratSideBets()});
export function sameBaccaratWager(a:BaccaratWager,b:BaccaratWager){return a.mainSide===b.mainSide&&a.mainUnits===b.mainUnits&&a.tieUnits===b.tieUnits&&Object.values(sideFields).every(key=>(a.sideBets?.[key]??0)===(b.sideBets?.[key]??0));}
/** Opposite main taps move the existing stake; otherwise one whole selected chip is added. */
export function addBaccaratChip(previous:BaccaratWager,tile:BaccaratBetTile,chip:BaccaratChip,bankrollUnits:number):BaccaratWager {
 const next=structuredClone(previous);next.sideBets??=emptyBaccaratSideBets();const units=chip*100;
 if(tile==='player'||tile==='banker'){
  if(next.mainUnits&&next.mainSide!==tile){next.mainSide=tile;return next;}
  next.mainSide=tile;next.mainUnits+=units;
 }else if(tile==='tie')next.tieUnits+=units;else next.sideBets[sideFields[tile]]+=units;
 const amount=tile==='player'||tile==='banker'?next.mainUnits:tile==='tie'?next.tieUnits:next.sideBets[sideFields[tile]];
 if(amount>100000)throw new Error('1,000 chips maximum per tile. Choose a smaller chip or Undo.');
 if(baccaratWagerUnits(next)>bankrollUnits)throw new Error('Not enough table chips. Choose a smaller chip or Undo.');
 return next;
}
export interface BaccaratBettingView {wager:BaccaratWager;pending:boolean;error:string;notice:string;canUndo:boolean;canClear:boolean}
type Client=TableClient<BaccaratSnapshot,BaccaratAction>;
/** One serialized full-wager write at a time. Rapid taps coalesce without losing their chips. */
export class BaccaratBettingController {
 private listeners=new Set<()=>void>();private active=false;private generation=0;private context='';private wasEditable=false;
 private desired:BaccaratWager|null=null;private history:BaccaratWager[]=[];private error='';private notice='';
 private flight:{target:BaccaratWager;acknowledged:boolean;generation:number}|null=null;
 private view:BaccaratBettingView;
 constructor(private client:Client){this.context=this.key();this.view={wager:this.own().wager,pending:false,error:'',notice:'',canUndo:false,canClear:false};}
 private own(){const state=this.client.getSnapshot();return state.players.find(p=>p.id===state.you)!;}
 private key(){const s=this.client.getSnapshot();return`${s.roomId}:${s.you}:${s.roundId}`;}
 private editable(){const s=this.client.getSnapshot();const connection=this.client.getConnection();return this.active&&s.phase==='betting'&&connection.status==='connected'&&s.legalActions.includes('PlaceBet')&&s.bettingDeadline!==null&&Date.now()+(connection.clockOffsetMs??0)<s.bettingDeadline;}
 private publish(){const wager=this.desired??this.own().wager;const editable=this.editable();this.view={wager,pending:this.flight!==null||this.desired!==null,error:this.error,notice:this.notice,canUndo:editable&&this.history.length>0,canClear:editable&&baccaratWagerUnits(wager)>0};for(const listener of this.listeners)listener();}
 getSnapshot=()=>this.view;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 start(){this.active=true;const unsubscribe=this.client.subscribe(this.sync);this.sync();return()=>{unsubscribe();this.active=false;this.generation++;this.flight=null;this.desired=null;this.history=[];};}
 private sync=()=>{
  const key=this.key();const editable=this.editable();if(key!==this.context||!editable&&(this.wasEditable||this.flight||this.desired||this.history.length)){
   const unplaced=key===this.context&&this.client.getSnapshot().phase!=='betting'&&this.desired&&!sameBaccaratWager(this.desired,this.own().wager);
   this.generation++;this.context=key;this.flight=null;this.desired=null;this.history=[];this.error=unplaced?'Betting closed. Pending chip changes were not placed.':'';this.notice='';
  }
  this.wasEditable=editable;
  this.confirm();this.publish();this.pump();
 };
 private confirm(){const flight=this.flight;if(!flight?.acknowledged||!sameBaccaratWager(this.own().wager,flight.target))return;
  this.flight=null;if(this.desired&&sameBaccaratWager(this.desired,flight.target))this.desired=null;
 }
 private pump(){if(!this.active||this.flight||!this.desired||!this.editable())return;
  if(sameBaccaratWager(this.own().wager,this.desired)){this.desired=null;this.publish();return;}
  const flight={target:structuredClone(this.desired),acknowledged:false,generation:this.generation};this.flight=flight;this.publish();
  void this.client.send({type:'PlaceBet',wager:flight.target}).then(()=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   flight.acknowledged=true;this.confirm();this.publish();this.pump();
  }).catch(problem=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   this.flight=null;this.desired=null;this.history=[];this.error=problem instanceof Error?problem.message:'Your chips could not be placed. Check the table before trying again.';this.publish();
  });
 }
 private replace(wager:BaccaratWager,remember=true){if(!this.editable()){this.error='Betting is closed or your seat is reconnecting.';this.publish();return;}
  const previous=this.desired??this.own().wager;if(sameBaccaratWager(previous,wager))return;
  if(remember)this.history=[...this.history,structuredClone(previous)].slice(-512);this.desired=structuredClone(wager);this.error='';this.publish();this.pump();
 }
 add(tile:BaccaratBetTile,chip:BaccaratChip){if(!this.editable()){this.replace(this.own().wager);return;}
  try{const own=this.own();const previous=this.desired??own.wager;const next=addBaccaratChip(previous,tile,chip,own.balanceUnits+baccaratWagerUnits(own.wager));this.notice=(tile==='player'||tile==='banker')&&previous.mainUnits>0&&previous.mainSide!==tile?`Moved ${(previous.mainUnits/100).toLocaleString()} chips to ${tile==='player'?'Player':'Banker'}.`:`${baccaratWagerUnits(next)/100} chips on the table. Tap again to stack.`;this.replace(next);}
  catch(problem){this.error=(problem as Error).message;this.publish();}
 }
 undo(){if(!this.editable())return;const previous=this.history.pop();if(previous){this.notice='Last betting change undone.';this.replace(previous,false);}}
 clear(){this.notice='All bets cleared.';this.replace(empty());}
}
