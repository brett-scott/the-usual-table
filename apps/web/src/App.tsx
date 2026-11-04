import { useEffect, useRef, useState, useSyncExternalStore,type ComponentType, type CSSProperties, type RefObject } from 'react';
import type { Action, GameClient, PublicHand, PublicPlayer, VisibleCard } from '@casual/protocol';
import { gameIdFromHash,roomIdFromHash,type GameId,type TableInfo } from '@casual/protocol';
import { ApiError,tableInfo } from './onlineClient';
import { blackjackClientAdapter } from './gameClientAdapters';
import { PlayingCard } from './PlayingCard';
import { dealerKey, playerCardKey, type CardTimeline } from './cardTimeline';
import { useTablePresentation } from './useTablePresentation';
import { displayedDealerTotal } from './dealerScore';
import { useCompactLayout } from './useCompactLayout';
import { TableHeader,TableToolbar } from './TableChrome';
import { CardAppearance, savedAppearance } from './cardAppearance';
import { TableOptions } from './TableOptions';
import { ChatBubble } from './ChatBubble';
import { WagerChips } from './WagerChips';
import { PlayerAvatar } from './PlayerAvatar';
import { GameHub } from './GameHub';
import { AccountControls, AccountProvider } from './AccountControls';
import { GameRoomEntry } from './GameRoomEntry';
import s from './App.module.css';

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

export function App() {
  return <AccountProvider><AppRoutes /></AccountProvider>;
}
function AppRoutes() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => { const changed = () => setHash(location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const invite = roomIdFromHash(hash);
  if (invite) return <GameRoomRoute key={invite} invite={invite} />;
  const gameId=gameIdFromHash(hash);
  if (gameId) return <GameHub key={gameId} browse gameId={gameId}/>;
  return <GameHub />;
}

const gameRoomViews:Partial<Record<GameId,{version:number;component:ComponentType<{invite:string;info:TableInfo}>}>>={blackjack:{version:blackjackClientAdapter.version,component:BlackjackRoom}};
function GameRoomRoute({invite}:{invite:string}){
  const [info,setInfo]=useState<TableInfo|null>(null);const [error,setError]=useState<ApiError|null>(null);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;const abort=new AbortController();setError(null);
    void tableInfo(invite,abort.signal).then(value=>{if(active)setInfo(value);}).catch(problem=>{if(active)setError(problem instanceof ApiError?problem:new ApiError('CLIENT_INCOMPATIBLE','This app cannot open this game. Refresh and try again.'));});
    return()=>{active=false;abort.abort();};},[invite,attempt]);
  const view=info?gameRoomViews[info.gameId]:undefined;const View=view?.component;
  if(info&&View&&info.adapterVersion===view?.version)return <View invite={invite} info={info}/>;
  return <main className={s.welcome}><div className={s.welcomeNav}><a href="#/games">All games</a><AccountControls/></div><div className={s.welcomeMain}>
    {!error&&!info?<p role="status">Opening your table…</p>:<><h1>{error?.code==='ROOM_EXPIRED'?'Table expired':'Table unavailable'}</h1><p>{error?.message??'Refresh the app to open this game.'}</p><button onClick={()=>setAttempt(x=>x+1)}>Retry table</button><a href="#/games">Find or create another table</a></>}
  </div></main>;
}
function BlackjackRoom({invite,info}:{invite:string;info:TableInfo}) {
  return <GameRoomEntry invite={invite} info={info} adapter={blackjackClientAdapter} gameName="Blackjack"
    intro="Join your friends for a little blackjack. No account required, no real money." seatHint="Up to four friends"
    art={<><PlayingCard card={{id:'intro-a',rank:'A',suit:'spades'}}/><PlayingCard card={{id:'intro-k',rank:'K',suit:'hearts'}}/><span className={s.artChip}>21</span></>}
    footer={<><span>BLACKJACK, WITHOUT THE STAKES.</span><span>Six decks. Classic rules. Your pace.</span></>}
  >{(client,onLeave)=><Table client={client} onLeave={onLeave}/>}</GameRoomEntry>;
}

