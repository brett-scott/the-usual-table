import {useEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type RefObject} from 'react';
import {HAND_DURATION_MS} from '@casual/engine';
import {RESULTS_DURATION_MS,type Action,type GameClient,type PublicHand,type PublicPlayer,type VisibleCard} from '@casual/protocol';
import {PlayingCard} from './PlayingCard';
import {dealerKey,playerCardKey,type CardTimeline} from './cardTimeline';
import {useTablePresentation} from './useTablePresentation';
import {displayedDealerTotal} from './dealerScore';
import {useCompactLayout} from './useCompactLayout';
import {TableHeader,TableToolbar} from './TableChrome';
import {useTableActions,type TableActions} from './useTableActions';
import {CardAppearance} from './cardAppearance';
import {useTableLook} from './Collection';
import {TableOptions} from './TableOptions';
import {ChatBubble} from './ChatBubble';
import {WagerChips} from './WagerChips';
import { PlayerIdentityButton } from './PlayerProfiles';
import {ChipTray} from './BettingChips';
import {BlackjackBettingController,type BlackjackChip} from './blackjackBettingController';
import c from './App.module.css';
import s from './BlackjackTable.module.css';
const chipFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const money = (units: number) => chipFormat.format(units / 2);
const signedMoney = (units: number) => `${units > 0 ? '+' : units < 0 ? '−' : ''}${money(Math.abs(units))}`;

function Cards({ cards, timeline, dealer = false, shoeRef, reducedMotion = false }: {
  cards: VisibleCard[]; timeline?: CardTimeline; dealer?: boolean; shoeRef?: RefObject<HTMLDivElement | null>; reducedMotion?: boolean;
}) {
  return <div className={s.cards} style={{ '--card-count': cards.length } as CSSProperties} role="group" aria-label={dealer ? 'Dealer cards' : 'Player hand cards'}>{cards.map((card, i) => {
    const key = dealer ? dealerKey(timeline!.source.roundId, i) : playerCardKey('hidden' in card ? `hidden-${i}` : card.id);
    return <PlayingCard key={key} card={card} cue={timeline?.cues[key]} shoeRef={shoeRef} reducedMotion={reducedMotion} />;
  })}</div>;
}
function Hand({ hand, active, presenting, timeline, shoeRef, now, reducedMotion, selected = true }: {
  hand: PublicHand; active: boolean; presenting: boolean; timeline: CardTimeline; shoeRef: RefObject<HTMLDivElement | null>; now: number; reducedMotion: boolean; selected?: boolean;
}) {
  const ready = hand.cards.every(c => (timeline.cues[playerCardKey(c.id)]?.readyAt ?? 0) <= now);
  return <div id={`hand-${hand.id}`} data-selected={selected} className={`${s.hand} ${active ? s.activeHand : ''}`} aria-label={`Hand total ${hand.total}${active ? ', active hand' : ''}`}>
    <Cards cards={hand.cards} timeline={timeline} shoeRef={shoeRef} reducedMotion={reducedMotion} />
    <div className={s.handInfo}>
      <span className={s.total} data-hand-total>{ready ? <>{hand.soft && hand.total <= 21 ? 'Soft ' : ''}{hand.total > 21 ? `${hand.total} · Bust` : hand.total}</> : 'Dealing…'}</span>
      {hand.outcome === 'blackjack' && !presenting && <strong>Blackjack</strong>}
    </div>
  </div>;
}

