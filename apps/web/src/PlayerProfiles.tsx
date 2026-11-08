import { createContext,useContext,useEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode } from 'react';
import { accountProfileSchema,DEFAULT_APPEARANCE,DEFAULT_PROFILE_VISIBILITY,detailedStatisticsSchema,GAME_CATALOG,profileDraftSchema,progressionSchema,walletSummarySchema,
  type AccountProfile,type Appearance,type ProfileDraft,type PublicAccountProfile,type RoomProfile,type TableClient,type Progression } from '@casual/protocol';
import { type AuthController, saveAccountProfile } from './authClient';
import { accountRequest } from './accountRequest';
import { generalStatistics,statisticsChips } from './AccountStatistics';
import { ProfileAvatar } from './ProfileAvatar';
import { AppearancePicker } from './AppearancePicker';
import s from './PlayerProfiles.module.css';

type View='profile'|'statistics'|'achievements'|'edit';
type Identity={id:string;name:string;icon?:import('@casual/protocol').PlayerIcon;appearance?:Appearance;balance?:number;balanceUnits?:number};
type Client=Pick<TableClient<unknown,unknown>,'readProfile'|'syncProfile'|'subscribe'>&{getSnapshot?():unknown};
type Table={client:Client;you:string;online:boolean;ownTurn:boolean;seconds:number|null;label:string};
type Target={own:boolean;identity?:Identity;opener:HTMLElement|null};
const Context=createContext<{openSelf(view?:View):void;openPlayer(player:Identity):void;register(table:Table|null):void}|null>(null);
export function useProfiles(){return useContext(Context);}
export function useProfileTable(table:Table){
  const context=useContext(Context);const register=context?.register;
  useEffect(()=>{register?.(table);return()=>register?.(null);},[register,table.client,table.you,table.online,table.ownTurn,table.seconds,table.label]);
}
export function PlayerIdentityButton({player,children,compact=false}:{player:Identity;children?:ReactNode;compact?:boolean}){
  const profiles=useContext(Context);
  const appearance=player.appearance??(player.icon?{avatar:{kind:'emoji' as const,id:player.icon},border:'none' as const}:DEFAULT_APPEARANCE);
  return <button type="button" className={`${s.identity} ${compact?s.seatIdentity:''}`} aria-label={`View ${player.name}'s profile`} onClick={event=>{event.currentTarget.closest('dialog')?.close();profiles?.openPlayer(player);}}>
    <ProfileAvatar name={player.name} appearance={appearance}/><strong>{children??player.name}</strong>
  </button>;
}
type Data={name:string;appearance:Appearance;kind:'account'|'guest';level?:number;version?:number;visibility:{chips:boolean;statistics:boolean;achievements:boolean};
  total?:string|null;statistics?:PublicAccountProfile['statistics'];achievements?:PublicAccountProfile['achievements'];stack?:number;funding?:'saved'|'temporary';settings?:AccountProfile;progress?:Progression};
