import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PUBLIC_SUPABASE_CONFIG, type PlayerIcon, type SocialProvider } from '@casual/protocol';
import { expectOneScreen } from './fixtures';

const accountId = 'a213ae22-a459-456d-976c-dc115e74abda';
const invite = 'b'.repeat(32);
async function providerFixture(page: Page, provider: SocialProvider, mode: 'success' | 'cancel' | 'offline' = 'success', savedNickname: string | null = null, savedIcon: PlayerIcon | null = null) {
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

for (const provider of ['google', 'discord'] as const) test(`${provider} PKCE sign-in preserves an invitation and entry preferences, refreshes and signs out`, async ({ page }, testInfo) => {
  const fixture = await providerFixture(page, provider);
  await page.goto(`./#/room/${invite}`);
  await page.getByLabel('What should we call you?').fill('My table name');
  await page.getByLabel('Player icon').selectOption({ label: '🦊 Fox' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: provider === 'google' ? 'Continue with Google' : 'Continue with Discord' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose your nickname' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toHaveValue('');
  await expect(page).toHaveURL(new RegExp(`#\\/room\\/${invite}$`));
  await expect(page.getByLabel('What should we call you?')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('casual-name'))).toBe('My table name');
  await page.getByRole('dialog').getByLabel('Player icon').selectOption({ label: '🐱 Cat' });
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Alex');
  await page.getByRole('button', { name: 'Save nickname' }).click();
  const accountButton = page.getByRole('button', { name: 'Account menu for Alex', exact: true });
  await expect(accountButton).toBeVisible(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('What should we call you?')).toHaveCount(0); await expect(page.getByLabel('Player icon')).toHaveCount(0);
  await expect(accountButton).toContainText('🐱');
  expect(fixture.counts().exchanges).toBe(1);
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => /^sb-.*-auth-token$/.test(key))!;
    const saved = JSON.parse(localStorage.getItem(key)!) as { expires_at: number };
    saved.expires_at = 1; localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload(); await expect(accountButton).toBeVisible(); expect(fixture.counts().refreshes).toBeGreaterThan(0);
  await accountButton.click(); await expect(page.getByRole('menu')).toContainText('Temporary table chips');
  await page.screenshot({ path: testInfo.outputPath(`account-${provider}.png`), fullPage: true });
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('What should we call you?')).toHaveValue('My table name');
  await expect(page.getByLabel('Player icon')).toHaveValue('🦊');
  await expect(page.getByRole('button', { name: 'Join table', exact: true })).toBeEnabled();
  expect(page.url()).not.toMatch(/[?&]code=|access_token=|refresh_token=/);
});

