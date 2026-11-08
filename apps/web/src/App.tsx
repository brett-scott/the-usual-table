import { lazy,Suspense,useEffect, useState,type ComponentType } from 'react';
import {gameIdFromHash,roomIdFromHash,type GameId,type TableInfo} from '@casual/protocol';
import {BlackjackTable as Table} from './BlackjackTable';
export {BlackjackTable as Table} from './BlackjackTable';
import { ApiError,tableInfo } from './onlineClient';
import { blackjackClientAdapter,crashClientAdapter,baccaratClientAdapter,duckRaceClientAdapter,rouletteClientAdapter,kenoClientAdapter } from './gameClientAdapters';
import { PlayingCard } from './PlayingCard';
import { GameHub } from './GameHub';
import { AccountControls, AccountProvider } from './AccountControls';
import { GameRoomEntry } from './GameRoomEntry';
import { CrashRoom } from './CrashTable';
import { BaccaratRoom } from './BaccaratTable';
import s from './App.module.css';

export function App() {
  return <AccountProvider><AppRoutes /></AccountProvider>;
}
function AppRoutes() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => { const changed = () => setHash(location.hash); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const invite = roomIdFromHash(hash);
  if (invite) return <GameRoomRoute key={invite} invite={invite} />;
  if (hash === '#/duck-race') return <GameHub browse gameId="duck-race"/>;
  const gameId=gameIdFromHash(hash);
  if (gameId) return <GameHub browse gameId={gameId}/>;
  return <GameHub />;
}

const RouletteRoom=lazy(()=>import('./RouletteTable').then(module=>({default:module.RouletteRoom})));
const DuckRaceRoom=lazy(()=>import('./DuckRace').then(module=>({default:module.DuckRaceRoom})));
const KenoRoom=lazy(()=>import('./KenoTable').then(module=>({default:module.KenoRoom})));
const gameRoomViews:Partial<Record<GameId,{version:number;component:ComponentType<{invite:string;info:TableInfo}>}>>={keno:{version:kenoClientAdapter.version,component:KenoRoom},roulette:{version:rouletteClientAdapter.version,component:RouletteRoom},'duck-race':{version:duckRaceClientAdapter.version,component:DuckRaceRoom},blackjack:{version:blackjackClientAdapter.version,component:BlackjackRoom},crash:{version:crashClientAdapter.version,component:CrashRoom},baccarat:{version:baccaratClientAdapter.version,component:BaccaratRoom}};
function GameRoomRoute({invite}:{invite:string}){
  const [info,setInfo]=useState<TableInfo|null>(null);const [error,setError]=useState<ApiError|null>(null);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;const abort=new AbortController();setError(null);
    void tableInfo(invite,abort.signal).then(value=>{if(active)setInfo(value);}).catch(problem=>{if(active)setError(problem instanceof ApiError?problem:new ApiError('CLIENT_INCOMPATIBLE','This app cannot open this game. Refresh and try again.'));});
    return()=>{active=false;abort.abort();};},[invite,attempt]);
  const view=info?gameRoomViews[info.gameId]:undefined;const View=view?.component;
  if(info&&View&&info.adapterVersion===view?.version)return <Suspense fallback={<main className={s.welcome}><p role="status">Opening your table...</p></main>}><View invite={invite} info={info}/></Suspense>;
  return <main className={s.welcome}><div className={s.welcomeNav}><a href="#/games">All games</a><AccountControls/></div><div className={s.welcomeMain}>
    {!error&&!info?<p role="status">Opening your table…</p>:<><h1>{error?.code==='ROOM_EXPIRED'?'Table expired':'Table unavailable'}</h1><p>{error?.message??'Refresh the app to open this game.'}</p><button onClick={()=>setAttempt(x=>x+1)}>Retry table</button><a href="#/games">Find or create another table</a></>}
  </div></main>;
}
function BlackjackRoom({invite,info}:{invite:string;info:TableInfo}) {
  return <GameRoomEntry invite={invite} info={info} adapter={blackjackClientAdapter} gameName="Blackjack"
    intro="Join your friends for a little blackjack. No account required, no real money." seatHint="Up to four friends"
    art={<><PlayingCard card={{id:'intro-a',rank:'A',suit:'spades'}}/><PlayingCard card={{id:'intro-k',rank:'K',suit:'hearts'}}/><span className={s.artChip}>21</span></>}
    footer={<><span>BLACKJACK, WITHOUT THE STAKES.</span><span>Six decks. Classic rules. Your pace.</span></>}
  >{(client,onLeave)=><Table client={client} onLeave={onLeave}/>}</GameRoomEntry>;
}

