import { useEffect, useState } from 'react';
import { allowanceSchema, type Allowance } from '@casual/protocol';
import { accountRequest } from './accountRequest';
export function DailyAllowance({owner,onClaimed}:{owner:string;onClaimed():void}) {
  const [data,setData] = useState<Allowance|null>(null); const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0); const [clock,setClock] = useState({server:0,local:0}); const [now,setNow] = useState(0);
  useEffect(() => { let active=true; const abort=new AbortController(); setData(null); setError(''); setBusy(true);
    void accountRequest('allowance',owner,allowanceSchema,'GET',abort.signal).then(value=>{if(active){setData(value);setClock({server:value.serverNow,local:Date.now()});setNow(value.serverNow);if(revision>0)onClaimed();}})
      .catch(()=>{if(active)setError('Daily allowance could not be loaded.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;abort.abort();};
  },[owner,revision]);
  useEffect(()=>{const id=setInterval(()=>setNow(clock.server+Date.now()-clock.local),1000);return()=>clearInterval(id);},[clock]);
  async function claim(){setBusy(true);setError('');try{const value=await accountRequest('allowance',owner,allowanceSchema,'POST');
    setData(value);setClock({server:value.serverNow,local:Date.now()});setNow(value.serverNow);onClaimed();
  }catch{setError('Could not claim. Retry to check your allowance.');}finally{setBusy(false);}}
  const seconds=Math.max(0,Math.ceil(((data?.nextEligibleAt??0)-now)/1000));
  const paused=data?.wallet?.status==='suspended';
  return <div role="group" aria-label="Daily allowance">
    <p>Daily allowance · 1,000 chips</p>
    {error ? <><p role="status">{error}</p><button role="menuitem" onClick={()=>setRevision(x=>x+1)}>Retry allowance</button></>
      : <button role="menuitem" disabled={busy || !data || paused || seconds>0} onClick={()=>void claim()}>
        {busy?'Loading allowance…':paused?'Wallet paused':seconds>0?`Available in ${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`:'Claim 1,000 chips'}</button>}
  </div>;
}
