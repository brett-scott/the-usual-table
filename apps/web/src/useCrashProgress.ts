import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import type { CrashSnapshot } from '@casual/protocol';
import { confirmedCrashDisplay,crashPlaybackFrame,CRASH_PLAYBACK_DELAY_MS,type CrashDisplay,type CrashFrame } from './crashPresentation';

/** Play a short buffer of confirmed samples continuously, holding safely if that buffer runs out. */
export function useCrashProgress(state:CrashSnapshot):CrashDisplay {
  const target=confirmedCrashDisplay(state);
  const [display,setDisplay]=useState(()=>({roundId:state.roundId,...target}));
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const playback=useRef({roundId:state.roundId,phase:state.phase,display:target,frames:[] as CrashFrame[]});
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');const changed=()=>setReduced(media.matches);
    media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);
  },[]);
  useLayoutEffect(()=>{
    const current=playback.current;const now=performance.now();
    if(state.phase!=='running'||current.roundId!==state.roundId||reduced){
      playback.current={roundId:state.roundId,phase:state.phase,display:target,frames:[{at:now,display:target}]};
      setDisplay({roundId:state.roundId,...target});return;
    }
    if(current.phase!=='running'||!current.frames.length)current.frames=[{at:now-CRASH_PLAYBACK_DELAY_MS,display:current.display}];
    current.phase='running';const last=current.frames.at(-1)!;
    // A changed server clock or a stale packet cannot move this round backwards.
    if(target.graphCents>=last.display.graphCents&&target.elapsedMs>=last.display.elapsedMs){
      if(now===last.at)current.frames[current.frames.length-1]={at:now,display:target};else current.frames.push({at:now,display:target});
    }
    while(current.frames.length>2&&current.frames[1]!.at<now-CRASH_PLAYBACK_DELAY_MS)current.frames.shift();
    if(current.frames.length>32)current.frames=current.frames.slice(-32);
  },[state.roundId,state.phase,state.progress?.sampledAt,target.cents,target.elapsedMs,reduced]);
  useEffect(()=>{
    if(state.phase!=='running'||reduced)return;
    let frame:number;const render=()=>{
      const current=playback.current;const next=crashPlaybackFrame(current.frames,performance.now()-CRASH_PLAYBACK_DELAY_MS);
      if(next.graphCents!==current.display.graphCents||next.elapsedMs!==current.display.elapsedMs){current.display=next;setDisplay({roundId:state.roundId,...next});}
      frame=requestAnimationFrame(render);
    };
    frame=requestAnimationFrame(render);return()=>cancelAnimationFrame(frame);
  },[state.roundId,state.phase,reduced]);
  return state.phase==='running'&&display.roundId===state.roundId?display:target;
}
