import { gameCommandEnvelopeSchema } from '@casual/protocol';
import { assertRule } from '../roomMembership';
import { gameAdapters,type GameAdapterRegistry } from './registry';
import type { HostedRoom } from './contracts';
export function parseGameCommand(room:HostedRoom,input:unknown,registry:GameAdapterRegistry=gameAdapters){
  const game=registry.forRoom(room);
  if(input&&typeof input==='object'&&'type' in input&&input.type==='game-command'){
    const envelope=gameCommandEnvelopeSchema.safeParse(input);assertRule(envelope.success,'INVALID_COMMAND','Send a valid game command envelope.');
    assertRule(envelope.data.gameId===game.gameId,'WRONG_GAME','This command belongs to a different game.');
    assertRule(envelope.data.adapterVersion===game.version,'CLIENT_INCOMPATIBLE','This command needs a different game version.');
    input=envelope.data.command;
  }else assertRule(game.gameId==='blackjack','CLIENT_INCOMPATIBLE','A versioned game command is required.');
  return game.parseCommand(input);
}
