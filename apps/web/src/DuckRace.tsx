import { useEffect,useRef,useState,useSyncExternalStore,type CSSProperties } from 'react';
import type { DuckRaceAction,DuckRaceSnapshot,TableClient,TableInfo } from '@casual/protocol';
import { duckRaceClientAdapter } from './gameClientAdapters';
import { GameRoomEntry } from './GameRoomEntry';
import { TableHeader,TableToolbar } from './TableChrome';
import { PlayerAvatar } from './PlayerAvatar';
import { ChatBubble } from './ChatBubble';
import { DuckArtwork } from './DuckArtwork';
import s from './DuckRace.module.css';

const chips=(units:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(units/100);
const colors=['#e6ba62','#80c8ca','#c8a3db','#eaa28b'];
const wings=['#b98134','#428c93','#876099','#af6656'];
const duckStyle=(id:number)=>({'--duck-color':colors[id],'--duck-wing':wings[id]} as CSSProperties);
export function DuckRaceRoom({invite,info}:{invite:string;info:TableInfo}){
 return <GameRoomEntry invite={invite} info={info} adapter={duckRaceClientAdapter} gameName="Duck Race" intro="Pick your duck. Share the race. Four contenders, one winner.">
  {(client,onLeave)=><DuckRaceTable client={client} onLeave={onLeave}/>}</GameRoomEntry>;
}
export function DuckRaceTable({client,onLeave}:{client:TableClient<DuckRaceSnapshot,DuckRaceAction>;onLeave(endSession?:boolean):void}){
 const state=useSyncExternalStore(client.subscribe,client.getSnapshot);const connection=useSyncExternalStore(client.subscribe,client.getConnection);
 const [now,setNow]=useState(Date.now());const [denomination,setDenomination]=useState(10);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const inFlight=useRef(false);const rules=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[]);
 const p=state.players.find(p=>p.id===state.you)!;const betting=state.phase==='betting';const results=state.phase==='results';const connected=connection.status==='connected';
 const serverNow=now+(connection.clockOffsetMs??0);const deadline=state.bettingDeadline??state.resultsDeadline??(state.startedAt===null?null:state.startedAt+10000);
 const seconds=deadline===null?null:Math.max(0,Math.ceil((deadline-serverNow)/1000));
 const can=(action:DuckRaceAction['type'])=>connected&&!busy&&state.legalActions.includes(action)&&(action!=='PlaceBet'||seconds!==0);
 async function send(action:DuckRaceAction){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try{await client.send(action);if(action.type==='Leave')onLeave(true);}catch(problem){setError(problem instanceof Error?problem.message:'Your action could not be completed.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 const net=p.returnedUnits-p.wager.amountUnits;
 const note=results&&p.wager.amountUnits?`${net>0?'Won':'Lost'} · ${net>0?'+':''}${chips(net)} chips`:state.phase==='racing'?p.wager.amountUnits?'Your wager is racing':'Watching · Bet next round':betting?'Choose a chip, then tap a duck. Tap again to add.':state.managerId===p.id?'Start rounds when you are ready.':'Waiting for the host to start.';
 return <div className={s.app} data-connection={connection.status} data-phase={state.phase} data-revision={state.revision}>
  <TableHeader client={client} playerId={p.id} online ownTurn={betting} seconds={seconds} decisionLabel="betting" showAccountSignIn={!!state.wallet}><button onClick={()=>rules.current?.showModal()}>Rules</button></TableHeader>
  <main className={s.main} style={{'--seat-rows':Math.ceil(state.players.length/4),'--phone-seat-rows':Math.ceil(state.players.length/2)} as CSSProperties}>
   <div className={s.toolbar}><TableToolbar connection={connection} leaveDisabled={!connected||busy} onLeave={()=>void send({type:'Leave'})}/></div>
   <section className={s.race} aria-label="Duck Race game">
    <div className={s.raceHead}><div><span className={s.eyebrow}>THE USUAL DERBY</span><h1>{results?`${state.ducks[state.winner!]!.name} wins!`:state.phase==='racing'?'And they’re off!':betting?'Back your duck':'Ready, set, quack.'}</h1></div>
     {seconds!==null&&<div className={s.timer} data-urgent={betting&&seconds<=5} role="timer" aria-label={betting?'Betting countdown':results?'Next race countdown':'Race countdown'}><strong>{seconds}s</strong><span>{betting?'BETS CLOSE':results?'NEXT RACE':'RACING'}</span></div>}
    </div>
    <div className={s.lanes} key={state.roundId} aria-label="Race positions">{state.ducks.map(duck=><div className={s.lane} key={duck.id} style={duckStyle(duck.id)} data-winner={results&&duck.id===state.winner}>
     <span className={s.laneName}>{duck.id+1} · {duck.name}</span><div className={s.track}><div className={s.runner} data-duck={duck.id} data-position={state.positions[duck.id]} style={{left:`${state.positions[duck.id]!/100}%`}}><DuckArtwork hat={duck.id}/></div></div><span className={s.finish} aria-hidden="true"/>
    </div>)}</div>
    <div className={s.history} aria-label="Last 10 Duck Race results"><span>LAST RACES</span><ol>{state.history.map(h=><li key={h.roundId} style={duckStyle(h.winner)} aria-label={`${state.ducks[h.winner]!.name} won race ${h.roundId}`}>{h.winner+1}</li>)}</ol>{!state.history.length&&<small>The first winner starts the story.</small>}</div>
   </section>
   <section className={s.players} aria-label="Duck Race players">{state.players.map(other=>{const outcome=results&&other.wager.amountUnits?(other.returnedUnits>other.wager.amountUnits?'won':'lost'):undefined;
    return <article key={other.id} className={s.player} data-own={other.id===p.id} data-outcome={outcome} aria-label={`Seat ${other.seat+1}: ${other.name}`}><ChatBubble client={client} playerId={other.id} name={other.name}/><PlayerAvatar player={other}/><div><strong>{other.name}{other.id===p.id?' · You':''}</strong><span>{outcome?`${outcome==='won'?'+':'−'}${chips(Math.abs(other.returnedUnits-other.wager.amountUnits))}`:other.wager.duckIndex!==null?`${state.ducks[other.wager.duckIndex]!.name} · ${chips(other.wager.amountUnits)}`:other.leaving?'Leaving':other.connected?'Watching':'Reconnecting'}</span></div></article>;
   })}</section>
   <section className={s.controls} aria-label="Game controls" aria-busy={busy}>
    <div className={s.balance}><span>Your table chips</span><strong>{chips(p.balanceUnits)}</strong><small>chips</small></div>
    <div className={s.chips} role="group" aria-label="Choose your betting chip">{[10,100,1000].map(value=><button key={value} aria-label={`Select ${value.toLocaleString('en')} chips`} aria-pressed={denomination===value} disabled={!betting||!connected||busy} onClick={()=>setDenomination(value)}>{value.toLocaleString('en')}</button>)}</div>
    <div className={s.betTiles} role="group" aria-label="Choose your duck">{state.ducks.map(duck=>{const amount=(p.wager.duckIndex===duck.id?p.wager.amountUnits:0)+denomination*100;const valid=amount<=100000&&amount<=p.balanceUnits+p.wager.amountUnits;
     return <button key={duck.id} style={duckStyle(duck.id)} data-selected={p.wager.duckIndex===duck.id} aria-label={`Bet on ${duck.name}`} disabled={!can('PlaceBet')||!valid} onClick={()=>void send({type:'PlaceBet',wager:{duckIndex:duck.id,amountUnits:amount}})}><span>{duck.id+1} · {duck.name}</span><strong>{p.wager.duckIndex===duck.id?`${chips(p.wager.amountUnits)} chips`:'Pays 4×'}</strong></button>;
    })}</div>
    <div className={s.actions}>{state.phase==='waiting'&&<button className={s.primary} disabled={!can('StartBetting')} onClick={()=>void send({type:'StartBetting'})}>{state.managerId===p.id?'Start rounds':'Waiting for host'}</button>}
     {betting&&p.wager.amountUnits>0&&<button disabled={!can('PlaceBet')} onClick={()=>void send({type:'PlaceBet',wager:{duckIndex:null,amountUnits:0}})}>Cancel bet</button>}
     {results&&state.managerId===p.id&&<button className={s.primary} disabled={!can('NextRound')} onClick={()=>void send({type:'NextRound'})}>Next round</button>}
     {can('Refill')&&<button onClick={()=>void send({type:'Refill'})}>Refill temporary chips</button>}
     {!connected&&<button onClick={()=>client.reconnect?.()}>Reconnect</button>}
    </div>
    <p className={s.note} role="status">{state.wallet?.error?'Your wallet is syncing. Please wait.':state.wallet&&state.wallet.status!=='active'?`Wallet: ${state.wallet.status}`:note}</p>{error&&<p className={s.error} role="alert">{error}</p>}
   </section>
  </main>
  <dialog ref={rules} className={s.rules} aria-label="Duck Race rules"><header><h2>Duck Race</h2><button aria-label="Close Duck Race rules" onClick={()=>rules.current?.close()}>×</button></header>
   <p>Four equally likely ducks, one winner. Winning wagers return four times the stake, including your original wager. A 100-chip win returns 400 chips: 300 chips profit.</p>
   <p>Bet 10–1,000 chips on one duck in steps of ten. Choose a chip and tap a duck to add it. Choosing another duck replaces your wager with the selected chip. Edit or cancel during the 15-second betting window.</p>
   <p>Races last ten seconds, followed by five seconds of results. The host can skip results. No wagers means rounds pause until the host resumes.</p>
   <p>Leaving during betting cancels your wager. After betting closes, wagers settle even if you leave or disconnect. Saved chips return through your account wallet. Only completed saved-chip wagers earn statistics, 10 XP and achievements.</p>
  </dialog>
 </div>;
}
