import { expect, test } from '@playwright/test';
import { expectOneScreen, rigShoe } from './fixtures';

// Playwright runs these viewport cases in the dedicated iPhone 16 project.

for (const viewport of [
  { label: 'iPhone 16', width: 393, height: 852 },
  { label: 'iPhone 16 with browser bars', width: 393, height: 659 },
  { label: 'small phone', width: 360, height: 640 },
  { label: 'phone landscape', width: 852, height: 393 },
]) {
  test(`${viewport.label}: four split hands and all actions fit without scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
    await rigShoe(page, ['8', '6', '8', '10', '8', '8', '8', '8', '3', '2', '2', 'K', '5']);
    await page.goto('./');
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.getByLabel('What should we call you?').fill('Mobile player'); await page.getByRole('button', { name: 'Take a practice seat' }).click();
    await expectOneScreen(page);
    await page.getByRole('button', { name: 'Deal me in' }).click(); await expectOneScreen(page);
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Split', exact: true }).click(); await expectOneScreen(page); }
    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('group', { name: 'Player hand cards' })).toHaveCount(1);
    await page.getByRole('tab', { name: 'Hand 4, total 16', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Hit/ })).toBeDisabled(); await expectOneScreen(page);
    await page.getByRole('tab', { name: /Hand 1,.*playing/ }).click();
    await expect(page.getByRole('button', { name: /^Hit/ })).toBeEnabled();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(/Hand 2,/);
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(/Hand 1,.*playing/);
    await page.screenshot({ path: testInfo.outputPath('compact-four-hands.png'), fullPage: true });
    await page.getByRole('button', { name: 'Double', exact: true }).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(/Hand 2,.*playing/);
    await expectOneScreen(page);
    while (await page.getByRole('button', { name: 'Stand', exact: true }).isVisible()) await page.getByRole('button', { name: 'Stand', exact: true }).click();
    await expectOneScreen(page);
    // Reflow when the visible viewport changes, without reloading the game.
    await page.setViewportSize({ width: 393, height: 659 }); await expectOneScreen(page);
  });
}

test('safe areas, insurance and a long card fan fit on screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 659 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await rigShoe(page, ['A', 'A', '2', '7', ...Array.from({ length: 8 }, () => 'A')]);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Many cards'); await page.keyboard.press('Enter');
  await page.locator('[data-connection]').evaluate(el => { (el as HTMLElement).style.setProperty('--safe-top', '47px'); (el as HTMLElement).style.setProperty('--safe-bottom', '34px'); });
  await page.getByRole('button', { name: 'Deal me in' }).click(); await expectOneScreen(page);
  await page.getByRole('button', { name: 'No insurance' }).click();
  while (await page.getByRole('button', { name: /^Hit/ }).isVisible()) { await page.getByRole('button', { name: /^Hit/ }).click(); await expectOneScreen(page); }
  const cards = page.getByRole('region', { name: 'Your seat' }).getByRole('img'); await expect(cards).toHaveCount(10);
  const first = await cards.first().boundingBox(); const last = await cards.last().boundingBox();
  expect(first!.x).toBeGreaterThanOrEqual(0); expect(last!.x + last!.width).toBeLessThanOrEqual(393);
  await page.screenshot({ path: testInfo.outputPath('compact-long-hand.png'), fullPage: true });
});