function RoundResult({ player, insurance }: { player: PublicPlayer; insurance: { wager: number; returned: number } | null }) {
  const pair = player.perfectPairs?.wager ? player.perfectPairs : null;
  const handNets = player.hands.map(hand => (hand.returned ?? 0) - hand.wager);
  const pairNet = pair ? (pair.returned ?? 0) - pair.wager : 0;
  const insuranceNet = insurance ? insurance.returned - insurance.wager : 0;
  const net = player.roundResult?.net ?? handNets.reduce((sum, amount) => sum + amount, pairNet + insuranceNet);
  const satOut = player.roundResult?.outcome === 'out' || !player.hands.length;
  const push = net === 0 && player.hands.length === 1 && player.hands[0]?.outcome === 'push' && !pair && !insurance?.wager;
  const outcome = satOut ? 'out' : net > 0 ? 'won' : net < 0 ? 'lost' : push ? 'push' : 'even';
  const headline = satOut ? 'Sat out' : push ? 'Push · stake returned' : `Round ${outcome} · ${signedMoney(net)} chips`;
  const split = player.hands.length > 1;
  const showBreakdown = !satOut && (split || pair || !!insurance?.wager);

  return <div className={s.result} data-round-outcome={outcome}>
    <h2 className={s.resultTitle}>{headline}</h2>
    {showBreakdown && <ul className={s.resultDetails} aria-label="Wager results">
      {player.hands.map((hand, index) => <li key={hand.id}>
        <span>{split ? `Hand ${index + 1}` : 'Main'} {hand.outcome === 'blackjack' || hand.outcome === 'win' ? 'won' : hand.outcome === 'push' ? 'pushed' : 'lost'}</span>
        <strong>{signedMoney(handNets[index]!)}</strong>
      </li>)}
      {pair && <li title={pair.kind && pair.kind !== 'none' ? `${pair.kind} pair` : undefined}><span>Perfect Pairs</span><strong>{signedMoney(pairNet)}</strong></li>}
      {!!insurance?.wager && <li><span>Insurance</span><strong>{signedMoney(insuranceNet)}</strong></li>}
    </ul>}
  </div>;
}

