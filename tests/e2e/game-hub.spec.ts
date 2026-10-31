import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@casual/protocol';
import { expectOneScreen, openTableEntry } from './fixtures';

async function expectCatalogFits(page: Page) {
  await expectOneScreen(page);
  const catalog = page.getByRole('region', { name: 'Game catalog' });
  await expect(catalog.getByRole('article')).toHaveCount(8);
  const overflow = await catalog.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight,
    width: element.clientWidth, scrollWidth: element.scrollWidth, scrollTop: element.scrollTop }));
  expect(overflow.scrollHeight, 'all game tiles must fit without scrolling the catalog').toBeLessThanOrEqual(overflow.height + 1);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1); expect(overflow.scrollTop).toBe(0);
  for (const tile of await catalog.getByRole('article').all()) {
    await expect(tile).toBeInViewport({ ratio: 1 });
    const bounds = (await tile.boundingBox())!;
    const content = tile.getByRole('heading').or(tile.getByText('COMING SOON', { exact: true })).or(tile.getByText('PLAY NOW', { exact: true })).or(tile.getByRole('link'));
    for (const item of await content.all()) {
      if (!(await item.isVisible())) continue;
      const rect = (await item.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x); expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    }
  }
  for (const link of await catalog.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}

test('game hub offers Blackjack and clearly marks future games without changing existing invitations', async ({ page }, testInfo) => {
  await page.goto('./'); await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
  for (const name of ['Baccarat', 'Roulette', 'Texas Hold’em', 'Keno', 'Duck Race', 'Penguin Cross', 'Crash']) await expect(page.getByRole('article', { name, exact: true })).toContainText('COMING SOON');
  const catalog = page.getByRole('region', { name: 'Game catalog' });
  await expectCatalogFits(page);
  await expect(catalog.getByRole('link')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('game-hub.png'), fullPage: true });
  await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a Table', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /practice/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await expect(page.getByLabel('What should we call you?')).toBeVisible();
  await expect(page.getByLabel('Table visibility')).toHaveValue('private');
  await page.getByRole('button', { name: 'Close create table' }).click();
  await page.getByRole('link', { name: 'All games' }).click(); await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
});

test('all eight home games fit smaller desktop, tablet and phone screens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The viewport matrix supplements the four standard device profiles.');
  await page.addInitScript(() => {
    const invite = 'a'.repeat(32);
    localStorage.setItem('casual-last-room', invite);
    localStorage.setItem(`casual-room:${invite}`, JSON.stringify({ inviteId: invite, playerId: 'layout-fixture', credential: 'b'.repeat(64) }));
  });
  for (const [width, height] of [[1366, 768], [1280, 720], [1024, 768], [768, 1024], [320, 568], [667, 375]]) {
    await page.setViewportSize({ width: width!, height: height! }); await page.goto('./#/games');
    await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
    await expectCatalogFits(page); await page.screenshot({ path: testInfo.outputPath(`games-${width}x${height}.png`), fullPage: true });
  }
});