export function Table({ client, onLeave }: { client: GameClient; onLeave: (endSession?: boolean) => void }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const connection = useSyncExternalStore(client.subscribe, client.getConnection);
  const presentation = useTablePresentation(state);
  const { timeline, now, reducedMotion, presenting } = presentation;
  const shoeRef = useRef<HTMLDivElement>(null);
  const player = state.players.find(p => p.id === state.you)!;
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
  const can = (type: Action['type']) => state.legalActions.includes(type) && connection.status === 'connected' && !pending && (!presenting || type === 'NextRound') && (localDeadline === null || localDeadline > now) && (!viewingOtherHand || !['Hit', 'Stand', 'Double', 'Split'].includes(type));
  async function send(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try { await client.send(action); if (action.type === 'Leave') onLeave(true); } catch (e) { setError(e instanceof Error ? e.message : 'That action failed. Please try again.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const profit = player.hands.reduce((sum, h) => sum + (h.returned ?? 0) - h.wager, 0) + (state.insurance ? state.insurance.returned - state.insurance.wager : 0);
  const complete = state.phase === 'ROUND_COMPLETE';
  const maxBet = Math.min(200, Math.floor(player.balance / 20) * 20);
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
    if (state.phase === 'BETTING') return p.ready ? `✓ Ready · ${money(p.bet)} chips` : p.sittingOut ? '— Sitting out' : state.room && !state.room.bettingOpen ? 'Waiting for betting' : '◷ Place your bet';
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
  const dealerReady = state.dealer.every((_, i) => (timeline.cues[dealerKey(state.roundId, i)]?.readyAt ?? 0) <= now);
  const dealerScore = displayedDealerTotal(timeline, now);
  const phaseDeadline = state.roundDeadline ?? state.room?.bettingDeadline ?? state.room?.insuranceDeadline;
  const phaseSeconds = phaseDeadline ? Math.min(complete ? 10 : Infinity, Math.max(0, Math.ceil((phaseDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000))) : null;
  return <CardAppearance.Provider value={appearance}><div className={s.app} data-theme={theme} data-card-face={appearance.face} data-card-back={appearance.back} data-online={!!state.room} data-revision={state.revision} data-connection={connection.status}>
    <TableHeader client={client} playerId={player.id} online={!!state.room} ownTurn={ownTurn} seconds={localDeadline===null?null:Math.max(0,Math.ceil((localDeadline-now)/1000))} decisionLabel="hand" showAccountSignIn={!!state.wallet}>
        <TableOptions appearance={appearance} onAppearanceChange={next => { setAppearance(next); writeLocal('casual-card-face', next.face); writeLocal('casual-card-back', next.back); }}
          theme={theme} onThemeChange={value => { setTheme(value); writeLocal('casual-theme', value); }}
          rules={<><p>Beat the dealer without going over 21. Aces count as 1 or 11. The dealer stands on every 17, including soft 17.</p><dl><dt>Blackjack</dt><dd>An unsplit ace + ten-value card pays 3:2. Regular wins pay 1:1; a push returns your bet.</dd><dt>Your turn</dt><dd>Each active hand gets 20 seconds. Hit resets the countdown to 20 seconds. If time runs out, your hand stands automatically.</dd><dt>Double</dt><dd>Double only on an initial two-card total of 9, 10 or 11, including after splitting. Receive one card, then stand.</dd><dt>Split</dt><dd>Identical ranks only, up to four hands. Split aces receive one card each, then stand. Split 21 pays 1:1.</dd><dt>Insurance</dt><dd>Offered before the dealer checks an ace. Wager up to half your original bet; pays 2:1 if the dealer has blackjack.</dd><dt>The shoe</dt><dd>Six physical decks, drawn without replacement across rounds. A cut card or safety reserve triggers a shuffle before the next deal.</dd></dl></>} />
    </TableHeader>
    <main className={s.main}>
      <TableToolbar connection={connection} leaveDisabled={!!state.room&&(pending||connection.status!=='connected')} onLeave={()=>{if(state.room)void send({type:'Leave'});else onLeave(true);}}/>
      <section className={s.table} aria-label="Blackjack table">
        <div className={s.tableInner}>
          <div ref={shoeRef} className={s.shoe} data-card-shoe><span className={s.shoeIcon} aria-hidden="true">▱</span><strong>6-DECK SHOE</strong><span>{state.shoe.remaining} cards remaining</span><small>{state.shoe.shuffleNext ? 'Shuffle before next deal' : state.shoe.shuffled ? 'Fresh shuffle this round' : 'Same shoe, next hand'}</small></div>
          <div className={s.dealer}><p className={s.seatLabel}>THE DEALER {dealerScore !== null && <span className={s.total} data-dealer-total>{dealerScore}</span>}</p>{state.dealer.length ? <Cards cards={state.dealer} timeline={timeline} dealer shoeRef={shoeRef} reducedMotion={reducedMotion} /> : <div className={s.cardSpaces} aria-label="Dealer is waiting to deal"><span /><span /></div>}<span className={s.dealerNote}>{state.dealerTotal === null ? 'Stands on all 17' : dealerReady ? 'Hand revealed' : 'Revealing cards…'}</span></div>
          <div className={s.feltLettering} aria-hidden="true"><span>THE USUAL TABLE</span><h2>Blackjack</h2><p>PAYS 3 TO 2</p><div>INSURANCE PAYS 2 TO 1</div></div>
          <div className={s.seats} data-player-count={state.players.length}>
            <section className={`${s.seat} ${s.ownSeat}`} data-state={seatState(player)} aria-label="Your seat">
              {state.room && <ChatBubble client={client} playerId={player.id} name={player.name} />}
              <div className={s.playerHead}><PlayerAvatar player={player} /><div><strong>{player.name} <small>YOU · SEAT {player.seat + 1}</small></strong><span className={s.seatStatus} data-state={seatState(player)}>{seatLabel(player)}</span></div></div>
              {player.hands.length ? <div className={s.ownHands}>
                {compact && player.hands.length > 1 && <div className={s.handTabs} role="tablist" aria-label="Your hands">{player.hands.map((h, index) => <button key={h.id} role="tab" aria-selected={h.id === selectedHand} aria-controls={`hand-${h.id}`} aria-label={`Hand ${index + 1}, total ${h.total}${h.id === ownActive ? ', playing' : ''}`} onClick={() => setHandView({ active: ownActive, selected: h.id })} onKeyDown={event => {
                  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return;
                  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? player.hands.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + player.hands.length) % player.hands.length;
                  setHandView({ active: ownActive, selected: player.hands[next]!.id }); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
                }}><span>{h.id === ownActive ? '▶ ' : ''}Hand {index + 1}</span><strong>{h.total > 21 ? `${h.total} Bust` : h.total}</strong></button>)}</div>}
                <div className={s.hands}>{player.hands.map(h => <Hand key={h.id} hand={h} selected={h.id === selectedHand} active={h.id === state.activeHandId} deadline={localDeadline} presentation={presentation} shoeRef={shoeRef} />)}</div>
              </div> : <div className={s.yourEmpty}>{(!state.room || player.ready) ? <WagerChips amount={player.bet} reducedMotion={reducedMotion} /> : <span className={s.chipIcon}>♣</span>}<span>Your next good hand<br />starts here.</span></div>}
            </section>
            {[0, 1, 2, 3].filter(seat => seat !== player.seat).map(seat => {
              const other = state.players.find(p => p.seat === seat);
              return other ? <section className={`${s.seat} ${s.otherSeat}`} data-state={seatState(other)} data-active={state.activePlayerId === other.id} key={seat} aria-label={`Seat ${seat + 1}: ${other.name}`}><ChatBubble client={client} playerId={other.id} name={other.name} />
                <div className={s.playerHead}><PlayerAvatar player={other} /><div><strong>{other.name} <small>SEAT {seat + 1}</small></strong><span className={s.seatStatus} data-state={seatState(other)}>{state.phase === 'BETTING' || complete ? seatLabel(other) : other.leavingAfterRound ? 'Finishing committed hand' : other.connected === false ? other.reservationDeadline ? `Disconnected · ${Math.max(0, Math.ceil((other.reservationDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000))}s reserved` : 'Disconnected' : other.ready ? 'Wager locked' : other.sittingOut ? 'Sitting out' : state.activePlayerId === other.id ? '▶ Playing' : 'At the table'}</span></div></div>
                {other.hands.length ? <div className={s.hands}>{other.hands.map(h => <Hand key={h.id} hand={h} active={h.id === state.activeHandId} deadline={localDeadline} presentation={presentation} shoeRef={shoeRef} />)}</div> : <p className={s.smallNote}>Waiting for the next hand</p>}
                <div className={s.opponentSummary} aria-label={`${other.name}'s hands`}>{complete && !presenting && <strong className={s.roundOutcome} data-state={seatState(other)}>{seatLabel(other)}</strong>}{state.phase === 'BETTING' && other.ready && <WagerChips amount={other.bet} reducedMotion={reducedMotion} compact />}{state.phase === 'BETTING' ? <span className={s.seatStatus} data-state={seatState(other)}>{seatLabel(other)}</span> : other.hands.length ? other.hands.map((h, index) => <span key={h.id} className={h.id === state.activeHandId ? s.summaryActive : ''} aria-label={`Hand ${index + 1}, ${h.total > 21 ? `${h.total}, bust` : h.total}${h.outcome ? `, ${h.outcome}` : ''}`}><WagerChips amount={h.wager} returned={h.returned} settled={!!h.outcome && !presenting} reducedMotion={reducedMotion} compact />{h.id === state.activeHandId ? '▶ ' : ''}{h.total > 21 ? `${h.total} Bust` : h.total}{h.outcome === 'win' || h.outcome === 'blackjack' ? ' ✓' : ''}</span>) : <span>Next round</span>}</div>
                <p className={s.smallNote}>{money(other.balance)} chips</p>
              </section> : <section className={`${s.seat} ${s.emptySeat}`} key={seat} aria-label={`Seat ${seat + 1} empty`}><span className={s.emptyAvatar}>+</span><strong>Open seat</strong><span>Seat {seat + 1} · {state.room ? 'Invite a friend' : 'Shared tables available'}</span></section>;
            })}
          </div>
        </div>
      </section>
      <section className={s.controls} aria-label="Game controls">
        <div className={s.balance}><span className={s.balanceChip}>♣</span><div><span>YOUR BALANCE</span><strong>{money(player.balance)} <small>chips</small></strong></div></div>
        <div className={s.controlMain}><div className={s.controlStatus}><p className={s.status} role="status" aria-live="polite">{state.wallet?.status === 'funding' ? 'Moving your buy-in to the table…' : state.wallet?.status === 'rejected' ? 'Buy-in declined. Check your available chips, leave this seat and try again.' : state.wallet?.error ? 'Saving your chips… Actions resume when the wallet reconnects.' : message}</p>
          {phaseSeconds !== null && <p className={`${s.smallNote} ${s.phaseNote}`} role="timer" aria-label={complete ? 'Next round countdown' : state.phase === 'INSURANCE' ? 'Insurance time remaining' : 'Betting time remaining'} aria-live="off">{complete ? `Next round in ${phaseSeconds}s` : `${phaseSeconds}s remaining`}</p>}</div>
          <div className={s.buttons}>
            {connection.status === 'connected' && <>
            {state.phase === 'BETTING' && (!state.room || state.room.bettingOpen) && <><div className={s.betControl}><button aria-label="Decrease bet" disabled={!can('PlaceBet') || player.bet <= 20} onClick={() => void send({ type: 'PlaceBet', amount: player.bet - 20 })}>−</button><span><small>YOUR BET</small><strong>{money(player.bet)} <small>chips</small></strong></span><button aria-label="Increase bet" disabled={!can('PlaceBet') || player.bet >= 200 || player.bet + 20 > player.balance} onClick={() => void send({ type: 'PlaceBet', amount: player.bet + 20 })}>+</button></div><button disabled={!can('PlaceBet') || maxBet < 20 || player.bet === maxBet} onClick={() => void send({ type: 'PlaceBet', amount: maxBet })}>Max Bet</button><button className={s.primary} disabled={!can('Ready')} onClick={() => void send({ type: 'Ready' })}>{state.room ? player.ready ? 'Ready \u2713' : 'Ready' : 'Deal me in'} <span>↗</span></button>{state.room && <button disabled={!can('SitOut')} onClick={() => void send({ type: 'SitOut' })}>Sit out</button>}</>}
            {state.phase === 'BETTING' && state.room && !state.room.bettingOpen && manager && <button className={s.primary} disabled={!can('StartBetting')} onClick={() => void send({ type: 'StartBetting' })}>Open betting</button>}
            {state.phase === 'PLAYER_TURNS' && <><button className={s.primary} disabled={!can('Hit')} onClick={() => void send({ type: 'Hit' })}>Hit <span>＋</span></button><button className={s.stand} disabled={!can('Stand')} onClick={() => void send({ type: 'Stand' })}>Stand</button><button disabled={!can('Double')} title="Two cards totaling 9, 10 or 11, and an equal extra wager required" onClick={() => void send({ type: 'Double' })}>Double</button><button disabled={!can('Split')} title="Identical ranks, enough chips, and fewer than four hands required" onClick={() => void send({ type: 'Split' })}>Split</button></>}
            {state.phase === 'INSURANCE' && <><button className={s.primary} disabled={!can('InsuranceDecision')} onClick={() => void send({ type: 'InsuranceDecision', amount: 0 })}>No insurance</button><button disabled={!can('InsuranceDecision') || player.balance < player.bet / 2} onClick={() => void send({ type: 'InsuranceDecision', amount: player.bet / 2 })}>Insure for {money(player.bet / 2)}</button></>}
            {complete && (!state.room || manager) && <button className={s.primary} disabled={!can('NextRound')} onClick={() => void send({ type: 'NextRound' })}>Next round <span>→</span></button>}
            {complete && state.room && !manager && <span className={s.smallNote}>Next betting opens automatically. The host can start sooner.</span>}
            {can('Refill') && <button onClick={() => void send({ type: 'Refill' })}>Refill to 1,000</button>}
            </>}
            {state.room && connection.status === 'offline' && <button onClick={() => client.reconnect?.()}>Try reconnecting</button>}
            {state.room && connection.status !== 'connected' && <button onClick={() => onLeave()}>Create another table</button>}
          </div>
          {error && <p className={s.error} role="alert">{error}</p>}
        </div>
        <div className={s.betLimits}><span>TABLE LIMITS</span><strong>10 – 100 chips</strong><span>Blackjack pays 3:2</span></div>
      </section>
    </main>
  </div></CardAppearance.Provider>;
}