export function BlackjackTable({ client, onLeave, actions }: { client: GameClient; onLeave: (endSession?: boolean) => void; actions?: TableActions<Action> }) {
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
  const waitingForBetting = state.phase === 'BETTING' && !!state.room && !state.room.bettingOpen;
  const localDeadline = state.decisionDeadline === null ? null : state.decisionDeadline - (connection.clockOffsetMs ?? 0);
  const turnTime = ownTurn && localDeadline !== null ? Math.min(HAND_DURATION_MS, Math.max(0, localDeadline - now)) : null;
  const turnSeconds = turnTime === null ? null : Math.ceil(turnTime / 1000);
  const practiceActions = useTableActions(client,onLeave);
  const {send,busy:pending,error} = actions ?? practiceActions;
  const tableError = error || betting.error;
  const {theme,appearance,setTheme,setAppearance}=useTableLook();
  const viewingOtherHand = compact && ownTurn && selectedHand !== ownActive;
  const bettingDeadline = state.room?.bettingDeadline;
  const bettingTimeLeft = bettingDeadline == null || now + (connection.clockOffsetMs ?? 0) < bettingDeadline;
  const can = (type: Action['type']) => state.legalActions.includes(type) && connection.status === 'connected' && !pending
    && (!presenting || type === 'NextRound') && (!betting.pending || !['Ready','SitOut','Leave'].includes(type))
    && (bettingTimeLeft || !['PlaceBet', 'Ready', 'Unready', 'SitOut'].includes(type))
    && (localDeadline === null || localDeadline > now) && (!viewingOtherHand || !['Hit', 'Stand', 'Double', 'Split'].includes(type));
  const inRound = state.phase !== 'BETTING';
  const complete = state.phase === 'ROUND_COMPLETE';
  const settled = complete && !presenting;
  const bettingOpen = !inRound && !waitingForBetting;
  const betLocked = !!player.ready || !!player.sittingOut;
  const showBettingControls = bettingOpen && !betLocked;
  const peers = [0, 1, 2, 3].filter(seat => seat !== player.seat).map(seat => ({ seat, player: state.players.find(p => p.seat === seat) }));
  const peerCount = state.players.length - 1;
  const maxBet = Math.min(2000, Math.floor((player.balance-betting.wager.perfectPairsAmount) / 20) * 20);
  const waiting = state.players.filter(p => p.connected !== false && !p.leavingAfterRound && !p.ready && !p.sittingOut).length;
  function seatState(p: PublicPlayer) {
    if (settled) return p.roundResult?.outcome ?? (p.hands.length ? 'even' : 'out');
    if (p.connected === false || p.leavingAfterRound) return 'offline';
    if (inRound) return state.activePlayerId === p.id ? 'active' : p.hands.length ? 'playing' : 'out';
    return p.ready ? 'ready' : p.sittingOut ? 'out' : 'waiting';
  }
  function seatLabel(p: PublicPlayer) {
    if (complete) {
      if (presenting) return 'Revealing dealer…';
      const result = p.roundResult;
      return !result || result.outcome === 'out' ? 'Sat out' : `${result.outcome === 'won' ? '✓ Won' : result.outcome === 'lost' ? '✕ Lost' : 'Even'} · ${result.net > 0 ? '+' : ''}${money(result.net)} chips`;
    }
    if (p.connected === false || p.leavingAfterRound) return 'Disconnected';
    if (!inRound) {
      if (p.ready) return `✓ Ready · ${money(p.bet + (p.perfectPairs?.wager ?? 0))} chips`;
      if (p.sittingOut) return 'Sitting out';
      if (waitingForBetting) return 'Waiting for betting';
      return p.bet ? 'Bet set · not ready' : 'Place a bet';
    }
    if (!p.hands.length) return 'Sitting out';
    if (state.phase === 'INSURANCE') return 'Insurance decision';
    if (state.activePlayerId === p.id) return '▶ Playing';
    return p.hands.some(hand => hand.status === 'playing') ? 'Waiting for turn' : 'Hand finished';
  }
  const timedOut = player.hands.some(h => h.timedOut);
  const editable=can('PlaceBet')&&state.blackjackBettingVersion===2;
  const readyAction = player.ready ? 'Unready' : 'Ready';
  const canConfirm = can(readyAction);
  const mainWager = player.hands.reduce((sum, hand) => sum + hand.wager, 0);
  const mainReturned = player.hands.reduce((sum, hand) => sum + (hand.returned ?? 0), 0);
  const pairWager = player.perfectPairs?.wager ?? 0;
  const wager = inRound ? { amount: mainWager, perfectPairsAmount: pairWager } : betting.wager;
  const lockedWager = player.bet + pairWager;
  const showLockedWagers = bettingOpen && !!player.ready && player.bet > 0;
  const displayedMainWager = showLockedWagers ? player.bet : mainWager;
  let message: string;
  if (connection.status !== 'connected') message = connection.message;
  else if (state.blackjackBettingVersion !== 2) message = 'Chip betting is unavailable for this table. Refresh and try again.';
  else if (state.wallet?.error) message = 'Saving your chips… Actions resume when the wallet reconnects.';
  else if (presenting) message = complete ? 'Revealing the dealer’s cards…' : 'Dealing the cards…';
  else if (!inRound) {
    if (!bettingOpen) message = '';
    else if (player.ready) message = waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'} to confirm` : 'Waiting for the deal';
    else if (player.sittingOut) message = 'You’re sitting out this round.';
    else message = wager.amount ? `Confirm your bet with ${state.room ? 'Ready' : 'Deal me in'}.` : 'Place a main bet to play.';
  } else if (!player.hands.length && !complete) message = 'This round is in progress. You’ll join the next betting window.';
  else if (state.phase === 'INSURANCE') message = 'Dealer shows an ace. Take insurance?';
  else if (complete) message = timedOut ? 'Time up. Your hand stood automatically.' : '';
  else message = viewingOtherHand ? 'Select the playing hand to take your turn.' : ownTurn ? 'Your turn. Hit resets your 20-second timer.' : `${state.players.find(p => p.id === state.activePlayerId)?.name ?? 'Another player'} is playing. You’re up soon.`;
  const dealerScore = displayedDealerTotal(timeline, now);
  const phaseDeadline = state.roundDeadline ?? state.room?.bettingDeadline ?? state.room?.insuranceDeadline;
  const phaseSeconds = phaseDeadline != null && (!complete || settled) ? Math.min(complete ? RESULTS_DURATION_MS / 1000 : Infinity, Math.max(0, Math.ceil((phaseDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000))) : null;
  const phaseTimer = phaseSeconds !== null && <p className={`${s.phaseNote} ${!inRound ? s.bettingClock : ''}`} role="timer" aria-label={complete ? 'Next round countdown' : state.phase === 'INSURANCE' ? 'Insurance time remaining' : 'Betting time remaining'} aria-live="off">{complete ? `Next round in ${phaseSeconds}s` : inRound ? `${phaseSeconds}s remaining` : `Bets close in ${phaseSeconds}s`}</p>;
  return <CardAppearance.Provider value={appearance}><div className={c.app+' '+s.app} data-game-table="blackjack" data-theme={theme} data-card-face={appearance.face} data-card-back={appearance.back} data-online={!!state.room} data-revision={state.revision} data-connection={connection.status}>
    <TableHeader client={client} playerId={player.id} online={!!state.room} ownTurn={ownTurn} seconds={turnSeconds} decisionLabel="hand" showAccountSignIn={!!state.wallet} openSeats={inRound ? 3 - peerCount : undefined}>
      <TableOptions appearance={appearance} onAppearanceChange={setAppearance} theme={theme} onThemeChange={setTheme}
        rules={<><p>Beat the dealer without going over 21. Aces count as 1 or 11. Dealer stands on all 17, including soft 17.</p><dl><dt>Blackjack</dt><dd>An unsplit natural pays 3:2. Regular wins pay 1:1; pushes return your stake.</dd><dt>Your turn</dt><dd>20 seconds per hand. Hit resets the countdown to 20 seconds. On timeout your hand stands.</dd><dt>Double</dt><dd>Only on an initial two-card 9, 10 or 11, including after splitting; one card then stand.</dd><dt>Split</dt><dd>Identical ranks, up to four hands. Split aces receive one card. Split 21 pays 1:1.</dd><dt>Insurance</dt><dd>Up to half your original bet when the dealer shows an ace; pays 2:1 on dealer blackjack.</dd><dt>Perfect Pairs</dt><dd>Your original two cards only, regardless of splits. Mixed pair: 6:1 profit; same colour, different suits: 12:1; same rank and suit: 25:1. Winning stakes also return.</dd><dt>Betting</dt><dd>10–1,000 chips per target in steps of 10. Perfect Pairs requires a main bet; combined bets cannot exceed your table stack. Cancel ready lets you edit your bets while betting is open. Only ready players are dealt in. Results last five seconds after the dealer reveal.</dd><dt>The shoe</dt><dd>Six physical decks, without replacement across rounds. The cut card triggers a shuffle before the next deal.</dd></dl></>}/>
    </TableHeader>
    <main className={s.main}>
      <TableToolbar connection={connection} leaveDisabled={pending||betting.pending||!!state.room&&connection.status!=='connected'} onLeave={()=>{if(state.room)void send({type:'Leave'});else onLeave(true);}}>
        {bettingOpen && phaseTimer}
      </TableToolbar>
      <div className={s.layout}>
      <section className={s.table} data-collection-surface data-round={inRound} data-bet-locked={!inRound && betLocked} data-peer-count={peerCount} style={{ '--peer-count': peerCount } as CSSProperties} aria-label="Blackjack table">
        <div className={s.tableInner}>
          <div className={s.heading}><h1>Blackjack <small>3:2</small></h1><span ref={shoeRef} className={s.shoe} data-card-shoe title={state.shoe.remaining+' cards remaining'}>▱ {state.shoe.shuffleNext?'Shuffle next':state.shoe.remaining}</span></div>
          <div className={s.dealer}><p className={s.seatLabel}>Dealer {dealerScore!==null&&<span className={s.total} data-dealer-total>{dealerScore}</span>}</p>{state.dealer.length?<Cards cards={state.dealer} timeline={timeline} dealer shoeRef={shoeRef} reducedMotion={reducedMotion}/>:<div className={s.cardSpaces} aria-label="Dealer is waiting to deal"><span/><span/></div>}</div>
          <div className={s.peers}>
          {peers.map(({ seat, player: other })=>other?<section key={seat} className={s.peer} data-state={seatState(other)} aria-label={`Seat ${seat+1}: ${other.name}`}>
            <ChatBubble client={client} playerId={other.id} name={other.name}/><div className={s.peerName}><PlayerIdentityButton player={other}/></div><span className={s.seatStatus} data-state={seatState(other)}>{seatLabel(other)}</span>
            {other.hands.length?<div className={s.peerHands}>{other.hands.map(h=><div key={h.id}><Cards cards={h.cards} timeline={timeline} shoeRef={shoeRef} reducedMotion={reducedMotion}/><span data-hand-total>{h.total}{h.total>21?' Bust':''}</span></div>)}</div>:!inRound&&<div className={s.peerWager}><WagerChips amount={other.bet+(other.perfectPairs?.wager??0)} reducedMotion={reducedMotion} compact/><span>{money(other.bet+(other.perfectPairs?.wager??0))}</span></div>}
          </section>:!inRound&&<section key={seat} className={s.emptySeat} aria-label={`Seat ${seat+1} empty`}>＋ <span>Open seat</span></section>)}
          </div>
          <section className={s.ownSeat} data-state={seatState(player)} aria-label="Your seat">
            {state.room&&<ChatBubble client={client} playerId={player.id} name={player.name}/>}
            <div className={s.playerHead}><PlayerIdentityButton player={player}>{player.name}<small>YOU</small></PlayerIdentityButton>{!complete && (inRound || !player.ready) && <span className={s.seatStatus} data-state={seatState(player)}>{seatLabel(player)}</span>}</div>
            {player.hands.length?<div className={s.ownHands}>
              {compact&&player.hands.length>1&&<div className={s.handTabs} role="tablist" aria-label="Your hands">{player.hands.map((h,index)=><button key={h.id} role="tab" aria-selected={h.id===selectedHand} aria-controls={`hand-${h.id}`} aria-label={`Hand ${index+1}, total ${h.total}${h.id===ownActive?', playing':''}`} onClick={()=>setHandView({active:ownActive,selected:h.id})} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?player.hands.length-1:(index+(event.key==='ArrowRight'?1:-1)+player.hands.length)%player.hands.length;setHandView({active:ownActive,selected:player.hands[next]!.id});(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();}}>{h.id===ownActive?'▶ ':''}{index+1} · {h.total>21?h.total+' Bust':h.total}</button>)}</div>}
              <div className={s.hands}>{player.hands.map(h=><Hand key={h.id} hand={h} selected={h.id===selectedHand} active={h.id===state.activeHandId} presenting={presenting} timeline={timeline} now={now} reducedMotion={reducedMotion} shoeRef={shoeRef}/>)}</div>
            </div>:!inRound&&!betLocked&&<div className={s.yourEmpty}><div className={s.cardSpaces}><span/><span/></div></div>}
            {displayedMainWager > 0 && <div className={s.committedWagers} data-locked={showLockedWagers} role="group" aria-label={showLockedWagers ? 'Locked wagers' : 'Committed wagers'}>
              <span><WagerChips key={state.roundId} amount={displayedMainWager} returned={mainReturned} settled={settled} reducedMotion={reducedMotion} compact/>Main <strong>{money(displayedMainWager)}</strong></span>
              {pairWager > 0 && <span><WagerChips key={state.roundId} amount={pairWager} returned={player.perfectPairs?.returned} settled={settled} reducedMotion={reducedMotion} compact/>Perfect Pairs <strong>{money(pairWager)}</strong></span>}
              {!!state.insurance?.wager && <span>Insurance <strong>{money(state.insurance.wager)}</strong></span>}
            </div>}
          </section>
          {!inRound && !betLocked && <div className={s.betBoard} role="group" aria-label="Your table wagers" data-pending={betting.pending}>
          {(['main','pair'] as const).map(tile=>{const amount=tile==='main'?wager.amount:wager.perfectPairsAmount;return <button key={tile} className={tile==='main'?s.mainBet:s.pairBet} type="button" aria-label={tile==='main'?'Bet on Blackjack':'Bet on Perfect Pairs'} aria-description={`${money(amount)} chips. ${editable?'+ '+denomination+' chips.':'Betting closed.'}`} disabled={!editable} data-bet-tile={tile} data-amount={amount} onClick={()=>controller.add(tile,denomination)}>
            <span>{tile==='main'?'Your bet':'Perfect Pairs'}</span><small>{tile==='main'?'Blackjack 3:2':'6:1 · 12:1 · 25:1'}</small><div className={s.targetChips}><WagerChips key={state.roundId} amount={amount} reducedMotion={reducedMotion} compact/><strong>{money(amount)}</strong></div>
          </button>;})}
          </div>}
        </div>
      </section>
      <section className={s.controls} data-round={inRound} data-settled={settled} aria-label="Game controls">
        <div className={s.summary}>
          <span>Table stack <strong>{money(player.balance)} <small>chips</small></strong></span>
          {bettingOpen && !betLocked && <span>On table <strong>{money(wager.amount + wager.perfectPairsAmount)}</strong></span>}
        </div>
        <div className={s.statusRow}>
          <div className={s.status} role="status">
            {settled && <RoundResult player={player} insurance={state.insurance}/>}
            {bettingOpen && player.ready && <strong className={s.readyLabel}>Ready · {money(lockedWager)} chips locked</strong>}
            {message && <p>{message}</p>}
          </div>
          {inRound && !complete && phaseTimer}
          {turnSeconds !== null && turnTime !== null && <div className={s.turnClock} data-urgent={turnSeconds <= 5} role="timer" aria-label="Time remaining for this hand" aria-live="off">
            <strong>{turnSeconds}s</strong><progress max={HAND_DURATION_MS} value={turnTime} aria-label="Hand time remaining" />
          </div>}
        </div>
        {showBettingControls && <ChipTray denomination={denomination} enabled={editable} pending={betting.pending} canUndo={betting.canUndo} canClear={betting.canClear} onSelect={setDenomination} onUndo={()=>controller.undo()} onClear={()=>controller.clear()}/>}
        <div className={`${s.buttons} ${settled ? s.resultFooter : ''}`}>
          {settled && phaseTimer}
          {connection.status==='connected'&&<>
            {showBettingControls && <button disabled={!editable||maxBet<20||wager.amount===maxBet} onClick={()=>controller.max()}>Max Bet</button>}
            {bettingOpen && !player.sittingOut && (!player.ready || state.legalActions.includes('Unready')) &&
              <button className={s.primary} disabled={!pending && !canConfirm} aria-disabled={pending || undefined} onClick={()=>{if(canConfirm)void send({type:readyAction});}}>
                {player.ready ? 'Cancel ready' : state.room ? 'Ready' : 'Deal me in'}
              </button>}
            {showBettingControls && state.room&&<button disabled={!can('SitOut')} onClick={()=>void send({type:'SitOut'})}>Sit out</button>}
            {state.phase==='PLAYER_TURNS'&&<><button className={s.primary} disabled={!can('Hit')} onClick={()=>void send({type:'Hit'})}>Hit</button><button disabled={!can('Stand')} onClick={()=>void send({type:'Stand'})}>Stand</button><button disabled={!can('Double')} onClick={()=>void send({type:'Double'})}>Double</button><button disabled={!can('Split')} onClick={()=>void send({type:'Split'})}>Split</button></>}
            {state.phase==='INSURANCE'&&<><button className={s.primary} disabled={!can('InsuranceDecision')} onClick={()=>void send({type:'InsuranceDecision',amount:0})}>No insurance</button><button disabled={!can('InsuranceDecision')||player.balance<player.bet/2} onClick={()=>void send({type:'InsuranceDecision',amount:player.bet/2})}>Insure for {money(player.bet/2)}</button></>}
            {complete&&(!state.room||manager)&&<button className={s.primary} disabled={!can('NextRound')} onClick={()=>void send({type:'NextRound'})}>Next round</button>}
            {can('Refill')&&<button onClick={()=>void send({type:'Refill'})}>Refill to 1,000</button>}
          </>}
          {state.room&&connection.status==='offline'&&<button onClick={()=>client.reconnect?.()}>Try reconnecting</button>}
          {state.room&&connection.status!=='connected'&&<button onClick={()=>onLeave()}>Create another table</button>}
        </div>
        {tableError&&<p className={s.error} role="alert">{tableError}</p>}
      </section>
      </div>
    </main>
  </div></CardAppearance.Provider>;
}
