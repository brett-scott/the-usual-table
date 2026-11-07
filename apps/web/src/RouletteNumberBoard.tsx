import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode } from 'react';
import { ROULETTE_BETS,rouletteBet,type RouletteWager } from '@casual/protocol';
import { WagerChips } from './WagerChips';
import { rouletteBoardSpot,ROULETTE_NUMBER_RANGES,type RouletteBoardLayout } from './rouletteBoardGeometry';
import s from './RouletteNumberBoard.module.css';
const layoutNow=():RouletteBoardLayout=>window.matchMedia('(max-height:500px) and (min-width:641px)').matches?'landscape':window.matchMedia('(max-width:1000px)').matches?'portrait':'wide';
const groupNames={split:'Split',street:'Street',corner:'Corner','six-line':'Six-line'};
const chips=(units:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(units/100);
interface Spot {id:string;x:number;y:number}
export function RouletteNumberBoard({wager,enabled,denomination,winner,reducedMotion,renderTile,onBet}:{
 wager:RouletteWager;enabled:boolean;denomination:number;winner:number|null;reducedMotion:boolean;
 renderTile(id:string,number:number|undefined,position:CSSProperties,covered:boolean):ReactNode;onBet(id:string):void;
}){
 const [layout,setLayout]=useState(layoutNow),[range,setRange]=useState(0),[mode,setMode]=useState('straight');
 const [spots,setSpots]=useState<Spot[]>([]),[hover,setHover]=useState<string|null>(null),[focus,setFocus]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null);
 const surface=useRef<HTMLDivElement>(null),grid=useRef<HTMLDivElement>(null);
 const start=layout==='wide'?1:ROULETTE_NUMBER_RANGES[range]!,count=layout==='wide'?36:12;
 const preview=rouletteBet(hover??focus??selected??'');const previewAmount=wager.find(b=>b.betId===preview?.id)?.amountUnits??0;
 useEffect(()=>{const change=()=>setLayout(layoutNow());window.addEventListener('resize',change);return()=>window.removeEventListener('resize',change);},[]);
 useLayoutEffect(()=>{
  const measure=()=>{
   if(!surface.current||!grid.current)return;const origin=surface.current.getBoundingClientRect();const rects=new Map<number,{left:number;top:number;right:number;bottom:number}>();
   grid.current.querySelectorAll<HTMLElement>('[data-number]').forEach(el=>{const n=Number(el.dataset.number),r=el.getBoundingClientRect();rects.set(n,{left:r.left-origin.left,right:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top});});
   const next=ROULETTE_BETS.flatMap(b=>{const point=rouletteBoardSpot(b,rects,layout,start);return point?[{id:b.id,...point}]:[];});setSpots(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  measure();const observer=new ResizeObserver(measure);if(grid.current)observer.observe(grid.current);if(surface.current)observer.observe(surface.current);return()=>observer.disconnect();
 },[layout,start]);
 useEffect(()=>{if(!wager.length)setSelected(null);},[wager]);
 function position(n:number):CSSProperties{
  if(n===0)return layout==='portrait'?{gridColumn:'1 / 4',gridRow:1}:{gridColumn:1,gridRow:'1 / 4'};
  const index=n-start;
  return layout==='portrait'?{gridColumn:index%3+1,gridRow:Math.floor(index/3)+2}:{gridColumn:Math.floor(index/3)+2,gridRow:3-index%3};
 }
 return <div className={s.board} data-number-layout={layout}>
  {layout!=='wide'&&<div className={s.navigation}>
   <div className={s.ranges} role="group" aria-label="Number ranges">{ROULETTE_NUMBER_RANGES.map((first,i)=><button key={first} type="button" aria-pressed={range===i} onClick={()=>{setRange(i);setHover(null);setFocus(null);setSelected(null);}}>{first}–{first+11}</button>)}</div>
   <select aria-label="Number bet type" value={mode} onChange={event=>{setMode(event.target.value);setHover(null);setFocus(null);setSelected(null);}}><option value="straight">Numbers</option><option value="split">Splits</option><option value="corner">Corners</option><option value="street">Streets</option><option value="six-line">Six-lines</option></select>
  </div>}
  <div className={s.surface} ref={surface} onPointerLeave={()=>setHover(null)} onClickCapture={event=>{const number=(event.target as Element).closest<HTMLElement>('[data-number]');if(number)setSelected(`straight-${number.dataset.number}`);}}>
   <div ref={grid} className={s.grid}>
    {[0,...Array.from({length:count},(_,i)=>start+i)].map(n=>renderTile(`straight-${n}`,n,position(n),!!preview?.numbers.includes(n)))}
    {layout==='wide'&&[3,2,1].map(n=>renderTile(`column-${n}`,undefined,{gridColumn:14,gridRow:4-n},false))}
   </div>
   {spots.filter(point=>layout==='wide'||rouletteBet(point.id)!.kind===mode||wager.some(b=>b.betId===point.id)).map(point=>{
    const rule=rouletteBet(point.id)!;if(rule.kind==='straight'||rule.kind==='outside')return null;const amount=wager.find(b=>b.betId===point.id)?.amountUnits??0;const wins=winner!==null&&rule.numbers.includes(winner);
    return <button key={point.id} className={s.spot} type="button" data-inside-spot={point.id} data-bet-tile={point.id} data-kind={rule.kind} data-amount={amount} data-selected={amount>0} data-preview={preview?.id===point.id} data-winning={wins} style={{left:point.x,top:point.y}} disabled={!enabled} aria-label={`Bet on ${groupNames[rule.kind]} ${rule.label}`} aria-description={`${chips(amount)} chips. Covers ${rule.label}. Pays ${rule.profit}:1 profit. ${enabled?`Tap to add ${denomination} chips.`:'Betting is closed.'}`} title={`${groupNames[rule.kind]} ${rule.label} · ${chips(amount)} chips`} onPointerEnter={()=>setHover(point.id)} onPointerLeave={()=>setHover(null)} onFocus={()=>setFocus(point.id)} onBlur={()=>setFocus(null)} onClick={()=>{setSelected(point.id);onBet(point.id);}}>
     <span className={s.dot} aria-hidden="true"/>{amount>0&&<span className={s.chips}><WagerChips amount={amount/50} returned={wins?amount*(rule.profit+1)/50:0} settled={winner!==null} reducedMotion={reducedMotion} compact/><strong>{chips(amount)}</strong></span>}
    </button>;
   })}
   {preview&&preview.kind!=='straight'&&preview.kind!=='outside'&&spots.some(p=>p.id===preview.id)&&<div className={s.preview} aria-hidden="true">{groupNames[preview.kind]} · {preview.label} · {chips(previewAmount)} chips</div>}
  </div>
 </div>;
}
