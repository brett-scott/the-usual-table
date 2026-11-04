import { useEffect,useState,type FormEvent,type ReactNode } from 'react';
import type { GameClientAdapter,TableClient,TableInfo } from '@casual/protocol';
import { ApiError,createTableClient,forgetSession,joinGameTable,resumeTableSession,savedSession } from './onlineClient';
import { AccountControls } from './AccountControls';
import { BuyInFields,GuestIdentityFields,useTableFunding,useTableIdentity } from './TableIdentity';
import s from './App.module.css';

/** One invitation, guest/account entry, resume and exit flow for all game views. */
export function GameRoomEntry<S,A>({invite,info,adapter,gameName,art,intro,footer,seatHint,children}:{
  invite:string;info:TableInfo;adapter:GameClientAdapter<S,A>;gameName:string;art?:ReactNode;intro?:string;footer?:ReactNode;seatHint?:string;
  children(client:TableClient<S,A>,onLeave:(endSession?:boolean)=>void):ReactNode;
}){
  const identity=useTableIdentity();const funding=useTableFunding(info);const [client,setClient]=useState<TableClient<S,A>|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [entryErrorCode,setEntryErrorCode]=useState('');
  useEffect(()=>()=>client?.dispose(),[client]);
  function showError(problem:unknown){setError(problem instanceof Error?problem.message:'The table could not be opened.');setEntryErrorCode(problem instanceof ApiError?problem.code:'REQUEST_FAILED');}
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
  return client?children(client,leave):<div className={s.welcome}>
    <div className={s.welcomeNav}><div className={s.welcomeBrand}><span className={s.brandMark}>♣</span><span>The Usual Table</span></div><a href="#/games">All games ↗</a><AccountControls beforeSignIn={identity.saveDraft}/></div>
    <main className={s.welcomeMain}>
      {art&&<div className={s.welcomeArt} aria-hidden="true">{art}</div>}
      <p className={s.eyebrow}>YOU’RE INVITED TO THE TABLE</p><h1>A seat at the table.<br/><em>Nothing on the line.</em></h1>
      <p className={s.welcomeCopy}>{intro??`Join your friends for ${gameName}. No account required, no real money.`}</p>
      <form onSubmit={event=>{void enter(event);}} className={s.nameForm}>
        <GuestIdentityFields identity={identity} disabled={busy}/><BuyInFields funding={funding} disabled={busy}/>
        {error&&<div className={s.entryProblem} role="alert" data-error-code={entryErrorCode}><h2>{entryErrorCode==='TABLE_FULL'?'Table full':entryErrorCode==='ROOM_EXPIRED'?'Table expired':['SESSION_INVALID','SESSION_EXPIRED'].includes(entryErrorCode)?'Seat unavailable':entryErrorCode==='OFFLINE'?'Connection unavailable':'Couldn’t open this table'}</h2><p>{error}</p><span>Find another table or create your own.</span></div>}
        <button className={s.primary} type="submit" disabled={busy||!identity.ready||!funding.valid}>{busy?'Connecting…':'Join table'}</button>
        <a className={s.secondary} href={`#/games/${info.gameId}`}>Find or create another table</a>
      </form>
      <p className={s.smallNote}>Play chips only · {seatHint??`Up to ${info.capacity} players`}</p>
    </main>
    {footer&&<footer className={s.welcomeFooter}>{footer}</footer>}
  </div>;
}