test('returning accounts edit their nickname from a keyboard accessible menu and use it for new seats', async ({ page }, testInfo) => {
  const fixture = await providerFixture(page, 'google', 'success', 'Alex'); await page.goto('./#/games');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Google' }).click();
  const accountButton = page.getByRole('button', { name: 'Account menu for Alex', exact: true });
  await expect(accountButton).toBeVisible(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await accountButton.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Edit nickname' })).toBeFocused(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Edit player icon' })).toBeFocused(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused(); await page.keyboard.press('Escape');
  await expect(accountButton).toBeFocused(); await expect(page.getByRole('menu')).toHaveCount(0);
  await accountButton.click(); await page.getByRole('menuitem', { name: 'Edit nickname' }).click();
  const field = page.getByRole('textbox', { name: 'Nickname', exact: true });
  await expect(field).toHaveValue('Alex'); await field.fill('Discard this'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await accountButton.click(); await page.getByRole('menuitem', { name: 'Edit nickname' }).click(); await expect(field).toHaveValue('Alex');
  await field.fill('   '); await page.getByRole('button', { name: 'Save nickname' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter your name');
  fixture.failSave(true); await field.fill('A nickname of 24 letters'); await page.getByRole('button', { name: 'Save nickname' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved'); await expect(field).toHaveValue('A nickname of 24 letters');
  await expect(accountButton).toHaveCount(1);
  fixture.failSave(false); await page.getByRole('button', { name: 'Save nickname' }).click();
  const renamed = page.getByRole('button', { name: 'Account menu for A nickname of 24 letters', exact: true });
  await expect(renamed).toBeVisible(); await renamed.click(); await expect(page.getByRole('menu')).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('nickname-menu.png'), fullPage: true });
  await page.locator('header').getByRole('link').first().click(); await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await expect(page.getByLabel('What should we call you?')).toHaveCount(0); await expect(page.getByLabel('Player icon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await renamed.click(); await page.getByRole('menuitem', { name: 'Edit nickname' }).click(); await field.fill('River');
  await page.getByRole('button', { name: 'Save nickname' }).click(); await expect(page.getByRole('button', { name: 'Account menu for River' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await page.getByRole('link', { name: 'Find a Table', exact: true }).click(); await expect(page.getByLabel('What should we call you?')).toHaveCount(0);
  fixture.renameRemotely('From another device'); await page.reload();
  const remoteName = page.getByRole('button', { name: 'Account menu for From another device' });
  await expect(remoteName).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await expect(remoteName).toBeVisible(); await remoteName.click();
  await expect(page.getByRole('menuitem', { name: 'Edit nickname' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('nickname-at-table.png'), fullPage: true });
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave table', exact: true }).click();
});

test('a nickname load failure offers retry instead of overwriting an existing name', async ({ page }) => {
  const fixture = await providerFixture(page, 'discord', 'success', 'Already saved'); fixture.failRead(true);
  await page.goto('./#/games'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Discord' }).click();
  await expect(page.getByRole('dialog', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('could not be loaded'); await expect(page.getByRole('button', { name: 'Save nickname' })).toHaveCount(0);
  fixture.failRead(false); await page.getByRole('button', { name: 'Retry loading profile' }).click();
  await expect(page.getByRole('button', { name: 'Account menu for Already saved' })).toBeVisible(); await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('profile icons follow the account into private lobbies and shared tables without Blackjack identity fields', async ({ page }, testInfo) => {
  await providerFixture(page, 'discord', 'success', 'Alex', '🦊'); await page.goto('./#/games');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Discord' }).click();
  const account = page.getByRole('button', { name: 'Account menu for Alex' }); await expect(account).toContainText('🦊');
  await account.click(); await page.getByRole('menuitem', { name: 'Edit player icon' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit profile' });
  await expect(editor.getByLabel('Player icon')).toHaveValue('🦊'); await expect(editor.getByLabel('Player icon')).toBeFocused();
  await editor.getByLabel('Player icon').selectOption('🐱'); await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(account).toContainText('🦊'); await account.click(); await page.getByRole('menuitem', { name: 'Edit player icon' }).click();
  await expect(editor.getByLabel('Player icon')).toHaveValue('🦊'); await editor.getByLabel('Player icon').selectOption('🐱');
  await editor.getByRole('button', { name: 'Save profile' }).click(); await expect(account).toContainText('🐱');
  await page.reload(); await expect(account).toContainText('🐱');
  await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What should we call you?' })).toHaveCount(0); await expect(page.getByLabel('Player icon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your seat', exact: true }).getByRole('img', { name: 'Cat player icon' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.getByRole('button', { name: 'Leave table', exact: true }).click(); await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Your seat', exact: true }).getByRole('img', { name: 'Cat player icon' })).toBeVisible();
  const peer = await page.context().browser()!.newContext({ viewport: page.viewportSize()! }); const guest = await peer.newPage();
  try {
    await guest.goto(page.url()); await guest.getByLabel('What should we call you?').fill('Guest');
    await guest.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(guest.getByRole('img', { name: 'Cat player icon' })).toBeVisible();
    await guest.getByRole('button', { name: 'Leave table', exact: true }).click();
  } finally { await peer.close(); }
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
  await account.click(); await page.getByRole('menuitem', { name: 'Edit player icon' }).click();
  await editor.getByLabel('Player icon').selectOption(''); await editor.getByRole('button', { name: 'Save profile' }).click();
  await page.reload(); await expect(account).not.toContainText('🐱');
  await page.getByRole('link', { name: 'Find a Table', exact: true }).click(); await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Your seat', exact: true }).getByRole('img')).toHaveCount(0);
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
});

test('the profile menu shows saved wallet units, honest unavailable states and recovery without changing table chips', async ({ page }, testInfo) => {
  const fixture = await providerFixture(page, 'google', 'success', 'Wallet player'); await page.goto('./#/games');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Google' }).click();
  const account = page.getByRole('button', { name: 'Account menu for Wallet player' }); await account.click();
  const balance = page.getByRole('group', { name: 'Account wallet' });
  await expect(balance).toContainText('1,234.56'); await expect(balance).toContainText('250'); await expect(balance).toContainText('50.5');
  await page.screenshot({ path: testInfo.outputPath('profile-wallet.png'), fullPage: true });
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.keyboard.press('Escape'); fixture.setWalletMode('wrong-account'); await account.click();
  await expect(balance).toContainText('Unavailable'); await expect(balance).not.toContainText('1,234.56');
  fixture.setWalletMode('zero'); await page.getByRole('menuitem', { name: 'Retry wallet balance' }).click(); await expect(balance).toContainText('0 chips available');
  await page.keyboard.press('Escape'); fixture.setWalletMode('not-connected'); await account.click(); await expect(balance).toContainText('Not connected yet');
  await expect(balance).not.toContainText('0 chips available'); await page.keyboard.press('Escape');
  fixture.setWalletMode('offline'); await account.click(); await expect(balance).toContainText('Unavailable');
  fixture.setWalletMode('ready'); await page.getByRole('menuitem', { name: 'Retry wallet balance' }).click(); await expect(balance).toContainText('1,234.56');
  await page.keyboard.press('Escape'); await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click(); await expect(page.getByRole('region', { name: 'Game controls' })).toContainText('1,000');
  await account.click(); await expect(balance).toContainText('1,234.56');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
});

test('a first wallet receives 10,000 chips once, retries safely and survives reload without importing table chips', async ({ page }) => {
  const fixture = await providerFixture(page, 'google', 'success', 'New wallet'); fixture.setWalletMode('new-offline');
  await page.goto('./#/games'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Google' }).click();
  const account = page.getByRole('button', { name: 'Account menu for New wallet' }); await account.click();
  const wallet = page.getByRole('group', { name: 'Account wallet' }); await expect(wallet).toContainText('Unavailable');
  expect(fixture.counts().walletCreates).toBe(1);
  fixture.setWalletMode('new'); await page.getByRole('menuitem', { name: 'Retry wallet balance' }).click();
  await expect(wallet).toContainText('10,000 chips available'); expect(fixture.counts().walletCreates).toBe(2);
  await page.reload(); await account.click(); await expect(wallet).toContainText('10,000 chips available'); expect(fixture.counts().walletCreates).toBe(2);
  await page.keyboard.press('Escape'); await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Game controls' })).toContainText('1,000');
  await account.click(); await expect(wallet).toContainText('10,000 chips available'); expect(fixture.counts().walletCreates).toBe(2);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave table', exact: true }).click();
});

test('provider cancellation restores the invitation and leaves guest private lobbies available', async ({ page }, testInfo) => {
  const fixture = await providerFixture(page, 'google', 'cancel'); await page.goto(`./#/room/${invite}`);
  await page.getByLabel('What should we call you?').fill('Guest');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/room\\/${invite}$`));
  await expect(page.getByRole('status')).toContainText('Guest play is available');
  expect(fixture.counts().exchanges).toBe(0); expect(page.url()).not.toContain('private-provider-message');
  await page.getByRole('link', { name: 'Find or create another table' }).click(); await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
});

test('an unavailable account API never blocks guest entry or creates a funded bankroll', async ({ page }, testInfo) => {
  await providerFixture(page, 'discord', 'offline'); await page.goto('./#/games/blackjack');
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByLabel('What should we call you?').fill('Still a guest'); await page.getByRole('button', { name: 'Close create table' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Discord' }).click();
  await expect(page.getByRole('status')).toContainText('Guest play is available');
  await expect(page.getByRole('button', { name: 'Discord account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
});
