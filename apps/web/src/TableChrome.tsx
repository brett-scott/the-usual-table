import { createContext, useContext, type ReactNode } from 'react';
import type { ConnectionInfo } from '@casual/protocol';
import { TableChat,type TableChatClient } from './TableChat';
import { TableInvite } from './TableInvite';
import { AccountControls } from './AccountControls';
import s from './App.module.css';
import w from './TableWaitingOverlay.module.css';
import { useProfileTable } from './PlayerProfiles';
import {useCollection} from './Collection';

interface TableWaitingProps {
  gameName:string;
  start?:{label:string;disabled:boolean;error:string;onStart():void};
}

export const TableWaitingContext = createContext<TableWaitingProps | null>(null);

/** Common table controls; game menus and decision timing are supplied by its view. */
export function TableHeader({client,playerId,online,ownTurn,seconds,decisionLabel,showAccountSignIn=false,children}:{
  client:TableChatClient;playerId:string;online:boolean;ownTurn:boolean;seconds:number|null;decisionLabel?:string;showAccountSignIn?:boolean;children?:ReactNode;
}){
  useProfileTable({client,online,you:playerId,ownTurn,seconds,label:decisionLabel??'round'});
  const collection=useCollection();
  const waiting = useContext(TableWaitingContext);
  return <><header className={s.header}><a href="#" className={s.brand} aria-label="The Usual Table"><span className={s.brandMark}>♣</span><span>The Usual Table</span></a>
    <div className={s.headerActions}>
      {online&&<TableChat client={client} playerId={playerId} ownTurn={ownTurn} seconds={seconds} decisionLabel={decisionLabel}/>}
      {online&&<TableInvite/>}{children}<button aria-label="Your collection" title="Your collection" onClick={()=>collection.open()}>♧</button><AccountControls compact signedInOnly={!showAccountSignIn}/>
    </div>
  </header>{waiting&&<TableWaitingOverlay {...waiting}/>}</>;
}
export function TableToolbar({connection,leaveDisabled,onLeave}:{connection:ConnectionInfo;leaveDisabled:boolean;onLeave():void}){
  return <div className={s.tableToolbar}>
    <span className={s.connectionBadge} data-status={connection.status}><i aria-hidden="true"/>{connection.status==='connected'?'Connected':connection.message}</span>
    <button className={s.leaveButton} disabled={leaveDisabled} onClick={onLeave}>Leave table <span aria-hidden="true">↗</span></button>
  </div>;
}

function TableWaitingOverlay({gameName,start}:TableWaitingProps){
  return <div className={w.overlay}>
    <section className={w.prompt} aria-label={`${gameName} round status`}>
      <h2>{start?'Waiting to start':'Waiting for Host'}</h2>
      {start&&<button type="button" disabled={start.disabled} onClick={start.onStart}>{start.label}</button>}
      {start?.error&&<p className={w.error} role="alert">{start.error}</p>}
    </section>
  </div>;
}
