import {useEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type RefObject} from 'react';
import {RESULTS_DURATION_MS,type Action,type GameClient,type PublicHand,type PublicPlayer,type VisibleCard} from '@casual/protocol';
import {PlayingCard} from './PlayingCard';
import {dealerKey,playerCardKey,type CardTimeline} from './cardTimeline';
import {useTablePresentation} from './useTablePresentation';
import {displayedDealerTotal} from './dealerScore';
import {useCompactLayout} from './useCompactLayout';
import {TableHeader,TableToolbar} from './TableChrome';
import {CardAppearance,savedAppearance} from './cardAppearance';
import {TableOptions} from './TableOptions';
import {ChatBubble} from './ChatBubble';
import {WagerChips} from './WagerChips';
import { PlayerIdentityButton } from './PlayerProfiles';
import {BaccaratChipTray} from './BaccaratBetting';
import {BlackjackBettingController,type BlackjackChip} from './blackjackBettingController';
import c from './App.module.css';
import s from './BlackjackTable.module.css';
const money = (units: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(units / 2);
function readLocal(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
function writeLocal(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Appearance stays usable when storage is blocked. */ } }

function Cards({ cards, timeline, dealer = false, shoeRef, reducedMotion = false }: {
  cards: VisibleCard[]; timeline?: CardTimeline; dealer?: boolean; shoeRef?: RefObject<HTMLDivElement | null>; reducedMotion?: boolean;
}) {
  return <div className={s.cards} style={{ '--card-count': cards.length } as CSSProperties} role="group" aria-label={dealer ? 'Dealer cards' : 'Player hand cards'}>{cards.map((card, i) => {
    const key = dealer ? dealerKey(timeline!.source.roundId, i) : playerCardKey('hidden' in card ? `hidden-${i}` : card.id);
    return <PlayingCard key={key} card={card} cue={timeline?.cues[key]} shoeRef={shoeRef} reducedMotion={reducedMotion} />;
  })}</div>;
}
function Hand({ hand, active, deadline, presentation, shoeRef, selected = true }: {
  hand: PublicHand; active: boolean; deadline: number | null; presentation: ReturnType<typeof useTablePresentation>; shoeRef: RefObject<HTMLDivElement | null>; selected?: boolean;
}) {
  const { timeline, now, reducedMotion, presenting } = presentation;
  const ready = hand.cards.every(c => (timeline.cues[playerCardKey(c.id)]?.readyAt ?? 0) <= now);
  const seconds = Math.min(20, Math.max(0, Math.ceil(((deadline ?? 0) - now) / 1000)));
  return <div id={`hand-${hand.id}`} data-selected={selected} className={`${s.hand} ${active ? s.activeHand : ''}`} aria-label={`Hand total ${hand.total}${active ? ', active hand' : ''}`}>
    <Cards cards={hand.cards} timeline={timeline} shoeRef={shoeRef} reducedMotion={reducedMotion} />
    <div className={s.handInfo}><span className={s.total} data-hand-total>{ready ? <>{hand.soft && hand.total <= 21 ? 'Soft ' : ''}{hand.total > 21 ? `${hand.total} · Bust` : hand.total}</> : 'Dealing…'}</span><span className={s.wagerDisplay}><WagerChips amount={hand.wager} returned={hand.returned} settled={!!hand.outcome && !presenting} reducedMotion={presentation.reducedMotion} /><span>Bet · {money(hand.wager)} chips</span></span>{hand.outcome && !presenting && <strong data-hand-outcome>{hand.outcome === 'blackjack' ? 'Blackjack!' : hand.outcome === 'win' ? 'Win' : hand.outcome === 'push' ? 'Push' : 'Lost'}</strong>}{hand.timedOut && <span className={s.turnLabel}>Time up · stood</span>}{active && <span className={s.turnLabel}>▶ Playing</span>}</div>
    {active && deadline !== null && <div className={`${s.countdown} ${seconds <= 5 ? s.countdownUrgent : ''}`} role="timer" aria-label="Time remaining for this hand" aria-live="off"><div><strong>{seconds}s</strong><span>Hit resets to 20s</span></div><progress max={20_000} value={Math.max(0, Math.min(20_000, deadline - now))} aria-label="Hand time remaining" /></div>}
  </div>;
}

export function BlackjackTable({ client, onLeave }: { client: GameClient; onLeave: (endSession?: boolean) => void }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const connection = useSyncExternalStore(client.subscribe, client.getConnection);
  const presentation = useTablePresentation(state);
  const { timeline, now, reducedMotion, presenting } = presentation;
  const shoeRef = useRef<HTMLDivElement>(null);
  const player = state.players.find(p => p.id === state.you)!;
  const [controller]=useState(()=>new BlackjackBettingController(client));
  useEffect(()=>controller.start(),[controller]);
  const betting=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [denomination,setDenomination]=useState<BlackjackChip>(10);
  const ownTurn = state.activePlayerId === player.id;
  const compact = useCompactLayout();
  const ownActive = ownTurn ? state.activeHandId : null;
  const [handView, setHandView] = useState({ active: ownActive, selected: ownActive ?? player.hands[0]?.id ?? null });
  let selectedHand = handView.selected;
  if (handView.active !== ownActive || !player.hands.some(h => h.id === selectedHand)) {
    selectedHand = ownActive ?? player.hands.find(h => h.id === selectedHand)?.id ?? player.hands[0]?.id ?? null;
    if (handView.active !== ownActive || handView.selected !== selectedHand) setHandView({ active: ownActive, selected: selectedHand });
  }
  const manager = state.room?.managerPlayerId === player.id;
  const localDeadline = state.decisionDeadline === null ? null : state.decisionDeadline - (connection.clockOffsetMs ?? 0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [theme, setTheme] = useState<'classic' | 'midnight'>(() => readLocal('casual-theme') === 'midnight' ? 'midnight' : 'classic');
  const [appearance, setAppearance] = useState(savedAppearance);
  const viewingOtherHand = compact && ownTurn && selectedHand !== ownActive;
  const can = (type: Action['type']) => state.legalActions.includes(type) && connection.status === 'connected' && !pending && (!presenting || type === 'NextRound') && (!betting.pending || !['Ready','SitOut','StartBetting','Leave'].includes(type)) && (localDeadline === null || localDeadline > now) && (!viewingOtherHand || !['Hit', 'Stand', 'Double', 'Split'].includes(type));
  async function send(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try { await client.send(action); if (action.type === 'Leave') onLeave(true); } catch (e) { setError(e instanceof Error ? e.message : 'That action failed. Please try again.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const profit = player.roundResult?.net??0;
  const complete = state.phase === 'ROUND_COMPLETE';
  const maxBet = Math.min(2000, Math.floor((player.balance-betting.wager.perfectPairsAmount) / 20) * 20);
  const waiting = state.players.filter(p => p.connected !== false && !p.leavingAfterRound && !p.ready && !p.sittingOut).length;
  function seatState(p: PublicPlayer) {
    if (complete && !presenting) return p.roundResult?.outcome ?? 'even';
    if (p.connected === false || p.leavingAfterRound) return 'offline';
    if (state.phase !== 'BETTING') return 'playing';
    return p.ready ? 'ready' : p.sittingOut ? 'out' : 'waiting';
  }
  function seatLabel(p: PublicPlayer) {
    if (complete) {
      if (presenting) return 'Revealing dealer…';
      const result = p.roundResult;
      return !result || result.outcome === 'out' ? 'Sat out' : `${result.outcome === 'won' ? '✓ Won' : result.outcome === 'lost' ? '✕ Lost' : 'Even'} · ${result.net > 0 ? '+' : ''}${money(result.net)} chips`;
    }
    if (p.connected === false || p.leavingAfterRound) return 'Disconnected';
    if (state.phase === 'BETTING') return p.ready ? `✓ Ready · ${money(p.bet+(p.perfectPairs?.wager??0))} chips` : p.sittingOut ? '— Sitting out' : state.room && !state.room.bettingOpen ? 'Waiting for betting' : '◷ Place your bet';
    return state.phase === 'INSURANCE' ? 'Insurance decision' : state.activePlayerId === p.id ? '▶ Playing' : 'Waiting for turn';
  }
  const timedOut = player.hands.some(h => h.timedOut);
  let message: string;
  if (connection.status !== 'connected') message = connection.message;
  else if (presenting) message = complete ? 'Revealing the dealer’s cards…' : 'Dealing the cards…';
  else if (state.phase === 'BETTING') {
    if (state.room && !state.room.bettingOpen) message = manager ? 'Open betting when you’re ready. Play alone or invite friends.' : 'Waiting for the table host to open betting.';
    else message = player.ready ? `✓ You’re ready. ${waiting} ${waiting === 1 ? 'player' : 'players'} still to bet.` : player.sittingOut ? 'You’re sitting out this round.' : 'Place your bet, then select Ready.';
  } else if (!player.hands.length && !complete) message = 'This round is in progress. You’ll join the next betting window.';
  else if (state.phase === 'INSURANCE') message = 'Dealer shows an ace. Take insurance?';
  else if (complete) message = `${timedOut ? 'Time up. Your hand stood automatically.' : profit > 0 ? 'A good hand.' : profit === 0 ? 'All square.' : 'On to the next hand.'} ${profit > 0 ? '+' : ''}${money(profit)} chips`;
  else message = viewingOtherHand ? 'Select the playing hand to take your turn.' : ownTurn ? 'Your turn. Hit resets your 20-second timer.' : `${state.players.find(p => p.id === state.activePlayerId)?.name ?? 'Another player'} is playing. You’re up soon.`;
  const dealerScore = displayedDealerTotal(timeline, now);
  const phaseDeadline = state.roundDeadline ?? state.room?.bettingDeadline ?? state.room?.insuranceDeadline;
  const phaseSeconds = phaseDeadline ? Math.min(complete ? RESULTS_DURATION_MS / 1000 : Infinity, Math.max(0, Math.ceil((phaseDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000))) : null;
  const editable=can('PlaceBet')&&state.blackjackBettingVersion===2;
  const wager=state.phase==='BETTING'?betting.wager:{amount:player.hands.reduce((sum,h)=>sum+h.wager,0)||player.bet,perfectPairsAmount:player.perfectPairs?.wager??0};
  const settled=complete&&!presenting;
  return <CardAppearance.Provider value={appearance}><div className={c.app+' '+s.app} data-theme={theme} data-card-face={appearance.face} data-card-back={appearance.back} data-online={!!state.room} data-revision={state.revision} data-connection={connection.status}>
    <TableHeader client={client} playerId={player.id} online={!!state.room} ownTurn={ownTurn} seconds={localDeadline===null?null:Math.max(0,Math.ceil((localDeadline-now)/1000))} decisionLabel="hand" showAccountSignIn={!!state.wallet}>
      <TableOptions appearance={appearance} onAppearanceChange={next=>{setAppearance(next);writeLocal('casual-card-face',next.face);writeLocal('casual-card-back',next.back);}} theme={theme} onThemeChange={value=>{setTheme(value);writeLocal('casual-theme',value);}}
        rules={<><p>Beat the dealer without going over 21. Aces count as 1 or 11. Dealer stands on all 17, including soft 17.</p><dl><dt>Blackjack</dt><dd>An unsplit natural pays 3:2. Regular wins pay 1:1; pushes return your stake.</dd><dt>Your turn</dt><dd>20 seconds per hand. Hit resets the countdown to 20 seconds. On timeout your hand stands.</dd><dt>Double</dt><dd>Only on an initial two-card 9, 10 or 11, including after splitting; one card then stand.</dd><dt>Split</dt><dd>Identical ranks, up to four hands. Split aces receive one card. Split 21 pays 1:1.</dd><dt>Insurance</dt><dd>Up to half your original bet when the dealer shows an ace; pays 2:1 on dealer blackjack.</dd><dt>Perfect Pairs</dt><dd>Your original two cards only, regardless of splits. Mixed pair: 6:1 profit; same colour, different suits: 12:1; same rank and suit: 25:1. Winning stakes also return.</dd><dt>Betting</dt><dd>10–1,000 chips per target in steps of 10. Perfect Pairs requires a main bet; combined bets cannot exceed your table stack. Ready locks both bets. Results last five seconds after the dealer reveal.</dd><dt>The shoe</dt><dd>Six physical decks, without replacement across rounds. The cut card triggers a shuffle before the next deal.</dd></dl></>}/>
    </TableHeader>
    <main className={s.main}>
      <TableToolbar connection={connection} leaveDisabled={pending||betting.pending||!!state.room&&connection.status!=='connected'} onLeave={()=>{if(state.room)void send({type:'Leave'});else onLeave(true);}}/>
      <div className={s.layout}>
      <section className={s.table} aria-label="Blackjack table">
        <div className={s.tableInner}>
          <div className={s.heading}><h1>Blackjack <small>3:2</small></h1><span ref={shoeRef} className={s.shoe} data-card-shoe title={state.shoe.remaining+' cards remaining'}>▱ {state.shoe.shuffleNext?'Shuffle next':state.shoe.remaining}</span></div>
          <div className={s.dealer}><p className={s.seatLabel}>Dealer {dealerScore!==null&&<span className={s.total} data-dealer-total>{dealerScore}</span>}</p>{state.dealer.length?<Cards cards={state.dealer} timeline={timeline} dealer shoeRef={shoeRef} reducedMotion={reducedMotion}/>:<div className={s.cardSpaces} aria-label="Dealer is waiting to deal"><span/><span/></div>}</div>
          <div className={s.peers}>
          {[0,1,2,3].filter(seat=>seat!==player.seat).map(seat=>{const other=state.players.find(p=>p.seat===seat);return other?<section key={seat} className={s.peer} data-state={seatState(other)} aria-label={`Seat ${seat+1}: ${other.name}`}>
            <ChatBubble client={client} playerId={other.id} name={other.name}/><div className={s.peerName}><PlayerIdentityButton player={other}/></div><span className={s.seatStatus} data-state={seatState(other)}>{seatLabel(other)}</span>
            {other.hands.length?<div className={s.peerHands}>{other.hands.map(h=><div key={h.id}><Cards cards={h.cards} timeline={timeline} shoeRef={shoeRef} reducedMotion={reducedMotion}/><span data-hand-total>{h.total}{h.total>21?' Bust':''}</span></div>)}</div>:<div className={s.peerWager}><WagerChips amount={other.bet+(other.perfectPairs?.wager??0)} reducedMotion={reducedMotion} compact/><span>{money(other.bet+(other.perfectPairs?.wager??0))}</span></div>}
          </section>:<section key={seat} className={s.emptySeat} aria-label={`Seat ${seat+1} empty`}>＋ <span>Open seat</span></section>;})}
          </div>
          <section className={s.ownSeat} data-state={seatState(player)} aria-label="Your seat">
            {state.room&&<ChatBubble client={client} playerId={player.id} name={player.name}/>}
            <div className={s.playerHead}><PlayerIdentityButton player={player}>{player.name}<small>YOU</small></PlayerIdentityButton><span className={s.seatStatus} data-state={seatState(player)}>{seatLabel(player)}</span></div>
            {player.hands.length?<div className={s.ownHands}>
              {compact&&player.hands.length>1&&<div className={s.handTabs} role="tablist" aria-label="Your hands">{player.hands.map((h,index)=><button key={h.id} role="tab" aria-selected={h.id===selectedHand} aria-controls={`hand-${h.id}`} aria-label={`Hand ${index+1}, total ${h.total}${h.id===ownActive?', playing':''}`} onClick={()=>setHandView({active:ownActive,selected:h.id})} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?player.hands.length-1:(index+(event.key==='ArrowRight'?1:-1)+player.hands.length)%player.hands.length;setHandView({active:ownActive,selected:player.hands[next]!.id});(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}>{h.id===ownActive?'▶ ':''}{index+1} · {h.total>21?h.total+' Bust':h.total}</button>)}</div>}
              <div className={s.hands}>{player.hands.map(h=><Hand key={h.id} hand={h} selected={h.id===selectedHand} active={h.id===state.activeHandId} deadline={localDeadline} presentation={presentation} shoeRef={shoeRef}/>)}</div>
            </div>:<div className={s.yourEmpty}><div className={s.cardSpaces}><span/><span/></div></div>}
          </section>
          <div className={s.betBoard} role="group" aria-label="Your table wagers" data-pending={betting.pending}>
          {(['main','pair'] as const).map(tile=>{const amount=tile==='main'?wager.amount:wager.perfectPairsAmount;const returned=tile==='main'?player.hands.reduce((sum,h)=>sum+(h.returned??0),0):player.perfectPairs?.returned??0;const stake=tile==='main'?player.hands.reduce((sum,h)=>sum+h.wager,0)||amount:amount;const net=returned-stake;return <button key={tile} className={tile==='main'?s.mainBet:s.pairBet} type="button" aria-label={tile==='main'?'Bet on Blackjack':'Bet on Perfect Pairs'} aria-description={`${money(amount)} chips. ${editable?'+ '+denomination+' chips.':'Betting closed.'}`} disabled={!editable} data-bet-tile={tile} data-amount={amount} data-result={settled&&amount?(net>0?'win':net<0?'loss':'push'):undefined} onClick={()=>controller.add(tile,denomination)}>
            <span>{tile==='main'?'Your bet':'Perfect Pairs'}</span><small>{tile==='main'?'Blackjack 3:2':'6:1 · 12:1 · 25:1'}</small><div className={s.targetChips}><WagerChips key={state.roundId} amount={amount} returned={returned} settled={settled} reducedMotion={reducedMotion} compact/><strong>{money(amount)}</strong></div>
            {settled&&amount>0&&<em>{tile==='pair'&&player.perfectPairs?.kind!=='none'?player.perfectPairs?.kind+' pair · ':''}{net>0?'+':''}{money(net)}</em>}
          </button>;})}
          </div>
        </div>
      </section>
      <section className={s.controls} aria-label="Game controls">
        <div className={s.summary}><span>Table stack <strong>{money(player.balance)} <small>chips</small></strong></span><span>On table <strong>{money(wager.amount+wager.perfectPairsAmount)}</strong></span></div>
        <p className={s.status} role="status">{state.blackjackBettingVersion!==2?'Chip betting is unavailable for this table. Refresh and try again.':state.wallet?.error?'Saving your chips… Actions resume when the wallet reconnects.':message}</p>
        {phaseSeconds!==null&&<p className={s.phaseNote} role="timer" aria-label={complete?'Next round countdown':state.phase==='INSURANCE'?'Insurance time remaining':'Betting time remaining'} aria-live="off">{complete?`Next round in ${phaseSeconds}s`:`${phaseSeconds}s remaining`}</p>}
        {state.phase==='BETTING'&&(!state.room||state.room.bettingOpen)&&<BaccaratChipTray denomination={denomination} enabled={editable} pending={betting.pending} canUndo={betting.canUndo} canClear={betting.canClear} onSelect={setDenomination} onUndo={()=>controller.undo()} onClear={()=>controller.clear()}/>}
        <div className={s.buttons}>
          {connection.status==='connected'&&<>
            {state.phase==='BETTING'&&(!state.room||state.room.bettingOpen)&&<><button disabled={!editable||maxBet<20||wager.amount===maxBet} onClick={()=>controller.max()}>Max Bet</button><button className={s.primary} disabled={!can('Ready')} onClick={()=>void send({type:'Ready'})}>{state.room?player.ready?'Ready ✓':'Ready':'Deal me in'}</button>{state.room&&<button disabled={!can('SitOut')} onClick={()=>void send({type:'SitOut'})}>Sit out</button>}</>}
            {state.phase==='BETTING'&&state.room&&!state.room.bettingOpen&&manager&&<button className={s.primary} disabled={!can('StartBetting')} onClick={()=>void send({type:'StartBetting'})}>Open betting</button>}
            {state.phase==='PLAYER_TURNS'&&<><button className={s.primary} disabled={!can('Hit')} onClick={()=>void send({type:'Hit'})}>Hit</button><button disabled={!can('Stand')} onClick={()=>void send({type:'Stand'})}>Stand</button><button disabled={!can('Double')} onClick={()=>void send({type:'Double'})}>Double</button><button disabled={!can('Split')} onClick={()=>void send({type:'Split'})}>Split</button></>}
            {state.phase==='INSURANCE'&&<><button className={s.primary} disabled={!can('InsuranceDecision')} onClick={()=>void send({type:'InsuranceDecision',amount:0})}>No insurance</button><button disabled={!can('InsuranceDecision')||player.balance<player.bet/2} onClick={()=>void send({type:'InsuranceDecision',amount:player.bet/2})}>Insure for {money(player.bet/2)}</button></>}
            {complete&&(!state.room||manager)&&<button className={s.primary} disabled={!can('NextRound')} onClick={()=>void send({type:'NextRound'})}>Next round</button>}
            {can('Refill')&&<button onClick={()=>void send({type:'Refill'})}>Refill to 1,000</button>}
          </>}
          {state.room&&connection.status==='offline'&&<button onClick={()=>client.reconnect?.()}>Try reconnecting</button>}
          {state.room&&connection.status!=='connected'&&<button onClick={()=>onLeave()}>Create another table</button>}
        </div>
        {(error||betting.error)&&<p className={s.error} role="alert">{error||betting.error}</p>}
      </section>
      </div>
    </main>
  </div></CardAppearance.Provider>;
}
