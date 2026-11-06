import { useEffect,useId,useLayoutEffect,useRef,useState } from 'react';
import { BACCARAT_HISTORY_LIMIT,seedBaccaratRoadmap,type BaccaratSnapshot,type BaccaratRoadmap } from '@casual/protocol';
import { beadPlate,bigRoad,type RoadCell } from './baccaratRoadmap';
import s from './BaccaratScoreboard.module.css';
const name=(side:string)=>side==='player'?'Player':side==='banker'?'Banker':'Tie';
function description(cell:RoadCell){return `Round ${cell.result.roundId}: ${name(cell.result.outcome)}, Player ${cell.result.playerTotal}, Banker ${cell.result.bankerTotal}${cell.ties?`, ${cell.ties} ${cell.ties===1?'tie':'ties'} on this cell`:''}`;}
function Road({results,kind,compact=false}:{results:BaccaratRoadmap['results'];kind:'bead'|'big';compact?:boolean}){
 const id=useId();const scroller=useRef<HTMLDivElement>(null);const cells=kind==='bead'?beadPlate(results):bigRoad(results);
 const occupiedColumns=Math.max(0,...cells.map(c=>c.column+1));const columns=Math.max(compact?12:16,occupiedColumns);const latest=results[0]?.roundId;
 useLayoutEffect(()=>{const el=scroller.current;if(!el)return;const update=()=>{el.scrollLeft=Math.max(0,occupiedColumns*22-el.clientWidth);};update();const observer=new ResizeObserver(update);observer.observe(el);return()=>observer.disconnect();},[latest,kind,occupiedColumns]);
 return <><div ref={scroller} className={s.scroll} tabIndex={0} aria-label={`${kind==='bead'?'Bead Plate':'Big Road'} history, scroll horizontally for earlier rounds`}>
  <svg className={s.road} role="img" aria-label={kind==='bead'?'Bead Plate':'Big Road'} viewBox={`0 0 ${columns*22} 132`} style={{width:columns*22}}>
   <defs><pattern id={id} width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 H 0 V 22" fill="none" stroke="#d4cebe" strokeWidth="1"/></pattern></defs>
   <rect width="100%" height="100%" fill="#f6f1e5"/><rect width="100%" height="100%" fill={`url(#${id})`}/>
   {cells.map(cell=><g key={`${cell.column}-${cell.row}`} transform={`translate(${cell.column*22+11} ${cell.row*22+11})`} data-outcome={cell.result.outcome} data-road-cell role="img" aria-label={description(cell)}>
    <title>{description(cell)}</title>
    <circle r="7.5" className={kind==='bead'?s.bead:s.ring} data-side={cell.leadingTie?'tie':cell.result.outcome}/>
    <text className={kind==='bead'?s.beadLabel:s.ringLabel} data-side={cell.result.outcome} textAnchor="middle" y="3">{cell.leadingTie?'T':cell.result.outcome==='player'?'P':cell.result.outcome==='banker'?'B':'T'}</text>
    {kind==='big'&&cell.ties>0&&<><path className={s.tieMark} d="M -7 7 L 7 -7"/>{cell.ties>1&&<text className={s.tieCount} x="7" y="-6" textAnchor="middle">{cell.ties}</text>}</>}
   </g>)}
  </svg>
 </div>{!results.length&&<p className={s.empty}>Completed rounds will appear here.</p>}</>;
}
function Totals({data,compact=false}:{data:BaccaratRoadmap;compact?:boolean}){
 return <div className={s.totals} data-compact={compact}>{([['banker',data.bankerWins],['player',data.playerWins],['tie',data.ties]] as const).map(([side,total])=><div key={side} data-side={side}><span>{name(side)}</span><strong>{total.toLocaleString()}</strong><small>{data.completedHands?`${(total/data.completedHands*100).toFixed(1)}%`:'0%'}</small></div>)}</div>;
}
export function BaccaratScoreboard({state}:{state:BaccaratSnapshot}){
 const data=state.roadmap??seedBaccaratRoadmap(state.history);const [open,setOpen]=useState(false);const [kind,setKind]=useState<'bead'|'big'>('bead');const dialog=useRef<HTMLDialogElement>(null);const opener=useRef<HTMLElement|null>(null);const id=useId();
 useEffect(()=>{if(open&&!dialog.current?.open){opener.current=document.activeElement as HTMLElement;dialog.current?.showModal();}else if(!open)dialog.current?.close();},[open]);
 const coverage=data.firstRoundId&&data.firstRoundId>1?`Recorded from round ${data.firstRoundId}.`:'Results from this lobby.';
 return <>
  <div className={s.access}><span><b>B</b> {data.bankerWins} <b>P</b> {data.playerWins} <b>T</b> {data.ties}</span><button type="button" onClick={()=>setOpen(true)}>Scoreboard <span aria-hidden="true">↗</span></button></div>
  <aside className={s.inline} aria-label="Baccarat lobby scoreboard"><header><h2>Lobby scoreboard</h2><span>{data.completedHands} recorded hands</span></header><Totals data={data} compact/><h3>Bead Plate <small>Oldest → newest</small></h3><Road results={data.results} kind="bead" compact/><p>{data.currentSide?`${name(data.currentSide)} streak: ${data.currentStreak} · Ties ignored`:'No Player/Banker streak yet'}</p><button type="button" onClick={()=>setOpen(true)}>Open full scoreboard</button></aside>
  <dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`} onClose={()=>{setOpen(false);opener.current?.focus();}}>
   <header className={s.heading}><div><h2 id={`${id}-title`}>Baccarat scoreboard</h2><p>{data.completedHands.toLocaleString()} recorded hands · {data.results.length<BACCARAT_HISTORY_LIMIT?'Lobby history':`Latest ${BACCARAT_HISTORY_LIMIT} plotted`}</p></div><button type="button" aria-label="Close Baccarat scoreboard" onClick={()=>dialog.current?.close()}>×</button></header>
   <div className={s.body}><section className={s.chart} aria-label="Baccarat roads"><div className={s.tabs} role="tablist" aria-label="Baccarat history boards">{(['bead','big'] as const).map(value=><button id={`${id}-${value}`} key={value} type="button" role="tab" aria-selected={kind===value} aria-controls={`${id}-panel`} onClick={()=>setKind(value)}>{value==='bead'?'Bead Plate':'Big Road'}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${kind}`}><Road results={data.results} kind={kind}/><p className={s.explanation}>{kind==='bead'?'Every result, top to bottom in columns of six.':'Player/Banker streaks; green slashes mark ties. Long streaks turn right.'}</p></div>
    <p className={s.legend}><span data-side="banker">B Banker</span><span data-side="player">P Player</span><span data-side="tie">T Tie</span><small>Hover a result for its scores.</small></p>
   </section><section className={s.summary} aria-label="Lobby outcome statistics"><h3>Recorded lobby outcomes</h3><Totals data={data}/><dl><div><dt>Current B/P streak</dt><dd>{data.currentSide?`${name(data.currentSide)} × ${data.currentStreak}`:'—'}</dd></div><div><dt>Longest Banker streak</dt><dd>{data.longestBankerStreak}</dd></div><div><dt>Longest Player streak</dt><dd>{data.longestPlayerStreak}</dd></div><div><dt>Banker wins on six</dt><dd>{data.bankerSixWins}</dd></div></dl><p className={s.coverage}>{coverage} Streaks ignore ties. Counts include all recorded hands; roads retain the latest {BACCARAT_HISTORY_LIMIT}.</p></section></div>
  </dialog>
 </>;
}
