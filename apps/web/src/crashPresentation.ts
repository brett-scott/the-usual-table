import { targetTime } from '@casual/crash';
import type { CrashSnapshot } from '@casual/protocol';

export interface CrashDisplay {cents:number;elapsedMs:number;graphCents:number}
export const CRASH_PLAYBACK_DELAY_MS=350;
export interface CrashFrame {at:number;display:CrashDisplay}
/** Browser clocks never advance a flight. Missing/delayed progress safely holds at the last confirmed value. */
export function confirmedCrashDisplay(state:CrashSnapshot):CrashDisplay {
  if(state.phase==='results'&&state.outcome)return{cents:state.outcome.multiplierCents,graphCents:state.outcome.multiplierCents,elapsedMs:targetTime(0,state.outcome.multiplierCents)};
  if(state.phase==='running'&&state.progress)return{cents:state.progress.multiplierCents,graphCents:state.progress.multiplierCents,elapsedMs:state.progress.elapsedMs};
  return{cents:100,graphCents:100,elapsedMs:0};
}
export function interpolateCrashDisplay(from:CrashDisplay,to:CrashDisplay,fraction:number):CrashDisplay {
  const progress=Math.max(0,Math.min(1,fraction));
  if(progress===0)return from;if(progress===1)return to;
  const graphCents=Math.min(to.graphCents,from.graphCents+(to.graphCents-from.graphCents)*progress);
  return{cents:Math.floor(graphCents),graphCents,elapsedMs:Math.min(to.elapsedMs,from.elapsedMs+(to.elapsedMs-from.elapsedMs)*progress)};
}
/** A small playback buffer removes gaps between packets without inventing any unconfirmed progress. */
export function crashPlaybackFrame(frames:readonly CrashFrame[],at:number):CrashDisplay {
  if(!frames.length)return{cents:100,graphCents:100,elapsedMs:0};
  if(at<=frames[0]!.at)return frames[0]!.display;
  for(let i=1;i<frames.length;i++){
    const next=frames[i]!;const previous=frames[i-1]!;
    if(at<=next.at)return interpolateCrashDisplay(previous.display,next.display,(at-previous.at)/Math.max(1,next.at-previous.at));
  }
  return frames.at(-1)!.display;
}
