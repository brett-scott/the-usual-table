import { expect, test, type Page } from '@playwright/test';
import { expectOneScreen, rigShoe } from './fixtures';
async function openChat(page: Page) {
  const sidebar = page.getByRole('region', { name: 'Table chat', exact: true });
  if (await sidebar.isVisible()) return sidebar;
  await page.getByRole('button', { name: /^Table chat/ }).click(); return page.getByRole('dialog', { name: 'Table chat', exact: true });
}

test('card face and back are independent, remembered and preserve the live cards', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await rigShoe(page, ['5', '6', '6', '10', 'K', '3']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Card collector'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  const card = page.getByRole('region', { name: 'Your seat' }).getByRole('img').first(); const handle = await card.elementHandle();
  const before = await page.locator('[data-revision]').getAttribute('data-revision'); const dealAt = await card.getAttribute('data-deal-at');
  await page.getByRole('button', { name: 'Card styles', exact: true }).click();
  const styles = page.getByRole('dialog', { name: 'Your card styles' });
  await styles.getByLabel('Card face', { exact: true }).selectOption('large-index');
  await styles.getByLabel('Card back', { exact: true }).selectOption('geometric');
  await expect(page.locator('[data-card-face]')).toHaveAttribute('data-card-face', 'large-index');
  await expect(page.locator('[data-card-back]')).toHaveAttribute('data-card-back', 'geometric');
  await page.screenshot({ path: testInfo.outputPath('card-styles.png'), fullPage: true });
  await styles.getByRole('button', { name: 'Close card styles' }).click();
  expect(await handle!.evaluate(node => node.isConnected)).toBe(true); expect(await card.getAttribute('data-deal-at')).toBe(dealAt);
  expect(await page.locator('[data-revision]').getAttribute('data-revision')).toBe(before);
  await expect(card).toHaveAttribute('data-face', 'large-index'); await expect(card).toHaveAttribute('data-back', 'geometric');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.reload(); await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await expect(page.locator('[data-card-face]')).toHaveAttribute('data-card-face', 'large-index');
  await expect(page.locator('[data-card-back]')).toHaveAttribute('data-card-back', 'geometric');
});

test('chips place, double and pay out from game amounts and honor reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await rigShoe(page, ['5', '6', '6', '10', 'K', '3', '10', '10', '6', '7', 'K']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Chip player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Increase bet' }).click();
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.id === 'chips-place'))).toBe(true);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Double', exact: true }).click();
  const payout = page.getByRole('region', { name: 'Your seat' }).getByRole('group', { name: 'Wager 40 chips, returned 80 chips', exact: true });
  await expect(payout).toHaveAttribute('data-settled', 'true');
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.id === 'chips-payout'))).toBe(true);
  await expect(page.getByRole('region', { name: 'Game controls' }).getByText('1,040', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chip-payout.png'), fullPage: true });
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.id.startsWith('chips-')).length)).toBe(0);
  await page.getByRole('button', { name: 'Next round' }).click(); await expect(payout).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: /^Hit/ })).toBeEnabled(); await page.getByRole('button', { name: /^Hit/ }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('group', { name: 'Wager 20 chips, returned 0 chips', exact: true })).toHaveAttribute('data-settled', 'true');
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.id === 'chips-collect'))).toBe(true);
  await expect(page.getByRole('region', { name: 'Game controls' }).getByText('1,020', { exact: false })).toBeVisible();
});

test('desktop chat is beside the game and table bubbles expire without replaying history', async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' }); const peer = await context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./'); await page.getByLabel('What should we call you?').fill('Host'); await page.getByRole('button', { name: 'Create a table with friends' }).click();
    await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    await peer.goto(page.url()); await peer.getByLabel('What should we call you?').fill('Guest'); await peer.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(peer.locator('[data-chat-ready]')).toHaveAttribute('data-chat-ready', 'true');
    await peer.clock.install(); await peer.clock.pauseAt(new Date());
    const sender = await openChat(page); const text = 'A'.repeat(300);
    await sender.getByRole('textbox').fill(text); await sender.getByRole('button', { name: 'Send', exact: true }).click();
    const bubble = peer.getByRole('region', { name: 'Seat 1: Host' }).getByRole('note', { name: 'Message from Host' });
    await expect(bubble).toBeVisible(); expect(Array.from(await bubble.innerText())).toHaveLength(80);
    await peer.screenshot({ path: testInfo.outputPath('table-bubble.png'), fullPage: true });
    await peer.clock.runFor(5001); await expect(bubble).toHaveCount(0);
    const history = await openChat(peer); await expect(history.getByRole('log')).toContainText(text);
    if (testInfo.project.name !== 'desktop') await sender.getByRole('button', { name: 'Close table chat' }).click();
    await page.getByRole('button', { name: 'Card styles', exact: true }).click();
    await page.getByLabel('Card face', { exact: true }).selectOption('large-index');
    await expect(peer.locator('[data-card-face]')).toHaveAttribute('data-card-face', 'classic');
    await page.getByRole('button', { name: 'Close card styles' }).click();
    await peer.reload(); await expect(peer.locator('[data-chat-ready]')).toHaveAttribute('data-chat-ready', 'true');
    await expect(peer.getByRole('note', { name: 'Message from Host' })).toHaveCount(0);
    const restored = await openChat(peer); await expect(restored.getByRole('log')).toContainText(text);
  } finally { await context.close(); }
});
