import { evictDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { SessionResponse } from '@casual/protocol';
import { bindings, create, http, inspect, snapshot } from './helpers';

it('shares optional player icons and restores them after Durable Object eviction', async () => {
  const response = await http('', undefined, { name: 'Fox host', icon: '🦊' });
  expect(response.status).toBe(201); const host = await response.json<SessionResponse>();
  expect(host.snapshot.players[0]).toMatchObject({ name: 'Fox host', icon: '🦊' });
  const joined = await http(`/${host.session.inviteId}/join`, undefined, { name: 'Robot guest', icon: '🤖' });
  expect(joined.status).toBe(201); const guest = await joined.json<SessionResponse>();
  expect(guest.snapshot.players.map(player => player.icon)).toEqual(['🦊', '🤖']);
  const before = await snapshot(host.session);
  await evictDurableObject(bindings.ROOMS.getByName(host.session.inviteId));
  const resumed = await http(`/${host.session.inviteId}/resume`, guest.session);
  expect(resumed.status).toBe(200); const after = await resumed.json<{ snapshot: SessionResponse['snapshot'] }>();
  expect(after.snapshot.players).toEqual(before.players); expect(after.snapshot.shoe).toEqual(before.shoe);
  expect(await inspect(host.session.inviteId, room => room.engine.players.map(player => player.icon))).toEqual(['🦊', '🤖']);
});

it('keeps legacy guests without icons and rejects invalid create/join icons without changing the room', async () => {
  const host = await create(); expect(host.snapshot.players[0]).not.toHaveProperty('icon');
  const before = await inspect(host.session.inviteId, room => JSON.stringify(room));
  for (const icon of ['<img src=x onerror=alert(1)>', '🦊🤖', 'not an emoji', null]) {
    for (const path of ['', `/${host.session.inviteId}/join`]) {
      const response = await http(path, undefined, { name: 'Guest', icon });
      expect(response.status).toBe(400);
    }
  }
  expect(await inspect(host.session.inviteId, room => JSON.stringify(room))).toBe(before);
});
