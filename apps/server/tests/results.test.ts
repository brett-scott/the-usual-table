import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { expireRoomDecisions, resultsDeadline } from '../src/roomState';
import { restoreRoom } from '../src/roomStorage';
import { bindings, close, connect, create, edit, inspect, join, rigShoe } from './helpers';

async function settled() {
  const guest = await create(); const peer = await connect(guest.session);
  await rigShoe(guest.session.inviteId, ['10', '6', '8', '10', '5']);
  await peer.send({ type: 'StartBetting' }); await peer.send({ type: 'Ready' }); await peer.send({ type: 'Stand' });
  return { guest, peer };
}
it('settles dealer blackjack after the last insurance decision without offering a player turn', async () => {
  const host = await create('Host'); const guest = await join(host.session.inviteId, 'Guest');
  const a = await connect(host.session); const b = await connect(guest.session);
  try {
    await rigShoe(host.session.inviteId, ['K', 'K', 'A', 'K', '7', 'Q']);
    await a.send({ type: 'StartBetting' }); await a.send({ type: 'PlaceBet', amount: 200 });
    await a.send({ type: 'Ready' }); await b.send({ type: 'Ready' });
    expect((await a.last()).phase).toBe('INSURANCE');
    expect(await a.send({ type: 'InsuranceDecision', amount: 0 })).toMatchObject({ type: 'ack' });
    const before = await a.last(); expect(before.phase).toBe('INSURANCE');
    expect(await b.send({ type: 'InsuranceDecision', amount: 0 })).toMatchObject({ type: 'ack' });
    const after = await a.last(); const other = await b.last();
    expect(after.revision).toBeGreaterThan(before.revision); expect(after.phase).toBe('ROUND_COMPLETE');
    expect(other.phase).toBe(after.phase); expect(other.revision).toBe(after.revision); expect(other.roundDeadline).toBe(after.roundDeadline);
    expect(after.activePlayerId).toBeNull(); expect(after.activeHandId).toBeNull();
    expect(after.legalActions).not.toContain('Stand'); expect(other.legalActions).not.toContain('Stand');
    expect(after.players.map(player => player.roundResult)).toEqual([{ net: -200, outcome: 'lost' }, { net: -20, outcome: 'lost' }]);
    expect(after.roundDeadline).toBeGreaterThan(Date.now());
    expect(await a.send({ type: 'NextRound' })).toMatchObject({ type: 'ack' });
    for (const peer of [a, b]) { const state = await peer.last(); expect(state.phase).toBe('BETTING'); expect(state.legalActions).toContain('Ready'); }
  } finally { await close(a, b); }
});
it('persists a shared ten-second results window, then opens betting exactly once', async () => {
  const { guest, peer } = await settled();
  try {
    const state = await peer.last(); expect(state.phase).toBe('ROUND_COMPLETE');
    expect(state.players[0]!.roundResult).toEqual({ net: -20, outcome: 'lost' });
    const room = await inspect(guest.session.inviteId, room => room);
    expect(state.roundDeadline).toBe(room.engine.updatedAt + 1420 + 10_000);
    expect(expireRoomDecisions(room, max => max - 1, state.roundDeadline! - 1)).toBe(room);
    const next = expireRoomDecisions(room, max => max - 1, state.roundDeadline!);
    expect(next.engine.phase).toBe('BETTING'); expect(next.bettingDeadline).toBe(state.roundDeadline! + 30_000);
    expect(next.engine.shoe).toEqual(room.engine.shoe); expect(next.engine.players[0]!.balance).toBe(room.engine.players[0]!.balance);
    expect(expireRoomDecisions(next, max => max - 1, state.roundDeadline!)).toBe(next);
    await evictDurableObject(bindings.ROOMS.getByName(guest.session.inviteId));
    expect((await peer.last()).roundDeadline).toBe(state.roundDeadline);
    await edit(guest.session.inviteId, room => { room.roundDeadline = Date.now() - 1; });
    await runDurableObjectAlarm(bindings.ROOMS.getByName(guest.session.inviteId));
    expect((await peer.last()).phase).toBe('BETTING');
  } finally { await close(peer); }
});
it('lets the host skip results without a late alarm resetting the new wager window', async () => {
  const { guest, peer } = await settled();
  try {
    expect((await peer.send({ type: 'NextRound' })).type).toBe('ack');
    const betting = await peer.last(); expect(betting.phase).toBe('BETTING'); expect(betting.roundDeadline).toBeNull();
    await peer.send({ type: 'PlaceBet', amount: 200 });
    await runDurableObjectAlarm(bindings.ROOMS.getByName(guest.session.inviteId));
    const current = await peer.last(); expect(current.room!.bettingDeadline).toBe(betting.room!.bettingDeadline); expect(current.players[0]!.bet).toBe(200);
  } finally { await close(peer); }
});
it('does not restart completed legacy rooms on restore or open betting with no connected guests', async () => {
  const { guest, peer } = await settled();
  await close(peer);
  await runInDurableObject(bindings.ROOMS.getByName(guest.session.inviteId), async (_instance, storage) => {
    const saved = await storage.storage.get<import('../src/roomState').OnlineRoom>('room'); delete saved!.roundDeadline;
    const first = restoreRoom(saved, Date.now()).room; const deadline = resultsDeadline(first)!;
    expect(resultsDeadline(restoreRoom(first, Date.now() + 5000).room)).toBe(deadline);
    const next = expireRoomDecisions(first, max => max - 1, deadline);
    expect(next.engine.phase).toBe('ROUND_COMPLETE'); expect(next.roundDeadline).toBeNull(); expect(next.bettingDeadline).toBeNull();
  });
});
