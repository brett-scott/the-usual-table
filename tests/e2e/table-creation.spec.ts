import { expect, test, type Locator, type Page } from '@playwright/test';
import { providerFixture } from './authFixture';
import { openTableEntry } from './fixtures';

const creation = (page: Page) => page.getByRole('dialog', { name: 'Create a table', exact: true });
async function dialogFits(page: Page) {
  const dialog = creation(page);
  const dimensions = await dialog.evaluate(el => ({ width: el.clientWidth, contentWidth: el.scrollWidth, height: el.clientHeight, contentHeight: el.scrollHeight,
    pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }));
  expect(dimensions.contentWidth, 'creation content must not overflow horizontally').toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.contentHeight, 'normal-size creation dialog must fit without scrolling').toBeLessThanOrEqual(dimensions.height + 1);
  const body = await dialog.locator('form > div').evaluate(el => ({ height: el.clientHeight, contentHeight: el.scrollHeight }));
  expect(body.contentHeight, 'normal-size form content must fit without internal scrolling').toBeLessThanOrEqual(body.height + 1);
  expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.pageHeight).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
  const controls = dialog.locator('input, select, button'); const bounds = [];
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const box = (await control.boundingBox())!;
    expect(box.height, 'touch targets must be at least 44px').toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
    bounds.push(box);
  }
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i]!; const b = bounds[j]!;
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
      && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
    expect(overlap, 'creation controls must not overlap').toBe(false);
  }
}
async function signedIn(page: Page) {
  await page.goto('./#/games/blackjack');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
}
async function reopenAfterReload(page: Page) {
  await page.reload();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
}
async function amountError(input: Locator) {
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAccessibleDescription(/chip|buy-in|minimum/i);
}

test('guest creation explains access and chips, fits the viewport and restores keyboard focus', async ({ page }, testInfo) => {
  await openTableEntry(page); const dialog = creation(page);
  await expect(dialog.getByLabel('Table visibility')).toHaveValue('private');
  await expect(dialog).toContainText(/Only people with.*link can join/i);
  await expect(dialog).toContainText('1,000 temporary chips');
  await dialog.getByLabel('What should we call you?').fill('A friendly guest at play');
  await dialog.getByLabel('Player icon', { exact: false }).selectOption('🦊');
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-guest-private.png') });
  await dialog.getByLabel('Table visibility').selectOption('public');
  await expect(dialog).toContainText(/public table|public browser/i);
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-guest-public.png') });
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press('Tab');
    // Native modals allow browser-chrome focus, but never background-page controls.
    const focus = await dialog.evaluate(el => ({ inside: el.contains(document.activeElement), documentFocused: document.hasFocus(), active: document.activeElement?.tagName }));
    expect(focus.inside || !focus.documentFocused && focus.active === 'BODY', JSON.stringify(focus)).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a table', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('What should we call you?')).toHaveValue('A friendly guest at play');
  await expect(dialog.getByLabel('Player icon', { exact: false })).toHaveValue('🦊');
  await page.setViewportSize({ width: 320, height: 480 });
  for (const control of await dialog.locator('input, select, button').all()) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321); expect(box.y + box.height).toBeLessThanOrEqual(481);
  }
  await page.screenshot({ path: testInfo.outputPath('create-constrained-viewport.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).not.toBeVisible();
});

test('saved-chip creation reuses the profile and explains invalid and insufficient buy-ins', async ({ page }, testInfo) => {
  await providerFixture(page, 'google', 'success', 'A friendly saved player', '🐱');
  await signedIn(page); const dialog = creation(page); const chips = dialog.getByRole('group', { name: 'Table chips' });
  await expect(dialog).toContainText('A friendly saved player');
  await expect(dialog.getByRole('img', { name: 'Cat player icon' })).toBeVisible();
  await expect(dialog.getByLabel('What should we call you?')).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: /^Player icon/ })).toHaveCount(0);
  await expect(chips).toContainText('1,234.56 chips available');
  await expect(chips.getByLabel('Play with', { exact: true })).toHaveValue('account');
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-saved-chips.png') });
  const amount = chips.getByLabel('Buy-in (chips)', { exact: true }); const submit = dialog.getByRole('button', { name: 'Create table', exact: true });
  await amount.fill('5'); await expect(submit).toBeDisabled(); await amountError(amount);
  await amount.fill('2000'); await expect(submit).toBeDisabled(); await amountError(amount);
  await expect(chips).toContainText(/available chips|available balance/i);
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-insufficient-chips.png') });
  await chips.getByLabel('Play with', { exact: true }).selectOption('guest');
  await expect(submit).toBeEnabled(); await expect(amount).toHaveCount(0);
  await expect(chips).toContainText(/not saved|aren’t saved/i);
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-temporary-chips.png') });
  await chips.getByLabel('Play with', { exact: true }).selectOption('account');
  await expect(amount).toHaveValue('2000'); await expect(submit).toBeDisabled();
  await amount.fill('1000'); await expect(submit).toBeEnabled();
});

