import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GAME_CATALOG,type GameId, type LobbyVisibility, type PublicLobby } from '@casual/protocol';
import { lastTable, listLobbies, rememberSession } from './onlineClient';
import { gameEntries } from './gameEntries';
import s from './GameHub.module.css';
import { AccountControls } from './AccountControls';
import { useTableFunding, useTableIdentity } from './TableIdentity';
import { CreateTableDialog } from './CreateTableDialog';
import { GameArtwork } from './GameArtwork';

const galleryDetails:Partial<Record<GameId,{category:string;short:string}>>={
  blackjack:{category:'The card table',short:'Find your twenty-one.'},
  baccarat:{category:'The card table',short:'Player. Banker. Tie.'},
  roulette:{category:'The wheel',short:'One wheel. Your numbers.'},
  'duck-race':{category:'The race',short:'Pick your duck.'},
  crash:{category:'The multiplier',short:'Choose your moment.'},
};

export function GameHub({ browse = false,gameId='blackjack' }: { browse?: boolean;gameId?:GameId }) {
  const recent = lastTable();
  const identity = useTableIdentity();
  return <div className={s.hub}>
    <header className={s.header}><a className={s.brand} href="#/games"><span aria-hidden="true">♣</span><span>The Usual Table</span></a><AccountControls showWallet beforeSignIn={identity.saveDraft} /></header>
    {browse ? gameEntries[gameId]&&GAME_CATALOG.find(game=>game.id===gameId)?.status==='available'?<LobbyBrowser identity={identity} gameId={gameId}/>:<main className={s.main}><h1>This game is coming soon.</h1><a href="#/games">All games</a></main> : <main className={s.main}>
      <div className={s.heading}><div><p className={s.eyebrow}>THE GAME ROOM</p><h1>Take your pick.</h1></div>{recent&&<a className={s.returnTable} href={`#/room/${recent.inviteId}`}>Return to your last table <span aria-hidden="true">↗</span></a>}</div>
      <div className={s.catalog} role="region" aria-label="Game catalog" tabIndex={0}>{GAME_CATALOG.filter(game=>game.status==='available'&&gameEntries[game.id]).map(game => <article key={game.id} className={s.game} data-game={game.id} aria-label={game.name}>
        <div className={s.art} aria-hidden="true"><GameArtwork gameId={game.id}/><span className={s.artNumber}>{game.badge}</span></div>
        <div className={s.gameCopy}><p className={s.category}>{galleryDetails[game.id]?.category??'The game room'}</p><h2>{game.name}</h2><p className={s.description}>{galleryDetails[game.id]?.short??game.description}</p>
        <a className={s.findLink} href={`#/games/${game.id}`}>Find a Table <span aria-hidden="true">↗</span></a></div>
      </article>)}</div>
    </main>}
  </div>;
}

function LobbyBrowser({ identity,gameId }: { identity: ReturnType<typeof useTableIdentity>;gameId:GameId }) {
  const entry=gameEntries[gameId]!;const game=GAME_CATALOG.find(game=>game.id===gameId)!;
  const funding = useTableFunding(entry.rules);
  const [lobbies, setLobbies] = useState<PublicLobby[]>([]); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [refresh, setRefresh] = useState(0);
  const createDialog = useRef<HTMLDialogElement>(null); const createButton = useRef<HTMLButtonElement>(null);
  const creating = useRef(false); const [busy, setBusy] = useState(false); const [createError, setCreateError] = useState('');
  const [visibility, setVisibility] = useState<LobbyVisibility>('private');
  async function create(event: FormEvent) {
    event.preventDefault(); if (creating.current || !identity.ready || !funding.valid) return;
    const seat = identity.validate(); if (!seat) { setCreateError('Enter a name of 1–24 characters.'); return; }
    creating.current = true; setBusy(true); setCreateError(''); identity.saveDraft();
    try {
      const response = await entry.create({name:seat.name,icon:seat.icon,visibility,...(funding.saved?{funding:'account' as const,buyInUnits:funding.units,entryId:funding.entryId}:{})});
      rememberSession(response.session); location.hash = `/room/${response.session.inviteId}`;
    } catch (problem) { setCreateError(problem instanceof Error ? problem.message : 'Your table could not be created. Please retry.'); }
    finally { creating.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true; let controller: AbortController | undefined;
    async function update() {
      controller?.abort(); const request = new AbortController(); controller = request; setLoading(true);
      try { const next = await listLobbies(request.signal,gameId); if (active && !request.signal.aborted) { setLobbies(next); setError(''); } }
      catch (problem) { if (active && !request.signal.aborted) setError(problem instanceof Error ? problem.message : 'Tables could not be loaded.'); }
      finally { if (active && !request.signal.aborted) setLoading(false); }
    }
    void update(); const interval = setInterval(() => { if (document.visibilityState === 'visible') void update(); }, 15_000);
    return () => { active = false; controller?.abort(); clearInterval(interval); };
  }, [refresh,gameId]);
  return <main className={s.browser}>
    <a className={s.back} href="#/games">← All games</a>
    <div className={s.browserHeading}><div><p className={s.eyebrow}>{game.name.toUpperCase()}</p><h1>Find a Table</h1></div><button disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh public tables">{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    <p className={s.intro}>Join a public table or create your own. A private table works for one player or a group of friends.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    {!error && !loading && !lobbies.length && <p className={s.empty}>No public tables are open right now. Start one and invite some company.</p>}
    <div className={s.lobbyList} aria-label={`Public ${game.name} tables`} aria-busy={loading}>
      {lobbies.map(lobby => <article key={lobby.roomId} className={s.lobby}><div><h2>{lobby.hostName}’s table</h2><p>{lobby.players}/{lobby.capacity} seats · {lobby.phase === 'waiting' ? 'Waiting to play' : 'Round in progress · Join next hand'}</p></div><a href={`#/room/${lobby.roomId}`} aria-label={`Join ${lobby.hostName}’s table`}>Join table ↗</a></article>)}
    </div>
    <div className={s.browserActions}><button className={s.primary} ref={createButton} onClick={() => { setCreateError(''); createDialog.current?.showModal(); }}>Create a table</button><span>Public tables are listed here. Private tables are shared by invitation.</span></div>
    <CreateTableDialog gameName={game.name} dialogRef={createDialog} identity={identity} funding={funding} busy={busy} error={createError}
      visibility={visibility} onVisibilityChange={setVisibility} onSubmit={event => { void create(event); }}
      onClose={() => { identity.saveDraft(); createButton.current?.focus(); }} />
  </main>;
}

