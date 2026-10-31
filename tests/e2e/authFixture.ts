import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { PUBLIC_SUPABASE_CONFIG, type PlayerIcon, type SocialProvider } from '@casual/protocol';

export const accountId = 'a213ae22-a459-456d-976c-dc115e74abda';
export async function providerFixture(page: Page, provider: SocialProvider, mode: 'success' | 'cancel' | 'offline' = 'success', savedNickname: string | null = null, savedIcon: PlayerIcon | null = null) {
  let challenge = ''; let refreshes = 0; let exchanges = 0; let verifications = 0;
  let nickname = savedNickname; let failSave = false; let failRead = false;
  let icon = savedIcon; let walletMode: 'ready' | 'offline' | 'not-connected' | 'wrong-account' | 'zero' | 'new' | 'new-offline' = 'ready';
  let provisioned = false; let walletCreates = 0;
  const tokens: string[] = [];
  function authUser() {
    return { id: accountId, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(),
      app_metadata: { provider, providers: [provider] }, user_metadata: { full_name: 'Private provider name', usual_table_nickname: nickname, usual_table_player_icon: icon, balance: 999999999 }, identities: [] };
  }
  function authSession() {
    const seconds = Math.floor(Date.now() / 1000);
    const payload = { sub: accountId, iss: `${PUBLIC_SUPABASE_CONFIG.url}/auth/v1`, aud: 'authenticated', role: 'authenticated',
      iat: seconds, exp: seconds + 3600, jti: String(tokens.length), app_metadata: { provider }, amr: [{ method: 'oauth', timestamp: seconds }] };
    const jwt = `${Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${Buffer.alloc(64, 1).toString('base64url')}`;
    tokens.push(jwt);
    return { access_token: jwt, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600,
      user: authUser() };
  }
  await page.route(`${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/authorize**`, async route => {
    const url = new URL(route.request().url()); expect(url.searchParams.get('provider')).toBe(provider);
    expect(url.searchParams.get('code_challenge_method')).toMatch(/^s256$/i); challenge = url.searchParams.get('code_challenge')!;
    expect(challenge.length).toBeGreaterThan(40);
    const redirect = new URL(url.searchParams.get('redirect_to')!);
    expect(redirect.pathname).toBe(process.env.E2E_BASE_PATH || '/'); expect(redirect.hash).toBe('');
    if (mode === 'cancel') redirect.hash = 'error=access_denied&error_description=private-provider-message';
    else redirect.searchParams.set('code', 'fixture-one-use-code');
    await route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(redirect.href)})</script>` });
  });
  await page.route(`${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/token**`, async route => {
    const url = new URL(route.request().url()); const body = route.request().postDataJSON() as { auth_code?: string; code_verifier?: string; refresh_token?: string };
    if (url.searchParams.get('grant_type') === 'pkce') {
      exchanges++; expect(body.auth_code).toBe('fixture-one-use-code'); expect(body.code_verifier).toBeTruthy();
      expect(createHash('sha256').update(body.code_verifier!).digest('base64url')).toBe(challenge);
    } else { refreshes++; expect(body.refresh_token).toBe('fixture-refresh'); }
    await route.fulfill({ json: authSession() });
  });
  await page.route(`${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/logout**`, route => route.fulfill({ status: 204 }));
  await page.route(`${PUBLIC_SUPABASE_CONFIG.url}/auth/v1/user`, async route => {
    expect(tokens).toContain(route.request().headers().authorization?.slice(7));
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { data: { usual_table_nickname: string; usual_table_player_icon: PlayerIcon | null } };
      expect(Object.keys(body.data)).toEqual(['usual_table_nickname', 'usual_table_player_icon']);
      if (failSave) { await route.fulfill({ status: 503, json: { msg: 'private-save-error' } }); return; }
      nickname = body.data.usual_table_nickname;
      icon = body.data.usual_table_player_icon;
    } else if (failRead) { await route.fulfill({ status: 503, json: { msg: 'private-load-error' } }); return; }
    await route.fulfill({ json: authUser() });
  });
  await page.route('**/api/v1/account/session', async route => {
    verifications++; expect(tokens).toContain(route.request().headers().authorization?.slice(7));
    await route.fulfill(mode === 'offline' ? { status: 503, json: { code: 'AUTH_UNAVAILABLE' } }
      : { json: { accountId, provider, expiresAt: Date.now() + 3_600_000 } });
  });
  await page.route('**/api/v1/account/wallet', async route => {
    expect(tokens).toContain(route.request().headers().authorization?.slice(7));
    if (route.request().method() === 'POST') {
      expect(route.request().postData()).toBeNull(); walletCreates++;
      if (walletMode === 'new-offline') { await route.fulfill({ status: 503, json: { code: 'WALLET_UNAVAILABLE' } }); return; }
      provisioned = true;
    } else expect(route.request().method()).toBe('GET');
    if (['new', 'new-offline'].includes(walletMode) && !provisioned) { await route.fulfill({ status: 404, json: { code: 'WALLET_NOT_FOUND' } }); return; }
    if (walletMode === 'offline' || walletMode === 'not-connected') {
      await route.fulfill({ status: 503, json: { code: walletMode === 'offline' ? 'WALLET_UNAVAILABLE' : 'WALLET_NOT_CONNECTED' } }); return;
    }
    await route.fulfill({ json: { contract: 1, currency: 'virtual-chips', unitsPerChip: 100,
      accountId: walletMode === 'wrong-account' ? 'a213ae22-a459-456d-976c-dc115e74abdb' : accountId,
      status: 'active', version: 1, availableUnits: walletMode === 'new' ? 1000000 : walletMode === 'zero' ? 0 : 123456, atTablesUnits: walletMode === 'new' ? 0 : 25000, pendingReturnUnits: walletMode === 'new' ? 0 : 5050 } });
  });
  return { counts: () => ({ exchanges, refreshes, verifications, walletCreates }), failSave: (value: boolean) => { failSave = value; },
    failRead: (value: boolean) => { failRead = value; }, renameRemotely: (value: string) => { nickname = value; },
    setWalletMode: (value: typeof walletMode) => { walletMode = value; } };
}

