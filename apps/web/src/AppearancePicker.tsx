import { PLAYER_ICONS,PROFILE_ILLUSTRATIONS,PROFILE_BORDERS,COSMETICS,type Appearance } from '@casual/protocol';
import {useCollection} from './Collection';
import { ProfileAvatar } from './ProfileAvatar';
import s from './PlayerProfiles.module.css';
export const borderNames:Record<Appearance['border'],string>={none:'Minimal',sage:'Sage',brass:'Brass',midnight:'Midnight',copper:'Copper',royal:'Amethyst',orbit:'Laurel',moonstone:'Moonstone','garden-edge':'Garden Edge','club-glint':'Club Glint','lunar-orbit':'Lunar Orbit','soft-halo':'Soft Halo'};
export function AppearancePicker({name,value,onChange,category,disabled=false}:{name:string;value:Appearance;onChange(value:Appearance):void;category:'illustrations'|'emoji'|'borders';disabled?:boolean}){
  const collection=useCollection();const borders=[...PROFILE_BORDERS,...COSMETICS.filter(c=>c.category==='border'&&!c.free&&collection.account&&collection.owned.includes(`border:${c.id}`)).map(c=>c.id as Appearance['border'])];
  const choices=category==='borders'?borders.map(id=>({key:id,label:borderNames[id],value:{...value,border:id}})):
    category==='emoji'?PLAYER_ICONS.map(i=>({key:i.emoji,label:i.label,value:{...value,avatar:{kind:'emoji' as const,id:i.emoji}}})):
    [...PROFILE_ILLUSTRATIONS.map(id=>({key:id,label:id[0]!.toUpperCase()+id.slice(1),value:{...value,avatar:{kind:'illustration' as const,id}}})),{key:'initials',label:'Initials',value:{...value,avatar:{kind:'initials' as const}}}];
  return <div className={`${s.collection} ${category==='borders'?s.borders:''}`} aria-label={category==='borders'?'Border choices':'Picture choices'}>{choices.map(c=>{
    const selected=category==='borders'?value.border===c.key:value.avatar.kind==='initials'?c.key==='initials':value.avatar.id===c.key;
    return <button type="button" key={c.key} disabled={disabled} className={s.choice} aria-label={`${c.label} ${category==='borders'?'border':'avatar'}`} aria-pressed={selected} onClick={()=>onChange(c.value)}>
      <ProfileAvatar name={name} appearance={category==='borders'?c.value:{...c.value,border:'none'}} motion={selected}/><span>{c.label}</span>{selected&&<i aria-hidden="true">✓</i>}
    </button>;
  })}</div>;
}