test('public table browser lists a real room and joins through the invitation flow', async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' }); const peer = await context.newPage();
  try {
    const hostName = `Open ${testInfo.project.name}`;
    await openTableEntry(page); await page.getByLabel('What should we call you?').fill(hostName);
    await page.getByLabel('Table visibility').selectOption('public'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    const invite = page.url();
    await peer.goto(invite); await expect(peer.getByLabel('What should we call you?')).toBeVisible();
    await peer.getByRole('link', { name: 'All games' }).click(); await peer.getByRole('link', { name: 'Find a Table', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Find a Table', exact: true })).toBeVisible();
    await expect(peer.getByRole('link', { name: `Join ${hostName}’s table`, exact: true })).toBeVisible();
    if (testInfo.project.name !== 'desktop') await expectOneScreen(peer);
    await peer.screenshot({ path: testInfo.outputPath('public-tables.png'), fullPage: true });
    await peer.getByRole('link', { name: `Join ${hostName}’s table`, exact: true }).click();
    await peer.getByLabel('What should we call you?').fill('Found guest'); await peer.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Seat 2: Found guest' })).toBeVisible();
    expect(peer.url()).toBe(invite); await expect(peer.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await peer.getByRole('link', { name: 'The Usual Table', exact: true }).click();
    await expect(peer.getByRole('link', { name: 'Return to your last table' })).toBeVisible();
    await expectCatalogFits(peer);
    await peer.getByRole('link', { name: 'Return to your last table' }).click();
    await expect(peer.getByRole('region', { name: 'Your seat' }).getByText('Found guest', { exact: false })).toBeVisible();
    await expect(peer.getByRole('region', { name: 'Seat 1: ' + hostName })).toBeVisible();
    await expect(peer.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await peer.getByRole('button', { name: 'Leave table', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
    await expect(peer.getByRole('link', { name: 'Return to your last table' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Seat 2: Found guest' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
    await peer.goto(invite);
    await peer.getByLabel('What should we call you?').fill('Late guest');
    await peer.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Table expired' })).toBeVisible();
  } finally { await context.close(); }
});

test('table browser failure still allows creation of a private solo lobby', async ({ page }) => {
  await page.route('**/api/v1/games/blackjack/lobbies', route => route.abort());
  await page.goto('./#/games/blackjack/lobbies'); await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
  await page.getByLabel('What should we call you?').fill('Solo guest'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible();
  await page.getByRole('button', { name: 'Open betting' }).click(); await expect(page.getByRole('button', { name: /^Ready/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
});

test('guest lobby creation remains usable when persistent browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    const local = localStorage; const get = Storage.prototype.getItem; const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (this === local) throw new DOMException('Storage blocked', 'SecurityError'); return get.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (this === local) throw new DOMException('Storage blocked', 'SecurityError'); set.call(this, key, value); };
  });
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Temporary guest');
  await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
});

test('one-player private lobbies play successive rounds, reload, admit friends and leave normally', async ({ page, browser }, testInfo) => {
  let latest: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    const data = JSON.parse(String(event.payload)) as { type: string; snapshot?: Snapshot };
    if (data.type === 'snapshot' && data.snapshot) latest = data.snapshot;
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Solo host');
  await expect(page.getByLabel('Table visibility')).toHaveValue('private'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled(); const invite = page.url();
  await page.getByRole('button', { name: 'Open betting' }).click();
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: /^Ready/ }).click();
    await expect.poll(() => !!latest && latest.phase !== 'BETTING').toBe(true);
    for (let step = 0; step < 8 && latest?.phase !== 'ROUND_COMPLETE'; step++) {
      const revision = latest!.revision;
      if (latest?.phase === 'INSURANCE') await page.getByRole('button', { name: 'No insurance' }).click();
      else if (latest?.phase === 'PLAYER_TURNS') await page.getByRole('button', { name: 'Stand', exact: true }).click();
      await expect.poll(() => latest?.revision).toBeGreaterThan(revision);
    }
    await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
    await expectOneScreen(page); await page.getByRole('button', { name: 'Next round' }).click();
    await expect.poll(() => latest?.phase).toBe('BETTING'); await expect(page.getByRole('button', { name: /^Ready/ })).toBeEnabled();
  }
  await page.reload(); await expect(page.getByRole('button', { name: /^Ready/ })).toBeEnabled();
  const context = await browser.newContext({ viewport: page.viewportSize()! }); const guest = await context.newPage();
  try {
    await guest.goto(invite); await guest.getByLabel('What should we call you?').fill('Joined later');
    await guest.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Seat 2: Joined later' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('solo-private-with-friend.png'), fullPage: true });
    await guest.getByRole('button', { name: 'Leave table', exact: true }).click();
  } finally { await context.close(); }
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
  await page.goto(invite); await page.getByLabel('What should we call you?').fill('Late guest'); await page.getByRole('button', { name: 'Join table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Table expired' })).toBeVisible();
});
