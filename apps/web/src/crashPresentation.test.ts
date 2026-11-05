import { expect,it,vi,afterEach } from 'vitest';
import { crashRoomAdapter,crashSnapshot } from '../../server/src/games/crash';
import { CRASH_PROGRESS_CAPABILITY,type CrashSnapshot } from '@casual/protocol';
import { confirmedCrashDisplay,interpolateCrashDisplay,crashPlaybackFrame,type CrashFrame } from './crashPresentation';
import { crashGraphCamera,crashGraphGeometry } from './crashGraph';
afterEach(()=>vi.useRealTimers());
it('never predicts past a server-confirmed multiplier under clock skew or delayed crash delivery',()=>{
  const room=crashRoomAdapter.create({roomId:'a'.repeat(32),player:{id:'pilot',name:'Pilot',seat:0},credentialHash:'b'.repeat(64),now:1000,random:()=>0});
  room.engine.phase='running';room.engine.startedAt=1000;room.engine.outcome={multiplierCents:298,capped:false};
  const sample=crashSnapshot(room,'pilot',{now:100000,capabilities:[CRASH_PROGRESS_CAPABILITY]});expect(sample.progress?.multiplierCents).toBe(297);
  vi.useFakeTimers();for(const clock of [0,1e9,1e12]){vi.setSystemTime(clock);expect(confirmedCrashDisplay(sample).cents).toBe(297);}
  for(const fraction of [-1,0,.5,1,4]){const shown=interpolateCrashDisplay({cents:280,graphCents:280,elapsedMs:10000},confirmedCrashDisplay(sample),fraction);expect(shown.cents).toBeLessThanOrEqual(297);expect(shown.graphCents).toBeLessThanOrEqual(297);}
  const result:CrashSnapshot={...sample,phase:'results',outcome:{multiplierCents:298,capped:false},progress:null};expect(confirmedCrashDisplay(result).cents).toBe(298);
});
it('uses only the public result after crash and defaults safely when progress is unavailable',()=>{
  const room=crashRoomAdapter.create({roomId:'a'.repeat(32),player:{id:'pilot',name:'Pilot',seat:0},credentialHash:'b'.repeat(64),now:1000,random:()=>0});
  const state=crashSnapshot(room,'pilot');expect(confirmedCrashDisplay({...state,phase:'running',startedAt:1})).toEqual({cents:100,graphCents:100,elapsedMs:0});
  expect(confirmedCrashDisplay({...state,phase:'results',outcome:{multiplierCents:10000,capped:true}}).cents).toBe(10000);
  expect(confirmedCrashDisplay(state)).toEqual({cents:100,graphCents:100,elapsedMs:0});
});
it('plays every animation frame between confirmed packets without rounding the curve or running beyond the buffer',()=>{
  const frames:CrashFrame[]=Array.from({length:9},(_,i)=>({at:i*250,display:{cents:100+i*3,graphCents:100+i*3,elapsedMs:i*250}}));
  let previous=100;for(let at=16;at<2000;at+=16){const frame=crashPlaybackFrame(frames,at);expect(frame.graphCents).toBeGreaterThan(previous);expect(frame.cents).toBe(Math.floor(frame.graphCents));expect(frame.graphCents).toBeLessThanOrEqual(124);previous=frame.graphCents;}
  expect(crashPlaybackFrame(frames,5000)).toEqual(frames.at(-1)!.display);expect(crashPlaybackFrame(frames,-500)).toEqual(frames[0]!.display);
  expect(interpolateCrashDisplay(frames[0]!.display,frames[1]!.display,.5).graphCents).toBe(101.5);
});
it('zooms out continuously across former multiplier and elapsed-time range boundaries',()=>{
  for(const multiplier of [2,3,5,10,20,50,100]){
    const before=crashGraphGeometry(multiplier-.0001,Math.log(multiplier-.0001)*10,640,260);
    const after=crashGraphGeometry(multiplier+.0001,Math.log(multiplier+.0001)*10,640,260);
    expect(after.maxValue).toBeGreaterThan(before.maxValue);expect(Math.abs(after.endpoint.x-before.endpoint.x)).toBeLessThan(.1);expect(Math.abs(after.endpoint.y-before.endpoint.y)).toBeLessThan(.1);
  }
  for(const elapsed of [10,20,30,40])expect(crashGraphCamera(3,elapsed+.0001).maxTime-crashGraphCamera(3,elapsed-.0001).maxTime).toBeLessThan(.001);
});
it('keeps the complete smooth curve within the camera with breathing room through the ceiling',()=>{
  for(const [width,height] of [[150,60],[420,180],[640,320]])for(const value of [1,1.01,2,10,100]){
    const g=crashGraphGeometry(value,Math.log(value)*10,width!,height!);expect(g.line.match(/ C /g)).toHaveLength(8);
    expect(g.endpoint.x).toBeGreaterThanOrEqual(g.left);expect(g.endpoint.x).toBeLessThan(g.right);
    expect(g.endpoint.y).toBeGreaterThan(g.top);expect(g.endpoint.y).toBeLessThanOrEqual(g.bottom);
    expect(g.maxTime).toBeGreaterThan(Math.log(value)*10);expect(g.maxValue).toBeGreaterThan(value);
  }
});
