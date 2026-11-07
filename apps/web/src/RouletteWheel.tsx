import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { ROULETTE_WHEEL,rouletteColor,type RouletteSnapshot } from '@casual/protocol';
import s from './RouletteTable.module.css';
const point=(radius:number,degrees:number)=>{const a=(degrees-90)*Math.PI/180;return{x:100+radius*Math.cos(a),y:100+radius*Math.sin(a)};};
const modulo=(n:number)=>(n%360+360)%360;
export const rouletteLandingAngle=(winner:number,wheel:number)=>ROULETTE_WHEEL.indexOf(winner as typeof ROULETTE_WHEEL[number])*360/37+wheel;
export function RouletteWheel({state,offset,reduced,onLanded,highlight}:{state:RouletteSnapshot;offset:number;reduced:boolean;onLanded(roundId:number):void;highlight:boolean}){
 const [frame,setFrame]=useState({wheel:0,ball:0});const latest=useRef(frame);const landing=useRef<{at:number;from:number;to:number;wheel:number}|null>(null);
 useLayoutEffect(()=>{
  if(state.phase==='results'){const wheel=176;const target=rouletteLandingAngle(state.winner!,wheel);const from=latest.current.ball;landing.current={at:performance.now(),from,to:from-720-modulo(from-target),wheel};}
  else landing.current=null;
 },[state.phase,state.roundId,state.winner]);
 useEffect(()=>{let id:number;const render=()=>{
  let next={wheel:0,ball:0};if(state.startedAt!==null&&state.phase==='spinning'){const elapsed=Math.min(8000,Math.max(0,Date.now()+offset-state.startedAt));next={wheel:elapsed*.022,ball:-elapsed*.25};}
  if(state.phase==='results'){const l=landing.current;const t=reduced?1:Math.min(1,Math.max(0,(performance.now()-(l?.at??0))/900));const wheel=l?.wheel??176;next={wheel,ball:l?l.from+(l.to-l.from)*(1-Math.pow(1-t,3)):rouletteLandingAngle(state.winner!,wheel)};if(t===1)onLanded(state.roundId);}
  if(reduced&&state.phase==='spinning')next={wheel:0,ball:0};latest.current=next;setFrame(next);if(!reduced&&(state.phase==='spinning'&&state.startedAt!==null&&Date.now()+offset<state.startedAt+8000||state.phase==='results'&&landing.current&&performance.now()<landing.current.at+950))id=requestAnimationFrame(render);
 };render();return()=>cancelAnimationFrame(id);},[state.phase,state.roundId,state.startedAt,state.winner,offset,reduced,onLanded]);
 const ball=point(83,frame.ball);
 return <svg className={s.wheel} viewBox="0 0 200 200" role="img" aria-label={state.phase==='results'?`Roulette wheel, winning number ${state.winner}`:state.phase==='spinning'?'Roulette wheel spinning':'European single-zero Roulette wheel'} data-ball-angle={frame.ball} data-wheel-angle={frame.wheel}>
  <circle cx="100" cy="100" r="98" fill="#6b593e" stroke="#c1a16c" strokeWidth="2"/><circle cx="100" cy="100" r="92" fill="#152725"/>
  <g transform={`rotate(${frame.wheel} 100 100)`}>{ROULETTE_WHEEL.map((n,i)=>{const a=i*360/37;const start=point(75,a-180/37),end=point(75,a+180/37),text=point(65,a);const winning=highlight&&n===state.winner;return <g key={n} data-winning-pocket={winning}><path d={`M100 100 L${start.x} ${start.y} A75 75 0 0 1 ${end.x} ${end.y} Z`} fill={n===0?'#357454':rouletteColor(n)==='red'?'#923e43':'#162425'} stroke={winning?'#fff0b0':'#b9a776'} strokeWidth={winning?2.5:.45}/><text x={text.x} y={text.y} dy="2" fill="#fff5dc" fontSize={winning?8:7} fontWeight={winning?700:400} textAnchor="middle" transform={`rotate(${a} ${text.x} ${text.y})`}>{n}</text></g>;})}</g>
  <circle cx="100" cy="100" r="48" fill="#2a4037" stroke="#ae925e" strokeWidth="2"/><circle cx="100" cy="100" r="20" fill="#b79b68"/><path d="M100 65v70M65 100h70" stroke="#e5d3ac" strokeWidth="4"/><circle cx="100" cy="100" r="8" fill="#eddbb3"/>
  <circle cx={ball.x} cy={ball.y} r="3.5" fill="#fff8dd" stroke="#c8c1a6" strokeWidth="1"/>
  {highlight&&state.winner!==null&&<g role="group" aria-label={`Winning number ${state.winner} ${rouletteColor(state.winner)}`}><circle cx="100" cy="100" r="39" fill={rouletteColor(state.winner)==='red'?'#843e42':state.winner===0?'#327647':'#162724'} stroke="#f4d68e" strokeWidth="2"/><text x="100" y="84" textAnchor="middle" fill="#ffe6ae" fontSize="6" letterSpacing="1.5">WINNER</text><text x="100" y="116" textAnchor="middle" fill="#fff7e6" fontSize="34" fontWeight="700">{state.winner}</text></g>}
 </svg>;
}
