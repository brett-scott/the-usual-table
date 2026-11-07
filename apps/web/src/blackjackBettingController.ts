import type { GameClient,Snapshot } from '@casual/protocol';
export type BlackjackBetTile='main'|'pair';
export type BlackjackChip=10|100|1000;
export type BlackjackWager={amount:number;perfectPairsAmount:number};
const empty=():BlackjackWager=>({amount:0,perfectPairsAmount:0});
export function sameBlackjackWager(a:BlackjackWager,b:BlackjackWager){return a.amount===b.amount&&a.perfectPairsAmount===b.perfectPairsAmount;}
export function addBlackjackChip(previous:BlackjackWager,tile:BlackjackBetTile,chip:BlackjackChip,bankroll:number){
 const next={...previous};if(tile==='pair'&&!next.amount)throw new Error('Place a main bet before Perfect Pairs.');
 const field=tile==='main'?'amount':'perfectPairsAmount';next[field]+=chip*2;
 if(next[field]>2000)throw new Error('1,000 chips maximum per target. Choose a smaller chip or Undo.');
 if(next.amount+next.perfectPairsAmount>bankroll)throw new Error('Not enough table chips. Choose a smaller chip or Undo.');return next;
}
const wager=(s:Snapshot):BlackjackWager=>{const p=s.players.find(p=>p.id===s.you)!;return{amount:p.bet,perfectPairsAmount:p.perfectPairs?.wager??0};};
export interface BlackjackBettingView {wager:BlackjackWager;pending:boolean;error:string;notice:string;canUndo:boolean;canClear:boolean}
type Client=GameClient;
/** One serialized full-wager write at a time. Rapid taps coalesce without losing their chips. */
export class BlackjackBettingController {
 private listeners=new Set<()=>void>();private active=false;private generation=0;private context='';private wasEditable=false;
 private desired:BlackjackWager|null=null;private history:BlackjackWager[]=[];private error='';private notice='';
 private flight:{target:BlackjackWager;acknowledged:boolean;generation:number}|null=null;
 private view:BlackjackBettingView;
 constructor(private client:Client){this.context=this.key();this.view={wager:wager(this.client.getSnapshot()),pending:false,error:'',notice:'',canUndo:false,canClear:false};}
 private own(){const state=this.client.getSnapshot();return state.players.find(p=>p.id===state.you)!;}
 private wager(){return wager(this.client.getSnapshot());}
 private key(){const s=this.client.getSnapshot();return`${s.room?.inviteId??'practice'}:${s.you}:${s.roundId}`;}
 private editable(){const s=this.client.getSnapshot();const connection=this.client.getConnection();return this.active&&s.phase==='BETTING'&&s.blackjackBettingVersion===2&&connection.status==='connected'&&s.legalActions.includes('PlaceBet')&&(!s.room||s.room.bettingOpen&&s.room.bettingDeadline!==null&&Date.now()+(connection.clockOffsetMs??0)<s.room.bettingDeadline);}
 private publish(){const wager=this.desired??this.wager();const editable=this.editable();this.view={wager,pending:this.flight!==null||this.desired!==null,error:this.error,notice:this.notice,canUndo:editable&&this.history.length>0,canClear:editable&&wager.amount+wager.perfectPairsAmount>0};for(const listener of this.listeners)listener();}
 getSnapshot=()=>this.view;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 start(){this.active=true;const unsubscribe=this.client.subscribe(this.sync);this.sync();return()=>{unsubscribe();this.active=false;this.generation++;this.flight=null;this.desired=null;this.history=[];};}
 private sync=()=>{
  const key=this.key();const editable=this.editable();if(key!==this.context||!editable&&(this.wasEditable||this.flight||this.desired||this.history.length)){
   const unplaced=key===this.context&&this.client.getSnapshot().phase!=='BETTING'&&this.desired&&!sameBlackjackWager(this.desired,this.wager());
   this.generation++;this.context=key;this.flight=null;this.desired=null;this.history=[];this.error=unplaced?'Betting closed. Pending chip changes were not placed.':'';this.notice='';
  }
  this.wasEditable=editable;
  this.confirm();this.publish();this.pump();
 };
 private confirm(){const flight=this.flight;if(!flight?.acknowledged||!sameBlackjackWager(this.wager(),flight.target))return;
  this.flight=null;if(this.desired&&sameBlackjackWager(this.desired,flight.target))this.desired=null;
 }
 private pump(){if(!this.active||this.flight||!this.desired||!this.editable())return;
  if(sameBlackjackWager(this.wager(),this.desired)){this.desired=null;this.publish();return;}
  const flight={target:structuredClone(this.desired),acknowledged:false,generation:this.generation};this.flight=flight;this.publish();
  void this.client.send({type:'PlaceBet',...flight.target}).then(()=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   flight.acknowledged=true;this.confirm();this.publish();this.pump();
  }).catch(problem=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   this.flight=null;this.desired=null;this.history=[];this.error=problem instanceof Error?problem.message:'Your chips could not be placed. Check the table before trying again.';this.publish();
  });
 }
 private replace(wager:BlackjackWager,remember=true){if(!this.editable()){this.error='Betting is closed or your seat is reconnecting.';this.publish();return;}
  const previous=this.desired??this.wager();if(sameBlackjackWager(previous,wager))return;
  if(remember)this.history=[...this.history,structuredClone(previous)].slice(-512);this.desired=structuredClone(wager);this.error='';this.publish();this.pump();
 }
 add(tile:BlackjackBetTile,chip:BlackjackChip){if(!this.editable()){this.replace(wager(this.client.getSnapshot()));return;}
  try{const next=addBlackjackChip(this.desired??wager(this.client.getSnapshot()),tile,chip,this.own().balance);this.notice='';this.replace(next);}
  catch(problem){this.error=(problem as Error).message;this.publish();}
 }
 max(){if(!this.editable())return;const previous=this.desired??wager(this.client.getSnapshot());this.replace({...previous,amount:Math.min(2000,Math.floor((this.own().balance-previous.perfectPairsAmount)/20)*20)});}

 undo(){if(!this.editable())return;const previous=this.history.pop();if(previous){this.notice='Last betting change undone.';this.replace(previous,false);}}
 clear(){this.notice='All bets cleared.';this.replace(empty());}
}