export function PlayerProfilesProvider({auth,children}:{auth:AuthController;children:ReactNode}){
  const account=useSyncExternalStore(auth.subscribe,auth.getSnapshot);
  const [table,setTable]=useState<Table|null>(null);const tableRef=useRef(table);tableRef.current=table;
  const [target,setTarget]=useState<Target|null>(null);const [view,setView]=useState<View>('profile');const [data,setData]=useState<Data|null>(null);
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [refresh,setRefresh]=useState(0);const [notice,setNotice]=useState('');
  const [claiming,setClaiming]=useState(false);const dialog=useRef<HTMLDialogElement>(null);const title=useId();const owner=account.account?.accountId;
  const [achievementView,setAchievementView]=useState({game:'blackjack',hideCompleted:false});
  const ownerAtOpen=useRef<string|undefined>(undefined);
  const [actions]=useState(()=>({
    register:setTable,
    openSelf(next:View='profile'){ownerAtOpen.current=auth.getSnapshot().account?.accountId;setTarget({own:true,opener:document.activeElement as HTMLElement|null});setView(next);setData(null);setError('');setNotice('');},
    openPlayer(identity:Identity){ownerAtOpen.current=auth.getSnapshot().account?.accountId;setTarget({own:false,identity,opener:document.activeElement as HTMLElement|null});setView('profile');setData(null);setError('');setNotice('');},
  }));
  function close(){dialog.current?.close();setTarget(null);setData(null);setError('');setNotice('');target?.opener?.focus();}
  useEffect(()=>{if(target&&!dialog.current?.open)dialog.current?.showModal();if(!target)dialog.current?.close();},[target]);
  useEffect(()=>{if(target&&ownerAtOpen.current!==owner)close();},[owner]);
  useEffect(()=>{if(!table&&target?.identity)close();},[table?.client]);
  useEffect(()=>{
    if(!target)return;let active=true;const abort=new AbortController();setLoading(true);setError('');setData(null);
    async function read(){
      if(target!.own){
        if(!owner)throw new Error('Sign in to view your profile.');
        const settings=await accountRequest('profile?catalogue=2',owner,accountProfileSchema,'GET',abort.signal);auth.applyProfile(settings);
        const [wallet,stats,progress]=await Promise.allSettled([
          accountRequest('wallet',owner,walletSummarySchema,'GET',abort.signal),accountRequest('statistics/details?version=6',owner,detailedStatisticsSchema,'GET',abort.signal),
          accountRequest('progression',owner,progressionSchema,'GET',abort.signal)]);
        const statistics=stats.status==='fulfilled'?{games:stats.value.summary.games,blackjack:stats.value.blackjack,crash:stats.value.crash,baccarat:stats.value.baccarat,roulette:stats.value.roulette,keno:stats.value.keno}:undefined;
        const w=wallet.status==='fulfilled'?wallet.value:null;const p=progress.status==='fulfilled'?progress.value:undefined;
        return {kind:'account' as const,name:settings.nickname??account.nickname??'Your profile',appearance:settings.appearance,settings,visibility:{...DEFAULT_PROFILE_VISIBILITY},version:settings.version,
          total:w?(BigInt(w.availableUnits)+BigInt(w.atTablesUnits)+BigInt(w.pendingReturnUnits)).toString():undefined,statistics,level:p?.level,achievements:p?.achievements,progress:p,
          stack:target!.identity?.balanceUnits??(target!.identity?.balance!==undefined?target!.identity.balance*50:undefined)};
      }
      const identity=target!.identity!;const client=tableRef.current?.client;
      if(!client?.readProfile){return {kind:'guest' as const,name:identity.name,appearance:identity.appearance??(identity.icon?{avatar:{kind:'emoji' as const,id:identity.icon},border:'none' as const}:DEFAULT_APPEARANCE),visibility:{...DEFAULT_PROFILE_VISIBILITY},stack:identity.balanceUnits??(identity.balance!==undefined?identity.balance*50:undefined),funding:'temporary' as const};}
      const response:RoomProfile=await client.readProfile(identity.id,abort.signal);const p=response.profile;
      if(response.ownAccount&&owner&&active)setTarget(current=>current&&current===target?{...current,own:true}:current);
      return {kind:p.kind,name:response.name,appearance:p.appearance,stack:response.stackUnits,funding:response.funding,
        ...(p.kind==='account'?{level:p.level,version:p.version,visibility:p.visibility,total:p.totalSavedChipUnits,statistics:p.statistics,achievements:p.achievements}:{visibility:{...DEFAULT_PROFILE_VISIBILITY}})};
    }
    void read().then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('This profile could not be loaded. Please try again.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;abort.abort();};
  },[target,owner,refresh,auth]);
  useEffect(()=>{
    if(!target||target.own||view==='edit')return;
    const timer=setInterval(()=>setRefresh(r=>r+1),15000);const focus=()=>setRefresh(r=>r+1);
    window.addEventListener('focus',focus);
    let previous=0;const unsubscribe=table?.client.subscribe(()=>{const snapshot=table.client.getSnapshot?.() as {players?:{id:string;profileVersion?:number}[]}|undefined;const version=snapshot?.players?.find(p=>p.id===target.identity?.id)?.profileVersion??0;if(version!==previous){previous=version;setRefresh(r=>r+1);}});
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus);unsubscribe?.();};
  },[target,table?.client,view]);
  const cosmeticVersion=account.profile?.version;
  useEffect(()=>{if(owner&&cosmeticVersion!==undefined&&table?.client.syncProfile)void table.client.syncProfile().catch(()=>{/* The next seat uses the saved picture; current table can reconnect independently. */});},[owner,cosmeticVersion,table?.client]);
  async function claim(){if(!owner)return;setClaiming(true);setError('');try{const result=await accountRequest('progression',owner,progressionSchema,'POST');await auth.refreshWallet();setRefresh(r=>r+1);setNotice(`${statisticsChips(String(result.claimedUnits))} chips added to your wallet.`);}catch{setError('Could not confirm your reward claim. Refresh your profile to check before trying again.');}finally{setClaiming(false);}}
  const identity=target?.identity;const name=data?.name??identity?.name??account.nickname??'Your profile';
  const appearance=data?.appearance??identity?.appearance??account.profile?.appearance??DEFAULT_APPEARANCE;
  const turn=table?.ownTurn?<span className={s.turn}><i/><b>{table.seconds===null?'Live':`${table.seconds}s`}</b>Your {table.label}</span>:<span className={s.turn}>{table?'Game continues':''}</span>;
  return <Context.Provider value={actions}>{children}<dialog ref={dialog} className={`${s.dialog} ${view==='edit'?s.editing:''}`} aria-labelledby={title} onCancel={e=>{e.preventDefault();if(!claiming)close();}}>
    <header className={s.header}><div>{view==='edit'&&<button type="button" aria-label="Back to profile" onClick={()=>setView('profile')}>←</button>}<h2 id={title}>{view==='edit'?'Customise profile':'Player profile'}</h2></div><button type="button" aria-label="Close profile" onClick={close}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    {target&&view==='edit'&&data?.settings?<ProfileEditor key={`${owner}:${refresh}`} profile={data.settings} auth={auth} turn={turn} onCancel={()=>setView('profile')} onSaved={profile=>{
      setData(value=>value?{...value,name:profile.nickname!,appearance:profile.appearance,settings:profile,version:profile.version}:value);setView('profile');setNotice('Profile saved. Nickname changes apply to your next seat.');
    }}/>:<>
      <div className={s.hero}><ProfileAvatar name={name} appearance={appearance}/><div className={s.heroInfo}><h3>{name}</h3>{data?.kind==='guest'?<small>Guest player</small>:<small>{data?.level!==undefined&&<span className={s.level}>✧ Level {data.level}</span>}{target?.own?'Your profile':loading?'Loading…':data?'Player':''}</small>}</div>{target?.own&&data?.settings&&<button type="button" onClick={()=>setView('edit')}>Edit profile</button>}</div>
      {data?.kind!=='guest'&&<nav className={s.tabs} aria-label="Profile views">{([['profile','Overview'],['statistics','Statistics'],['achievements','Achievements']] as const).map(([key,label])=><button type="button" key={key} aria-current={view===key?'page':undefined} aria-selected={view===key} onClick={()=>setView(key)}>{label}</button>)}</nav>}
      <div className={s.body}>{notice&&<p className={s.notice} role="status">{notice}</p>}{loading&&<p role="status">Loading profile…</p>}{error&&<p className={s.error} role="alert">{error}</p>}
        {!loading&&data&&(view==='profile'?<Overview data={data} own={!!target?.own}/>:view==='statistics'?<Statistics data={data}/>:<Achievements data={data} own={!!target?.own} claiming={claiming} onClaim={()=>void claim()} view={achievementView} onViewChange={setAchievementView}/>)}
        {!loading&&(error||data?.kind==='account')&&<p><button type="button" onClick={()=>setRefresh(r=>r+1)}>{error?'Retry profile':'Refresh profile'}</button></p>}
      </div><footer className={s.footer}>{turn}<button type="button" className={s.primary} onClick={close}>{table?'Return to hand':'Done'}</button></footer>
    </>}
  </dialog></Context.Provider>;
}
function Overview({data:d,own}:{data:Data;own:boolean}){
  const summary=d.statistics?generalStatistics(d.statistics.games):null;
  return <>{d.kind==='account'&&<div className={s.wealth}><span>Total saved chips</span><strong>{!d.visibility.chips?'Hidden':d.total==null?'Unavailable':`◈ ${statisticsChips(d.total)}`}</strong><small>{!d.visibility.chips?'This player keeps their balance private':own&&d.settings&&!d.settings.visibility.chips?'Your saved balance · Hidden from other players':'Across the wallet and saved-chip tables'}</small></div>}
    <div className={s.grid}>{d.stack!==undefined&&<div className={s.stat}><span>{d.kind==='guest'||d.funding==='temporary'?'Temporary table chips':'Current table stack'}</span><strong>◈ {statisticsChips(String(d.stack))}</strong></div>}{d.kind==='account'&&<div className={s.stat}><span>Saved rounds</span><strong>{!d.visibility.statistics?'Hidden':summary?new Intl.NumberFormat('en').format(BigInt(summary.roundsPlayed)):'Unavailable'}</strong></div>}</div>
    {d.kind==='guest'?<p className={s.note}>Playing as a guest. Chips and game history aren't saved.</p>:<>
      <p className={s.note}>{!d.visibility.achievements?'Achievements are private.':d.achievements?`${d.achievements.filter(a=>a.unlocked).length} achievements earned`:'Achievements unavailable.'}</p>
      {d.progress&&<><p className={s.note}>{d.progress.xp} XP · Next level at {d.progress.nextLevelXp} XP</p><progress className={s.xp} aria-label="Progress to next level" max={100} value={Number((BigInt(d.progress.xp)-BigInt(d.progress.levelStartXp))*100n/(BigInt(d.progress.nextLevelXp)-BigInt(d.progress.levelStartXp)))}/></>}
      {d.funding==='temporary'&&<p className={s.note}>This seat uses temporary chips. Account statistics and level are from saved play.</p>}
    </>}
  </>;
}
function GameSelect({value,onChange,general=false}:{value:string;onChange(value:string):void;general?:boolean}){return <label>Game<select aria-label="Game" value={value} onChange={e=>onChange(e.target.value)}>{general&&<option value="general">General</option>}{GAME_CATALOG.filter(g=>g.status==='available').map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>;}
function Statistics({data:d}:{data:Data}){
  const [game,setGame]=useState('general');if(!d.visibility.statistics)return <State title="Statistics are private"/>;if(!d.statistics)return <State title="Statistics unavailable"/>;
  const values=game==='general'?generalStatistics(d.statistics.games):d.statistics.games.find(g=>g.gameId===game)??generalStatistics([]);
  const fields=[['Rounds played',values.roundsPlayed],['Won',values.roundsWon],['Lost',values.roundsLost],['Even',values.roundsEven],['Chips wagered',statisticsChips(values.wageredUnits)],['Chips returned',statisticsChips(values.returnedUnits)],['Net chips',statisticsChips(values.netUnits,true)],['Best round',statisticsChips(values.bestRoundNetUnits,true)]];
  if(game==='blackjack')fields.push(...Object.entries(d.statistics.blackjack).filter(([k])=>!['trackedRounds','perfectPairsWageredUnits','perfectPairsReturnedUnits'].includes(k)).map(([k,v])=>[({hands:'Hands played',blackjacks:'Natural blackjacks',insuranceTaken:'Insurance bets',insuranceWon:'Insurance wins',perfectPairsBets:'Perfect Pairs bets',perfectPairsWins:'Perfect Pairs wins'} as Record<string,string>)[k]??k[0]!.toUpperCase()+k.slice(1),v]));
  if(game==='crash'&&d.statistics.crash)fields.push(['Cash-outs',d.statistics.crash.cashouts],['Crashes',d.statistics.crash.crashes],['Highest cash-out',`${(Number(d.statistics.crash.highestCashoutCents)/100).toFixed(2)}×`]);
  if(game==='baccarat'&&d.statistics.baccarat){const b=d.statistics.baccarat;fields.push(['Player bets',b.playerBets],['Banker bets',b.bankerBets],['Tie bets',b.tieBets],['Tie wins',b.tieWins],['Banker wins on six',b.bankerSixWins],['Commission paid',statisticsChips(b.commissionUnits)]);}
  if(game==='keno'&&d.statistics.keno)fields.push(['Total matches',d.statistics.keno.totalMatches],['Numbers picked',d.statistics.keno.totalPicks],['Most matches',d.statistics.keno.bestMatches],['Best multiplier',`${Number(d.statistics.keno.bestMultiplierCents)/100}×`]);
  if(game==='roulette'&&d.statistics.roulette)fields.push(['Straight-up wins',d.statistics.roulette.straightUpWins]);
  return <section aria-label={`${game==='general'?'General':GAME_CATALOG.find(g=>g.id===game)?.name} statistics`}><div className={s.sectionTop}><h3>Statistics</h3><GameSelect value={game} onChange={setGame} general/></div>{!d.statistics.games.length&&<p className={s.note}>No saved rounds yet.</p>}<div className={`${s.grid} ${s.stats}`}>{fields.map(([label,value])=><div key={label} className={s.stat}><span>{label}</span><strong>{value}</strong></div>)}</div><p className={s.note}>Saved-chip play only. Results update after the round is saved.</p></section>;
}
function Achievements({data:d,own,claiming,onClaim,view,onViewChange}:{data:Data;own:boolean;claiming:boolean;onClaim():void;view:{game:string;hideCompleted:boolean};onViewChange(view:{game:string;hideCompleted:boolean}):void}){
  const id=useId();const {game,hideCompleted}=view;
  if(!d.visibility.achievements)return <State title="Achievements are private"/>;if(!d.achievements)return <State title="Achievements unavailable"/>;
  const achievements=d.achievements.filter(a=>a.gameId===game);
  const visible=achievements.filter(a=>!hideCompleted||!a.unlocked).sort((a,b)=>Number(b.unlocked)-Number(a.unlocked));
  return <>{own&&d.progress&&<div className={s.wealth}><span>Level {d.progress.level} · {d.progress.xp} XP</span><p className={s.note}>Each level-up earns 1,000 chips.</p><button type="button" disabled={claiming||d.progress.readyRewardUnits==='0'||d.progress.wallet?.status==='suspended'} onClick={onClaim}>{claiming?'Claiming…':d.progress.readyRewardUnits==='0'?'No rewards to claim':`Claim ${statisticsChips(d.progress.readyRewardUnits)} reward chips`}</button></div>}
    <div className={s.sectionTop}><h3>Achievements</h3><GameSelect value={game} onChange={game=>onViewChange({...view,game})}/></div>
    <label className={s.achievementFilter} htmlFor={id}><input id={id} type="checkbox" checked={hideCompleted} onChange={event=>onViewChange({...view,hideCompleted:event.target.checked})}/>Hide completed achievements</label>
    <ul className={s.achievementList} aria-label={`${GAME_CATALOG.find(g=>g.id===game)?.name} achievements`}>{visible.map(a=><li key={a.id} className={s.achievement} data-earned={a.unlocked}><i aria-hidden="true">{a.unlocked?'♠':'◇'}</i><div><b>{a.name}</b><p>{a.description}</p>{!a.unlocked&&<progress aria-label={`${a.name} progress`} max={a.target} value={Math.min(a.target,Number(a.progress))}/>}</div><span>{own&&d.progress?.achievements.find(item=>item.id===a.id)?.claimed?'Claimed':a.unlocked?'✓ Earned':`${a.progress} / ${a.target}`}<br/>{statisticsChips(String(a.rewardUnits))} chips</span></li>)}</ul>{!achievements.length?<p className={s.note}>No achievements available for this game yet.</p>:!visible.length&&<p className={s.note}>All achievements for this game are completed.</p>}</>;
}
function State({title}:{title:string}){return <div className={s.state}><h3>{title}</h3></div>;}
function ProfileEditor({profile,auth,turn,onCancel,onSaved}:{profile:AccountProfile;auth:AuthController;turn:ReactNode;onCancel():void;onSaved(profile:AccountProfile):void}){
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [draft,setDraft]=useState<ProfileDraft>({nickname:profile.nickname??'',appearance:profile.appearance,visibility:profile.visibility});
  const [tab,setTab]=useState<'illustrations'|'emoji'|'borders'|'sharing'>('illustrations');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [version,setVersion]=useState(profile.version);const id=useId();
  async function save(){const result=profileDraftSchema.safeParse(draft);if(!result.success){setError(result.error.issues[0]!.message);setTab('sharing');return;}setBusy(true);setError('');try{const saved=await saveAccountProfile({...result.data,version});if(mounted.current)onSaved(saved);}catch(e){if(mounted.current)setError(e instanceof Error&&e.message==='PROFILE_CONFLICT'?'Your profile changed on another device. Reload the latest settings before saving. Your draft is still here.':'Your profile could not be saved. Your choices are still here; please try again.');}finally{if(mounted.current)setBusy(false);}}
  async function reload(){const owner=auth.getSnapshot().account?.accountId;if(!owner)return;setBusy(true);try{const p=await accountRequest('profile?catalogue=2',owner,accountProfileSchema);setDraft({nickname:p.nickname??'',appearance:p.appearance,visibility:p.visibility});setVersion(p.version);setError('');}catch{setError('Could not reload your profile. Your draft has been kept.');}finally{setBusy(false);}}
  return <><div className={s.preview}><ProfileAvatar name={draft.nickname} appearance={draft.appearance}/><div><small>At the table</small><div className={s.seatPreview}><ProfileAvatar name={draft.nickname} appearance={draft.appearance}/><strong>{draft.nickname||'You'}</strong></div></div></div>
    <nav className={s.tabs} aria-label="Customisation categories">{(['illustrations','emoji','borders','sharing'] as const).map(k=><button type="button" key={k} aria-selected={tab===k} disabled={busy} onClick={()=>setTab(k)}>{k[0]!.toUpperCase()+k.slice(1)}</button>)}</nav>
    <div className={s.body}>{error&&<div role="alert" className={s.error}><p>{error}</p><button type="button" disabled={busy} onClick={()=>void reload()}>Reload latest profile</button></div>}
      {tab==='sharing'?<><div className={s.field}><label htmlFor={`${id}-name`}>Nickname</label><input id={`${id}-name`} autoComplete="nickname" maxLength={24} value={draft.nickname} disabled={busy} onChange={e=>setDraft({...draft,nickname:e.target.value})}/><small className={s.note}>Other players can use the same nickname.</small></div><div className={s.sectionTop}><h3>Profile sharing</h3></div>{([['chips','Total saved chips'],['statistics','Statistics'],['achievements','Achievements']] as const).map(([k,label])=><div className={s.visibility} key={k}><label htmlFor={`${id}-${k}`}>{label}</label><input type="checkbox" id={`${id}-${k}`} disabled={busy} aria-label={`Share ${label.toLowerCase()}`} checked={draft.visibility[k]} onChange={e=>setDraft({...draft,visibility:{...draft.visibility,[k]:e.target.checked}})}/></div>)}<p className={s.note}>Your nickname, picture and level stay visible. Your table stack is part of the game.</p></>:
      <><div className={s.sectionTop}><h3>{tab==='borders'?'Choose your border':tab==='emoji'?'Choose an emoji':'Choose your picture'}</h3></div><AppearancePicker name={draft.nickname} value={draft.appearance} category={tab} disabled={busy} onChange={appearance=>setDraft({...draft,appearance})}/></>}
    </div><footer className={s.footer}>{turn}<div className={s.saveActions}><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={s.primary} disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save changes'}</button></div></footer>
  </>;
}
