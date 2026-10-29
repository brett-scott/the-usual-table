import { expect, test } from '@playwright/test';
import { expectOneScreen } from './fixtures';

test('optional emoji icons work in practice, persist for entry and can return to initials', async ({ page }, testInfo) => {
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Friendly fox');
  const picker = page.getByLabel('Player icon', { exact: false });
  await expect(picker).toHaveValue(''); await picker.selectOption('🦊');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('emoji-entry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('img', { name: 'Fox player icon' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.reload(); await expect(picker).toHaveValue('🦊');
  await picker.selectOption(''); await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).locator('[data-emoji="false"]')).toHaveText('F');
  await page.reload(); await expect(picker).toHaveValue('');
});
