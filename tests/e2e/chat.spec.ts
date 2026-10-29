import { expect, test, type Page } from '@playwright/test';
import { expectOneScreen } from './fixtures';

async function chat(page: Page) { await page.getByRole('button', { name: /^Table chat/ }).click(); return page.getByRole('dialog', { name: 'Table chat', exact: true }); }

test('table chat shares safe text, stays private to the room, survives reload and leaves the mobile game on screen', async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' }); const peer = await context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./'); await page.getByLabel('What should we call you?').fill('Alex'); await page.getByRole('button', { name: 'Create a table with friends' }).click();
    await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    await peer.goto(page.url()); await peer.getByLabel('What should we call you?').fill('Alex'); await peer.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    const sender = await chat(page);
    await sender.getByRole('textbox').fill('Hello <img src=x onerror="window.chatInjected=true">');
    await sender.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(sender.getByRole('textbox')).toHaveValue('');
    await expect(peer.getByRole('button', { name: 'Table chat, 1 unread message' })).toBeVisible();
    const receiver = await chat(peer);
    await expect(receiver.getByRole('log')).toContainText('Hello <img src=x onerror="window.chatInjected=true">');
    expect(await peer.evaluate(() => 'chatInjected' in window)).toBe(false); await expect(receiver.locator('img')).toHaveCount(0);
    await receiver.getByRole('textbox').fill('Hi, seat one!'); await receiver.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(sender.getByRole('log')).toContainText('Hi, seat one!');
    await expect(sender.getByRole('log')).toContainText('Seat 1'); await expect(sender.getByRole('log')).toContainText('Seat 2');
    await page.screenshot({ path: testInfo.outputPath('table-chat.png'), fullPage: true });
    const bounds = await sender.boundingBox(); const viewport = page.viewportSize()!;
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (testInfo.project.name !== 'desktop') expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    if (testInfo.project.name !== 'desktop') {
      await page.setViewportSize({ width: viewport.width, height: Math.min(450, viewport.height) });
      await expect.poll(async () => {
        const input = await sender.getByRole('textbox').boundingBox(); return input!.y + input!.height;
      }).toBeLessThanOrEqual(Math.min(450, viewport.height));
      await page.setViewportSize(viewport);
    }
    await sender.getByRole('button', { name: 'Close table chat' }).click(); await expect(page.getByRole('button', { name: 'Table chat', exact: true })).toBeFocused();
    if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
    await peer.reload(); await expect(peer.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    const restored = await chat(peer); await expect(restored.getByRole('log').locator('article')).toHaveCount(2);
    await context.setOffline(true); await expect(peer.locator('[data-connection]')).toHaveAttribute('data-connection', 'offline');
    await restored.getByRole('textbox').fill('Keep my draft'); await expect(restored.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await context.setOffline(false); await expect(peer.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await expect(restored.getByRole('textbox')).toHaveValue('Keep my draft'); await expect(restored.getByRole('log').locator('article')).toHaveCount(2);
    await peer.keyboard.press('Escape'); await expect(restored).not.toBeVisible();
  } finally { await context.close(); }
});
