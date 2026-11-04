import { SELF } from 'cloudflare:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PUBLIC_SUPABASE_CONFIG, type WalletSummary } from '@casual/protocol';
import { verifyAccountSession } from '../src/accountAuth';
import { readAccountWallet } from '../src/accountWallet';
import worker from '../src/index';
import { bindings, origin } from './helpers';

const issuer = `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1`;
const accountId = 'a213ae22-a459-456d-976c-dc115e74abda';
let pair: Awaited<ReturnType<typeof generateKeyPair>>; let resolver: JWTVerifyGetKey;
const rpc = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
beforeEach(() => { rpc.mockReset(); rpc.mockImplementation(async () => Response.json({ code: 'PGRST202' }, { status: 404 })); });
beforeAll(async () => {
  pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig' };
  resolver = createLocalJWKSet({ keys: [jwk] });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith(`${PUBLIC_SUPABASE_CONFIG.url}/rest/v1/rpc/`)) return rpc(String(input), init);
    if (String(input) !== `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/.well-known/jwks.json`) throw new Error('Unexpected outbound request');
    return Response.json({ keys: [jwk] });
  });
});
afterAll(() => { vi.restoreAllMocks(); });
async function token(overrides = {}, key = pair.privateKey) {
  const seconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: accountId, iss: issuer, aud: 'authenticated', exp: seconds + 3600, iat: seconds,
    role: 'authenticated', is_anonymous: false, app_metadata: { provider: 'google', providers: ['google'] },
    amr: [{ method: 'oauth', timestamp: seconds }], email: 'private@example.test', user_metadata: { name: 'Private name' }, ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(key);
}
function request(value: string, headers = {}) {
  return new Request('https://api.test/api/v1/account/session', { headers: { Authorization: `Bearer ${value}`, ...headers } });
}
it.each(['google', 'discord'] as const)('verifies a signed %s account and exposes only its public account session', async provider => {
  const jwt = await token({ app_metadata: { provider } });
  const result = await verifyAccountSession(request(jwt), {}, resolver);
  expect(result).toMatchObject({ accountId, provider }); expect(result.expiresAt).toBeGreaterThan(Date.now());
  expect(Object.keys(result).sort()).toEqual(['accountId', 'expiresAt', 'provider']);
  expect(JSON.stringify(result)).not.toContain('private@example.test');
});
it('keeps matching display names on distinct account IDs and preserves identity when a name changes', async () => {
  const otherId = crypto.randomUUID();
  const matchingName = { display_name: 'Alex', username: 'Alex', full_name: 'Alex' };
  const first = await verifyAccountSession(request(await token({ sub: accountId, user_metadata: matchingName })), {}, resolver);
  const second = await verifyAccountSession(request(await token({ sub: otherId, user_metadata: matchingName })), {}, resolver);
  const renamed = await verifyAccountSession(request(await token({ sub: accountId, user_metadata: { display_name: 'River', username: 'River' } })), {}, resolver);
  expect(first.accountId).toBe(accountId); expect(second.accountId).toBe(otherId);
  expect(second.accountId).not.toBe(first.accountId); expect(renamed.accountId).toBe(first.accountId);
});
it.each([
  ['expired', () => ({ exp: 1 })], ['future', () => ({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
  ['wrong issuer', () => ({ iss: 'https://other.supabase.co/auth/v1' })], ['wrong audience', () => ({ aud: 'other' })],
  ['missing expiry', () => ({ exp: undefined })], ['missing issued-at', () => ({ iat: undefined })], ['invalid subject', () => ({ sub: 'forged' })],
  ['anonymous user', () => ({ is_anonymous: true })], ['privileged role', () => ({ role: 'service_role' })],
  ['email provider', () => ({ app_metadata: { provider: 'email' } })], ['password login', () => ({ amr: [{ method: 'password' }] })],
  ['anonymous login', () => ({ amr: [{ method: 'anonymous' }] })], ['missing auth method', () => ({ amr: undefined })],
  ['mixed password proof', () => ({ amr: [{ method: 'oauth' }, { method: 'password' }] })],
] as const)('rejects %s claims even when their signature is valid', async (_label, claims) => {
  await expect(verifyAccountSession(request(await token(claims())), {}, resolver)).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
});
it('rejects forged signatures, unknown keys, unsigned tokens and legacy guest credentials', async () => {
  const wrong = await generateKeyPair('ES256');
  await expect(verifyAccountSession(request(await token({}, wrong.privateKey)), {}, resolver)).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
  for (const value of ['a'.repeat(64), 'eyJhbGciOiJub25lIn0.e30.', 'x'.repeat(8193), 'not-a-jwt'])
    await expect(verifyAccountSession(request(value), {}, resolver)).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
  const badKid = await new SignJWT({ sub: accountId }).setProtectedHeader({ alg: 'ES256', kid: 'unknown' }).sign(pair.privateKey);
  await expect(verifyAccountSession(request(badKid), {}, resolver)).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
});
it('fails account verification when keys/config are unavailable without falling back to trusting the token', async () => {
  await expect(verifyAccountSession(request(await token()), { SUPABASE_URL: 'https://evil.test' }, resolver)).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
  const offline: JWTVerifyGetKey = async () => { throw new TypeError('network unavailable'); };
  await expect(verifyAccountSession(request(await token()), {}, offline)).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
});
it('serves verified sessions through the Worker with CORS and ignores spoofed account headers', async () => {
  const health = await SELF.fetch('https://api.test/api/v1/health', { headers: { Origin: origin } });
  expect(await health.json()).toMatchObject({ status: 'ok', authProjectUrl: PUBLIC_SUPABASE_CONFIG.url });
  const jwt = await token();
  const response = await SELF.fetch('https://api.test/api/v1/account/session', { headers: { Origin: origin, Authorization: `Bearer ${jwt}`, 'X-Account-Id': crypto.randomUUID() } });
  expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ accountId, provider: 'google' });
  const missing = await SELF.fetch('https://api.test/api/v1/account/session', { headers: { Origin: origin, 'X-Account-Id': accountId } });
  expect(missing.status).toBe(401); expect(await missing.json()).toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
  const denied = await SELF.fetch('https://api.test/api/v1/account/session', { headers: { Origin: 'https://evil.test', Authorization: `Bearer ${jwt}` } });
  expect(denied.status).toBe(403); expect(await denied.text()).not.toContain(jwt);
});

const wallet: WalletSummary = { contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId, status: 'active', version: 1,
  availableUnits: 123456, atTablesUnits: 25000, pendingReturnUnits: 5050 };
it('reads only the signed-in caller wallet, ignores requested IDs and strips extra fields without mutating money', async () => {
  const getWallet = vi.fn(async () => ({ ...wallet, secret: 'private-storage-field' })); const execute = vi.fn();
  const jwt = await token({ user_metadata: { balance: 999999999 } });
  const response = await worker.fetch(new Request(`https://api.test/api/v1/account/wallet?accountId=${crypto.randomUUID()}`, {
    headers: { Origin: origin, Authorization: `Bearer ${jwt}`, 'X-Account-Id': crypto.randomUUID() },
  }), { ...bindings, WALLET_SERVICE: { getWallet, execute } });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin); expect(await response.json()).toEqual(wallet);
  expect(getWallet).toHaveBeenCalledExactlyOnceWith(accountId); expect(execute).not.toHaveBeenCalled();
});
it('requires verified authentication even when wallet storage is not configured and rejects other website origins', async () => {
  const getWallet = vi.fn(async () => wallet); const execute = vi.fn();
  const missing = await worker.fetch(new Request('https://api.test/api/v1/account/wallet', { headers: { Origin: origin, 'X-Account-Id': accountId } }), { ...bindings, WALLET_SERVICE: { getWallet, execute } });
  expect(missing.status).toBe(401); expect(getWallet).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  const jwt = await token();
  const absent = await SELF.fetch('https://api.test/api/v1/account/wallet', { headers: { Origin: origin, Authorization: `Bearer ${jwt}` } });
  expect(absent.status).toBe(503); expect(await absent.json()).toMatchObject({ code: 'WALLET_NOT_CONNECTED' });
  const denied = await worker.fetch(new Request('https://api.test/api/v1/account/wallet', { headers: { Origin: 'https://evil.test', Authorization: `Bearer ${jwt}` } }), { ...bindings, WALLET_SERVICE: { getWallet, execute } });
  expect(denied.status).toBe(403); expect(getWallet).not.toHaveBeenCalled();
});
it.each([
  { ...wallet, accountId: crypto.randomUUID() }, { ...wallet, availableUnits: -1 }, { ...wallet, unitsPerChip: 2 },
])('fails closed for wrong-account or malformed wallet service responses', async invalid => {
  await expect(readAccountWallet({ accountId, provider: 'google', expiresAt: Date.now() + 3600000 }, { execute: vi.fn(), getWallet: async () => invalid as WalletSummary }))
    .rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
});
it('bounds unavailable/hanging wallet reads without returning a fabricated zero balance', async () => {
  const account = { accountId, provider: 'google' as const, expiresAt: Date.now() + 3600000 };
  await expect(readAccountWallet(account, { execute: vi.fn() })).rejects.toMatchObject({ code: 'WALLET_NOT_CONNECTED' });
  await expect(readAccountWallet(account, { execute: vi.fn(), getWallet: async () => { throw new Error('private database failure'); } })).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
  await expect(readAccountWallet(account, { execute: vi.fn(), getWallet: () => new Promise<WalletSummary>(() => {}) }, 5)).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
});

