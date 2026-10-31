import { expect, test } from '@playwright/test';
import { openTableEntry, expectOneScreen } from './fixtures';

test('optional guest icons persist for lobby creation and can return to initials', async ({ page }, testInfo) => {
  let releaseLeave: (() => void) | undefined; let acceptedLeaves = 0;
  // Hold Leave until the test confirms the pending state, using the real Worker.
  await page.routeWebSocket('**/api/v1/rooms/*/socket', socket => {
    const upstream = socket.connectToServer();
    socket.onMessage(message => {
      const command = String(message).startsWith('{') ? JSON.parse(String(message)) as { action?: { type: string } } : undefined;
      if (command?.action?.type === 'Leave') {
        releaseLeave = () => { releaseLeave = undefined; acceptedLeaves++; upstream.send(message); };
      } else upstream.send(message);
    });
  });
  async function leaveAndReopen() {
    const tableUrl = page.url();
    const leave = page.getByRole('button', { name: 'Leave table', exact: true });
    await leave.click();
    await expect.poll(() => !!releaseLeave).toBe(true);
    await expect(leave).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Your seat' })).toBeVisible();
    await expect(page).toHaveURL(tableUrl);
    releaseLeave!();
    await expect(page).toHaveURL(/#\/games$/);
    await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Return to your last table/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
    await page.getByRole('button', { name: 'Create a table', exact: true }).click();
  }
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Friendly fox');
  const picker = page.getByLabel('Player icon', { exact: false });
  await expect(picker).toHaveValue(''); await picker.selectOption('🦊');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('emoji-entry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('img', { name: 'Fox player icon' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.reload(); await expect(page.getByRole('region', { name: 'Your seat' }).getByRole('img', { name: 'Fox player icon' })).toBeVisible();
  await leaveAndReopen(); await expect(picker).toHaveValue('🦊');
  await picker.selectOption(''); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your seat' }).locator('[data-emoji="false"]')).toHaveText('F');
  await leaveAndReopen(); await expect(picker).toHaveValue('');
  expect(acceptedLeaves).toBe(2);
});
