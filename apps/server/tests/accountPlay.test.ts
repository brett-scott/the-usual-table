import { SELF, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PUBLIC_SUPABASE_CONFIG, type SessionResponse, type WalletReceipt } from '@casual/protocol';
import type { OnlineRoom } from '../src/roomState';
import type { TableRoom } from '../src/tableRoom';
import type { Env } from '../src/env';
import type { WalletGateway } from '../src/roomWallet';
import { bindings, close, connect, create, edit, origin, rigShoe } from './helpers';
import { hashSecret } from '../src/security';
import { restoreRoom } from '../src/roomStorage';

let pair: Awaited<ReturnType<typeof generateKeyPair>>;
const claims = new Map<string, string>();
let walletStatus = 'active';
beforeAll(async () => {
  pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'account-play', alg: 'ES256', use: 'sig' };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/auth/v1/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (String(input).endsWith('/rest/v1/rpc/usual_table_wallet_summary')) {
      const token = new Headers(init?.headers).get('Authorization')?.slice(7) ?? '';
      const accountId = claims.get(token); if (!accountId) throw new Error('Unknown fixture token');
      return Response.json({ contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId, status: walletStatus, version: 1, availableUnits: 1000000, atTablesUnits: 0, pendingReturnUnits: 0 });
    }
    throw new Error('Unexpected outbound request');
  });
});
afterAll(() => vi.restoreAllMocks());
async function jwt(accountId: string) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sub: accountId, iss: `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1`, aud: 'authenticated', role: 'authenticated',
    is_anonymous: false, app_metadata: { provider: 'google' }, amr: [{ method: 'oauth' }], iat: now, exp: now + 3600 }).setProtectedHeader({ alg: 'ES256', kid: 'account-play' }).sign(pair.privateKey);
  claims.set(token, accountId); return token;
}
async function call(path: string, token: string, body?: unknown, method = 'POST') {
  return SELF.fetch(`https://example.test/api/v1/rooms${path}`, { method, headers: { Origin: origin, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function inject(invite: string, unavailable = false, insufficient = false) {
  const stub = bindings.ROOMS.getByName(invite);
  await runInDurableObject(stub, async (instance: TableRoom, state) => {
    const target = instance as unknown as { env: Env };
    const gateway: WalletGateway = { async execute(command) {
      const room = (await state.storage.get<OnlineRoom>('room'))!;
      expect(room.wallet!.outbox[0]!.command).toEqual(command);
      if (unavailable) throw new Error('Database offline');
      if (insufficient && command.kind === 'allocate') throw Object.assign(new Error('Insufficient'), { code: 'INSUFFICIENT_FUNDS' });
      const saved = await state.storage.get<WalletReceipt>(`fixture:${command.operationId}`); if (saved) return saved;
      const receipt: WalletReceipt = { operationId: command.operationId, session: room.wallet!.outbox[0]!.after,
        wallet: { contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId: command.accountId, status: 'active', version: 1,
          availableUnits: 900000, atTablesUnits: 100000, pendingReturnUnits: 0 } };
      await state.storage.put(`fixture:${command.operationId}`, receipt); return receipt;
    } };
    Object.defineProperty(instance, 'env', { configurable: true, value: { ...target.env, WALLET_SERVICE: gateway } });
  });
  return stub;
}
async function setup(options: { offline?: boolean; insufficient?: boolean; uppercase?: boolean } = {}) {
  const accountId = crypto.randomUUID(); const token = await jwt(accountId); const rawEntry = crypto.randomUUID(); const entryId = options.uppercase ? rawEntry.toUpperCase() : rawEntry;
  const invite = (await hashSecret(`blackjack:${accountId}:${entryId.toLowerCase()}`)).slice(0, 32);
  const stub = await inject(invite, options.offline, options.insufficient);
  const body = { name: 'Same nickname', funding: 'account', buyInUnits: 100000, entryId };
  const response = await call('', token, body); expect(response.status).toBe(201);
  const room = await response.json<SessionResponse>(); return { accountId, token, entryId, invite, stub, body, room };
}
it('funds a verified seat once, resumes across devices and never exposes account IDs or accepts guest credentials', async () => {
  const f = await setup({ uppercase: true }); expect(f.room.session.funding).toBe('account');
  expect(f.room.snapshot.wallet).toMatchObject({ status: 'active', stackUnits: 100000 }); expect(f.room.snapshot.players[0]!.balance).toBe(2000);
  expect(JSON.stringify(f.room)).not.toContain(f.accountId); expect(f.room.snapshot.legalActions).not.toContain('Refill');
  const replay = await (await call('', f.token, f.body)).json<SessionResponse>(); expect(replay.session.playerId).toBe(f.room.session.playerId);
  const same = await (await call('', f.token, { ...f.body, entryId: f.entryId.toLowerCase() })).json<SessionResponse>(); expect(same.session.playerId).toBe(f.room.session.playerId);
  expect((await call('', f.token, { ...f.body, buyInUnits: 200000 })).status).toBe(409);
  expect((await call('', f.token, { ...f.body, visibility: 'public' })).status).toBe(409);
  const resumed = await (await call(`/${f.invite}/join`, f.token, { ...f.body, entryId: crypto.randomUUID() })).json<SessionResponse>();
  expect(resumed.session.playerId).toBe(f.room.session.playerId);
  const guest = await call(`/${f.invite}/resume`, f.room.session.credential); expect(guest.status).toBe(401);
  const other = await call(`/${f.invite}/resume`, await jwt(crypto.randomUUID())); expect(other.status).toBe(401);
  await runInDurableObject(f.stub, async (_instance, state) => {
    const room = (await state.storage.get<OnlineRoom>('room'))!; expect(Object.keys(room.wallet!.seats)).toHaveLength(1);
    expect(room.schema).toBe(4);
    const missingOwner = structuredClone(room); delete missingOwner.members[f.room.session.playerId]!.account;
    expect(() => restoreRoom(missingOwner, Date.now())).toThrow('safely restored');
    expect(() => restoreRoom({ ...room, schema: 3 }, Date.now())).toThrow('safely restored');
    expect(Object.keys(room.wallet!.seats)[0]).toBe(f.entryId.toLowerCase());
    expect((await state.storage.list({ prefix: 'fixture:' })).size).toBe(2);
  });
});
it('plays a committed hand, saves its result, rejects refills and returns funds before deleting an empty room', async () => {
  const f = await setup(); await rigShoe(f.invite, ['10', '6', '8', '10', '5']);
  const peer = await connect({ ...f.room.session, credential: f.token });
  expect((await peer.send({ type: 'Refill' })).type).toBe('error');
  await peer.send({ type: 'StartBetting' }); await peer.send({ type: 'Ready' });
  expect((await peer.last()).phase).toBe('PLAYER_TURNS');
  await peer.send({ type: 'Stand' });
  expect((await peer.last()).wallet).toMatchObject({ status: 'active', stackUnits: 99000 });
  await peer.send({ type: 'Leave' });
  await runInDurableObject(f.stub, async (_instance, state) => { expect(await state.storage.get('room')).toBeUndefined(); });
  await close(peer);
});
it('keeps uncertain buy-ins durable across eviction and reports explicit insufficient funds without guest fallback', async () => {
  const f = await setup({ offline: true }); expect(f.room.snapshot.wallet?.status).toBe('funding'); expect(f.room.snapshot.players[0]!.balance).toBe(0);
  expect(f.room.snapshot.legalActions).not.toContain('Ready');
  await evictDurableObject(f.stub); await inject(f.invite);
  await edit(f.invite, room => { room.wallet!.retryAt = 0; });
  // Ticket creation saves and reconciles the persisted outbox after reauthorization.
  const peer = await connect({ ...f.room.session, credential: f.token }); expect((await peer.last()).wallet?.status).toBe('active'); await close(peer);
  const poor = await setup({ insufficient: true }); expect(poor.room.snapshot.wallet?.status).toBe('rejected'); expect(poor.room.snapshot.players[0]!.balance).toBe(0);
  expect(poor.room.snapshot.legalActions).not.toContain('Refill');
});
it('lets a funded account join a guest table during a hand without importing guest chips or entering that hand', async () => {
  const host = await create('Guest host'); const peer = await connect(host.session);
  await rigShoe(host.session.inviteId, ['10', '6', '8', '10', '5']);
  await peer.send({ type: 'StartBetting' }); await peer.send({ type: 'Ready' });
  await inject(host.session.inviteId);
  const accountId = crypto.randomUUID(); const token = await jwt(accountId);
  const response = await call(`/${host.session.inviteId}/join`, token, { name: 'Same nickname', funding: 'account', entryId: crypto.randomUUID(), buyInUnits: 25000 });
  expect(response.status).toBe(201); const joined = await response.json<SessionResponse>();
  expect(joined.snapshot.phase).toBe('PLAYER_TURNS'); expect(joined.snapshot.wallet).toMatchObject({ status: 'active', stackUnits: 25000 });
  expect(joined.snapshot.players.find(player => player.id === joined.session.playerId)).toMatchObject({ balance: 500, hands: [] });
  const accountPeer = await connect({ ...joined.session, credential: token });
  expect((await accountPeer.last()).legalActions).not.toContain('Hit');
  await peer.send({ type: 'Stand' }); await peer.send({ type: 'NextRound' });
  expect((await accountPeer.last()).legalActions).toContain('Ready');
  await accountPeer.send({ type: 'Leave' }); await peer.send({ type: 'Leave' }); await close(peer, accountPeer);
});
it('renews only the current controller and rejects expired authorization, suspended accounts and forged funding fields', async () => {
  const f = await setup(); const peer = await connect({ ...f.room.session, credential: f.token });
  let controllerId = '';
  await runInDurableObject(f.stub, async (_instance, state) => { controllerId = (await state.storage.get<OnlineRoom>('room'))!.members[f.room.session.playerId]!.controllerId!; });
  expect((await call(`/${f.invite}/authorize`, f.token, { controllerId })).status).toBe(200);
  expect((await call(`/${f.invite}/authorize`, f.token, { controllerId: crypto.randomUUID() })).status).toBe(409);
  await edit(f.invite, room => { room.members[f.room.session.playerId]!.account!.expiresAt = 1; });
  const result = new Promise<{ code: string }>(resolve => peer.ws.addEventListener('message', event => { const value = JSON.parse(String(event.data)); if (value.code === 'ACCOUNT_SESSION_INVALID') resolve(value); }));
  peer.ws.send('ping'); expect((await result).code).toBe('ACCOUNT_SESSION_INVALID');
  walletStatus = 'suspended';
  try { expect((await call(`/${f.invite}/resume`, f.token)).status).toBe(400); } finally { walletStatus = 'active'; }
  const guest = await create();
  const forged = await call(`/${guest.session.inviteId}/join`, f.token, { ...f.body, accountId: crypto.randomUUID() }); expect(forged.status).toBe(400);
  expect((await call('', f.token, null)).status).toBe(400);
  await close(peer);
});
