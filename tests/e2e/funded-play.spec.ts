import { expect, test, type Page } from '@playwright/test';
import { createDecks, createRoom, project, transition } from '@casual/engine';
import type { Command, Snapshot, WalletSummary } from '@casual/protocol';
import { accountId, providerFixture } from './authFixture';
import { expectOneScreen } from './fixtures';

/** Browser transport fixture. Signed authorization and real PostgreSQL accounting have separate runtime tests. */
async function savedTable(page: Page, failFirst = false) {
  await providerFixture(page, 'google', 'success', 'Saved player');
  const inviteId = 'c'.repeat(32); const playerId = 'saved-player'; const credential = 'd'.repeat(64);
  let engine = createRoom('Saved player', max => max - 1, Date.now()); engine.players[0]!.id = playerId;
  const cards = createDecks(); engine.shoe.cards = [...['10', '6', '8', '10', '5'].map(rank => cards.splice(cards.findIndex(card => card.rank === rank), 1)[0]!), ...cards];
  let available = 1000000; let stack = 0; let created = false; let bettingOpen = false; let revision = 0;
  let entryId = ''; let creates = 0; let renewals = 0;
  const session = { inviteId, playerId, credential, funding: 'account' as const };
  const wallet = (): WalletSummary => ({ contract: 1, currency: 'virtual-chips', unitsPerChip: 100, accountId, status: 'active', version: revision + 1,
    availableUnits: available, atTablesUnits: stack, pendingReturnUnits: 0 });
  function snapshot(): Snapshot {
    const result = project(engine, playerId);
    return { ...result, revision, wallet: { status: 'active', stackUnits: stack, error: null },
      room: { inviteId, managerPlayerId: playerId, bettingOpen, bettingDeadline: null, insuranceDeadline: null, claimVersion: 0 },
      legalActions: ['Leave', ...(engine.phase === 'BETTING' && !bettingOpen ? ['StartBetting' as const] : result.legalActions.filter(action => action !== 'Refill'))],
      players: result.players.map(player => ({ ...player, connected: true })) };
  }
  await page.route('**/api/v1/account/wallet', route => route.fulfill({ json: wallet() }));
  await page.route('**/api/v1/rooms**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    expect(request.headers().authorization).toMatch(/^Bearer [^.]+\.[^.]+\./);
    if (path.endsWith('/rooms')) {
      const body = request.postDataJSON() as { funding: string; buyInUnits: number; entryId: string };
      expect(body.funding).toBe('account'); expect(body.buyInUnits).toBe(100000);
      expect(body).not.toHaveProperty('accountId'); creates++;
      if (entryId) expect(body.entryId).toBe(entryId); entryId = body.entryId;
      if (failFirst && creates === 1) { await route.fulfill({ status: 503, json: { code: 'WALLET_UNAVAILABLE', message: 'Your buy-in could not be confirmed. Retry to check the same entry.' } }); return; }
      if (!created) { created = true; available -= body.buyInUnits; stack = body.buyInUnits; engine.players[0]!.balance = body.buyInUnits / 50; }
      await route.fulfill({ status: 201, json: { session, snapshot: snapshot() } });
    } else if (path.endsWith('/resume')) await route.fulfill({ json: { snapshot: snapshot() } });
    else if (path.endsWith('/ticket')) await route.fulfill({ json: { ticket: 'e'.repeat(64) } });
    else if (path.endsWith('/authorize')) { renewals++; await route.fulfill({ json: { expiresAt: Date.now() + 90000 } }); }
    else throw new Error(`Unexpected saved-table route: ${path}`);
  });
  await page.routeWebSocket('**/api/v1/rooms/*/socket', socket => {
    socket.send(JSON.stringify({ type: 'connected', controllerId: '11111111-1111-4111-8111-111111111111', serverTime: Date.now() }));
    const sendSnapshot = () => socket.send(JSON.stringify({ type: 'snapshot', snapshot: snapshot(), serverTime: Date.now() }));
    sendSnapshot();
    socket.onMessage(message => {
      if (message === 'ping') { socket.send(JSON.stringify({ type: 'pong', serverTime: Date.now() })); return; }
      if (message === 'snapshot') { sendSnapshot(); return; }
      const command = JSON.parse(String(message)) as Command;
      if (command.action.type === 'StartBetting') bettingOpen = true;
      else if (command.action.type === 'Leave') { available += stack; stack = 0; }
      else {
        engine = transition(engine, { ...command, revision: engine.revision, roundId: engine.roundId, playerId }, max => max - 1, Date.now());
        if (engine.phase === 'ROUND_COMPLETE') stack = engine.players[0]!.balance * 50;
      }
      revision++;
      if (command.action.type !== 'Leave') sendSnapshot();
      socket.send(JSON.stringify({ type: 'ack', commandId: command.id, revision }));
    });
  });
  return { counts: () => ({ creates, renewals }), wallet };
}
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Account menu for Saved player' })).toBeVisible();
}

test('saved-chip buy-in retries once, survives reload, settles a round and returns remaining chips on leave', async ({ page }, testInfo) => {
  const fixture = await savedTable(page, true); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/games'); await signIn(page); await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click();
  await expect(page.getByLabel('Play with', { exact: true })).toHaveValue('account');
  await page.getByLabel('Buy-in (chips)', { exact: true }).fill('5'); await expect(page.getByRole('button', { name: 'Create table', exact: true })).toBeDisabled();
  await page.getByLabel('Buy-in (chips)', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Create table', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  expect(fixture.wallet().availableUnits).toBe(1000000);
  await page.getByRole('button', { name: 'Create table', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  expect(fixture.counts().creates).toBe(2); expect(fixture.wallet()).toMatchObject({ availableUnits: 900000, atTablesUnits: 100000 });
  await expect(page.getByRole('button', { name: 'Refill to 1,000' })).toHaveCount(0); await expectOneScreen(page);
  await page.reload(); await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled(); expect(fixture.counts().creates).toBe(2);
  await page.getByRole('button', { name: 'Open betting' }).click(); await page.getByRole('button', { name: /^Ready/ }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
  expect(fixture.wallet()).toMatchObject({ availableUnits: 900000, atTablesUnits: 99000 });
  await page.screenshot({ path: testInfo.outputPath('saved-chip-round.png'), fullPage: true }); await expectOneScreen(page);
  await page.getByRole('button', { name: 'Leave table', exact: true }).click(); await expect(page.getByRole('heading', { name: 'A game for every table.' })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu for Saved player' }).click();
  const balance = page.getByRole('group', { name: 'Account wallet' }); await expect(balance).toContainText('9,990 chips available');
  expect(fixture.wallet()).toMatchObject({ availableUnits: 999000, atTablesUnits: 0 });
});

test('signing out stops a saved-chip controller and signing back in restores its existing seat', async ({ page }) => {
  const fixture = await savedTable(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/games'); await signIn(page); await page.getByRole('link', { name: 'Find a Table', exact: true }).click();
  await page.getByRole('button', { name: 'Create a table', exact: true }).click(); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  await page.getByRole('button', { name: 'Account menu for Saved player' }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('[data-connection]')).toHaveAttribute('data-connection', 'invalid');
  await expect(page.getByRole('button', { name: 'Open betting' })).toHaveCount(0);
  await signIn(page); await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  expect(fixture.counts().creates).toBe(1); expect(fixture.wallet()).toMatchObject({ availableUnits: 900000, atTablesUnits: 100000 });
});
