import { useEffect,useRef,useState,type FormEvent } from 'react';
import { GAME_CATALOG,type GameId,type LobbyVisibility,type PublicLobby } from '@casual/protocol';
import { AccountControls } from './AccountControls';
import { CreateTableDialog } from './CreateTableDialog';
import { GameArtwork } from './GameArtwork';
import { gameEntries } from './gameEntries';
import { listLobbies,rememberSession } from './onlineClient';
import { useTableFunding,type useTableIdentity } from './TableIdentity';
import s from './GameLobbyDialog.module.css';

export function GameLobbyDialog({identity,gameId,onClose}:{identity:ReturnType<typeof useTableIdentity>;gameId:GameId;onClose():void}){
  const entry=gameEntries[gameId]!,game=GAME_CATALOG.find(game=>game.id===gameId)!;
  const funding=useTableFunding(entry.rules);
  const dialog=useRef<HTMLDialogElement>(null),creation=useRef<HTMLDialogElement>(null),createButton=useRef<HTMLButtonElement>(null);
  const switching=useRef(false),creating=useRef(false);
  const [panel,setPanel]=useState<'browse'|'create'>('browse'),[visibility,setVisibility]=useState<LobbyVisibility>('private');
  const [lobbies,setLobbies]=useState<PublicLobby[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [busy,setBusy]=useState(false),[createError,setCreateError]=useState('');

  useEffect(()=>{
    if(panel==='browse')dialog.current?.showModal();
    else {dialog.current?.close();creation.current?.showModal();}
  },[panel]);

  useEffect(()=>{
    if(panel!=='browse')return;
    let active=true,request:AbortController|undefined;
    async function update(){
      request?.abort();const nextRequest=new AbortController();request=nextRequest;setLoading(true);
      try{const next=await listLobbies(nextRequest.signal,gameId);if(active&&!nextRequest.signal.aborted){setLobbies(next);setError('');}}
      catch(problem){if(active&&!nextRequest.signal.aborted)setError(problem instanceof Error?problem.message:'Tables could not be loaded.');}
      finally{if(active&&!nextRequest.signal.aborted)setLoading(false);}
    }
    void update();const interval=setInterval(()=>{if(document.visibilityState==='visible')void update();},15000);
    return()=>{active=false;request?.abort();clearInterval(interval);};
  },[gameId,panel,refresh]);

  function openCreation(){identity.saveDraft();setCreateError('');switching.current=true;setPanel('create');}
  function backToTables(){identity.saveDraft();switching.current=false;setPanel('browse');}
  async function create(event:FormEvent){
    event.preventDefault();if(creating.current||!identity.ready||!funding.valid)return;
    const seat=identity.validate();if(!seat){setCreateError('Enter a name of 1–24 characters.');return;}
    creating.current=true;setBusy(true);setCreateError('');identity.saveDraft();
    try{
      const response=await entry.create({name:seat.name,icon:seat.icon,visibility,...(funding.saved?{funding:'account' as const,buyInUnits:funding.units,entryId:funding.entryId}:{})});
      rememberSession(response.session);location.hash=`/room/${response.session.inviteId}`;
    }catch(problem){setCreateError(problem instanceof Error?problem.message:'Your table could not be created. Please retry.');}
    finally{creating.current=false;setBusy(false);}
  }

  return <>
    <dialog ref={dialog} className={s.dialog} aria-labelledby={`lobbies-${gameId}`} onClose={()=>{if(!switching.current)onClose();}}>
      <header className={s.header}>
        <div className={s.heading}><span className={s.gameArt} data-game={gameId}><GameArtwork gameId={gameId}/></span><div><p>{game.name}</p><h2 id={`lobbies-${gameId}`}>Find a Table</h2></div></div>
        <a className={s.close} href="#/games" aria-label="All games" title="Close table browser">×</a>
      </header>
      <div className={s.account}><AccountControls showWallet beforeSignIn={identity.saveDraft}/></div>
      <div className={s.listHeading}><h3>Public tables</h3><button type="button" aria-label="Refresh public tables" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{loading?'Refreshing…':'Refresh'}</button></div>
      <div className={s.list} role="region" aria-label={`Public ${game.name} tables`} aria-busy={loading}>
        {error?<p className={s.error} role="alert">{error}</p>:!lobbies.length?<p className={s.empty} role={loading?'status':undefined}>{loading?'Loading tables…':'No open tables yet.'}</p>:lobbies.map(lobby=><article key={lobby.roomId} className={s.lobby}>
          <div><h4>{lobby.hostName}’s table</h4><p>{lobby.players}/{lobby.capacity} players · {lobby.phase==='waiting'?'Waiting':'Round in progress'}</p></div>
          <a href={`#/room/${lobby.roomId}`} aria-label={`Join ${lobby.hostName}’s table`}>Join table <span aria-hidden="true">↗</span></a>
        </article>)}
      </div>
      <footer className={s.footer}>
        <fieldset className={s.visibility}><legend>New table</legend>{(['public','private'] as const).map(value=><label key={value} data-selected={visibility===value}>
          <input type="radio" name={`new-table-${gameId}`} value={value} checked={visibility===value} aria-label={value==='public'?'Public':'Private'} onChange={()=>setVisibility(value)}/>
          <span>{value==='public'?'Public':'Private'}</span><small>{value==='public'?'Listed for everyone':'Invite only'}</small>
        </label>)}</fieldset>
        <button type="button" className={s.create} ref={createButton} onClick={openCreation}>Create a table <span aria-hidden="true">↗</span></button>
      </footer>
    </dialog>
    <CreateTableDialog gameName={game.name} dialogRef={creation} identity={identity} funding={funding} busy={busy} error={createError} visibility={visibility} onSubmit={event=>{void create(event);}} onClose={()=>{backToTables();requestAnimationFrame(()=>createButton.current?.focus());}}/>
  </>;
}
