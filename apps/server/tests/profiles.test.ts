import { evictDurableObject } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { expect,it } from 'vitest';
import { roomProfileSchema } from '@casual/protocol';
import { create,join,http,bindings,inspect,origin,edit } from './helpers';
it('requires current room membership and never accepts arbitrary account identifiers',async()=>{
  expect((await http('',undefined,{name:'Unowned',appearance:{avatar:{kind:'initials'},border:'club-glint'}})).status).toBe(400);
  const host=await create('Host');const peer=await join(host.session.inviteId,'Host');const outsider=await create('Outside');
  expect((await http(`/${host.session.inviteId}/profile`,undefined,{playerId:peer.session.playerId})).status).toBe(401);
  expect((await http(`/${host.session.inviteId}/profile`,outsider.session,{playerId:peer.session.playerId})).status).toBe(401);
  expect((await http(`/${host.session.inviteId}/profile`,host.session,{accountId:crypto.randomUUID()})).status).toBeGreaterThanOrEqual(400);
  expect((await http(`/${host.session.inviteId}/profile`,host.session,{playerId:outsider.session.playerId})).status).toBe(503);
  const response=await http(`/${host.session.inviteId}/profile`,host.session,{playerId:peer.session.playerId});
  expect(response.status).toBe(200);expect(roomProfileSchema.parse(await response.json())).toMatchObject({name:'Host',stackUnits:100000,funding:'temporary',profile:{kind:'guest'}});
});
for(const game of ['blackjack','baccarat','crash','duck-race','roulette'])it(`${game} keeps legacy snapshots free of unnegotiated profile fields`,async()=>{
  const response=await SELF.fetch(`https://example.test/api/v1/games/${game}/rooms`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Legacy',appearance:{avatar:{kind:'illustration',id:'owl'},border:'sage'}})});
  expect(response.status).toBe(201);const created=await response.json<{session:import('@casual/protocol').GuestSession;snapshot:{players:unknown[]}}>();
  expect(created.snapshot.players[0]).not.toHaveProperty('appearance');expect(created.snapshot.players[0]).not.toHaveProperty('profileVersion');
  const modern=await http(`/${created.session.inviteId}/snapshot?capabilities=usual-player-profiles-v1`,created.session,undefined,'GET');
  expect((await modern.json<{snapshot:{players:unknown[]}}>()).snapshot.players[0]).toMatchObject({appearance:{avatar:{kind:'illustration',id:'owl'},border:'sage'},profileVersion:0});
  await edit(created.session.inviteId,room=>{room.members[created.session.playerId]!.appearance={avatar:{kind:'illustration',id:'owl'},border:'club-glint'};});
  const legacy=await http(`/${created.session.inviteId}/snapshot?capabilities=usual-player-profiles-v1`,created.session,undefined,'GET');
  expect((await legacy.json<{snapshot:{players:unknown[]}}>()).snapshot.players[0]).toMatchObject({appearance:{border:'brass'}});
  const collection=await http(`/${created.session.inviteId}/snapshot?capabilities=usual-player-profiles-v1,usual-player-profiles-v2`,created.session,undefined,'GET');
  expect((await collection.json<{snapshot:{players:unknown[]}}>()).snapshot.players[0]).toMatchObject({appearance:{border:'club-glint'}});
});
it('persists catalogue appearance without changing engine identity, balance or timers through eviction',async()=>{
  const response=await http('?capabilities=usual-player-profiles-v1',undefined,{name:'Portrait',appearance:{avatar:{kind:'illustration',id:'panda'},border:'midnight'}});
  const host=await response.json<import('@casual/protocol').SessionResponse>();expect(response.status).toBe(201);
  const before=await inspect(host.session.inviteId,r=>r.engine);
  await evictDurableObject(bindings.ROOMS.getByName(host.session.inviteId));
  const resumed=await http('/'+host.session.inviteId+'/snapshot?capabilities=usual-player-profiles-v1',host.session,undefined,'GET');
  expect((await resumed.json<{snapshot:import('@casual/protocol').Snapshot}>()).snapshot.players[0]!.appearance).toEqual({avatar:{kind:'illustration',id:'panda'},border:'midnight'});
  expect(await inspect(host.session.inviteId,r=>r.engine)).toEqual(before);
  const read=await http(`/${host.session.inviteId}/profile`,host.session,{playerId:host.session.playerId});expect(roomProfileSchema.parse(await read.json()).profile.kind).toBe('guest');
  expect((await http(`/${host.session.inviteId}/join`,undefined,{name:'Bad',appearance:{avatar:{kind:'photo',id:'https://test.invalid/pic'},border:'brass'}})).status).toBe(400);
});
