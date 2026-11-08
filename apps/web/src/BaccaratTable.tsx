import { useEffect,useMemo,useRef,useState,useSyncExternalStore,type CSSProperties } from 'react';
import { BACCARAT_CARD_STEP_MS,BACCARAT_CARD_READY_MS,baccaratWagerUnits,type BaccaratSnapshot,type BaccaratAction,type TableClient,type TableInfo } from '@casual/protocol';
import { baccaratClientAdapter } from './gameClientAdapters';
import { GameRoomEntry } from './GameRoomEntry';
import { TableHeader,TableToolbar } from './TableChrome';
import { TableOptions } from './TableOptions';
import { BaccaratScoreboard } from './BaccaratScoreboard';
import { PlayerIdentityButton } from './PlayerProfiles';
import { ChatBubble } from './ChatBubble';
import { PlayingCard } from './PlayingCard';
import { BaccaratBettingBoard,BaccaratChipTray,type BaccaratDenomination } from './BaccaratBetting';
import { BaccaratBettingController } from './baccaratBettingController';
import { CardAppearance,savedAppearance } from './cardAppearance';
import { baccaratTotal } from '@casual/baccarat';
import layout from './CrashTable.module.css';
import s from './BaccaratTable.module.css';
const chips=(units:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(units/100);
const label=(side:string)=>side==='player'?'Player':side==='banker'?'Banker':'Tie';
const staked=(p:BaccaratSnapshot['players'][number])=>baccaratWagerUnits(p.wager);
const sideLabels={playerPairUnits:'Player Pair',bankerPairUnits:'Banker Pair',superSixUnits:'Super 6'} as const;
const sideKeys=Object.keys(sideLabels) as (keyof typeof sideLabels)[];
const sideDescription=(w:BaccaratSnapshot['players'][number]['wager'])=>sideKeys.filter(key=>(w.sideBets?.[key]??0)>0).map(key=>`${sideLabels[key]} ${chips(w.sideBets![key])}`).join(' + ');
function readTheme(){try{return localStorage.getItem('casual-theme')==='midnight'?'midnight':'classic';}catch{return'classic';}}
export function BaccaratRoom({invite,info}:{invite:string;info:TableInfo}){
 return <GameRoomEntry invite={invite} info={info} adapter={baccaratClientAdapter} gameName="Baccarat" intro="Two hands. One shared reveal. Choose Player, Banker or Tie.">{(client,onLeave)=><BaccaratTable client={client} onLeave={onLeave}/>}</GameRoomEntry>;
}
export function BaccaratTable({client,onLeave}:{client:TableClient<BaccaratSnapshot,BaccaratAction>;onLeave(endSession?:boolean):void}){
 const state=useSyncExternalStore(client.subscribe,client.getSnapshot);const connection=useSyncExternalStore(client.subscribe,client.getConnection);
 const bettingController=useMemo(()=>new BaccaratBettingController(client),[client]);
 const bets=useSyncExternalStore(bettingController.subscribe,bettingController.getSnapshot);
 useEffect(()=>bettingController.start(),[bettingController]);
 const [now,setNow]=useState(Date.now());const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [theme,setTheme]=useState<'classic'|'midnight'>(readTheme);const [appearance,setAppearance]=useState(savedAppearance);
 const [denomination,setDenomination]=useState<BaccaratDenomination>(10);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const pending=useRef(false);const shoe=useRef<HTMLDivElement>(null);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),50);const media=window.matchMedia('(prefers-reduced-motion: reduce)');const changed=()=>setReduced(media.matches);media.addEventListener('change',changed);return()=>{clearInterval(timer);media.removeEventListener('change',changed);};},[]);
 const p=state.players.find(p=>p.id===state.you)!;const betting=state.phase==='betting';const result=state.phase==='results';const dealing=state.phase==='dealing';const connected=connection.status==='connected';const offset=connection.clockOffsetMs??0;
 const deadline=state.bettingDeadline??state.resultsDeadline;const seconds=deadline===null?null:Math.max(0,Math.ceil((deadline-now-offset)/1000));
 const can=(type:BaccaratAction['type'])=>connected&&!busy&&state.legalActions.includes(type);
 const total=baccaratWagerUnits(bets.wager);const available=p.balanceUnits+staked(p)-(betting?total:staked(p));const enabled=can('PlaceBet')&&betting&&seconds!==0;
 async function send(action:BaccaratAction){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await client.send(action);if(action.type==='Leave')onLeave(true);}catch(e){setError(e instanceof Error?e.message:'Your action could not be completed.');}finally{pending.current=false;setBusy(false);}}
 const readyCards=state.cards.filter((_card,i)=>reduced||state.startedAt!==null&&now>=state.startedAt+i*BACCARAT_CARD_STEP_MS+BACCARAT_CARD_READY_MS-offset);
 const net=p.returnedUnits-staked(p);const ownResult=result&&staked(p)>0?`${net>0?'Won':net<0?'Lost':'Even'} · ${net>0?'+':''}${chips(net)} chips`:'';
 const note=ownResult||dealing?(ownResult||'Bets closed · Revealing the cards'):betting?bets.pending?'Placing your chips…':seconds===0?'Bets closed · Waiting for the reveal':bets.notice||`Tap a tile to add ${denomination.toLocaleString()} chips`:state.phase==='waiting'?'The host can open betting':'Watching this round';
 return <CardAppearance.Provider value={appearance}><div className={`${layout.app} ${s.app}`} data-theme={theme} data-phase={state.phase} data-revision={state.revision} data-connection={connection.status}>
  <TableHeader client={client} playerId={p.id} online ownTurn={false} seconds={null} showAccountSignIn={!!state.wallet}>
   <TableOptions timerNote="Betting deadlines keep running." rulesSummary="Eight decks · No commission" theme={theme} onThemeChange={value=>{setTheme(value);try{localStorage.setItem('casual-theme',value);}catch{/* Retain in memory. */}}} appearance={appearance} onAppearanceChange={value=>{setAppearance(value);try{localStorage.setItem('casual-card-face',value.face);localStorage.setItem('casual-card-back',value.back);}catch{/* Retain in memory. */}}} rules={<><p>Eight decks. Closest to nine wins; only the last digit counts. Aces are one; tens and face cards are zero. Drawing is automatic.</p><p>Player wins pay 1:1 profit. Banker wins pay 1:1, except a Banker win on six pays half profit. Tie wins pay 8:1. Winning stakes are returned; Player and Banker bets push on a tie. No commission. Player Pair and Banker Pair pay 11:1 profit when the first two cards of that hand have the same rank. Super 6 pays 12:1 profit when Banker wins on six; a tied six loses. Winning side-bet stakes are also returned.</p><p>Bet 10–1,000 chips per tile in steps of ten during the 15-second window. Choose Player or Banker plus optional Tie and side bets, or bet on Tie/side bets alone. Each tile has its own limit; the combined total may exceed 1,000 chips. Change or cancel before betting closes. After closing, bets settle even if you leave or disconnect.</p><p>Results last five seconds; the host can start the next round sooner. No bets means no deal. Saved-chip rounds earn 10 XP once per round; temporary play is not saved.</p></>}/>
  </TableHeader>
  <main className={layout.main} style={{'--seat-rows':Math.ceil(state.players.length/4),'--phone-seat-rows':Math.ceil(state.players.length/2),'--short-seat-rows':Math.ceil(state.players.length/4)} as CSSProperties}>
   <div className={layout.toolbar}><TableToolbar connection={connection} leaveDisabled={!connected||busy||bets.pending} onLeave={()=>void send({type:'Leave'})}/></div>
   <section className={s.table} aria-label="Baccarat game">
    <header className={s.heading}><h1>Baccarat <small>No commission</small></h1>{betting?<div className={s.countdown} role="timer" aria-label="Betting countdown" data-urgent={seconds!==null&&seconds<=3}><strong>{seconds}s</strong><span>Place your bets</span><progress max={15} value={seconds??0} aria-label="Betting time remaining"/></div>:<div className={s.phase} role="status">{result?<>{label(state.outcome!.outcome)} {state.outcome!.outcome==='tie'?'game':'wins'}<small>Next round in {seconds}s</small></>:dealing?'Revealing…':'Ready when you are'}</div>}</header>
    <div className={s.hands}>{(['player','banker'] as const).map(hand=>{const cards=state.cards.filter(c=>c.side===hand);const total=baccaratTotal(readyCards.filter(c=>c.side===hand).map(c=>c.card));return <section key={hand} className={s.hand} data-side={hand} data-winner={result&&state.outcome!.outcome===hand} aria-label={`${label(hand)} hand`}><div className={s.handTitle}><h2>{label(hand)}</h2><strong aria-label={`${label(hand)} score`}>{readyCards.some(c=>c.side===hand)?total:'—'}</strong></div><div className={s.cards} role="group" aria-label={`${label(hand)} cards`}>{cards.length?cards.map(c=>{const i=state.cards.findIndex(x=>x.card.id===c.card.id);const dealAt=(state.startedAt??0)+i*BACCARAT_CARD_STEP_MS-offset;return <PlayingCard key={c.card.id} card={c.card} cue={{dealAt,revealAt:dealAt+280,readyAt:dealAt+BACCARAT_CARD_READY_MS}} shoeRef={shoe} reducedMotion={reduced}/>;}):<><i/><i/></>}</div><span className={s.pays}>{hand==='player'?'Pays 1:1':'Pays 1:1 · Win on 6 pays ½'}</span></section>;})}</div>
    <div ref={shoe} className={s.shoe} aria-hidden="true">♠</div>
    <footer className={s.history} aria-label="Last 20 Baccarat results"><div className={s.historyHead}><span>Last 20 results <small>Newest first</small></span><BaccaratScoreboard state={state}/></div>{state.history.length?<ol>{state.history.map(h=><li key={h.roundId} data-side={h.outcome} aria-label={`${label(h.outcome)}: Player ${h.playerTotal}, Banker ${h.bankerTotal}`}>{h.outcome==='player'?'P':h.outcome==='banker'?'B':'T'}{h.outcome==='banker'&&h.bankerTotal===6?'₆':''}</li>)}</ol>:<p>No completed hands yet.</p>}</footer>
   </section>
   <section className={layout.players} aria-label="Baccarat players">{state.players.map(other=>{const profit=other.returnedUnits-staked(other);const outcome=result&&staked(other)>0?profit>0?'won':profit<0?'lost':'even':undefined;return <article key={other.id} className={`${layout.player} ${s.player}`} data-own={other.id===p.id} data-outcome={outcome} aria-label={`Seat ${other.seat+1}: ${other.name}`}><ChatBubble client={client} playerId={other.id} name={other.name}/><div><PlayerIdentityButton compact player={other}>{other.name}{other.id===p.id?' · You':''}</PlayerIdentityButton><span>{staked(other)>0?result?`${profit>0?'Won':profit<0?'Lost':'Even'} · ${profit>0?'+':''}${chips(profit)}`:`${other.wager.mainUnits?`${label(other.wager.mainSide!)} ${chips(other.wager.mainUnits)}`:''}${other.wager.tieUnits?`${other.wager.mainUnits?' + ':''}Tie ${chips(other.wager.tieUnits)}`:''}${sideDescription(other.wager)?`${other.wager.mainUnits||other.wager.tieUnits?' + ':''}${sideDescription(other.wager)}`:''}`:other.leaving?'Leaving':other.connected?'Watching':'Reconnecting'}</span></div></article>;})}</section>
   <section className={s.dock} aria-label="Game controls" aria-busy={bets.pending}>
    <div className={s.dockSummary}><div><span>{bets.pending?'Available after changes':'Available chips'}</span><strong>{chips(available)}</strong></div><div><span>{ownResult?'Round result':bets.pending?'Placing':'On the table'}</span><strong className={ownResult?s.roundNet:undefined}>{ownResult||chips(total)}</strong></div><small>1,000 max per tile</small></div>
    <BaccaratBettingBoard wager={bets.wager} denomination={denomination} enabled={enabled} pending={bets.pending} result={state.outcome} cards={state.cards} roundId={state.roundId} reducedMotion={reduced} onBet={tile=>bettingController.add(tile,denomination)}/>
    <BaccaratChipTray denomination={denomination} enabled={enabled} pending={bets.pending} canUndo={bets.canUndo} canClear={bets.canClear} onSelect={setDenomination} onUndo={()=>bettingController.undo()} onClear={()=>bettingController.clear()}/>
    <p className={s.bettingNote} role={bets.error||error?'alert':'status'}>{bets.error||error||note}</p>
    {state.phase==='waiting'&&<button className={layout.primary} disabled={!can('StartBetting')} onClick={()=>void send({type:'StartBetting'})}>{state.managerId===p.id?'Start rounds':'Waiting for host'}</button>}
    {result&&<button className={layout.primary} disabled={!can('NextRound')} onClick={()=>void send({type:'NextRound'})}>{state.managerId===p.id?'Next round':`Next round in ${seconds}s`}</button>}
    <div className={layout.feedback}>{state.wallet?.error&&<p role="status">Your wallet is syncing. Please wait before betting.</p>}{state.wallet?.status==='funding'&&<p role="status">Confirming your saved-chip buy-in...</p>}{can('Refill')&&<button onClick={()=>void send({type:'Refill'})}>Refill temporary chips</button>}{!connected&&<><span>Actions are paused while your seat reconnects.</span>{client.reconnect&&<button onClick={()=>client.reconnect?.()}>Reconnect</button>}<button onClick={()=>onLeave()}>Return to tables</button></>}</div>
   </section>
  </main>

 </div></CardAppearance.Provider>;
}
