import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@casual/protocol';
import { expectOneScreen, openTableEntry } from './fixtures';
import { providerFixture } from './authFixture';

async function expectCatalogFits(page: Page) {
  await expectOneScreen(page);
  const catalog = page.getByRole('region', { name: 'Game catalog' });
  await expect(catalog.getByRole('article')).toHaveCount(5);
  const overflow = await catalog.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight,
    width: element.clientWidth, scrollWidth: element.scrollWidth, scrollTop: element.scrollTop }));
  expect(overflow.scrollHeight, 'all game tiles must fit without scrolling the catalog').toBeLessThanOrEqual(overflow.height + 1);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1); expect(overflow.scrollTop).toBe(0);
  for (const tile of await catalog.getByRole('article').all()) {
    await expect(tile).toBeInViewport({ ratio: 1 });
    const bounds = (await tile.boundingBox())!;
    const content = tile.getByRole('heading').or(tile.getByRole('link'));
    for (const item of await content.all()) {
      if (!(await item.isVisible())) continue;
      const rect = (await item.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x); expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    }
  }
  for (const link of await catalog.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const viewport=page.viewportSize()!;
  if(viewport.width<=1000||viewport.height<=500){
    const rows=await catalog.getByRole('article').evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return{x:r.x,y:r.y,bottom:r.bottom};}));
    for(let i=1;i<rows.length;i++){expect(rows[i]!.x).toBe(rows[0]!.x);expect(rows[i]!.y).toBeGreaterThanOrEqual(rows[i-1]!.bottom);}
  }
}

test('Club Gallery lists only playable games without changing existing invitations', async ({ page }, testInfo) => {
  await page.goto('./'); await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
  for (const name of ['Texas Hold’em', 'Keno', 'Penguin Cross']) await expect(page.getByRole('article', { name, exact: true })).toHaveCount(0);
  const catalog = page.getByRole('region', { name: 'Game catalog' });
  await expectCatalogFits(page);
  await expect(catalog.getByRole('link')).toHaveCount(5);
  for(const copy of ['Five games. Your kind of table.','Choose a game to find or create a table.','Virtual chips. Real company.'])await expect(page.getByText(copy,{exact:true})).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('game-hub.png'), fullPage: true });
  await page.getByRole('article',{name:'Blackjack',exact:true}).getByRole('link', { name: 'Find a Table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a Table', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /practice/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await expect(page.getByLabel('What should we call you?')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Private table',exact:true})).toBeVisible();
  await page.getByRole('button', { name: 'Close create table' }).click();
  await page.getByRole('link', { name: 'All games' }).click(); await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
});

test('gallery shows the available account wallet outside the menu, recovers failures and fits a long nickname',async({page},info)=>{
  const fixture=await providerFixture(page,'google','success','A very long gallery name');
  await page.goto('./#/games');await expect(page.getByRole('group',{name:'Available wallet balance'})).toHaveCount(0);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();
  const account=page.getByRole('button',{name:'Account menu for A very long gallery name'}),wallet=page.getByRole('group',{name:'Available wallet balance'});
  await expect(account).toHaveAttribute('aria-expanded','false');await expect(wallet).toContainText('1,234.56');await expect(wallet).not.toContainText('250');
  for(const size of info.project.name==='desktop'?[{width:1280,height:720},{width:393,height:659},{width:320,height:568},{width:740,height:360}]:[page.viewportSize()!]){
    await page.setViewportSize(size);await expectCatalogFits(page);
    for(const element of [account,wallet,page.getByRole('link',{name:'The Usual Table',exact:true})]){const r=(await element.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(size.width+1);expect(r.y+r.height).toBeLessThanOrEqual(size.height+1);}
  }
  await page.screenshot({path:info.outputPath('gallery-visible-wallet.png')});
  fixture.setWalletMode('wrong-account');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(wallet).toContainText('Unavailable');await expect(wallet).not.toContainText('1,234.56');
  fixture.setWalletMode('zero');await wallet.getByRole('button',{name:'Retry wallet balance'}).click();await expect(wallet).toContainText('0chips');
  fixture.setWalletMode('ready');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(wallet).toContainText('1,234.56');
  await account.click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(wallet).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});

test('all playable home games fit smaller desktop, tablet and phone screens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The viewport matrix supplements the four standard device profiles.');
  await page.addInitScript(() => {
    const invite = 'a'.repeat(32);
    localStorage.setItem('casual-last-room', invite);
    localStorage.setItem(`casual-room:${invite}`, JSON.stringify({ inviteId: invite, playerId: 'layout-fixture', credential: 'b'.repeat(64) }));
  });
  for (const [width, height] of [[1366, 768], [1280, 720], [1024, 768], [768, 1024], [320, 568], [667, 375]]) {
    await page.setViewportSize({ width: width!, height: height! }); await page.goto('./#/games');
    await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
    await expectCatalogFits(page); await page.screenshot({ path: testInfo.outputPath(`games-${width}x${height}.png`), fullPage: true });
  }
});

test('public table browser lists a real room and joins through the invitation flow', async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' }); const peer = await context.newPage();
  try {
    const hostName = `Open ${testInfo.project.name}`;
    await openTableEntry(page, 'public'); await page.getByLabel('What should we call you?').fill(hostName);
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    const invite = page.url();
    await peer.goto(invite); await expect(peer.getByLabel('What should we call you?')).toBeVisible();
    await peer.getByRole('link', { name: 'All games' }).click(); await peer.getByRole('article',{name:'Blackjack',exact:true}).getByRole('link', { name: 'Find a Table', exact: true }).click();
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
    await expect(peer.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
    await expect(peer.getByRole('link', { name: 'Return to your last table' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Seat 2: Found guest' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
    await peer.goto(invite);
    await expect(peer.getByRole('heading', { name: 'Table expired' })).toBeVisible();
  } finally { await context.close(); }
});

test('table browser failure still allows creation of a private solo lobby', async ({ page }) => {
  await page.route('**/api/v1/games/blackjack/lobbies', route => route.abort());
  await page.goto('./#/games/blackjack/lobbies'); await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
  await page.getByLabel('What should we call you?').fill('Solo guest'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Blackjack table', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
});

test('one-player private lobbies play successive rounds, reload, admit friends and leave normally', async ({ page, browser }, testInfo) => {
  let latest: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    const data = JSON.parse(String(event.payload)) as { type: string; snapshot?: Snapshot };
    if ((data.type === 'snapshot'||data.type === 'game-snapshot') && data.snapshot) latest = data.snapshot;
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Solo host');
  await expect(page.getByRole('heading',{name:'Private table',exact:true})).toBeVisible(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: 'Take your pick.' })).toBeVisible();
  await page.goto(invite);
  await expect(page.getByRole('heading', { name: 'Table expired' })).toBeVisible();
});