it('connects the verified caller to Supabase RPC with the public app key and no user-selected arguments', async () => {
  rpc.mockImplementationOnce(async () => Response.json(wallet)); const jwt = await token();
  const response = await SELF.fetch(`https://api.test/api/v1/account/wallet?accountId=${crypto.randomUUID()}`, { headers: { Origin: origin, Authorization: `Bearer ${jwt}` } });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(wallet);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(`${PUBLIC_SUPABASE_CONFIG.url}/rest/v1/rpc/usual_table_wallet_summary`, expect.objectContaining({
    method: 'POST', body: '{}', redirect: 'manual', cache: 'no-store', headers: { apikey: PUBLIC_SUPABASE_CONFIG.publishableKey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal),
  }));
});
it.each(['GET', 'POST'])('uses RPC options accepted by the real Workers Request implementation for wallet %s', async method => {
  let constructionError: unknown;
  rpc.mockImplementationOnce(async (url, init) => {
    let outgoing: Request;
    try { outgoing = new Request(url, init); } catch (error) { constructionError = error; throw error; }
    expect(outgoing.redirect).toBe('manual');
    return Response.json(wallet);
  });
  const response = await SELF.fetch('https://api.test/api/v1/account/wallet', { method, headers: { Origin: origin, Authorization: `Bearer ${await token()}` } });
  expect(constructionError).toBeUndefined();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(wallet);
});
it.each([301, 302, 303, 307, 308])('rejects a Supabase %s redirect without following it or exposing account tokens', async status => {
  const jwt = await token();
  rpc.mockImplementationOnce(async () => new Response('Redirect body', { status, headers: { Location: 'https://other.test/private-target' } }));
  const response = await SELF.fetch('https://api.test/api/v1/account/wallet', { headers: { Origin: origin, Authorization: `Bearer ${jwt}` } });
  expect(response.status).toBe(503); const value = await response.json();
  expect(value).toMatchObject({ code: 'WALLET_UNAVAILABLE' });
  expect(JSON.stringify(value)).not.toContain(jwt); expect(JSON.stringify(value)).not.toContain('private-target');
  expect(rpc).toHaveBeenCalledOnce(); expect(rpc.mock.calls[0]![1]!.redirect).toBe('manual');
});
it('returns not-found for a missing wallet, and provisions only through an authenticated empty POST', async () => {
  const jwt = await token(); const headers = { Origin: origin, Authorization: `Bearer ${jwt}` };
  rpc.mockImplementationOnce(async () => Response.json(null));
  const missing = await SELF.fetch('https://api.test/api/v1/account/wallet', { headers });
  expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ code: 'WALLET_NOT_FOUND' }); expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockImplementationOnce(async () => Response.json({ ...wallet, availableUnits: 1000000, atTablesUnits: 0, pendingReturnUnits: 0, version: 1 }));
  const created = await SELF.fetch('https://api.test/api/v1/account/wallet', { method: 'POST', headers });
  expect(created.status).toBe(200); expect(await created.json()).toMatchObject({ accountId, availableUnits: 1000000 });
  expect(rpc.mock.calls[1]![0]).toBe(`${PUBLIC_SUPABASE_CONFIG.url}/rest/v1/rpc/usual_table_ensure_wallet`);
  expect(rpc.mock.calls[1]![1]!.body).toBe('{}'); expect(created.headers.get('Cache-Control')).toBe('no-store');
});
it('rejects provisioning amounts/IDs and unverified callers without reaching wallet storage', async () => {
  const jwt = await token();
  const forged = await SELF.fetch('https://api.test/api/v1/account/wallet', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: crypto.randomUUID(), amountUnits: 100000 }) });
  expect(forged.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  const guest = await SELF.fetch('https://api.test/api/v1/account/wallet', { method: 'POST', headers: { Origin: origin } });
  expect(guest.status).toBe(401); expect(rpc).not.toHaveBeenCalled();
});
it.each([
  [404, { code: 'PGRST202', message: 'private schema-cache detail' }, 'WALLET_NOT_CONNECTED'],
  [401, { code: 'PGRST301', message: 'private JWT detail' }, 'ACCOUNT_SESSION_INVALID'],
  [403, { code: '42501', message: 'private account/deletion detail' }, 'ACCOUNT_SESSION_INVALID'],
  [500, { code: 'XX000', message: 'private database detail' }, 'WALLET_UNAVAILABLE'],
] as const)('handles Supabase HTTP %s without disclosing database/authentication details', async (status, body, code) => {
  rpc.mockImplementationOnce(async () => Response.json(body, { status }));
  const response = await SELF.fetch('https://api.test/api/v1/account/wallet', { headers: { Origin: origin, Authorization: `Bearer ${await token()}` } });
  const value = await response.json(); expect(value).toMatchObject({ code }); expect(JSON.stringify(value)).not.toContain('private');
});
it('rejects wrong-account RPC data and fails closed for network/abort errors', async () => {
  const headers = { Origin: origin, Authorization: `Bearer ${await token()}` };
  rpc.mockImplementationOnce(async () => Response.json({ ...wallet, accountId: crypto.randomUUID() }));
  expect((await SELF.fetch('https://api.test/api/v1/account/wallet', { headers })).status).toBe(503);
  rpc.mockRejectedValueOnce(new DOMException('Private request detail', 'AbortError'));
  const offline = await SELF.fetch('https://api.test/api/v1/account/wallet', { headers }); expect(offline.status).toBe(503);
  expect(await offline.json()).toMatchObject({ code: 'WALLET_UNAVAILABLE' });
});

