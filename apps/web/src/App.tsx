import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { displayNameSchema, type Action, type GameClient, type PublicHand, type VisibleCard } from '@casual/protocol';
import { createPracticeClient } from './practiceClient';
import { ApiError, createGuest, createOnlineClient, joinGuest, resumeGuest, savedSession } from './onlineClient';
import { PlayingCard } from './PlayingCard';
import { dealerKey, playerCardKey, type CardTimeline } from './cardTimeline';
import { useTablePresentation } from './useTablePresentation';
import { useCompactLayout } from './useCompactLayout';
import s from './App.module.css';

const money = (units: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(units / 2);
function readLocal(key: string) { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } }
function writeLocal(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Practice remains usable when storage is blocked. */ } }
function invitation() { return location.hash.match(/^#\/room\/([a-f0-9]{32})$/)?.[1] ?? ''; }

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
    <div className={s.handInfo}><span className={s.total}>{ready ? <>{hand.soft && hand.total <= 21 ? 'Soft ' : ''}{hand.total > 21 ? 'Bust' : hand.total}</> : 'Dealing…'}</span><span>{money(hand.wager)} chips</span>{hand.outcome && !presenting && <strong>{hand.outcome === 'blackjack' ? 'Blackjack!' : hand.outcome === 'win' ? 'Win' : hand.outcome === 'push' ? 'Push' : 'Lost'}</strong>}{hand.timedOut && <span className={s.turnLabel}>Time up · stood</span>}{active && <span className={s.turnLabel}>▶ Playing</span>}</div>
    {active && deadline !== null && <div className={`${s.countdown} ${seconds <= 5 ? s.countdownUrgent : ''}`} role="timer" aria-label="Time remaining for this hand" aria-live="off"><div><strong>{seconds}s</strong><span>Hit resets to 20s</span></div><progress max={20_000} value={Math.max(0, Math.min(20_000, deadline - now))} aria-label="Hand time remaining" /></div>}
  </div>;
}

export function App() {
  const [client, setClient] = useState<GameClient | null>(null);
  const [invite, setInvite] = useState(invitation);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => readLocal('casual-name'));
  const [error, setError] = useState('');
  const [entryErrorCode, setEntryErrorCode] = useState('');
  function showEntryError(e: unknown) {
    setError(e instanceof Error ? e.message : 'The table could not be opened.');
    setEntryErrorCode(e instanceof ApiError ? e.code : 'REQUEST_FAILED');
  }
  useEffect(() => {
    const changed = () => { const next = invitation(); if (client?.getSnapshot().room?.inviteId !== next) { client?.dispose(); setClient(null); } setInvite(next); };
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, [client]);
  useEffect(() => {
    if (!invite || client) return;
    const session = savedSession(invite); if (!session) return;
    let active = true; const abort = new AbortController(); setBusy(true);
    void resumeGuest(session, abort.signal).then(response => { if (active) { setBusy(false); setClient(createOnlineClient(response)); } }).catch(e => { if (active) { setBusy(false); showEntryError(e); } });
    return () => { active = false; abort.abort(); };
  }, [invite, client]);
  async function enter(event: FormEvent) {
    event.preventDefault(); const result = displayNameSchema.safeParse(name);
    if (!result.success) { setError(result.error.issues[0]!.message); return; }
    writeLocal('casual-name', result.data); setError(''); setEntryErrorCode('');
    const mode = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? (invite ? 'join' : 'practice');
    if (mode === 'practice') { history.replaceState(null, '', `${location.pathname}${location.search}#`); setInvite(''); setClient(createPracticeClient(result.data)); return; }
    setBusy(true);
    try {
      const response = mode === 'join' ? await joinGuest(invite, result.data) : await createGuest(result.data);
      history.replaceState(null, '', `${location.pathname}${location.search}#/room/${response.session.inviteId}`);
      setInvite(response.session.inviteId); setClient(createOnlineClient(response));
    } catch (e) { showEntryError(e); }
    finally { setBusy(false); }
  }
  function leave(forgetCredential = false) {
    if (forgetCredential && client?.getSnapshot().room) { try { localStorage.removeItem(`casual-room:${client.getSnapshot().room!.inviteId}`); } catch { /* Best effort. */ } }
    client?.dispose(); setClient(null); setInvite(''); setError(''); setEntryErrorCode(''); history.replaceState(null, '', `${location.pathname}${location.search}#`);
  }
  return client ? <Table client={client} onLeave={leave} /> : <div className={s.welcome}>
    <div className={s.welcomeBrand}><span className={s.brandMark}>♣</span><span>The Casual Table</span></div>
    <main className={s.welcomeMain}>
      <div className={s.welcomeArt} aria-hidden="true"><PlayingCard card={{ id: 'intro-a', rank: 'A', suit: 'spades' }} /><PlayingCard card={{ id: 'intro-k', rank: 'K', suit: 'hearts' }} /><span className={s.artChip}>21</span></div>
      <p className={s.eyebrow}>{invite ? 'YOU’RE INVITED TO THE TABLE' : 'GOOD HANDS. EASY COMPANY.'}</p>
      <h1>A seat at the table.<br /><em>Nothing on the line.</em></h1>
      <p className={s.welcomeCopy}>Settle in for a little blackjack. No accounts, no real money.<br />Just you, the cards, and a fresh stack of chips.</p>
      <form onSubmit={enter} className={s.nameForm}>
        <label htmlFor="guest-name">What should we call you?</label>
        <input id="guest-name" autoComplete="nickname" maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="Your display name" aria-describedby={error ? 'name-error' : undefined} required disabled={busy} />
        {error && (entryErrorCode ? <div id="name-error" className={s.entryProblem} role="alert" data-error-code={entryErrorCode}><h2>{entryErrorCode === 'TABLE_FULL' ? 'Table full' : entryErrorCode === 'ROOM_EXPIRED' ? 'Table expired' : ['SESSION_INVALID', 'SESSION_EXPIRED'].includes(entryErrorCode) ? 'Seat unavailable' : entryErrorCode === 'OFFLINE' ? 'Connection unavailable' : 'Couldn’t open this table'}</h2><p>{error}</p><span>You can create a new table below.</span></div> : <p id="name-error" role="alert">{error}</p>)}
        {invite ? <button className={s.primary} type="submit" value="join" disabled={busy}>{busy ? 'Connecting…' : 'Join table'} <span aria-hidden="true">↗</span></button> : <button className={s.primary} type="submit" value="practice" disabled={busy}>Take a practice seat <span>↗</span></button>}
        <button className={s.secondary} type="submit" value="online" disabled={busy}>{busy ? 'Connecting…' : 'Create a table with friends'}</button>
        {invite && <button className={s.secondary} type="submit" value="practice" disabled={busy}>Practice on my own</button>}
      </form>
      <p className={s.smallNote}>1,000 play chips on the house · Up to four friends</p>
    </main>
    <footer className={s.welcomeFooter}><span>BLACKJACK, WITHOUT THE STAKES.</span><span>Six decks. Classic rules. Your pace.</span></footer>
  </div>;
}

function Table({ client, onLeave }: { client: GameClient; onLeave: (forgetCredential?: boolean) => void }) {
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
  const [theme, setTheme] = useState(() => readLocal('casual-theme') === 'midnight' ? 'midnight' : 'classic');
  const rulesRef = useRef<HTMLDialogElement>(null);
  const rulesButton = useRef<HTMLButtonElement>(null);
  const viewingOtherHand = compact && ownTurn && selectedHand !== ownActive;
  const can = (type: Action['type']) => state.legalActions.includes(type) && connection.status === 'connected' && !pending && !presenting && (localDeadline === null || localDeadline > now) && (!viewingOtherHand || !['Hit', 'Stand', 'Double', 'Split'].includes(type));
  async function send(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try { await client.send(action); if (action.type === 'Leave') onLeave(true); } catch (e) { setError(e instanceof Error ? e.message : 'That action failed. Please try again.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const profit = player.hands.reduce((sum, h) => sum + (h.returned ?? 0) - h.wager, 0) + (state.insurance ? state.insurance.returned - state.insurance.wager : 0);
  const complete = state.phase === 'ROUND_COMPLETE';
  const timedOut = player.hands.some(h => h.timedOut);
  let message: string;
  if (connection.status !== 'connected') message = connection.message;
  else if (presenting) message = complete ? 'Revealing the dealer’s cards…' : 'Dealing the cards…';
  else if (state.phase === 'BETTING') {
    if (state.room && !state.room.bettingOpen) message = manager ? 'Invite your friends, then open betting.' : 'Waiting for the table host to open betting.';
    else message = player.ready ? 'Your wager is locked. Waiting for the other seats.' : player.sittingOut ? 'You’re sitting out this round.' : 'Make yourself comfortable. Place your bet.';
  } else if (!player.hands.length) message = 'This round is in progress. You’ll join the next betting window.';
  else if (state.phase === 'INSURANCE') message = 'Dealer shows an ace. Take insurance?';
  else if (complete) message = `${timedOut ? 'Time up. Your hand stood automatically.' : profit > 0 ? 'A good hand.' : profit === 0 ? 'All square.' : 'On to the next hand.'} ${profit > 0 ? '+' : ''}${money(profit)} chips`;
  else message = viewingOtherHand ? 'Select the playing hand to take your turn.' : ownTurn ? 'Your turn. Hit resets your 20-second timer.' : `${state.players.find(p => p.id === state.activePlayerId)?.name ?? 'Another player'} is playing. You’re up soon.`;
  const dealerReady = state.dealer.every((_, i) => (timeline.cues[dealerKey(state.roundId, i)]?.readyAt ?? 0) <= now);
  const phaseDeadline = state.room?.bettingDeadline ?? state.room?.insuranceDeadline;
  const phaseSeconds = phaseDeadline ? Math.max(0, Math.ceil((phaseDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000)) : null;
  return <div className={s.app} data-theme={theme} data-revision={state.revision} data-connection={connection.status}>
    <header className={s.header}>
      <a href="#" className={s.brand} aria-label="The Casual Table"><span className={s.brandMark}>♣</span><span>The Casual Table<small>A LITTLE BLACKJACK. A LITTLE DOWNTIME.</small></span></a>
      <div className={s.headerActions}><span className={s.practiceBadge}><i /> {connection.message}</span>{state.room && <button onClick={() => { void navigator.clipboard.writeText(location.href).then(() => setError('Invitation link copied.')).catch(() => setError(`Share this link: ${location.href}`)); }}>Invite</button>}<button ref={rulesButton} onClick={() => rulesRef.current?.showModal()}>Rules <span aria-hidden="true">↗</span></button><button onClick={() => { const value = theme === 'classic' ? 'midnight' : 'classic'; setTheme(value); writeLocal('casual-theme', value); }} aria-label={`Switch to ${theme === 'classic' ? 'Midnight' : 'Classic'} table`}>◐ <span className={s.themeText}>Themes</span></button></div>
    </header>
    <main className={s.main}>
      <div className={s.tableHeading}><div><p className={s.eyebrow}>{state.room ? `TABLE ${state.room.inviteId.slice(0, 6).toUpperCase()}` : 'YOUR OWN LITTLE CORNER'}</p><h1>{state.room ? 'The shared table' : 'The practice table'}</h1></div><div className={s.roomMeta}>{state.players.length.toString().padStart(2, '0')} / 04 seats<span>{state.room ? connection.message : 'Solo practice · Play at your own table'}</span></div></div>
      <section className={s.table} aria-label="Blackjack table">
        <div className={s.tableInner}>
          <div ref={shoeRef} className={s.shoe}><span className={s.shoeIcon} aria-hidden="true">▱</span><strong>6-DECK SHOE</strong><span>{state.shoe.remaining} cards remaining</span><small>{state.shoe.shuffleNext ? 'Shuffle before next deal' : state.shoe.shuffled ? 'Fresh shuffle this round' : 'Same shoe, next hand'}</small></div>
          <div className={s.dealer}><p className={s.seatLabel}>THE DEALER {state.dealerTotal !== null && dealerReady && <span className={s.total}>{state.dealerTotal}</span>}</p>{state.dealer.length ? <Cards cards={state.dealer} timeline={timeline} dealer shoeRef={shoeRef} reducedMotion={reducedMotion} /> : <div className={s.cardSpaces} aria-label="Dealer is waiting to deal"><span /><span /></div>}<span className={s.dealerNote}>{state.dealerTotal === null ? 'Stands on all 17' : dealerReady ? 'Hand revealed' : 'Revealing cards…'}</span></div>
          <div className={s.feltLettering} aria-hidden="true"><span>THE CASUAL TABLE</span><h2>Blackjack</h2><p>PAYS 3 TO 2</p><div>INSURANCE PAYS 2 TO 1</div></div>
          <div className={s.seats}>
            <section className={`${s.seat} ${s.ownSeat}`} aria-label="Your seat">
              <div className={s.playerHead}><span className={s.avatar}>{player.name.slice(0, 1).toUpperCase()}</span><div><strong>{player.name} <small>YOU · SEAT {player.seat + 1}</small></strong><span>{state.phase === 'BETTING' ? player.ready ? 'Wager locked' : player.sittingOut ? 'Sitting out' : 'Ready when you are' : complete ? 'Round complete' : state.phase === 'INSURANCE' ? 'Insurance decision' : ownTurn ? '▶ Your turn' : 'Waiting for your turn'}</span></div></div>
              {player.hands.length ? <div className={s.ownHands}>
                {compact && player.hands.length > 1 && <div className={s.handTabs} role="tablist" aria-label="Your hands">{player.hands.map((h, index) => <button key={h.id} role="tab" aria-selected={h.id === selectedHand} aria-controls={`hand-${h.id}`} aria-label={`Hand ${index + 1}, total ${h.total}${h.id === ownActive ? ', playing' : ''}`} onClick={() => setHandView({ active: ownActive, selected: h.id })} onKeyDown={event => {
                  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return;
                  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? player.hands.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + player.hands.length) % player.hands.length;
                  setHandView({ active: ownActive, selected: player.hands[next]!.id }); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
                }}><span>{h.id === ownActive ? '▶ ' : ''}Hand {index + 1}</span><strong>{h.total > 21 ? 'Bust' : h.total}</strong></button>)}</div>}
                <div className={s.hands}>{player.hands.map(h => <Hand key={h.id} hand={h} selected={h.id === selectedHand} active={h.id === state.activeHandId} deadline={localDeadline} presentation={presentation} shoeRef={shoeRef} />)}</div>
              </div> : <div className={s.yourEmpty}><span className={s.chipIcon}>♣</span><span>Your next good hand<br />starts here.</span></div>}
            </section>
            {[0, 1, 2, 3].filter(seat => seat !== player.seat).map(seat => {
              const other = state.players.find(p => p.seat === seat);
              return other ? <section className={`${s.seat} ${s.otherSeat}`} key={seat} aria-label={`Seat ${seat + 1}: ${other.name}`}>
                <div className={s.playerHead}><span className={s.avatar}>{other.name.slice(0, 1).toUpperCase()}</span><div><strong>{other.name} <small>SEAT {seat + 1}</small></strong><span>{other.leavingAfterRound ? 'Finishing committed hand' : other.connected === false ? other.reservationDeadline ? `Disconnected · ${Math.max(0, Math.ceil((other.reservationDeadline - (connection.clockOffsetMs ?? 0) - now) / 1000))}s reserved` : 'Disconnected' : other.ready ? 'Wager locked' : other.sittingOut ? 'Sitting out' : state.activePlayerId === other.id ? '▶ Playing' : 'At the table'}</span></div></div>
                {other.hands.length ? <div className={s.hands}>{other.hands.map(h => <Hand key={h.id} hand={h} active={h.id === state.activeHandId} deadline={localDeadline} presentation={presentation} shoeRef={shoeRef} />)}</div> : <p className={s.smallNote}>Waiting for the next hand</p>}
                <div className={s.opponentSummary} aria-label={`${other.name}'s hands`}>{other.hands.length ? other.hands.map((h, index) => <span key={h.id} className={h.id === state.activeHandId ? s.summaryActive : ''} aria-label={`Hand ${index + 1}, ${h.total > 21 ? 'bust' : h.total}${h.outcome ? `, ${h.outcome}` : ''}`}>{h.id === state.activeHandId ? '▶ ' : ''}{h.total > 21 ? 'Bust' : h.total}{h.outcome === 'win' || h.outcome === 'blackjack' ? ' ✓' : ''}</span>) : <span>Next round</span>}</div>
                <p className={s.smallNote}>{money(other.balance)} chips</p>
              </section> : <section className={`${s.seat} ${s.emptySeat}`} key={seat} aria-label={`Seat ${seat + 1} empty`}><span className={s.emptyAvatar}>+</span><strong>Open seat</strong><span>Seat {seat + 1} · {state.room ? 'Invite a friend' : 'Shared tables available'}</span></section>;
            })}
          </div>
        </div>
      </section>
      <section className={s.controls} aria-label="Game controls">
        <div className={s.balance}><span className={s.balanceChip}>♣</span><div><span>YOUR BALANCE</span><strong>{money(player.balance)} <small>chips</small></strong></div></div>
        <div className={s.controlMain}><div className={s.controlStatus}><p className={s.status} role="status" aria-live="polite">{message}</p>
          {phaseSeconds !== null && <p className={`${s.smallNote} ${s.phaseNote}`} role="timer" aria-label={state.phase === 'INSURANCE' ? 'Insurance time remaining' : 'Betting time remaining'} aria-live="off">{phaseSeconds}s remaining</p>}</div>
          <div className={s.buttons}>
            {connection.status === 'connected' && <>
            {state.phase === 'BETTING' && (!state.room || state.room.bettingOpen) && <><div className={s.betControl}><button aria-label="Decrease bet" disabled={!can('PlaceBet') || player.bet <= 20} onClick={() => void send({ type: 'PlaceBet', amount: player.bet - 20 })}>−</button><span><small>YOUR BET</small><strong>{money(player.bet)} <small>chips</small></strong></span><button aria-label="Increase bet" disabled={!can('PlaceBet') || player.bet >= 200 || player.bet + 20 > player.balance} onClick={() => void send({ type: 'PlaceBet', amount: player.bet + 20 })}>+</button></div><button className={s.primary} disabled={!can('Ready')} onClick={() => void send({ type: 'Ready' })}>{state.room ? player.ready ? 'Wager locked' : 'Ready' : 'Deal me in'} <span>↗</span></button>{state.room && <button disabled={!can('SitOut')} onClick={() => void send({ type: 'SitOut' })}>Sit out</button>}</>}
            {state.phase === 'BETTING' && state.room && !state.room.bettingOpen && manager && <button className={s.primary} disabled={!can('StartBetting')} onClick={() => void send({ type: 'StartBetting' })}>Open betting</button>}
            {state.phase === 'PLAYER_TURNS' && <><button className={s.primary} disabled={!can('Hit')} onClick={() => void send({ type: 'Hit' })}>Hit <span>＋</span></button><button className={s.stand} disabled={!can('Stand')} onClick={() => void send({ type: 'Stand' })}>Stand</button><button disabled={!can('Double')} title="Two cards and an equal extra wager required" onClick={() => void send({ type: 'Double' })}>Double</button><button disabled={!can('Split')} title="Identical ranks, enough chips, and fewer than four hands required" onClick={() => void send({ type: 'Split' })}>Split</button></>}
            {state.phase === 'INSURANCE' && <><button className={s.primary} disabled={!can('InsuranceDecision')} onClick={() => void send({ type: 'InsuranceDecision', amount: 0 })}>No insurance</button><button disabled={!can('InsuranceDecision') || player.balance < player.bet / 2} onClick={() => void send({ type: 'InsuranceDecision', amount: player.bet / 2 })}>Insure for {money(player.bet / 2)}</button></>}
            {complete && (!state.room || manager) && <button className={s.primary} disabled={!can('NextRound')} onClick={() => void send({ type: 'NextRound' })}>Next round <span>→</span></button>}
            {complete && state.room && !manager && <span className={s.smallNote}>Waiting for the host to open the next round.</span>}
            {can('Refill') && <button onClick={() => void send({ type: 'Refill' })}>Refill to 1,000</button>}
            </>}
            {state.room && connection.status === 'offline' && <button onClick={() => client.reconnect?.()}>Try reconnecting</button>}
            {state.room && connection.status !== 'connected' && <button onClick={() => onLeave()}>Create another table</button>}
          </div>
          {error && <p className={s.error} role="alert">{error}</p>}
        </div>
        <div className={s.betLimits}><span>TABLE LIMITS</span><strong>10 – 100 chips</strong><span>Blackjack pays 3:2</span></div>
      </section>
      <footer className={s.footer}><span><i /> All the fun. None of the stakes.</span>{state.room && <button className={s.leaveButton} disabled={pending || connection.status !== 'connected'} onClick={() => void send({ type: 'Leave' })}>Leave table</button>}<span>Play chips only · Round {state.roundId.toString().padStart(2, '0')}</span></footer>
    </main>
    <dialog ref={rulesRef} className={s.dialog} onClose={() => rulesButton.current?.focus()}><div className={s.dialogHeading}><span className={s.eyebrow}>SIX-DECK CLASSIC</span><button autoFocus onClick={() => rulesRef.current?.close()} aria-label="Close rules">✕</button></div><h2>A few table rules.</h2><p>Beat the dealer without going over 21. Aces count as 1 or 11. The dealer stands on every 17, including soft 17.</p><dl><dt>Blackjack</dt><dd>An unsplit ace + ten-value card pays 3:2. Regular wins pay 1:1; a push returns your bet.</dd><dt>Your turn</dt><dd>Each active hand gets 20 seconds. Hit resets the countdown to 20 seconds. If time runs out, your hand stands automatically.</dd><dt>Double</dt><dd>Double your wager on any initial two cards, including after splitting. Receive one card, then stand.</dd><dt>Split</dt><dd>Identical ranks only, up to four hands. Split aces receive one card each, then stand. Split 21 pays 1:1.</dd><dt>Insurance</dt><dd>Offered before the dealer checks an ace. Wager up to half your original bet; pays 2:1 if the dealer has blackjack.</dd><dt>The shoe</dt><dd>Six physical decks, drawn without replacement across rounds. A cut card or safety reserve triggers a shuffle before the next deal.</dd></dl><p className={s.smallNote}>{state.room ? 'This is a shared table. Reload restores your guest seat while its saved credential is available.' : 'This is solo local practice. Reloading starts a fresh table.'} Your display name and table appearance stay saved in this browser.</p></dialog>
  </div>;
}
