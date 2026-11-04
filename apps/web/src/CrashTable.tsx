import { useEffect,useRef,useState,useSyncExternalStore,type FormEvent,type CSSProperties } from 'react';
import { multiplierAt } from '@casual/crash';
import type { CrashAction,CrashSnapshot,TableClient,TableInfo } from '@casual/protocol';
import { crashClientAdapter } from './gameClientAdapters';
import { GameRoomEntry } from './GameRoomEntry';
import { TableHeader,TableToolbar } from './TableChrome';
import { PlayerAvatar } from './PlayerAvatar';
import { ChatBubble } from './ChatBubble';
import s from './CrashTable.module.css';

export const crashChips=(units:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(units/100);
export const crashMultiplier=(cents:number)=>(cents/100).toFixed(2)+'×';
export function CrashRoom({invite,info}:{invite:string;info:TableInfo}){
  return <GameRoomEntry invite={invite} info={info} adapter={crashClientAdapter} gameName="Crash" intro="One flight. A table of friends. Cash out before the crash.">
    {(client,onLeave)=><CrashTable client={client} onLeave={onLeave}/>}</GameRoomEntry>;
}
export function CrashTable({client,onLeave}:{client:TableClient<CrashSnapshot,CrashAction>;onLeave(endSession?:boolean):void}){
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot);const connection=useSyncExternalStore(client.subscribe,client.getConnection);
  const [now,setNow]=useState(Date.now());const [amount,setAmount]=useState('10');const [auto,setAuto]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const inFlight=useRef(false);const rules=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[]);
  const serverNow=now+(connection.clockOffsetMs??0);const p=state.players.find(p=>p.id===state.you)!;
  const live=state.phase==='running';const betting=state.phase==='betting';const committed=p.betUnits>0&&(betting||live);
  const cents=state.outcome?.multiplierCents??(live&&state.startedAt!==null?multiplierAt(state.startedAt,serverNow):100);
  const deadline=state.bettingDeadline??state.resultsDeadline;const seconds=deadline===null?null:Math.max(0,Math.ceil((deadline-serverNow)/1000));
  const connected=connection.status==='connected';const can=(action:CrashAction['type'])=>connected&&!busy&&state.legalActions.includes(action);
  const units=Number(amount)*100;const target=auto.trim()===''?null:Math.round(Number(auto)*100);
  const valid=amount.trim()!==''&&Number.isSafeInteger(units)&&units>=1000&&units<=100000&&units%1000===0&&units<=p.balanceUnits
    &&(target===null||/^\d+(\.\d{1,2})?$/.test(auto)&&target>=101&&target<=10000);
  async function send(action:CrashAction){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
    try{await client.send(action);if(action.type==='Leave')onLeave(true);}catch(problem){setError(problem instanceof Error?problem.message:'Your action could not be completed.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function bet(event:FormEvent){event.preventDefault();if(can('PlaceBet')&&valid)void send({type:'PlaceBet',amountUnits:units,autoCashoutCents:target});}
  const phaseLabel=state.phase==='waiting'?'Ready for take-off':betting?'Place your bets':live?'In flight':state.outcome?.capped?'Ceiling reached':'Crashed';
  const distance=Math.log(cents/100);const progress=live||state.phase==='results'?distance/(distance+.7):0;
  const path=`M 28 190 Q ${28+progress*354} 190 ${28+progress*590} ${190-progress*155}`;
  const note=committed?(p.cashedOutCents!==null?`Cashed out at ${crashMultiplier(p.cashedOutCents)} · ${crashChips(p.returnedUnits)} chips returned`:betting?'Your wager is locked':'Cash out before the crash')
    :state.phase==='results'&&p.betUnits>0?(p.cashedOutCents===null?`Lost ${crashChips(p.betUnits)} chips`:`Returned ${crashChips(p.returnedUnits)} chips at ${crashMultiplier(p.cashedOutCents)}`)
    :live?'Watching this flight · Bet next round':state.phase==='waiting'?'The host can start the next betting window':'Choose your wager for the next flight';
  return <div className={s.app} data-connection={connection.status} data-phase={state.phase} data-revision={state.revision}>
    <TableHeader client={client} playerId={p.id} online ownTurn={live&&p.betUnits>0&&p.cashedOutCents===null} seconds={null} showAccountSignIn={!!state.wallet}>
      <button onClick={()=>rules.current?.showModal()}>Rules</button>
    </TableHeader>
    <main className={s.main} style={{'--seat-rows':Math.ceil(state.players.length/4),'--phone-seat-rows':Math.ceil(state.players.length/2)} as CSSProperties}>
      <div className={s.toolbar}><TableToolbar connection={connection} leaveDisabled={!connected||busy} onLeave={()=>void send({type:'Leave'})}/></div>
      <section className={s.flight} aria-label="Crash game" data-result={state.phase==='results'}>
        <div className={s.flightHeading}><div><span className={s.eyebrow}>THE USUAL TABLE</span><h1>Crash</h1></div><span className={s.roundLabel}>One flight. Your moment.</span></div>
        <div className={s.readout}><p role="status">{phaseLabel}</p><strong aria-label="Current multiplier">{crashMultiplier(cents)}</strong>
          {betting&&<span role="timer" aria-label="Betting countdown">Bets close in {seconds}s</span>}
          {state.phase==='results'&&<span role="timer" aria-label="Next round countdown">Next round in {seconds}s</span>}
          {live&&<span>Cash-out includes your wager</span>}
        </div>
        <svg className={s.chart} viewBox="0 0 660 220" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="crash-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#dec48a" stopOpacity=".22"/><stop offset="1" stopColor="#dec48a" stopOpacity="0"/></linearGradient></defs>
          {[45,95,145,195].map(y=><line key={y} x1="24" x2="640" y1={y} y2={y} stroke="#ffffff0b"/>)}
          <path d={path+' L '+(28+progress*590)+' 210 L 28 210 Z'} fill="url(#crash-fill)"/>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="3"/><circle cx={28+progress*590} cy={190-progress*155} r="6" fill="currentColor"/>
        </svg>
        <div className={s.history} aria-label="Recent Crash results">{state.history.length?state.history.map(h=><span key={h.roundId} data-high={h.multiplierCents>=200}>{crashMultiplier(h.multiplierCents)}{h.capped?' ✓':''}</span>):<span>The next flight starts here.</span>}</div>
      </section>
      <section className={s.players} aria-label="Crash players">{state.players.map(other=><article key={other.id} className={s.player} data-own={other.id===p.id} data-cashed={other.cashedOutCents!==null} aria-label={`Seat ${other.seat+1}: ${other.name}`}>
        <ChatBubble client={client} playerId={other.id} name={other.name}/><PlayerAvatar player={other}/><div><strong>{other.name}{other.id===p.id?' · You':''}</strong><span>{other.betUnits>0?other.cashedOutCents!==null?`${crashMultiplier(other.cashedOutCents)} · +${crashChips(other.returnedUnits-other.betUnits)}`:state.phase==='results'?`Lost ${crashChips(other.betUnits)}`:`${crashChips(other.betUnits)} chips locked`:other.leaving?'Leaving':other.connected?'Watching':'Reconnecting'}</span></div>
      </article>)}</section>
      <section className={s.controls} aria-label="Game controls">
        <div className={s.balance}><span>Your table chips</span><strong>{crashChips(p.balanceUnits)} <small>chips</small></strong><p role="status">{note}</p></div>
        <form className={s.betForm} onSubmit={bet}>
          <label>Wager (chips)<input aria-label="Wager (chips)" type="number" min="10" max="1000" step="10" value={amount} disabled={committed||busy} onChange={e=>setAmount(e.target.value)}/></label>
          <label>Auto cash-out (×)<input aria-label="Auto cash-out multiplier" inputMode="decimal" type="number" min="1.01" max="100" step="0.01" placeholder="Optional" value={auto} disabled={committed||busy} onChange={e=>setAuto(e.target.value)}/></label>
          {state.phase==='waiting'?<button type="button" className={s.primary} disabled={!can('StartBetting')} onClick={()=>void send({type:'StartBetting'})}>{state.managerId===p.id?'Start rounds':'Waiting for host'}</button>
            :betting?<button className={s.primary} disabled={!can('PlaceBet')||!valid}>{p.betUnits>0?'Wager locked':busy?'Placing wager…':'Place bet'}</button>
            :live?<button type="button" className={s.primary} disabled={!can('CashOut')} onClick={()=>void send({type:'CashOut'})}>{p.cashedOutCents!==null?'Cashed out':p.betUnits>0?`Cash out · ${crashChips(Math.floor(p.betUnits*cents/100))} chips`:'Watching this flight'}</button>
            :<button className={s.primary} type="button" disabled>Next flight in {seconds}s</button>}
        </form>
        <div className={s.feedback}>{error&&<p role="alert">{error}</p>}{state.wallet&&state.wallet.status!=='active'&&<p role="status">{state.wallet.status==='funding'?'Confirming your saved-chip buy-in…':`Wallet: ${state.wallet.status}`}</p>}
          {state.wallet?.error&&<p role="status">Your wallet is syncing. Please wait before placing another wager.</p>}
          {can('Refill')&&<button onClick={()=>void send({type:'Refill'})}>Refill temporary chips</button>}
          {!connected&&<><span>Actions are paused while your seat reconnects.</span>{client.reconnect&&<button onClick={()=>client.reconnect?.()}>Reconnect</button>}<button onClick={()=>onLeave()}>Return to tables</button></>}
        </div>
      </section>
    </main>
    <dialog ref={rules} className={s.rules} aria-label="Crash rules"><header><h2>Crash rules</h2><button aria-label="Close Crash rules" onClick={()=>rules.current?.close()}>×</button></header>
      <p>Place one wager of 10–1,000 chips in the 10-second betting window. Cash out before the shared flight crashes. Your payout includes your original wager.</p>
      <p>Set an optional auto cash-out from 1.01× to 100× before betting. Crash wins ties. At the 100× ceiling, surviving wagers pay automatically. Immediate crashes at 1.00× are possible; the outcome distribution has a 3% house edge before display precision.</p>
      <p>The server decides cash-out and crash ordering; your displayed multiplier is an estimate. An existing auto target works while disconnected. Without one, a disconnected wager stays live and may be lost. Leaving never cancels a locked wager.</p>
      <p>Results last five seconds, then betting reopens. An empty betting window pauses rounds until the host resumes. Only saved-chip wagers earn account statistics and 10 XP per completed round.</p>
    </dialog>
  </div>;
}
