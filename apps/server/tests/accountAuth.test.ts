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
    method: 'POST', body: '{}', redirect: 'error', cache: 'no-store', headers: { apikey: PUBLIC_SUPABASE_CONFIG.publishableKey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal),
  }));
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
