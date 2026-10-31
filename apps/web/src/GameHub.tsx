import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GAME_CATALOG, type LobbyVisibility, type PublicLobby } from '@casual/protocol';
import { createAccountTable, createGuest, lastTable, listLobbies, rememberSession } from './onlineClient';
import s from './GameHub.module.css';
import { AccountControls } from './AccountControls';
import { BuyInFields, GuestIdentityFields, useTableFunding, useTableIdentity } from './TableIdentity';
import tableStyles from './App.module.css';

export function GameHub({ browse = false }: { browse?: boolean }) {
  const recent = lastTable();
  const identity = useTableIdentity();
  return <div className={s.hub}>
    <header className={s.header}><a className={s.brand} href="#/games"><span aria-hidden="true">♣</span><span>The Usual Table</span></a>{recent ? <a className={s.returnTable} href={`#/room/${recent.inviteId}`}>Return to your last table ↗</a> : <span className={s.tagline}>ALL THE FUN. NONE OF THE STAKES.</span>}<AccountControls beforeSignIn={identity.saveDraft} /></header>
    {browse ? <LobbyBrowser identity={identity} /> : <main className={s.main}>
      <p className={s.eyebrow}>GOOD GAMES. EASY COMPANY.</p><h1>A game for every table.</h1><p className={s.intro}>Pick your game. Bring your friends. Nothing on the line.</p>
      <div className={s.catalog} role="region" aria-label="Game catalog" tabIndex={0}>{GAME_CATALOG.map(game => <article key={game.id} className={s.game} data-game={game.id} aria-label={game.name}>
        <div className={s.art} aria-hidden="true"><span>{game.symbol}</span><i>{game.badge}</i></div>
        <div className={s.gameHeading}><h2>{game.name}</h2><span>{game.status === 'available' ? 'PLAY NOW' : 'COMING SOON'}</span></div><p>{game.description}</p>
        {game.status === 'available' ? <div className={s.gameLinks}><a className={s.primary} href={`#/games/${game.id}`}>Find a Table <span aria-hidden="true">↗</span></a></div> : <span className={s.soon}>More good hands ahead.</span>}
      </article>)}</div>
    </main>}
    <footer className={s.footer}>Play chips only · No purchases. No cash value.</footer>
  </div>;
}

function LobbyBrowser({ identity }: { identity: ReturnType<typeof useTableIdentity> }) {
  const funding = useTableFunding();
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
      const response = funding.saved ? await createAccountTable(seat.name, seat.icon, visibility, funding.units, funding.entryId) : await createGuest(seat.name, seat.icon, visibility);
      rememberSession(response.session); location.hash = `/room/${response.session.inviteId}`;
    } catch (problem) { setCreateError(problem instanceof Error ? problem.message : 'Your table could not be created. Please retry.'); }
    finally { creating.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true; let controller: AbortController | undefined;
    async function update() {
      controller?.abort(); const request = new AbortController(); controller = request; setLoading(true);
      try { const next = await listLobbies(request.signal); if (active && !request.signal.aborted) { setLobbies(next); setError(''); } }
      catch (problem) { if (active && !request.signal.aborted) setError(problem instanceof Error ? problem.message : 'Tables could not be loaded.'); }
      finally { if (active && !request.signal.aborted) setLoading(false); }
    }
    void update(); const interval = setInterval(() => { if (document.visibilityState === 'visible') void update(); }, 15_000);
    return () => { active = false; controller?.abort(); clearInterval(interval); };
  }, [refresh]);
  return <main className={s.browser}>
    <a className={s.back} href="#/games">← All games</a>
    <div className={s.browserHeading}><div><p className={s.eyebrow}>BLACKJACK</p><h1>Find a Table</h1></div><button disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh public tables">{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    <p className={s.intro}>Join a public table or create your own. A private table works for one player or a group of friends.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    {!error && !loading && !lobbies.length && <p className={s.empty}>No public tables are open right now. Start one and invite some company.</p>}
    <div className={s.lobbyList} aria-label="Public Blackjack tables" aria-busy={loading}>
      {lobbies.map(lobby => <article key={lobby.roomId} className={s.lobby}><div><h2>{lobby.hostName}’s table</h2><p>{lobby.players}/{lobby.capacity} seats · {lobby.phase === 'waiting' ? 'Waiting to play' : 'Round in progress · Join next hand'}</p></div><a href={`#/room/${lobby.roomId}`} aria-label={`Join ${lobby.hostName}’s table`}>Join table ↗</a></article>)}
    </div>
    <div className={s.browserActions}><button className={s.primary} ref={createButton} onClick={() => { setCreateError(''); createDialog.current?.showModal(); }}>Create a table</button><span>Public tables are listed here. Private tables are shared by invitation.</span></div>
    <dialog ref={createDialog} className={`${tableStyles.dialog} ${s.createDialog}`} aria-labelledby="create-table-title"
      onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { identity.saveDraft(); createButton.current?.focus(); }}>
      <div className={tableStyles.dialogHeading}><h2 id="create-table-title">Create a table</h2><button disabled={busy} aria-label="Close create table" onClick={() => createDialog.current?.close()}>×</button></div>
      <p>Play on your own or invite friends to join.</p>
      <form className={tableStyles.nameForm} onSubmit={event => { void create(event); }}>
        <GuestIdentityFields identity={identity} disabled={busy} />
        <BuyInFields funding={funding} disabled={busy} />
        <div className={tableStyles.iconPicker}><label htmlFor="table-visibility">Table visibility</label><select id="table-visibility" value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as LobbyVisibility)}>
          <option value="private">Private · Invite only</option><option value="public">Public · Listed</option>
        </select></div>
        {createError && <p role="alert">{createError}</p>}
        <button className={tableStyles.primary} type="submit" disabled={busy || !identity.ready || !funding.valid}>{busy ? 'Creating…' : 'Create table'}</button>
      </form>
    </dialog>
  </main>;
}
