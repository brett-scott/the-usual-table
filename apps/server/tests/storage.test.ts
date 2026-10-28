import { createDecks, transition, type Rank } from '@casual/engine';
import { expect, it } from 'vitest';
import { newRoom } from '../src/roomState';
import { restoreRoom } from '../src/roomStorage';

function activeRoom() {
  const room = newRoom('a'.repeat(32), 'player', 'Guest', 'b'.repeat(64), max => max - 1, 1000);
  const rest = createDecks(); const ranks: Rank[] = ['2', '10', '3', '7'];
  room.engine.shoe.cards = [...ranks.map(rank => rest.splice(rest.findIndex(c => c.rank === rank), 1)[0]!), ...rest];
  room.engine = transition(room.engine, { protocol: 1, id: 'deal', revision: 0, roundId: 0, playerId: 'player', action: { type: 'Ready' } }, max => max - 1, 5000);
  return room;
}
function legacyRoom() {
  const room = activeRoom(); const m = room.members.player!;
  return { ...room, schema: 1, members: { player: { hash: m.hash, connected: m.connected, controllerId: m.controllerId, leaveAfterRound: m.leaveAfterRound } }, tickets: [{ hash: 'c'.repeat(64), playerId: 'player', expires: 100_000 }] };
}
it('upgrades version 1 without changing the shoe, active hand, deadline, accounting or accepted commands', () => {
  const legacy = legacyRoom(); const before = JSON.stringify(legacy);
  const result = restoreRoom(legacy, 10_000);
  expect(result.migrated).toBe(true); expect(result.room.schema).toBe(2); expect(result.room.engine).toEqual(legacy.engine);
  expect(result.room.members.player!.reservationDeadline).toBe(70_000); expect(result.room.tickets).toEqual([]);
  expect(JSON.stringify(legacy)).toBe(before);
});
it('does not repeat migration or extend a restored reservation on subsequent reads', () => {
  const once = restoreRoom(legacyRoom(), 10_000).room;
  const again = restoreRoom(once, 40_000);
  expect(again.migrated).toBe(false); expect(again.room).toEqual(once);
});
it.each(['unknown-version', 'short-shoe', 'duplicate-instance', 'wrong-card', 'wrong-active-hand', 'missing-member', 'duplicate-seat'] as const)('rejects %s without mutating stored input', mode => {
  const room = activeRoom(); let damaged: unknown = room;
  if (mode === 'unknown-version') damaged = { ...room, schema: 3 };
  if (mode === 'short-shoe') room.engine.shoe.cards.pop();
  if (mode === 'duplicate-instance') room.engine.shoe.cards[5] = room.engine.shoe.cards[6]!;
  if (mode === 'wrong-card') room.engine.shoe.cards[5]!.rank = 'K';
  if (mode === 'wrong-active-hand') room.engine.activeHand = 3;
  if (mode === 'missing-member') delete room.members.player;
  if (mode === 'duplicate-seat') room.engine.players.push({ ...room.engine.players[0]!, id: 'other', hands: [] });
  const before = JSON.stringify(damaged); expect(() => restoreRoom(damaged, 10_000)).toThrow(); expect(JSON.stringify(damaged)).toBe(before);
});
