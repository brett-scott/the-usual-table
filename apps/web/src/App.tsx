import { lazy,Suspense,useEffect, useState,type ComponentType } from 'react';
import {gameIdFromHash,roomIdFromHash,type GameId,type TableInfo} from '@casual/protocol';
import {BlackjackTable as Table} from './BlackjackTable';
export {BlackjackTable as Table} from './BlackjackTable';
import { ApiError, forgetSession, tableInfo } from './onlineClient';
import { blackjackClientAdapter,crashClientAdapter,baccaratClientAdapter,duckRaceClientAdapter,rouletteClientAdapter,kenoClientAdapter } from './gameClientAdapters';
import { PlayingCard } from './PlayingCard';
import { GameHub } from './GameHub';
import { AccountProvider } from './AccountControls';
import { GameRoomEntry } from './GameRoomEntry';
import { TableRecovery } from './TableRecovery';
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
  const [result, setResult] = useState<{info: TableInfo} | {error: ApiError} | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void tableInfo(invite, abort.signal).then(info => {
      if (active) setResult({info});
    }).catch(problem => {
      if (!active) return;
      const error = problem instanceof ApiError ? problem : new ApiError('CLIENT_INCOMPATIBLE', 'Refresh the app to open this game.');
      if (error.code === 'ROOM_EXPIRED') forgetSession(invite);
      setResult({error});
    });
    return () => { active = false; abort.abort(); };
  }, [invite, attempt]);

  if (!result) return <TableRecovery state="loading" />;
  if ('info' in result) {
    const {info} = result;
    const view = gameRoomViews[info.gameId];
    if (view && info.adapterVersion === view.version) {
      const View = view.component;
      return <Suspense fallback={<TableRecovery state="loading" />}><View invite={invite} info={info}/></Suspense>;
    }
  } else if (result.error.code === 'ROOM_EXPIRED') {
    return <TableRecovery state="expired" />;
  }
  return <TableRecovery state="unavailable"
    message={'error' in result ? result.error.message : 'Refresh the app to open this game.'}
    onRetry={() => { setResult(null); setAttempt(value => value + 1); }} />;
}
function BlackjackRoom({invite,info}:{invite:string;info:TableInfo}) {
  return <GameRoomEntry invite={invite} info={info} adapter={blackjackClientAdapter} gameName="Blackjack"
    intro="Join your friends for a little blackjack. No account required, no real money." seatHint="Up to four friends"
    art={<><PlayingCard card={{id:'intro-a',rank:'A',suit:'spades'}}/><PlayingCard card={{id:'intro-k',rank:'K',suit:'hearts'}}/><span className={s.artChip}>21</span></>}
    footer={<><span>BLACKJACK, WITHOUT THE STAKES.</span><span>Six decks. Classic rules. Your pace.</span></>}
  >{(client,onLeave,actions)=><Table client={client} onLeave={onLeave} actions={actions}/>}</GameRoomEntry>;
}

