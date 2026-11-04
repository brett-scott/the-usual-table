import type { GameEntryRules,GameId,PlayerIcon,LobbyVisibility,TableSessionResponse } from '@casual/protocol';
import { createGameTable } from './onlineClient';
import { blackjackClientAdapter,crashClientAdapter } from './gameClientAdapters';
interface GameEntry {
  rules:GameEntryRules;
  create(input:{name:string;icon?:PlayerIcon;visibility:LobbyVisibility;funding?:'account';buyInUnits?:number;entryId?:string}):Promise<TableSessionResponse<unknown>>;
}
/** Register an entry together with its game client; unavailable games have no creation flow. */
export const gameEntries:Partial<Record<GameId,GameEntry>>={
  blackjack:{rules:blackjackClientAdapter.entry,create:input=>createGameTable(blackjackClientAdapter,input)},
  crash:{rules:crashClientAdapter.entry,create:input=>createGameTable(crashClientAdapter,input)},
};
