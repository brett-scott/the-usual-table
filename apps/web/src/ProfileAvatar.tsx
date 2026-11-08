import { PLAYER_ICONS, type Appearance } from '@casual/protocol';
import s from './PlayerProfiles.module.css';
export function ProfileAvatar({name,appearance,size,motion=true}:{name:string;appearance:Appearance;size?:number;motion?:boolean}){
  const a=appearance.avatar;
  return <span className={s.avatar} data-motion={motion} data-emoji={a.kind==='emoji'} data-border={appearance.border} data-avatar={a.kind==='initials'?'initials':a.id} style={size?{width:size,height:size}:undefined}>
    {a.kind==='illustration'?<Illustration id={a.id}/>:<span className={s.face} role={a.kind==='emoji'?'img':undefined} aria-label={a.kind==='emoji'?`${PLAYER_ICONS.find(i=>i.emoji===a.id)?.label??''} player icon`:undefined} aria-hidden={a.kind==='initials'?true:undefined}>{a.kind==='emoji'?a.id:name.slice(0,1).toUpperCase()}</span>}
  </span>;
}
function Illustration({id}:{id:string}){
  let art;let bg='#b9c4a4';
  const eyes=<><circle cx="37" cy="48" r="3.5" fill="#253d35"/><circle cx="63" cy="48" r="3.5" fill="#253d35"/></>;
  switch(id){
    case 'fox':art=<><path d="M18 19 40 29Q50 23 60 29L82 19 78 61Q71 84 50 88 29 84 22 61Z" fill="#d78c52"/><path d="M23 29 36 35 25 44M77 29 64 35 75 44" fill="#693e33"/><path d="M21 52Q40 48 50 70 60 48 79 52 73 78 50 88 27 78 21 52" fill="#fff0cb"/>{eyes}<path d="m43 67 7 9 7-9Z" fill="#253d35"/></>;break;
    case 'owl':bg='#c4c9ae';art=<><path d="m21 20 21 12q8-3 16 0l21-12-3 37q-1 28-26 31-25-3-26-31Z" fill="#826b63"/><path d="M24 48q2-19 25-8 24-11 27 8 1 22-26 29-27-7-26-29" fill="#e9dcb8"/><circle cx="36" cy="49" r="12" fill="#b3b995"/><circle cx="64" cy="49" r="12" fill="#b3b995"/>{eyes}<path d="m44 61 6 9 6-9Z" fill="#b18042"/></>;break;
    case 'panda':bg='#a5b8ae';art=<><circle cx="25" cy="29" r="15" fill="#344e43"/><circle cx="75" cy="29" r="15" fill="#344e43"/><ellipse cx="50" cy="55" rx="36" ry="34" fill="#f0e8d0"/><ellipse cx="35" cy="48" rx="11" ry="14" transform="rotate(23 35 48)" fill="#344e43"/><ellipse cx="65" cy="48" rx="11" ry="14" transform="rotate(-23 65 48)" fill="#344e43"/><circle cx="36" cy="47" r="3" fill="#f0e8d0"/><circle cx="64" cy="47" r="3" fill="#f0e8d0"/><path d="m43 65 7 7 7-7Z" fill="#344e43"/></>;break;
    case 'robot':bg='#8ba8a2';art=<><path d="M50 15v13" stroke="#3f6258" strokeWidth="5"/><circle cx="50" cy="13" r="5" fill="#e1a36b"/><rect x="17" y="28" width="66" height="54" rx="15" fill="#d9e0cd"/><path d="M11 45v21m78-21v21" stroke="#3f6258" strokeWidth="7"/><rect x="27" y="41" width="46" height="19" rx="8" fill="#3f6258"/><circle cx="37" cy="50" r="4" fill="#e1c382"/><circle cx="63" cy="50" r="4" fill="#e1c382"/><path d="M38 71h24" stroke="#3f6258" strokeWidth="4" strokeLinecap="round"/></>;break;
    case 'cat':bg='#b8c2af';art=<><path d="m20 17 24 15h12l24-15-2 43Q72 86 50 87 28 86 22 60Z" fill="#c2a58d"/><path d="m27 28 11 8-12 7m47-15-11 8 12 7" fill="#d8b3a3"/>{eyes}<path d="m45 61 5 5 5-5Z" fill="#67483f"/><path d="m12 57 22 5m-20 9 20-3m54-11-22 5m20 9-20-3" stroke="#67483f" strokeWidth="2"/></>;break;
    case 'penguin':bg='#b1c6ca';art=<><ellipse cx="50" cy="58" rx="32" ry="43" fill="#344d48"/><path d="M27 55q0-25 23-12 23 13 23 12v20q-23 20-46 0Z" fill="#f0e7ce"/>{eyes}<path d="m42 59 8 8 8-8Z" fill="#d5a165"/></>;break;
    case 'moon':bg='#596c75';art=<><circle cx="50" cy="50" r="32" fill="#e9d8a4"/><circle cx="65" cy="38" r="29" fill={bg}/><path d="m24 21 2 5 5 2-5 2-2 5-2-5-5-2 5-2m53 35 2 6 6 2-6 2-2 6-2-6-6-2 6-2" fill="#e9d8a4"/></>;break;
    default:bg='#486a54';art=<><circle cx="50" cy="36" r="17" fill="#e3d3a1"/><circle cx="34" cy="56" r="17" fill="#e3d3a1"/><circle cx="66" cy="56" r="17" fill="#e3d3a1"/><path d="M44 59 38 82h24l-6-23Z" fill="#e3d3a1"/></>;
  }
  return <svg viewBox="0 0 100 100" role="img" aria-label={`${id[0]!.toUpperCase()+id.slice(1)} illustrated avatar`}><rect width="100" height="100" fill={bg}/>{art}</svg>;
}
