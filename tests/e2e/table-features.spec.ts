import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '@casual/protocol';
import { openTableEntry, expectOneScreen, rigShoe } from './fixtures';

test('Max Bet, double eligibility, numeric bust totals and automatic results countdown', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = new Date('2026-10-29T00:00:00Z'); await page.clock.install({ time: now }); await page.clock.pauseAt(now);
  await rigShoe(page, ['4', '10', '5', '7', 'K', '9']);
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Max player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Max Bet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Max Bet', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Hit/ }).click();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Hit/ }).click();
  const seat = page.getByRole('region', { name: 'Your seat' });
  await expect(seat.getByText('28 · Bust', { exact: true })).toBeVisible();
  await expect(seat.getByText('✕ Lost · -100 chips', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Next round countdown' })).toHaveText('Next round in 10s');
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
  await page.screenshot({ path: testInfo.outputPath('bust-and-results.png'), fullPage: true });
  await page.clock.runFor(1000); // Fixed reveal allowance precedes the ten-second results window.
  await page.clock.runFor(9000); await expect(page.getByRole('timer', { name: 'Next round countdown' })).toHaveText('Next round in 1s');
  await page.clock.runFor(1000); await expect(page.getByRole('button', { name: 'Deal me in' })).toBeEnabled();
  await expect(page.getByRole('timer', { name: 'Next round countdown' })).toHaveCount(0);
  if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
});

test('double is unavailable on 12 and Next round can skip an unfinished dealer reveal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await rigShoe(page, ['6', '6', '6', '10', '5']);
  await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Skip player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next round' }).click();
  await expect(page.getByRole('button', { name: 'Deal me in' })).toBeEnabled();
});

test('guests see ready and waiting states, shared results and the host skipping the pause', async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const context = await browser.newContext({ viewport: page.viewportSize()!, reducedMotion: 'reduce' }); const guest = await context.newPage();
  const latest = new Map<Page, Snapshot>();
  for (const peer of [page, guest]) peer.on('websocket', socket => socket.on('framereceived', event => {
    const data = JSON.parse(String(event.payload)) as { type: string; snapshot?: Snapshot };
    if (data.type === 'snapshot' && data.snapshot) latest.set(peer, data.snapshot);
  }));
  async function sharedState(accept: (snapshot: Snapshot) => boolean) {
    await expect.poll(() => {
      const host = latest.get(page); const visitor = latest.get(guest);
      return !!host && !!visitor && host.revision === visitor.revision && accept(host) && accept(visitor);
    }, { message: 'Both guests must receive the expected table state before the next action' }).toBe(true);
    return latest.get(page)!;
  }
  try {
    await openTableEntry(page); await page.getByLabel('What should we call you?').fill('Host'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The shared table' })).toBeVisible();
    await guest.goto(page.url()); await guest.getByLabel('What should we call you?').fill('Guest'); await guest.getByRole('button', { name: 'Join table', exact: true }).click();
    await expect(guest.locator('[data-connection]')).toHaveAttribute('data-connection', 'connected');
    await page.getByRole('button', { name: 'Open betting' }).click();
    await page.getByRole('button', { name: 'Max Bet', exact: true }).click();
    await page.getByRole('button', { name: /^Ready/ }).click();
    await expect(page.getByRole('region', { name: 'Your seat' }).getByText('✓ Ready · 100 chips', { exact: true })).toBeVisible();
    const waiting = page.getByRole('region', { name: 'Seat 2: Guest' });
    await expect(waiting.getByText('◷ Place your bet', { exact: true }).filter({ visible: true })).toHaveCount(1);
    const host = guest.getByRole('region', { name: 'Seat 1: Host' });
    await expect(host.getByText('✓ Ready · 100 chips', { exact: true }).filter({ visible: true })).toHaveCount(1);
    if (testInfo.project.name !== 'desktop') await expectOneScreen(page);
    await page.screenshot({ path: testInfo.outputPath('ready-and-waiting.png'), fullPage: true });
    await guest.getByRole('button', { name: /^Ready/ }).click();
    let state = await sharedState(snapshot => snapshot.phase !== 'BETTING');
    if (state.phase === 'INSURANCE') for (const peer of [page, guest]) {
      const revision = state.revision; const decidingPlayer = latest.get(peer)!.you;
      await peer.getByRole('button', { name: 'No insurance' }).click();
      // The final decision can settle a dealer blackjack without any player turn.
      state = await sharedState(snapshot => snapshot.revision > revision && (snapshot.you !== decidingPlayer || !snapshot.legalActions.includes('InsuranceDecision')));
    }
    for (let turns = 0; state.phase === 'PLAYER_TURNS' && turns < 4; turns++) {
      const actor = state.activePlayerId === state.you ? page : guest;
      const hand = state.activeHandId;
      await actor.getByRole('button', { name: 'Stand', exact: true }).click();
      state = await sharedState(snapshot => snapshot.phase !== 'PLAYER_TURNS' || snapshot.activeHandId !== hand);
    }
    expect(state.phase).toBe('ROUND_COMPLETE');
    await expect(page.getByRole('timer', { name: 'Next round countdown' })).toContainText('Next round in');
    await expect(guest.getByRole('timer', { name: 'Next round countdown' })).toContainText('Next round in');
    await expect(host.getByText(/^(✓ Won|✕ Lost|Even)/).filter({ visible: true })).toHaveCount(1);
    if (testInfo.project.name !== 'desktop') { await expectOneScreen(page); await expectOneScreen(guest); }
    await page.screenshot({ path: testInfo.outputPath('shared-results.png'), fullPage: true });
    await expect(guest.getByRole('button', { name: 'Next round' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next round' }).click();
    await sharedState(snapshot => snapshot.phase === 'BETTING');
    for (const peer of [page, guest]) await expect(peer.getByRole('button', { name: /^Ready/ })).toBeEnabled();
  } finally { await context.close(); }
});
