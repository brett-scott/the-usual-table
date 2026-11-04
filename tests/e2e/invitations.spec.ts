import { expect, test } from '@playwright/test';
import { roomIdFromHash, shortRoomHash } from '@casual/protocol';
import { openTableEntry } from './fixtures';
import { providerFixture } from './authFixture';

test('short invitation links join the same private room, survive reload and preserve legacy invitations', async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: page.viewportSize()! }); const guest = await context.newPage();
  try {
    await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Host'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled(); const legacy = page.url(); const id = roomIdFromHash(new URL(legacy).hash)!;
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = page.getByRole('dialog', { name: 'Invite friends' }); const short = await invite.getByLabel('Invitation link').inputValue();
    expect(short.length).toBeLessThan(legacy.length); expect(new URL(short).hash).toBe(shortRoomHash(id)); expect(roomIdFromHash(new URL(short).hash)).toBe(id);
    await guest.goto(short); await guest.getByLabel('What should we call you?').fill('Short link guest');
    await guest.getByRole('button', { name: 'Join table', exact: true }).click(); await expect(guest.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await guest.reload(); await expect(guest.getByRole('region', { name: 'Your seat' })).toContainText('Short link guest');
    await expect(guest.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await guest.goto(legacy); await expect(guest.getByRole('region', { name: 'Your seat' })).toContainText('Short link guest');
    await expect(guest.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await guest.screenshot({ path: testInfo.outputPath('short-invitation-resumed.png') });
    await guest.getByRole('button', { name: 'Leave table', exact: true }).click(); await expect(guest.getByRole('link', { name: 'Find a Table', exact: true })).toBeVisible();
    await invite.getByRole('button', { name: 'Close invitation' }).click();
    await expect(page.getByRole('region', { name: 'Seat 2 empty', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click(); await expect(page.getByRole('link', { name: 'Find a Table', exact: true })).toBeVisible();
    await guest.goto(short);
    await expect(guest.getByRole('heading', { name: 'Table expired' })).toBeVisible();
  } finally { await context.close(); }
});

test('social sign-in returns to a short invitation without exposing callback parameters', async ({ page }) => {
  await providerFixture(page, 'discord', 'success', 'Saved guest');
  const hash = shortRoomHash('a'.repeat(32)); await page.goto(`./${hash}`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Continue with Discord' }).click();
  await expect(page.getByRole('button', { name: 'Account menu for Saved guest' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash); expect(page.url()).not.toMatch(/code=|access_token=|refresh_token=/);
  await expect(page.getByRole('button', { name: 'Join table', exact: true })).toBeEnabled();
});
