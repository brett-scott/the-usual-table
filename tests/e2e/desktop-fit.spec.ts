import { expect, test, type Page } from '@playwright/test';
import type { ServerEvent, Snapshot } from '@casual/protocol';
import { expectOneScreen, openTableEntry } from './fixtures';

test('desktop table, controls and chat fit laptop screens with four players', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific layout matrix.');
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })));
  const peers = await Promise.all(contexts.map(context => context.newPage()));
  const pages = [page, ...peers];
  const latest = new Map<Page, Snapshot>(); const errors: string[] = [];
  function observe(view: Page, frame: string | Buffer) {
    const event = JSON.parse(String(frame)) as ServerEvent;
    if (event.type === 'snapshot' && event.snapshot.revision >= (latest.get(view)?.revision ?? -1)) latest.set(view, event.snapshot);
    if (event.type === 'error') errors.push(event.code);
  }
  for (const view of pages) view.on('websocket', socket => socket.on('framereceived', event => observe(view, event.payload)));
  async function synced(minRevision = 0) {
    await expect.poll(() => pages.every(view => {
      const snapshot = latest.get(view);
      return snapshot && snapshot.revision >= minRevision && snapshot.revision === latest.get(page)?.revision
        && snapshot.players.length === 4 && snapshot.players.every(player => player.connected);
    })).toBe(true);
    const revision = latest.get(page)!.revision;
    await Promise.all(pages.map(view => expect(view.locator('[data-revision]')).toHaveAttribute('data-revision', String(revision))));
    return revision;
  }
  async function click(view: Page, name: string | RegExp) {
    const revision = await synced();
    await view.getByRole('button', { name, exact: typeof name === 'string' }).click();
    await synced(revision + 1);
  }
  let delayedReadySnapshot = false;
  // Keep one peer behind the host's first Ready update, preserving message order.
  await peers[0]!.routeWebSocket('**/api/v1/rooms/*/socket', socket => {
    const upstream = socket.connectToServer(); const queued: (string | Buffer)[] = [];
    let waiting = false; let timer: ReturnType<typeof setTimeout> | undefined;
    peers[0]!.once('close', () => clearTimeout(timer));
    upstream.onMessage(message => {
      const event = JSON.parse(String(message)) as ServerEvent;
      if (!delayedReadySnapshot && event.type === 'snapshot' && event.snapshot.phase === 'BETTING' && event.snapshot.players.some(player => player.seat === 0 && player.ready)) {
        delayedReadySnapshot = true; waiting = true;
        timer = setTimeout(() => { waiting = false; for (const frame of queued.splice(0)) { socket.send(frame); observe(peers[0]!, frame); } }, 500);
      }
      if (waiting) queued.push(message); else { socket.send(message); observe(peers[0]!, message); }
    });
  });
  async function fit() {
    for (const view of pages) {
      await expectOneScreen(view);
      const chat = view.getByRole('region', { name: 'Table chat', exact: true });
      if (await chat.isVisible()) {
        const bounds = (await chat.boundingBox())!; const table = (await view.getByRole('region', { name: 'Blackjack table' }).boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(table.x + table.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(view.viewportSize()!.height);
        const composer = (await chat.getByRole('textbox').boundingBox())!; expect(composer.y + composer.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
  }
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await openTableEntry(page);
    await page.getByLabel('What should we call you?').fill('A long host display name'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
    for (const [index, peer] of peers.entries()) {
      await peer.goto(page.url()); await peer.getByLabel('What should we call you?').fill(`Desktop guest ${index + 1}`);
      await peer.getByRole('button', { name: 'Join table', exact: true }).click(); await expect(peer.locator('[data-chat-ready]')).toHaveAttribute('data-chat-ready', 'true');
    }
    await synced();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
      await Promise.all(pages.map(view => view.setViewportSize(viewport))); await fit();
    }
    await Promise.all(pages.map(view => view.setViewportSize({ width: 1280, height: 720 })));
    await click(page, 'Open betting');
    for (const view of pages) {
      await click(view, /^Ready/);
      const snapshot = latest.get(view)!;
      if (snapshot.phase === 'BETTING') expect(snapshot.players.find(player => player.id === snapshot.you)?.ready).toBe(true);
    }
    expect(latest.get(page)!.phase).not.toBe('BETTING');
    await expect(page.getByRole('button', { name: /^Ready/ })).toHaveCount(0); await fit();
    for (const view of pages) {
      if (latest.get(view)!.legalActions.includes('InsuranceDecision')) await click(view, 'No insurance');
    }
    for (let turn = 0; latest.get(page)!.phase === 'PLAYER_TURNS' && turn < 4; turn++) {
      const active = pages.find(view => latest.get(view)!.you === latest.get(page)!.activePlayerId);
      expect(active).toBeDefined(); await click(active!, 'Stand');
    }
    expect(latest.get(page)!.phase).toBe('ROUND_COMPLETE');
    await fit();
    await page.screenshot({ path: testInfo.outputPath('desktop-table-chat-1280x720.png'), fullPage: true });
    expect(delayedReadySnapshot).toBe(true);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
