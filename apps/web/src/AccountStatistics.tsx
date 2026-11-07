import { useEffect, useId, useRef, useState } from 'react';
import { detailedStatisticsSchema, GAME_CATALOG, type GameStatistics } from '@casual/protocol';
import type { z } from 'zod';
import { accountRequest } from './accountRequest';
import s from './AccountStatistics.module.css';

export function statisticsChips(units: string, signed = false) {
  const value = BigInt(units); const absolute = value < 0n ? -value : value;
  const fraction = String(absolute % 100n).padStart(2, '0').replace(/0+$/, '');
  return `${value < 0n ? '−' : signed && value > 0n ? '+' : ''}${new Intl.NumberFormat('en').format(absolute / 100n)}${fraction ? `.${fraction}` : ''}`;
}
const empty: GameStatistics = {gameId:'blackjack',roundsPlayed:'0',roundsWon:'0',roundsLost:'0',roundsEven:'0',wageredUnits:'0',returnedUnits:'0',netUnits:'0',bestRoundNetUnits:'0'};
export function generalStatistics(games: GameStatistics[]):GameStatistics {
  const result={...empty};
  for(const field of ['roundsPlayed','roundsWon','roundsLost','roundsEven','wageredUnits','returnedUnits','netUnits'] as const)
    result[field]=games.reduce((sum,game)=>sum+BigInt(game[field]),0n).toString();
  result.bestRoundNetUnits=games.reduce((best,game)=>BigInt(game.bestRoundNetUnits)>best?BigInt(game.bestRoundNetUnits):best,0n).toString();
  return result;
}
function Summary({game}:{game:GameStatistics}) {
  return <dl>{[['Rounds played',game.roundsPlayed],['Won',game.roundsWon],['Lost',game.roundsLost],['Even',game.roundsEven],
    ['Chips wagered',statisticsChips(game.wageredUnits)],['Chips returned',statisticsChips(game.returnedUnits)],['Net chips',statisticsChips(game.netUnits,true)],['Best round',statisticsChips(game.bestRoundNetUnits,true)]]
    .map(([label,value])=><div key={label}><dt>{label}</dt><dd>{['Rounds played','Won','Lost','Even'].includes(label!)?new Intl.NumberFormat('en').format(BigInt(value!)):value}</dd></div>)}</dl>;
}
type Details=z.infer<typeof detailedStatisticsSchema>;
export function AccountStatisticsDialog({open,accountId:owner,onClose}:{open:boolean;accountId:string|null;onClose():void}) {
  const dialog=useRef<HTMLDialogElement>(null);const opener=useRef<HTMLElement|null>(null);const title=useId();
  const [tab,setTab]=useState('general');const [revision,setRevision]=useState(0);
  const [state,setState]=useState<{owner:string|null;data?:Details;status:'loading'|'ready'|'error'|'not-connected'}>({owner:null,status:'loading'});
  useEffect(()=>{if(open&&owner){if(!dialog.current?.open){opener.current=document.activeElement as HTMLElement|null;dialog.current?.showModal();}}
    else dialog.current?.close();},[open,owner]);
  useEffect(()=>{if(!open||!owner)return;let active=true;const abort=new AbortController();setState({owner,status:'loading'});
    void accountRequest('statistics/details?version=4',owner,detailedStatisticsSchema,'GET',abort.signal).then(data=>{if(active)setState({owner,status:'ready',data});})
      .catch(error=>{if(active)setState({owner,status:error instanceof Error&&error.message==='STATISTICS_NOT_CONNECTED'?'not-connected':'error'});});
    return()=>{active=false;abort.abort();};},[open,owner,revision]);
  const current=state.owner===owner?state:{status:'loading' as const,data:undefined}; const data=current.data;
  const selected=GAME_CATALOG.find(game=>game.id===tab); const game=tab==='general'?generalStatistics(data?.summary.games??[]):data?.summary.games.find(game=>game.gameId===tab)??{...empty,gameId:selected?.id??'blackjack'};
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={title} onClose={()=>{if(document.activeElement===document.body||dialog.current?.contains(document.activeElement))opener.current?.focus();onClose();}}>
    <header className={s.heading}><h2 id={title}>Your statistics</h2><button aria-label="Close statistics" onClick={()=>dialog.current?.close()}>×</button></header>
    <p className={s.note}>Saved-chip games only. Temporary play isn’t recorded.</p>
    <div className={s.tabs} role="tablist" aria-label="Statistics categories">{[{id:'general',name:'General'},...GAME_CATALOG].map(item=><button key={item.id} role="tab" aria-selected={tab===item.id} onClick={()=>setTab(item.id)}>{item.name}</button>)}</div>
    {open&&owner&&<>
      {current.status==='loading'&&<p role="status">Loading statistics…</p>}
      {current.status==='error'&&<p role="alert">Your statistics could not be loaded. Please try again.</p>}
      {current.status==='not-connected'&&<p role="status">Statistics are not connected yet.</p>}
      {current.status==='ready'&&data&&<section className={s.game} role="tabpanel" aria-label={`${selected?.name??'General'} statistics`}>
        <h3>{selected?.name??'All games'}</h3>
        {selected?.status==='coming-soon'?<p>This game is coming soon. Its statistics will be available when it launches.</p>:<>
          {!data.summary.games.length&&<p>No saved rounds yet. Your results will appear here after you play with saved chips.</p>}
          <Summary game={game}/>
          {tab==='general'&&<p>Games played: {data.summary.games.filter(g=>BigInt(g.roundsPlayed)>0n).length}</p>}
          {tab==='blackjack'&&<><h3>Blackjack details</h3><p className={s.note}>Detailed counters cover {data.blackjack.trackedRounds} rounds recorded since this feature was enabled.</p>
            <dl>{([['Hands played','hands'],['Hands won','wins'],['Hands lost','losses'],['Hands pushed','pushes'],['Natural blackjacks','blackjacks'],['Busts','busts'],['Doubles','doubles'],['Splits','splits'],['Insurance bets','insuranceTaken'],['Insurance wins','insuranceWon']] as const)
              .map(([label,key])=><div key={key}><dt>{label}</dt><dd>{new Intl.NumberFormat('en').format(BigInt(data.blackjack[key]))}</dd></div>)}</dl></>}
          {tab==='baccarat'&&(data.baccarat?<><h3>Baccarat details</h3><p className={s.note}>No-commission rules. Each round counts once across main, Tie and side bets. Chip totals include every bet.</p><dl>{[['Player bets',data.baccarat.playerBets],['Banker bets',data.baccarat.bankerBets],['Tie bets',data.baccarat.tieBets],['Winning Tie bets',data.baccarat.tieWins],['Banker wins on six',data.baccarat.bankerSixWins],['Commission paid',statisticsChips(data.baccarat.commissionUnits)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>:<p>Baccarat detail tracking needs the latest database setup.</p>)}
          {tab==='roulette'&&(data.roulette?<><h3>Roulette details</h3><dl><div><dt>Straight-up wins</dt><dd>{data.roulette.straightUpWins}</dd></div></dl><p className={s.note}>Each spin counts once across all your bets.</p></>:<p>Roulette detail tracking needs the latest database setup.</p>)}
          {tab==='crash'&&(data.crash?<><h3>Crash details</h3><dl>{[['Successful cash-outs',data.crash.cashouts],['Wagers lost to crashes',data.crash.crashes],['Highest cash-out',`${(Number(data.crash.highestCashoutCents)/100).toFixed(2)}×`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>:<p>Crash detail tracking needs the latest database setup.</p>)}
          <p className={s.note}>{tab==='blackjack'?'Each round includes all your hands and insurance. ':''}Results update after the round is saved.</p>
        </>}
      </section>}
      <button className={s.refresh} disabled={current.status==='loading'} onClick={()=>setRevision(value=>value+1)}>{current.status==='error'||current.status==='not-connected'?'Retry statistics':'Refresh statistics'}</button>
    </>}
  </dialog>;
}
