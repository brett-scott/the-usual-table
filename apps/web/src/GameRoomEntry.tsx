import { useEffect,useState,useSyncExternalStore,type FormEvent,type ReactNode } from 'react';
import type { TableClient,TableInfo } from '@casual/protocol';
import { ApiError,createTableClient,forgetSession,joinGameTable,resumeTableSession,savedSession } from './onlineClient';
import { AccountControls } from './AccountControls';
import { TableRecovery } from './TableRecovery';
import { BuyInFields,GuestIdentityFields,useTableFunding,useTableIdentity } from './TableIdentity';
import type { RoomGameClientAdapter } from './gameClientAdapters';
import { TableWaitingContext } from './TableChrome';
import { useTableActions,type TableActions } from './useTableActions';
import s from './App.module.css';

type RoomView<S,A> = (client:TableClient<S,A>,onLeave:(endSession?:boolean)=>void,actions:TableActions<A>)=>ReactNode;

function SeatedGameRoom<S,A extends {type:string}>({client,adapter,gameName,onLeave,children}:{
  client:TableClient<S,A>;adapter:RoomGameClientAdapter<S,A>;gameName:string;onLeave:(endSession?:boolean)=>void;
  children:RoomView<S,A>;
}){
  const snapshot=useSyncExternalStore(client.subscribe,client.getSnapshot);
  const connection=useSyncExternalStore(client.subscribe,client.getConnection);
  const actions=useTableActions(client,onLeave);
  const round=connection.status==='connected'?adapter.roundStart(snapshot):null;
  const start=round?.isHost?{
    label:round.label,
    disabled:!round.allowed||actions.busy,
    error:actions.startError,
    onStart:()=>void actions.send(round.action,'start'),
  }:undefined;
  const tableActions={...actions,error:actions.error||(!start?actions.startError:'')};
  return <TableWaitingContext.Provider value={round?{gameName,start}:null}>
    {children(client,onLeave,tableActions)}
  </TableWaitingContext.Provider>;
}

/** One invitation, guest/account entry, resume and exit flow for all game views. */
export function GameRoomEntry<S,A extends {type:string}>({invite,info,adapter,gameName,art,intro,footer,seatHint,children}:{
  invite:string;info:TableInfo;adapter:RoomGameClientAdapter<S,A>;gameName:string;art?:ReactNode;intro?:string;footer?:ReactNode;seatHint?:string;
  children:RoomView<S,A>;
}){
  const identity=useTableIdentity();const funding=useTableFunding(info);const [client,setClient]=useState<TableClient<S,A>|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [entryErrorCode,setEntryErrorCode]=useState('');
  useEffect(()=>()=>client?.dispose(),[client]);
  function showError(problem: unknown) {
    const code = problem instanceof ApiError ? problem.code : 'REQUEST_FAILED';
    if (code === 'ROOM_EXPIRED') forgetSession(invite);
    setError(problem instanceof Error ? problem.message : 'The table could not be opened.');
    setEntryErrorCode(code);
  }
  useEffect(()=>{
    const session=savedSession(invite);if(!session||session.funding==='account'&&!identity.accountId)return;
    let active=true;const abort=new AbortController();setBusy(true);
    void resumeTableSession(session,adapter,abort.signal).then(response=>{if(active)setClient(createTableClient(response,adapter));})
      .catch(problem=>{if(active)showError(problem);}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;abort.abort();};
  },[invite,identity.accountId,adapter]);
  async function enter(event:FormEvent){
    event.preventDefault();if(busy||!identity.ready||!funding.valid)return;
    const seat=identity.validate();if(!seat){setError('Enter a name of 1–24 characters.');return;}
    identity.saveDraft();setBusy(true);setError('');setEntryErrorCode('');
    try{const response=await joinGameTable(adapter,invite,{name:seat.name,icon:seat.icon,...(funding.saved?{funding:'account' as const,buyInUnits:funding.units,entryId:funding.entryId}:{})});setClient(createTableClient(response,adapter));}
    catch(problem){showError(problem);}finally{setBusy(false);}
  }
  function leave(endSession=false){if(endSession)forgetSession(invite);client?.dispose();location.hash=endSession?'/games':`/games/${info.gameId}`;}
  if (entryErrorCode === 'ROOM_EXPIRED') return <TableRecovery state="expired" browseHref={`#/games/${info.gameId}`} />;
  return client?<SeatedGameRoom client={client} adapter={adapter} gameName={gameName} onLeave={leave}>{children}</SeatedGameRoom>:<div className={s.welcome}>
    <div className={s.welcomeNav}><div className={s.welcomeBrand}><span className={s.brandMark}>♣</span><span>The Usual Table</span></div><a href="#/games">All games ↗</a><AccountControls beforeSignIn={identity.saveDraft}/></div>
    <main className={s.welcomeMain}>
      {art&&<div className={s.welcomeArt} aria-hidden="true">{art}</div>}
      <p className={s.eyebrow}>YOU’RE INVITED TO THE TABLE</p><h1>A seat at the table.<br/><em>Nothing on the line.</em></h1>
      <p className={s.welcomeCopy}>{intro??`Join your friends for ${gameName}. No account required, no real money.`}</p>
      <form onSubmit={event=>{void enter(event);}} className={s.nameForm}>
        <GuestIdentityFields identity={identity} disabled={busy}/><BuyInFields funding={funding} disabled={busy}/>
        {error&&<div className={s.entryProblem} role="alert" data-error-code={entryErrorCode}><h2>{entryErrorCode==='TABLE_FULL'?'Table full':['SESSION_INVALID','SESSION_EXPIRED'].includes(entryErrorCode)?'Seat unavailable':entryErrorCode==='OFFLINE'?'Connection unavailable':'Couldn’t open this table'}</h2><p>{error}</p><span>Find another table or create your own.</span></div>}
        <button className={s.primary} type="submit" disabled={busy||!identity.ready||!funding.valid}>{busy?'Connecting…':'Join table'}</button>
        <a className={s.secondary} href={`#/games/${info.gameId}`}>Find or create another table</a>
      </form>
      <p className={s.smallNote}>Play chips only · {seatHint??`Up to ${info.capacity} players`}</p>
    </main>
    {footer&&<footer className={s.welcomeFooter}>{footer}</footer>}
  </div>;
}
