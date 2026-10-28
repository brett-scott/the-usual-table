import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@casual/protocol';
import { expectOneScreen } from './fixtures';

test('four guests share a real round; a fifth is rejected and reload resumes the same seat', async ({ browser, page, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' })));
  const others = await Promise.all(contexts.map(context => context.newPage()));
  const pages = [page, ...others.slice(0, 3)]; const fifth = others[3]!;
  if (testInfo.project.name === 'iphone16') for (const peer of pages) await peer.setViewportSize({ width: 393, height: 659 });
  const latest = new Map<Page, Snapshot>(); const frames = new Map<Page, string[]>();
  async function fits(peer: Page) {
    if (await peer.evaluate(() => matchMedia('(max-width: 640px), (max-width: 1024px) and (max-height: 500px)').matches)) await expectOneScreen(peer);
  }
  for (const peer of pages) {
    frames.set(peer, []);
    peer.on('websocket', socket => socket.on('framereceived', event => {
      const text = String(event.payload); frames.get(peer)!.push(text);
      const message = JSON.parse(text) as { type: string; snapshot?: Snapshot };
      if (message.type === 'snapshot' && message.snapshot) latest.set(peer, message.snapshot);
    }));
  }
  async function synced(minRevision = 0) {
    await expect.poll(() => {
      const snapshots = pages.map(peer => latest.get(peer));
      return snapshots.every(value => value && value.revision >= minRevision && value.revision === snapshots[0]?.revision && value.players.length === 4 && value.players.every(p => p.connected));
    }, { timeout: 15_000 }).toBe(true);
  }
  try {
    await page.goto(baseURL!); await page.getByLabel('What should we call you?').fill('Alex');
    await page.getByRole('button', { name: 'Create a table with friends' }).click();
    await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    const invite = page.url(); expect(invite).toMatch(/#\/room\/[a-f0-9]{32}$/);
    for (let i = 1; i < 4; i++) {
      const peer = pages[i]!; await peer.goto(invite); await peer.getByLabel('What should we call you?').fill(i === 1 ? 'Alex' : `Guest ${i + 1}`);
      await peer.getByRole('button', { name: 'Join table', exact: true }).click(); await expect(peer.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    }
    await synced();
    if (testInfo.project.name === 'iphone16') for (const peer of pages) await peer.locator('[data-connection]').evaluate(el => {
      (el as HTMLElement).style.setProperty('--safe-top', '47px'); (el as HTMLElement).style.setProperty('--safe-bottom', '34px');
    });
    for (const peer of pages) await fits(peer);
    const identities = pages.map(peer => latest.get(peer)!.you); expect(new Set(identities).size).toBe(4);
    await fifth.goto(invite); await fifth.getByLabel('What should we call you?').fill('Fifth'); await fifth.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(fifth.getByRole('alert')).toContainText('four players already');
    await expect(fifth.getByRole('button', { name: 'Create a table with friends' })).toBeVisible();
    let revision = latest.get(page)!.revision;
    await page.getByRole('button', { name: 'Open betting' }).click(); await synced(revision + 1);
    for (const peer of pages) {
      await expect(peer.getByRole('button', { name: /^Ready/ })).toBeEnabled();
      await fits(peer);
      revision = latest.get(page)!.revision;
      await peer.getByRole('button', { name: /^Ready/ }).click();
      await synced(revision + 1);
    }
    if (latest.get(page)!.phase === 'INSURANCE') for (const peer of pages) {
      revision = latest.get(page)!.revision;
      await peer.getByRole('button', { name: 'No insurance' }).click(); await synced(revision + 1);
    }
    for (let turn = 0; latest.get(page)!.phase !== 'ROUND_COMPLETE' && turn < 8; turn++) {
      const active = latest.get(page)!.activePlayerId; const peer = pages.find(p => latest.get(p)!.you === active)!;
      revision = latest.get(page)!.revision;
      await fits(peer);
      await peer.getByRole('button', { name: 'Stand', exact: true }).click(); await synced(revision + 1);
    }
    const final = latest.get(page)!; expect(final.phase).toBe('ROUND_COMPLETE');
    for (const peer of pages) {
      await expect(peer.getByRole('status')).toContainText('chips');
      expect(latest.get(peer)!.players).toEqual(final.players); expect(latest.get(peer)!.dealer).toEqual(final.dealer);
      expect(latest.get(peer)!.shoe).toEqual(final.shoe);
      expect(frames.get(peer)!.join('\n')).not.toContain('credential'); expect(frames.get(peer)!.join('\n')).not.toContain('cursor');
      expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await fits(peer);
    }
    await page.screenshot({ path: testInfo.outputPath('four-player-table.png'), fullPage: true });
    await page.reload(); await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible(); await synced(final.revision + 1);
    expect(latest.get(page)!.you).toBe(identities[0]); expect(latest.get(page)!.players).toHaveLength(4);
    expect(latest.get(page)!.shoe).toEqual(final.shoe);
    const replacement = await page.context().newPage();
    try {
      await replacement.goto(invite);
      await expect(replacement.getByRole('heading', { name: 'The shared table' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('another tab');
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
      await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'replaced');
      await expect(replacement.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
      await page.getByRole('button', { name: 'Create another table', exact: true }).click();
      await expect(page.getByLabel('What should we call you?')).toBeVisible();
      // Leaving the displaced view must not erase the controlling tab's credential.
      await replacement.reload(); await expect(replacement.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    } finally { await replacement.close(); }
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
