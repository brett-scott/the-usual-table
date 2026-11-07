import { expect, test, type Page } from '@playwright/test';
import { accountId, providerFixture } from './authFixture';

const game = { gameId: 'blackjack', roundsPlayed: '4', roundsWon: '2', roundsLost: '1', roundsEven: '1', wageredUnits: '4000', returnedUnits: '5500', netUnits: '1500', bestRoundNetUnits: '1500' };
const statistics = { contract: 1, accountId, unitsPerChip: 100, basis: 'saved-rounds', games: [game] };
const blackjackDetails={trackedRounds:'4',hands:'5',wins:'2',losses:'2',pushes:'1',blackjacks:'1',busts:'1',doubles:'1',splits:'1',insuranceTaken:'1',insuranceWon:'0',perfectPairsBets:'2',perfectPairsWins:'1'};
const detailed={accountId,summary:statistics,blackjack:blackjackDetails};
async function login(page: Page) {
  await page.goto('./#/games'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Account menu for Stats player' })).toBeVisible();
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Account menu for Stats player' }).click();
  await page.getByRole('menuitem', { name: 'Statistics', exact: true }).click();
  return page.getByRole('dialog', { name: 'Your statistics', exact: true });
}

test('account statistics show per-game saved rounds, precise amounts, refresh and no guest persistence', async ({ page }, testInfo) => {
  await providerFixture(page, 'google', 'success', 'Stats player'); let reads = 0;
  await page.route('**/api/v1/account/statistics/details*', async route => {
    expect(route.request().method()).toBe('GET'); expect(route.request().postData()).toBeNull(); expect(new URL(route.request().url()).search).toBe('?version=5'); reads++;
    await route.fulfill({ json: detailed });
  });
  await login(page); expect(reads).toBe(0);
  const dialog = await open(page);
  await expect(dialog.getByRole('tabpanel',{name:'General statistics'})).toContainText('Games played: 1');
  await dialog.getByRole('tab',{name:'Blackjack',exact:true}).click();
  const blackjack = dialog.getByRole('tabpanel', { name: 'Blackjack statistics', exact: true });
  await expect(blackjack).toBeVisible(); await expect(blackjack.getByText('+15', { exact: true })).toHaveCount(2);
  await expect(blackjack.locator('dl > div').filter({ hasText: 'Rounds played' })).toHaveText('Rounds played4');
  await expect(blackjack.locator('dl > div').filter({ hasText: 'Chips wagered' })).toHaveText('Chips wagered40');
  await expect(blackjack.locator('dl > div').filter({ hasText: 'Chips returned' })).toHaveText('Chips returned55');
  await expect(blackjack.locator('dl > div').filter({hasText:'Hands played'})).toHaveText('Hands played5');
  await expect(blackjack.locator('dl > div').filter({hasText:'Natural blackjacks'})).toHaveText('Natural blackjacks1');
  await expect(blackjack.locator('dl > div').filter({hasText:'Perfect Pairs bets'})).toHaveText('Perfect Pairs bets2');
  await expect(blackjack.locator('dl > div').filter({hasText:'Perfect Pairs wins'})).toHaveText('Perfect Pairs wins1');
  await expect(dialog).toContainText('Temporary play isn’t recorded');
  await page.screenshot({ path: testInfo.outputPath('account-statistics.png') });
  await dialog.getByRole('button', { name: 'Refresh statistics' }).click(); await expect.poll(() => reads).toBe(2);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Account menu for Stats player' })).toBeFocused();
  await page.getByRole('button', { name: 'Account menu for Stats player' }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Statistics', exact: true })).toHaveCount(0); await expect(dialog).not.toBeVisible();
});

test('statistics distinguish empty history, setup and unavailable/wrong-account responses with retry', async ({ page }, testInfo) => {
  await providerFixture(page, 'google', 'success', 'Stats player');
  let mode = 'missing';
  await page.route('**/api/v1/account/statistics/details*', async route => {
    if (mode === 'missing') await route.fulfill({ status: 503, json: { code: 'STATISTICS_NOT_CONNECTED' } });
    else if (mode === 'offline') await route.abort();
    else if (mode === 'wrong') await route.fulfill({ json: { ...detailed, accountId: 'c213ae22-a459-456d-976c-dc115e74abda' } });
    else await route.fulfill({ json: { ...detailed, summary:{...statistics,games: mode === 'empty' ? [] : [game]} } });
  });
  await login(page); const dialog = await open(page);
  await expect(dialog.getByRole('status')).toHaveText('Statistics are not connected yet.');
  mode = 'offline'; await dialog.getByRole('button', { name: 'Retry statistics' }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be loaded');
  mode = 'wrong'; await dialog.getByRole('button', { name: 'Retry statistics' }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be loaded'); await expect(dialog.getByText('+15', { exact: true })).toHaveCount(0);
  mode = 'empty'; await dialog.getByRole('button', { name: 'Retry statistics' }).click();
  await expect(dialog).toContainText('No saved rounds yet');
  await expect(dialog.getByRole('tabpanel', { name: 'General statistics' }).locator('dd')).toHaveText(['0', '0', '0', '0', '0', '0', '0', '0']);
  await page.screenshot({ path: testInfo.outputPath('empty-statistics.png') });
  mode = 'ready'; await dialog.getByRole('button', { name: 'Refresh statistics' }).click();
  await expect(dialog.getByText('+15', { exact: true })).toHaveCount(2);
});
