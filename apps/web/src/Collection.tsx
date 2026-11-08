import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {COSMETICS,DEFAULT_APPEARANCE,DEFAULT_COSMETICS,collectionSchema,cosmeticKey,type Collection,type CosmeticCategory,type CosmeticSelection} from '@casual/protocol';
import {accountRequest} from './accountRequest';
import type {AuthController} from './authClient';
import {CardAppearance,type CardFace,type CardAppearanceValue} from './cardAppearance';
import {ProfileAvatar} from './ProfileAvatar';
import {PlayingCard} from './PlayingCard';
import s from './Collection.module.css';
import './collectionTokens.css';

function stored(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function persist(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Preferences remain usable without storage. */}}
function freeSelection():CosmeticSelection{return {...DEFAULT_COSMETICS,theme:stored('casual-theme')==='midnight'?'midnight':'classic',back:stored('casual-card-back')==='geometric'?'geometric':'traditional'};}
type ContextValue={selection:CosmeticSelection;appearance:CardAppearanceValue;owned:readonly string[];open(category?:CosmeticCategory):void;equip(category:CosmeticCategory,id:string):Promise<void>;setFace(face:CardFace):void;motion:boolean;setMotion(value:boolean):void;reduced:boolean;loading:boolean;error:string;refresh():void;account:boolean};
const Context=createContext<ContextValue|null>(null);
export function useCollection(){const value=useContext(Context);if(!value)throw new Error('Collection provider missing');return value;}
export function useTableLook(){
 const collection=useCollection();
 return {theme:collection.selection.theme,appearance:collection.appearance,
  setTheme(value:CosmeticSelection['theme']){void collection.equip('theme',value).catch(()=>collection.open('theme'));},
  setAppearance(value:CardAppearanceValue){collection.setFace(value.face);if(value.back!==collection.selection.back)void collection.equip('back',value.back).catch(()=>collection.open('back'));}};
}
export function CollectionProvider({auth,children}:{auth:AuthController;children:ReactNode}){
 const state=useSyncExternalStore(auth.subscribe,auth.getSnapshot);const owner=state.account?.accountId;
 const [guest,setGuest]=useState(freeSelection);const [data,setData]=useState<Collection|null>(null);const dataRef=useRef(data);dataRef.current=data;
 const [face,setFaceState]=useState<CardFace>(()=>stored('casual-card-face')==='large-index'?'large-index':'classic');
 const [motion,setMotionState]=useState(()=>stored('usual-border-motion')!=='off');const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [hidden,setHidden]=useState(document.hidden);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const [category,setCategory]=useState<CosmeticCategory>('theme');const [opened,setOpened]=useState(false);const opener=useRef<HTMLElement|null>(null);
 useEffect(()=>setOpened(false),[owner]);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const changed=()=>setReduced(query.matches);const visibility=()=>setHidden(document.hidden);query.addEventListener('change',changed);document.addEventListener('visibilitychange',visibility);return()=>{query.removeEventListener('change',changed);document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{
  if(!owner){setData(null);setError('');setLoading(false);return;}
  if(dataRef.current?.accountId===owner&&dataRef.current.profile.version===state.profile?.version&&revision===0)return;
  const abort=new AbortController();setLoading(true);setError('');
  void accountRequest('collection',owner,collectionSchema,'GET',abort.signal).then(value=>{if(!abort.signal.aborted&&auth.getSnapshot().account?.accountId===owner){setData(value);auth.applyProfile(value.profile);}}).catch(()=>{if(!abort.signal.aborted)setError('Your collection could not be loaded. Please try again.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[owner,state.profile?.version,revision,auth]);
 const current=data?.accountId===owner?data:null;
 const selection=useMemo(()=>current?.selection??{...guest,border:owner?state.profile?.appearance.border??'none':guest.border},[current?.selection,guest,owner,state.profile?.appearance.border]);
 const owned=current?.owned??COSMETICS.filter(c=>c.free).map(c=>cosmeticKey(c.category,c.id));
 useEffect(()=>{document.body.dataset.collectionTheme=selection.theme;document.body.dataset.borderMotion=!motion||reduced?'off':hidden?'paused':'on';return()=>{delete document.body.dataset.collectionTheme;delete document.body.dataset.borderMotion;};},[selection.theme,motion,reduced,hidden]);
 async function equip(category:CosmeticCategory,id:string){
  const definition=COSMETICS.find(c=>c.category===category&&c.id===id);if(!definition)throw new Error('Choose a collection item.');
  if(owner){
   const current=dataRef.current;if(current?.accountId!==owner)throw new Error('Reload your collection before equipping.');
   try{const value=await accountRequest('collection',owner,collectionSchema,'POST',undefined,{category,id,version:current.profile.version});if(auth.getSnapshot().account?.accountId!==owner)throw new Error('Account changed');setData(value);dataRef.current=value;auth.applyProfile(value.profile);}
   catch(problem){throw new Error(problem instanceof Error&&problem.message==='PROFILE_CONFLICT'?'Your profile changed. Reload your collection before equipping.':problem instanceof Error&&problem.message==='COSMETIC_LOCKED'?'Earn this item before equipping it.':'Your choice could not be saved. Please try again.',{cause:problem});}
  }else{
   if(!definition.free||category==='border')throw new Error('Sign in to save your collection.');
   setGuest(value=>({...value,[category]:id}));if(category==='theme')persist('casual-theme',id);if(category==='back')persist('casual-card-back',id);
  }
 }
 const value:ContextValue={selection,appearance:{face,back:selection.back,artwork:selection.artwork},owned,equip,loading,error,account:!!owner,motion,reduced,
  open(next='theme'){opener.current=document.activeElement as HTMLElement;setCategory(next);if(owner){setLoading(true);setRevision(n=>n+1);}setOpened(true);},
  refresh(){setRevision(n=>n+1);},setFace(next){setFaceState(next);persist('casual-card-face',next);},setMotion(next){setMotionState(next);persist('usual-border-motion',next?'on':'off');}};
 return <Context.Provider value={value}>{children}{opened&&<CollectionDialog initial={category} name={state.nickname??'You'} appearance={state.profile?.appearance??DEFAULT_APPEARANCE} onClose={()=>{setOpened(false);opener.current?.focus();}}/>}</Context.Provider>;
}
function CollectionDialog({initial,name,appearance,onClose}:{initial:CosmeticCategory;name:string;appearance:import('@casual/protocol').Appearance;onClose():void}){
 const collection=useCollection();const [category,setCategory]=useState(initial);const [draft,setDraft]=useState({...collection.selection});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null);const dirty=useRef(false);
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{if(!collection.loading&&!dirty.current)setDraft({...collection.selection});},[collection.loading,collection.selection]);
 const definition=COSMETICS.find(c=>c.category===category&&c.id===draft[category])!;const earned=collection.owned.includes(cosmeticKey(category,definition.id));const equipped=collection.selection[category]===definition.id;
 const unavailable=collection.account&&(collection.loading||!!collection.error);const cards=category==='artwork'||category==='back';
 const previewAppearance={...appearance,border:draft.border};
 const renderCard=(hidden:boolean,artwork=draft.artwork,back=draft.back)=><CardAppearance.Provider value={{face:collection.appearance.face,artwork,back}}><PlayingCard card={hidden?{hidden:true}:{id:'collection-preview',rank:'A',suit:'spades'}} reducedMotion/></CardAppearance.Provider>;
 async function save(){setBusy(true);setError('');try{await collection.equip(category,definition.id);}catch(problem){setError(problem instanceof Error?problem.message:'Could not save your choice.');}finally{setBusy(false);}}
 return <dialog ref={dialog} className={s.dialog} aria-label="Your collection" onCancel={event=>{event.preventDefault();onClose();}}>
  <header className={s.header}><h2>Your collection</h2><div><label className={s.motion}><input type="checkbox" aria-label="Border motion" checked={collection.motion&&!collection.reduced} disabled={collection.reduced} onChange={e=>collection.setMotion(e.target.checked)}/>Border motion</label><button aria-label="Close collection" onClick={onClose}>×</button></div></header>
  <div className={s.studio}>
   <section className={s.previewPanel} aria-label="Cosmetic preview"><div className={s.felt} data-preview-theme={draft.theme}>
    <div className={s.dealer}><span>Dealer</span><div>{renderCard(false)}{renderCard(true)}</div></div><span className={s.mark}>THE USUAL TABLE</span>
    <div className={s.hand}><CardAppearance.Provider value={{face:collection.appearance.face,artwork:draft.artwork,back:draft.back}}><PlayingCard card={{id:'preview-ace',rank:'A',suit:'spades'}} reducedMotion/><PlayingCard card={{id:'preview-nine',rank:'9',suit:'hearts'}} reducedMotion/></CardAppearance.Provider></div>
    <div className={s.seat}><ProfileAvatar name={name} appearance={previewAppearance}/><b>{name}</b></div><span className={s.chip}>100</span>
   </div><div className={s.previewFooter}><strong>{definition.name}</strong><div><ProfileAvatar name={name} appearance={previewAppearance} size={30}/><span>Table size</span></div></div></section>
   <section className={s.choicesPanel}><nav className={s.tabs} aria-label="Collection categories">{(['theme','artwork','border'] as const).map(c=><button key={c} aria-selected={c==='artwork'?cards:category===c} onClick={()=>setCategory(c)}>{c==='theme'?'Themes':c==='artwork'?'Cards':'Borders'}</button>)}</nav>
    <div className={s.body}>
     {(collection.error||error)&&<div className={s.error} role="alert"><p>{error||collection.error}</p><button disabled={busy} onClick={()=>{setError('');collection.refresh();}}>Reload collection</button></div>}
     {collection.loading&&<p role="status">Loading collection…</p>}
     {cards&&<div className={s.cardControls}><div>{(['artwork','back'] as const).map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c==='artwork'?'Faces':'Backs'}</button>)}</div><select aria-label="Card index size" value={collection.appearance.face} onChange={event=>collection.setFace(event.target.value as CardFace)}><option value="classic">Classic index</option><option value="large-index">Large index</option></select></div>}
     <div className={s.grid}>{COSMETICS.filter(c=>c.category===category).map(c=>{const selected=draft[category]===c.id;const owned=collection.owned.includes(cosmeticKey(category,c.id));const equipped=collection.selection[category]===c.id;return <button type="button" key={c.id} className={s.option} data-preview={selected} aria-pressed={selected} aria-label={`${c.name}, ${equipped?'Equipped':owned?'Earned':'Locked'}`} disabled={busy} onClick={()=>{dirty.current=true;setDraft(value=>({...value,[category]:c.id}));}}>
      <div className={s.art} data-preview-theme={category==='theme'?c.id:undefined}>
       {category==='theme'?<span className={s.miniTable}>♣</span>:category==='border'?<><ProfileAvatar name={name} appearance={{...appearance,border:c.id as CosmeticSelection['border']}} size={60} motion={selected}/><ProfileAvatar name={name} appearance={{...appearance,border:c.id as CosmeticSelection['border']}} size={28} motion={selected}/></>:<div className={s.cardSample}>{renderCard(category==='back',category==='artwork'?c.id as CosmeticSelection['artwork']:draft.artwork,category==='back'?c.id as CosmeticSelection['back']:draft.back)}{renderCard(false,category==='artwork'?c.id as CosmeticSelection['artwork']:draft.artwork)}</div>}
       {c.motion&&<small className={s.motionTag}>Animated</small>}{selected&&<i className={s.selected}>✓</i>}
      </div><div className={s.optionCopy}><b>{c.name}</b><small>{c.requirement}</small><span>{equipped?'Equipped':owned?'Earned':'◇ Locked'}</span></div>
     </button>;})}</div>
    </div><footer className={s.equip}><div><strong>{definition.name}</strong><small>{!collection.account&&!definition.free?'Sign in to earn this look':!earned?definition.requirement:definition.free?'Included':'Earned'}</small></div><button className={s.primary} disabled={busy||unavailable||!earned||equipped||!collection.account&&category==='border'} onClick={()=>void save()}>{busy?'Saving…':unavailable?'Unavailable':equipped?'Equipped':!earned?'Locked · Preview only':!collection.account&&category==='border'?'Set in guest profile':'Equip'}</button></footer>
   </section>
  </div><footer className={s.note}>Only your table and cards change. Your border is shared.</footer>
 </dialog>;
}
