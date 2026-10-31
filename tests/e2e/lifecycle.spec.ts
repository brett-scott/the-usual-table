import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@casual/protocol';
import { openTableEntry, expectOneScreen } from './fixtures';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT || '8787'}`;
const table = (page: Page) => page.locator('[data-connection]');
async function createTable(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Resuming guest');
  await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(table(page)).toHaveAttribute('data-connection', 'connected');
}
async function current(page: Page): Promise<Snapshot> {
  return page.evaluate(async base => {
    const invite = location.hash.split('/').at(-1)!;
    const session = JSON.parse(localStorage.getItem(`casual-room:${invite}`)!) as { credential: string };
    const response = await fetch(`${base}/api/v1/rooms/${invite}/snapshot`, { headers: { Authorization: `Bearer ${session.credential}` } });
    return (await response.json() as { snapshot: Snapshot }).snapshot;
  }, api);
}
function game(snapshot: Snapshot) {
  return { round: snapshot.roundId, phase: snapshot.phase, shoe: snapshot.shoe, dealer: snapshot.dealer, deadline: snapshot.decisionDeadline,
    players: snapshot.players.map(p => ({ id: p.id, seat: p.seat, balance: p.balance, bet: p.bet, hands: p.hands })) };
}

test('offline and reload restore the same committed hand, balance, shoe and timer', async ({ page, context }, testInfo) => {
  await createTable(page);
  await page.getByRole('button', { name: 'Open betting' }).click(); await page.getByRole('button', { name: /^Ready/ }).click();
  await expect(page.getByRole('button', { name: /^Ready/ })).not.toBeVisible();
  const before = await current(page);
  await context.setOffline(true);
  await expect(table(page)).toHaveAttribute('data-connection', 'offline');
  await expect(page.getByRole('region', { name: 'Game controls' }).getByRole('status')).toContainText('offline');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('offline-reservation.png'), fullPage: true });
  const stand = page.getByRole('button', { name: 'Stand', exact: true }); if (await stand.isVisible()) await expect(stand).toBeDisabled();
  await context.setOffline(false); await expect(table(page)).toHaveAttribute('data-connection', 'connected');
  const reconnected = await current(page); expect(reconnected.you).toBe(before.you); expect(game(reconnected)).toEqual(game(before));
  await page.reload(); await expect(table(page)).toHaveAttribute('data-connection', 'connected');
  const restored = await current(page); expect(restored.you).toBe(before.you); expect(restored.players).toHaveLength(1); expect(game(restored)).toEqual(game(before));
});

test('lost snapshots and acknowledgements recover without repeating the accepted wager', async ({ page }) => {
  let dropSnapshot = false; let dropAck = false; let committed: Snapshot | undefined;
  await page.routeWebSocket('**/api/v1/rooms/*/socket', route => {
    const server = route.connectToServer();
    server.onMessage(async raw => {
      const message = JSON.parse(String(raw)) as { type: string; snapshot?: Snapshot };
      if (message.type === 'snapshot') {
        if (message.snapshot!.roundId > 0 && !committed) committed = message.snapshot;
        if (dropSnapshot) { dropSnapshot = false; return; }
      }
      if (message.type === 'ack' && dropAck) { dropAck = false; await route.close({ code: 1012, reason: 'Test lost acknowledgement' }); return; }
      route.send(raw);
    });
  });
  await createTable(page); const original = await current(page);
  dropSnapshot = true; await page.getByRole('button', { name: 'Open betting' }).click();
  await expect.poll(async () => (await current(page)).room!.bettingOpen).toBe(true);
  expect(Number(await table(page).getAttribute('data-revision'))).toBe(original.revision);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: /^Ready/ })).toBeVisible();
  dropAck = true; await page.getByRole('button', { name: /^Ready/ }).click();
  await expect.poll(() => committed !== undefined && !dropAck).toBe(true);
  await expect(table(page)).toHaveAttribute('data-connection', 'connected');
  await expect.poll(async () => (await current(page)).players[0]!.connected).toBe(true);
  const recovered = await current(page); expect(game(recovered)).toEqual(game(committed!)); expect(recovered.you).toBe(original.you);
  await expect(page.getByRole('alert')).toContainText('unconfirmed');
});

test('expired invitations and invalid saved sessions show recovery actions', async ({ page }, testInfo) => {
  await page.goto(`./#/room/${'0'.repeat(32)}`); await page.getByLabel('What should we call you?').fill('Guest');
  await page.getByRole('button', { name: 'Join table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Table expired' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find or create another table' })).toBeVisible();
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('expired-invitation.png'), fullPage: true });
  await page.getByRole('link', { name: 'Find or create another table' }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
  await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(table(page)).toHaveAttribute('data-connection', 'connected');
  await page.evaluate(() => {
    const invite = location.hash.split('/').at(-1)!; const key = `casual-room:${invite}`;
    const session = JSON.parse(localStorage.getItem(key)!) as { credential: string }; session.credential = '0'.repeat(64); localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Seat unavailable' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find or create another table' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invalid-session.png'), fullPage: true });
});