const statistics = { contract: 1, accountId, unitsPerChip: 100, basis: 'saved-rounds', games: [{ gameId: 'blackjack', roundsPlayed: '3', roundsWon: '1', roundsLost: '1', roundsEven: '1', wageredUnits: '3000', returnedUnits: '3000', netUnits: '0', bestRoundNetUnits: '1000' }] };
it('reads caller-only statistics with real Workers request options and no caller-selected account', async () => {
  rpc.mockImplementationOnce(async (url, init) => { expect(new Request(url, init).redirect).toBe('manual'); return Response.json(statistics); });
  const jwt = await token();
  const response = await SELF.fetch(`https://api.test/api/v1/account/statistics?accountId=${crypto.randomUUID()}`, { headers: { Origin: origin, Authorization: `Bearer ${jwt}` } });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(statistics);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(rpc).toHaveBeenCalledExactlyOnceWith(`${PUBLIC_SUPABASE_CONFIG.url}/rest/v1/rpc/usual_table_account_statistics`, expect.objectContaining({ method: 'POST', body: '{}', redirect: 'manual', cache: 'no-store', headers: expect.objectContaining({ Authorization: `Bearer ${jwt}`, apikey: PUBLIC_SUPABASE_CONFIG.publishableKey }) }));
});
it('rejects guest statistics and does not provide a statistics mutation endpoint', async () => {
  expect((await SELF.fetch('https://api.test/api/v1/account/statistics', { headers: { Origin: origin } })).status).toBe(401);
  expect((await SELF.fetch('https://api.test/api/v1/account/statistics', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${await token()}` } })).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
it.each([
  { ...statistics, accountId: crypto.randomUUID() },
  { ...statistics, games: [{ ...statistics.games[0], netUnits: '999' }] },
  { ...statistics, games: [{ ...statistics.games[0], roundsPlayed: 'NaN' }] },
  { ...statistics, games: [statistics.games[0], statistics.games[0]] },
])('fails closed for mismatched, malformed or duplicate statistics', async value => {
  rpc.mockImplementationOnce(async () => Response.json(value));
  const response = await SELF.fetch('https://api.test/api/v1/account/statistics', { headers: { Origin: origin, Authorization: `Bearer ${await token()}` } });
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'STATISTICS_UNAVAILABLE' });
});
it.each([302, 307])('rejects statistics HTTP %s redirects without forwarding the caller token', async status => {
  rpc.mockImplementationOnce(async () => new Response('private redirect', { status, headers: { Location: 'https://other.test/private' } }));
  const response = await SELF.fetch('https://api.test/api/v1/account/statistics', { headers: { Origin: origin, Authorization: `Bearer ${await token()}` } });
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'STATISTICS_UNAVAILABLE' }); expect(rpc).toHaveBeenCalledOnce();
});
it.each([
  [404, { code: 'PGRST202' }, 'STATISTICS_NOT_CONNECTED'],
  [403, { code: '42501' }, 'ACCOUNT_SESSION_INVALID'],
  [500, { code: 'XX000', message: 'private database detail' }, 'STATISTICS_UNAVAILABLE'],
] as const)('reports statistics setup/session/service failures safely for HTTP %s', async (status, value, code) => {
  rpc.mockImplementationOnce(async () => Response.json(value, { status }));
  const response = await SELF.fetch('https://api.test/api/v1/account/statistics', { headers: { Origin: origin, Authorization: `Bearer ${await token()}` } });
  const body = await response.json(); expect(body).toMatchObject({ code }); expect(JSON.stringify(body)).not.toContain('private');
});
const allowance={contract:1,accountId,amountUnits:100000,cooldownMs:86400000,serverNow:100000,nextEligibleAt:null,canClaim:true,claimed:false,wallet};
it.each(['allowance','progression'])('rejects guest and body-controlled %s claims before RPC',async path=>{
  expect((await SELF.fetch(`https://api.test/api/v1/account/${path}`,{method:'POST',headers:{Origin:origin}})).status).toBe(401);
  const response=await SELF.fetch(`https://api.test/api/v1/account/${path}`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${await token()}`},body:JSON.stringify({accountId:crypto.randomUUID(),amount:999999})});
  expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();
});
it.each(['GET','POST'])('uses a caller-scoped allowance RPC for %s and validates real request options',async method=>{
  rpc.mockImplementationOnce(async(url,init)=>{expect(new Request(url,init).redirect).toBe('manual');expect(init?.body).toBe('{}');return Response.json(allowance);});
  const response=await SELF.fetch('https://api.test/api/v1/account/allowance',{method,headers:{Origin:origin,Authorization:`Bearer ${await token()}`}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(allowance);expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(rpc.mock.calls[0]![0]).toContain(method==='POST'?'usual_table_claim_allowance':'usual_table_allowance');
});
it.each([null,{...allowance,accountId:crypto.randomUUID()},{...allowance,amountUnits:999}])('refuses malformed or foreign reward responses',async value=>{
  rpc.mockImplementationOnce(async()=>Response.json(value));
  const response=await SELF.fetch('https://api.test/api/v1/account/allowance',{headers:{Origin:origin,Authorization:`Bearer ${await token()}`}});
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'REWARDS_UNAVAILABLE'});
});
it('refuses reward redirects and safely reports a missing migration',async()=>{
  const headers={Origin:origin,Authorization:`Bearer ${await token()}`};
  rpc.mockImplementationOnce(async()=>new Response(null,{status:307,headers:{Location:'https://other.test'}}));
  expect((await SELF.fetch('https://api.test/api/v1/account/allowance',{method:'POST',headers})).status).toBe(503);
  const missing=await SELF.fetch('https://api.test/api/v1/account/progression',{headers});expect(await missing.json()).toMatchObject({code:'REWARDS_NOT_CONNECTED'});
});
it.each(['GET','POST'])('returns verified progression through its fixed %s RPC',async method=>{
  const progress={contract:1,accountId,policy:'progress-v1',startsAt:1000,xpPerRound:10,xp:'0',level:1,levelStartXp:'0',nextLevelXp:'100',levelRewardUnits:100000,
    claimedLevel:1,readyRewardUnits:'0',claimedUnits:0,achievements:[],wallet};
  rpc.mockImplementationOnce(async()=>Response.json(progress));
  const response=await SELF.fetch('https://api.test/api/v1/account/progression',{method,headers:{Origin:origin,Authorization:`Bearer ${await token()}`}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(progress);
  expect(rpc.mock.calls[0]![0]).toContain(method==='POST'?'usual_table_claim_rewards':'usual_table_progression');
});
it('returns caller-owned detailed statistics while retaining the original summary contract',async()=>{
  const details={accountId,summary:statistics,blackjack:{trackedRounds:'0',hands:'0',wins:'0',losses:'0',pushes:'0',blackjacks:'0',busts:'0',doubles:'0',splits:'0',insuranceTaken:'0',insuranceWon:'0'}};
  rpc.mockImplementationOnce(async()=>Response.json(details));
  const response=await SELF.fetch('https://api.test/api/v1/account/statistics/details',{headers:{Origin:origin,Authorization:`Bearer ${await token()}`}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(details);expect(rpc.mock.calls[0]![0]).toContain('usual_table_detailed_statistics');
});