test('wallet zero, unavailable, loading and unconfigured states stay distinct with explicit recovery', async ({ page }, testInfo) => {
  const fixture = await providerFixture(page, 'google', 'success', 'Saved player'); fixture.setWalletMode('zero');
  await signedIn(page); const dialog = creation(page); const chips = dialog.getByRole('group', { name: 'Table chips' });
  await expect(chips).toContainText('0 chips available');
  await expect(chips).toContainText('Not enough saved chips. Choose temporary chips to play.');
  await expect(chips.getByLabel('Play with', { exact: true })).toHaveValue('account');
  await expect(dialog.getByRole('button', { name: 'Create table', exact: true })).toBeDisabled();
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-zero-wallet.png') });
  fixture.setWalletMode('offline'); await reopenAfterReload(page);
  await expect(chips.getByRole('status')).toContainText('Unavailable');
  await expect(chips.getByLabel('Play with', { exact: true })).toHaveValue('account');
  await expect(chips).not.toContainText('0 chips available');
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-wallet-unavailable.png') });
  let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/account/wallet', async route => { await response; await route.fallback(); });
  await chips.getByRole('button', { name: 'Retry wallet balance', exact: true }).click();
  await expect(chips).toContainText(/loading wallet balance/i);
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-wallet-loading.png') });
  fixture.setWalletMode('ready'); release();
  await expect(chips).toContainText('1,234.56 chips available');
  fixture.setWalletMode('not-connected'); await reopenAfterReload(page);
  await expect(chips.getByRole('status')).toContainText('Not connected yet');
  await expect(chips).not.toContainText('0 chips available');
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-wallet-not-connected.png') });
  await chips.getByLabel('Play with', { exact: true }).selectOption('guest');
  await expect(dialog.getByRole('button', { name: 'Create table', exact: true })).toBeEnabled();
});

test('pending creation prevents dismissal and failure preserves choices for a successful retry', async ({ page }, testInfo) => {
  let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; }); let attempts = 0;
  await page.route('**/api/v1/games/blackjack/rooms', async route => {
    const body = route.request().postDataJSON() as { name: string; icon: string; visibility: string; funding?: string };
    expect(body).toMatchObject({ name: 'Friendly fox', icon: '🦊', visibility: 'public' });
    expect(body.funding).toBeUndefined();
    if (++attempts === 1) {
      await response;
      await route.fulfill({ status: 503, json: { code: 'UNAVAILABLE', message: 'Your table could not be created. Please retry.' } });
    } else await route.continue();
  });
  await openTableEntry(page); const dialog = creation(page);
  await dialog.getByLabel('What should we call you?').fill('Friendly fox');
  await dialog.getByLabel('Player icon', { exact: false }).selectOption('🦊');
  await dialog.getByLabel('Table visibility').selectOption('public');
  await dialog.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close create table', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-pending.png') });
  release(); await expect(dialog.getByRole('alert')).toContainText('Please retry');
  await expect(dialog.getByLabel('What should we call you?')).toHaveValue('Friendly fox');
  await expect(dialog.getByLabel('Player icon', { exact: false })).toHaveValue('🦊');
  await expect(dialog.getByLabel('Table visibility')).toHaveValue('public');
  await dialogFits(page); await page.screenshot({ path: testInfo.outputPath('create-failed.png') });
  await dialog.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled(); expect(attempts).toBe(2);
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
});
