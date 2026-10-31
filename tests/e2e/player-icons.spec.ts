import { expect, test } from '@playwright/test';
import { openTableEntry, expectOneScreen } from './fixtures';

test('optional guest icons persist for lobby creation and can return to initials', async ({ page }, testInfo) => {
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Friendly fox');
  const picker = page.getByLabel('Player icon', { exact: false });
  await expect(picker).toHaveValue(''); await picker.selectOption('🦊');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('emoji-entry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('img', { name: 'Fox player icon' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.reload(); await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('img', { name: 'Fox player icon' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave table', exact: true }).click(); await openTableEntry(page); await expect(picker).toHaveValue('🦊');
  await picker.selectOption(''); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).locator('[data-emoji="false"]')).toHaveText('F');
  await page.getByRole('button', { name: 'Leave table', exact: true }).click(); await openTableEntry(page); await expect(picker).toHaveValue('');
});
