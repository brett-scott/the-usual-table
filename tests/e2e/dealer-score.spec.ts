import { expect, test } from '@playwright/test';
import { CARD_FLIP_MS } from '@casual/protocol';
import { openTableEntry, rigShoe } from './fixtures';

test('dealer score counts only completed reveals, updates each draw and clears between rounds', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const start = new Date('2026-11-01T00:00:00Z'); await page.clock.install({ time: start }); await page.clock.pauseAt(start);
  await rigShoe(page, ['10', '2', '8', '2', '2', '2', '2', '2', '5']);
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Reveal watcher'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  const score = page.locator('[data-dealer-total]'); const cards = page.getByRole('group', { name: 'Dealer cards', exact: true }).getByRole('img');
  await expect(score).toHaveCount(0);
  await page.clock.runFor(2500); await expect(score).toHaveText('2');
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(cards).toHaveCount(7);
  const ready = await cards.evaluateAll((elements, flip) => elements.map(element => Number(element.getAttribute('data-reveal-at')) + flip), CARD_FLIP_MS);
  for (let index = 1; index < ready.length; index++) {
    const before = ready[index]! - 1; const now = await page.evaluate(() => Date.now());
    await page.clock.runFor(Math.max(0, before - now));
    await expect(score).toHaveText(String(index * 2));
    await page.clock.runFor(101);
    await expect(score).toHaveText(String(index === 6 ? 17 : (index + 1) * 2));
  }
  await page.getByRole('button', { name: 'Next round' }).click(); await expect(score).toHaveCount(0);
});

test('reduced motion shows the available upcard total and final dealer total immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await rigShoe(page, ['10', '6', '8', '10', '5']);
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Instant watcher'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('[data-dealer-total]')).toHaveText('6');
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('[data-dealer-total]')).toHaveText('21');
});
