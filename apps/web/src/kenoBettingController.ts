import {kenoWagerSchema,type KenoAction,type KenoSnapshot,type KenoWager,type TableClient} from '@casual/protocol';
export type KenoChip=10|100|1000;
export const sameKenoWager=(a:KenoWager,b:KenoWager)=>a.amountUnits===b.amountUnits&&a.numbers.length===b.numbers.length&&a.numbers.every((n,i)=>b.numbers[i]===n);
export interface KenoBettingView {wager:KenoWager;pending:boolean;error:string;notice:string;canUndo:boolean;canClear:boolean}
type Client=TableClient<KenoSnapshot,KenoAction>;
/** One serialized full-wager write at a time. Rapid taps coalesce without losing their chips. */
export class KenoBettingController {
 private listeners=new Set<()=>void>();private active=false;private generation=0;private context='';private wasEditable=false;
 private desired:KenoWager|null=null;private history:KenoWager[]=[];private error='';private notice='';
 private flight:{target:KenoWager;acknowledged:boolean;generation:number}|null=null;
 private view:KenoBettingView;
 constructor(private client:Client){this.context=this.key();this.view={wager:this.own().wager,pending:false,error:'',notice:'',canUndo:false,canClear:false};}
 private own(){const state=this.client.getSnapshot();return state.players.find(p=>p.id===state.you)!;}
 private key(){const s=this.client.getSnapshot();return`${s.roomId}:${s.you}:${s.roundId}`;}
 private editable(){const s=this.client.getSnapshot();const connection=this.client.getConnection();return this.active&&s.phase==='betting'&&connection.status==='connected'&&s.legalActions.includes('PlaceBet')&&s.bettingDeadline!==null&&Date.now()+(connection.clockOffsetMs??0)<s.bettingDeadline;}
 private publish(){const wager=this.desired??this.own().wager;const editable=this.editable();this.view={wager,pending:this.flight!==null||this.desired!==null,error:this.error,notice:this.notice,canUndo:editable&&this.history.length>0,canClear:editable&&(wager.amountUnits>0||wager.numbers.length>0)};for(const listener of this.listeners)listener();}
 getSnapshot=()=>this.view;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 start(){this.active=true;const unsubscribe=this.client.subscribe(this.sync);this.sync();return()=>{unsubscribe();this.active=false;this.generation++;this.flight=null;this.desired=null;this.history=[];};}
 private sync=()=>{
  const key=this.key();const editable=this.editable();if(key!==this.context||!editable&&(this.wasEditable||this.flight||this.desired||this.history.length)){
   const unplaced=key===this.context&&this.client.getSnapshot().phase!=='betting'&&this.desired&&!sameKenoWager(this.desired,this.own().wager);
   this.generation++;this.context=key;this.flight=null;this.desired=null;this.history=[];this.error=unplaced?'Betting closed. Pending chip changes were not placed.':'';this.notice='';
  }
  this.wasEditable=editable;
  this.confirm();this.publish();this.pump();
 };
 private confirm(){const flight=this.flight;if(!flight?.acknowledged||!sameKenoWager(this.own().wager,flight.target))return;
  this.flight=null;if(this.desired&&sameKenoWager(this.desired,flight.target))this.desired=null;
 }
 private pump(){if(!this.active||this.flight||!this.desired||!this.editable())return;
  if(sameKenoWager(this.own().wager,this.desired)){this.desired=null;this.publish();return;}
  const flight={target:structuredClone(this.desired),acknowledged:false,generation:this.generation};this.flight=flight;this.publish();
  void this.client.send({type:'PlaceBet',wager:flight.target}).then(()=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   flight.acknowledged=true;this.confirm();this.publish();this.pump();
  }).catch(problem=>{
   if(!this.active||flight.generation!==this.generation||this.flight!==flight)return;
   this.flight=null;this.desired=null;this.history=[];this.error=problem instanceof Error?problem.message:'Your chips could not be placed. Check the table before trying again.';this.publish();
  });
 }
 private replace(wager:KenoWager,remember=true){if(!this.editable()){this.error='Betting is closed or your seat is reconnecting.';this.publish();return;}
  const previous=this.desired??this.own().wager;if(sameKenoWager(previous,wager))return;
  if(remember)this.history=[...this.history,structuredClone(previous)].slice(-512);this.desired=structuredClone(wager);this.error='';this.publish();this.pump();
 }

 private change(next:KenoWager){try{kenoWagerSchema.parse(next);const own=this.own();if(next.amountUnits>own.balanceUnits+own.wager.amountUnits)throw new Error('Not enough table chips.');this.replace(next);}catch(problem){this.error=problem instanceof Error?problem.message:'Choose a valid ticket.';this.publish();}}
 add(chip:KenoChip){const old=this.desired??this.own().wager;if(!old.numbers.length){this.error='Select your numbers first.';this.publish();return;}if(old.amountUnits+chip*100>100000){this.error='1,000 chips maximum per ticket.';this.publish();return;}this.change({...old,amountUnits:old.amountUnits+chip*100});}
 toggle(number:number){const old=this.desired??this.own().wager;const numbers=old.numbers.includes(number)?old.numbers.filter(n=>n!==number):[...old.numbers,number].sort((a,b)=>a-b);if(numbers.length>10){this.error='Choose at most ten numbers.';this.publish();return;}this.change({numbers,amountUnits:numbers.length?old.amountUnits:0});}
 quickPick(count:number){const old=this.desired??this.own().wager;const pool=Array.from({length:40},(_,i)=>i+1);const numbers=Array.from({length:count},()=>pool.splice(Math.floor(Math.random()*pool.length),1)[0]!).sort((a,b)=>a-b);this.change({...old,numbers});}
 undo(){if(!this.editable())return;const previous=this.history.pop();if(previous)this.replace(previous,false);}
 cancel(){const old=this.desired??this.own().wager;this.change({...old,amountUnits:0});}
 clear(){this.change({numbers:[],amountUnits:0});}
}
