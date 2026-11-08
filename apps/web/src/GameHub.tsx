import { useEffect, useRef } from 'react';
import { GAME_CATALOG,type GameId } from '@casual/protocol';
import { lastTable } from './onlineClient';
import { gameEntries } from './gameEntries';
import s from './GameHub.module.css';
import { AccountControls } from './AccountControls';
import { useTableIdentity } from './TableIdentity';
import { GameLobbyDialog } from './GameLobbyDialog';
import { GameArtwork } from './GameArtwork';

const galleryDetails:Partial<Record<GameId,{category:string;short:string}>>={
  blackjack:{category:'The card table',short:'Find your twenty-one.'},
  baccarat:{category:'The card table',short:'Player. Banker. Tie.'},
  keno:{category:'The number draw',short:'Choose your numbers.'},
  roulette:{category:'The wheel',short:'One wheel. Your numbers.'},
  'duck-race':{category:'The race',short:'Pick your duck.'},
  crash:{category:'The multiplier',short:'Choose your moment.'},
};

export function GameHub({ browse = false,gameId='blackjack' }: { browse?: boolean;gameId?:GameId }) {
  const recent = lastTable();
  const identity = useTableIdentity();
  const catalog=useRef<HTMLDivElement>(null),openedGame=useRef<GameId|null>(null);
  useEffect(()=>{
    if(browse){openedGame.current=gameId;return;}
    if(openedGame.current){catalog.current?.querySelector<HTMLAnchorElement>(`[data-game="${openedGame.current}"] a`)?.focus();openedGame.current=null;}
  },[browse,gameId]);
  const available=!!gameEntries[gameId]&&GAME_CATALOG.some(game=>game.id===gameId&&game.status==='available');
  return <div className={s.hub}>
    <div className={s.galleryShell} inert={browse&&available} aria-hidden={browse&&available||undefined}>
    <header className={s.header}><a className={s.brand} href="#/games"><span aria-hidden="true">♣</span><span>The Usual Table</span></a><AccountControls showWallet={!browse} beforeSignIn={identity.saveDraft} /></header>
    {browse&&!available?<main className={s.main}><h1>This game is coming soon.</h1><a href="#/games">All games</a></main>:<main className={s.main}>
      <div className={s.heading}><div><p className={s.eyebrow}>THE GAME ROOM</p><h1>Take your pick.</h1></div>{recent&&<a className={s.returnTable} href={`#/room/${recent.inviteId}`}>Return to your last table <span aria-hidden="true">↗</span></a>}</div>
      <div ref={catalog} className={s.catalog} role="region" aria-label="Game catalog" tabIndex={0}>{GAME_CATALOG.filter(game=>game.status==='available'&&gameEntries[game.id]).map(game => <article key={game.id} className={s.game} data-game={game.id} aria-label={game.name}>
        <div className={s.art} aria-hidden="true"><GameArtwork gameId={game.id}/><span className={s.artNumber}>{game.badge}</span></div>
        <div className={s.gameCopy}><p className={s.category}>{galleryDetails[game.id]?.category??'The game room'}</p><h2>{game.name}</h2><p className={s.description}>{galleryDetails[game.id]?.short??game.description}</p>
        <a className={s.findLink} href={`#/games/${game.id}`} aria-haspopup="dialog" onClick={identity.saveDraft}>Find a Table <span aria-hidden="true">↗</span></a></div>
      </article>)}</div>
    </main>}
    </div>
    {browse&&available&&<GameLobbyDialog key={gameId} identity={identity} gameId={gameId} onClose={()=>{identity.saveDraft();location.hash='/games';}}/>}
  </div>;
}

