import { useEffect,useId,useRef,useState } from 'react';
import { GAME_CATALOG,progressionSchema,type Progression } from '@casual/protocol';
import { accountRequest } from './accountRequest';
import { statisticsChips } from './AccountStatistics';
import s from './AccountStatistics.module.css';
export function AccountProgression({owner,onClose,onClaimed}:{owner:string;onClose():void;onClaimed():void}){
  const dialog=useRef<HTMLDialogElement>(null);const opener=useRef<HTMLElement|null>(null);const title=useId();
  const [data,setData]=useState<Progression|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revision,setRevision]=useState(0);const [game,setGame]=useState('blackjack');
  useEffect(()=>{opener.current=document.activeElement as HTMLElement|null;dialog.current?.showModal();},[]);
  useEffect(()=>{let active=true;const abort=new AbortController();setBusy(true);setError('');
    void accountRequest('progression',owner,progressionSchema,'GET',abort.signal).then(value=>{if(active){setData(value);if(revision>0)onClaimed();}}).catch(()=>{if(active)setError('Your progress could not be loaded. Please try again.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;abort.abort();};},[owner,revision]);
  async function claim(){setBusy(true);setError('');try{const next=await accountRequest('progression',owner,progressionSchema,'POST');setData(next);onClaimed();}catch{setError('Could not claim rewards. Refresh to check what is available.');}finally{setBusy(false);}}
  const percent=data?Number((BigInt(data.xp)-BigInt(data.levelStartXp))*100n/(BigInt(data.nextLevelXp)-BigInt(data.levelStartXp))):0;
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={title} onClose={()=>{if(document.activeElement===document.body||dialog.current?.contains(document.activeElement))opener.current?.focus();onClose();}}>
    <header className={s.heading}><h2 id={title}>Progress & achievements</h2><button aria-label="Close progress" onClick={()=>dialog.current?.close()}>×</button></header>
    <p className={s.note}>Saved-chip rounds earn 10 XP each, regardless of your bet or result. Progress starts when this feature is enabled.</p>
    {error&&<p role="alert">{error}</p>}{!data&&busy&&<p role="status">Loading progress…</p>}
    {data&&<>
      <section className={s.game} aria-label="Your level"><h3>Level {data.level}</h3><p>{data.xp} XP · Next level at {data.nextLevelXp} XP</p><progress aria-label="Progress to next level" max={100} value={percent}/><p>Each level-up earns 1,000 chips.</p>
        <button disabled={busy||BigInt(data.readyRewardUnits)===0n||data.wallet?.status==='suspended'} onClick={()=>void claim()}>{BigInt(data.readyRewardUnits)===0n?'No rewards to claim':`Claim ${statisticsChips(data.readyRewardUnits)} reward chips`}</button>
        {data.claimedUnits>0&&<p role="status">{statisticsChips(String(data.claimedUnits))} chips added to your wallet.</p>}
      </section>
      <div role="tablist" className={s.tabs} aria-label="Achievement games">{GAME_CATALOG.map(item=><button key={item.id} role="tab" aria-selected={game===item.id} onClick={()=>setGame(item.id)}>{item.name}</button>)}</div>
      <section role="tabpanel" aria-label={`${GAME_CATALOG.find(item=>item.id===game)?.name} achievements`}>
        {!data.achievements.some(a=>a.gameId===game)&&<p>Achievements and rewards for this game will arrive when it launches.</p>}
        <ul className={s.achievements}>{data.achievements.filter(a=>a.gameId===game).map(a=><li key={a.id}><strong>{a.name}</strong><p>{a.description}</p><p>{statisticsChips(String(a.rewardUnits))} chips · {a.claimed?'Claimed':a.unlocked?'Unlocked':`${a.progress} / ${a.target}`}</p></li>)}</ul>
      </section>
    </>}
    <button className={s.refresh} disabled={busy} onClick={()=>setRevision(value=>value+1)}>{error?'Retry progress':'Refresh progress'}</button>
  </dialog>;
}
