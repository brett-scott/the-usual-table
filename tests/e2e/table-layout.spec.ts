import { expect, test, type Page } from '@playwright/test';
import { expectOneScreen, openTableEntry, rigShoe } from './fixtures';

async function checkCards(page: Page, name: 'Dealer cards' | 'Player hand cards') {
  const group = page.getByRole('group', { name, exact: true });
  const bounds = await group.getByRole('img').evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, right: box.right };
  }));
  const area = (await group.boundingBox())!;
  expect(bounds.length).toBeGreaterThanOrEqual(2);
  for (const [index, card] of bounds.entries()) {
    expect(card.x, `${name}: cards stay inside their row`).toBeGreaterThanOrEqual(area.x - 5);
    expect(card.right).toBeLessThanOrEqual(area.x + area.width + 5);
    if (index) expect(card.x - bounds[index - 1]!.x, `${name}: each card has a visible position beside the previous card`).toBeGreaterThan(12);
  }
  if (name === 'Dealer cards' && bounds.length === 2)
    expect(bounds[1]!.x).toBeGreaterThan(bounds[0]!.right);
}

test('dealer and player cards stay beside each other and table decoration stays compact', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await rigShoe(page, ['K', '2', 'Q', '2', '2', '2', '2', '2', '5']);
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Layout player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await checkCards(page, 'Dealer cards'); await checkCards(page, 'Player hand cards'); await expectOneScreen(page);
  const decoration = page.getByText('INSURANCE PAYS 2 TO 1', { exact: true });
  if (await decoration.isVisible()) {
    const oval = (await decoration.boundingBox())!; const table = (await page.getByRole('region', { name: 'Blackjack table' }).boundingBox())!;
    expect(oval.width, 'insurance oval stays around its lettering').toBeLessThan(280);
    expect(Math.abs(oval.x + oval.width / 2 - table.x - table.width / 2)).toBeLessThan(2);
  }
  await page.screenshot({ path: testInfo.outputPath('table-two-card-layout.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Dealer cards', exact: true }).getByRole('img')).toHaveCount(7);
  await checkCards(page, 'Dealer cards'); await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('table-seven-dealer-cards.png'), fullPage: true });
  if (testInfo.project.name === 'desktop') for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport); await checkCards(page, 'Dealer cards'); await checkCards(page, 'Player hand cards'); await expectOneScreen(page);
  }
});
