import { expect, test, type Page } from '@playwright/test';

async function rigShoe(page: Page, ranks: string[]) {
  // Browser-only fixture: construct a desired physical shoe, then invert Fisher–Yates.
  // Production has no seed control or fixture endpoint.
  const cards = Array.from({ length: 6 }, (_, deck) => ['spades', 'hearts', 'diamonds', 'clubs'].flatMap(suit => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map(rank => ({ id: `${deck}-${suit}-${rank}`, rank })))).flat();
  const unused = [...cards];
  const prefix = ranks.map(rank => unused.splice(unused.findIndex(c => c.rank === rank), 1)[0]!);
  const desired = [...prefix, ...unused]; const current = [...cards]; const indices: number[] = [];
  for (let i = 311; i > 0; i--) { const j = current.findIndex(c => c.id === desired[i]!.id); indices.push(j); [current[i], current[j]] = [current[j]!, current[i]!]; }
  await page.addInitScript(values => {
    let cursor = 0;
    Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array[0] = values[cursor++] ?? 0; return array; } });
  }, indices);
}

test('guest plays repeated complete rounds; themes preserve the hand', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true });
  await page.getByLabel('What should we call you?').fill('River');
  await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await expect(page.getByRole('heading', { name: 'The practice table' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Seat \d empty/ })).toHaveCount(3);
  await page.getByRole('button', { name: 'Increase bet' }).click();
  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: 'Deal me in' }).click();
    await page.getByRole('button', { name: 'Switch to Midnight table' }).click();
    await expect(page.locator('[data-theme="midnight"]')).toBeVisible();
    await page.getByRole('button', { name: 'Switch to Classic table' }).click();
    if (await page.getByRole('button', { name: 'No insurance' }).isVisible()) await page.getByRole('button', { name: 'No insurance' }).click();
    if (await page.getByRole('button', { name: 'Stand', exact: true }).isVisible()) await page.getByRole('button', { name: 'Stand', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
    if (round === 0) await page.screenshot({ path: testInfo.outputPath('table.png'), fullPage: true });
    await page.getByRole('button', { name: 'Next round' }).click();
  }
  await page.getByRole('button', { name: 'Rules' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Rules' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByLabel('What should we call you?')).toHaveValue('River');
});

test('split hands, double, and hit are usable', async ({ page }, testInfo) => {
  await rigShoe(page, ['8', '6', '8', '10', '8', '8', '8', '8', '3', '2', '2', 'K', '5']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Split player'); await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('four-hands.png'), fullPage: true });
  await page.getByRole('button', { name: 'Double', exact: true }).click();
  await page.getByRole('button', { name: /^Hit/ }).click();
  while (await page.getByRole('button', { name: 'Stand', exact: true }).isVisible()) await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
});

test('name form and controls work with the keyboard', async ({ page }) => {
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Keyboard player'); await page.keyboard.press('Enter');
  const rules = page.getByRole('button', { name: 'Rules' }); await rules.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(rules).toBeFocused();
  await page.getByRole('button', { name: 'Deal me in' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Deal me in' })).not.toBeVisible();
});

test('insurance is offered before peek and pays with simultaneous naturals', async ({ page }) => {
  await rigShoe(page, ['A', 'A', 'K', 'Q']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Ace player'); await page.getByRole('button', { name: 'Take a practice seat' }).click();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('img', { name: 'Face-down dealer card' })).toBeVisible();
  await page.getByRole('button', { name: 'Insure for 5' }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Face-down dealer card' })).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('+10 chips');
});

test('Hit resets the 20-second clock and expiry stands automatically', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const instant = new Date('2026-10-28T00:00:00Z');
  await page.clock.install({ time: instant }); await page.clock.pauseAt(new Date(instant.getTime() + 1000));
  await rigShoe(page, ['2', '10', '3', '7', '2']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Timer player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  const remaining = page.getByRole('timer').locator('strong');
  await expect(remaining).toHaveText('20s');
  await page.clock.runFor(15_000); await expect(remaining).toHaveText('5s');
  await page.getByRole('button', { name: /^Hit/ }).click(); await expect(remaining).toHaveText('20s');
  await page.clock.runFor(19_000); await expect(remaining).toHaveText('1s');
  await page.clock.runFor(1000);
  await expect(page.getByRole('timer', { name: 'Time remaining for this hand' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Time up. Your hand stood automatically.');
  await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('card-')).length)).toBe(0);
});

test('each split hand receives its own timer and background recovery respects expiry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const instant = new Date('2026-10-28T00:00:00Z');
  await page.clock.install({ time: instant }); await page.clock.pauseAt(new Date(instant.getTime() + 1000));
  await rigShoe(page, ['8', '10', '8', '7', '3', '2']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Split timer'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click(); await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.clock.runFor(15_000); await expect(page.getByRole('timer').locator('strong')).toHaveText('5s');
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.getByRole('timer').locator('strong')).toHaveText('20s');
  await page.clock.setSystemTime(new Date(instant.getTime() + 90_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('timer', { name: 'Time remaining for this hand' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('Time up.');
});

test('deal and flip order is staggered and the dealer hole card flips in place', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await rigShoe(page, ['10', '6', '8', '10', '5']);
  await page.goto('./'); await page.getByLabel('What should we call you?').fill('Animation player'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  const own = page.getByRole('group', { name: 'Player hand cards' }).locator('[data-deal-at]');
  const dealer = page.getByRole('group', { name: 'Dealer cards' }).locator('[data-deal-at]');
  const times = await Promise.all([own.nth(0), dealer.nth(0), own.nth(1), dealer.nth(1)].map(card => card.getAttribute('data-deal-at')));
  const values = times.map(Number);
  expect(values.slice(1).every((time, index) => time > values[index]!)).toBe(true);
  const firstFlip = Number(await own.nth(0).getAttribute('data-reveal-at'));
  const secondFlip = Number(await dealer.nth(0).getAttribute('data-reveal-at'));
  expect(secondFlip - firstFlip).toBeGreaterThanOrEqual(320);
  const hole = await dealer.nth(1).elementHandle();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('timer-and-cards.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  expect(await hole!.evaluate(el => el.isConnected)).toBe(true);
  expect(await dealer.nth(1).getAttribute('data-deal-at')).toBe(times[3]);
  const holeFlip = Number(await dealer.nth(1).getAttribute('data-reveal-at'));
  const drawAt = Number(await dealer.nth(2).getAttribute('data-deal-at'));
  expect(drawAt).toBeGreaterThanOrEqual(holeFlip + 320);
  // Freeze the actual 3D reveal halfway for visual inspection.
  await dealer.nth(1).evaluate(card => {
    const flip = card.getAnimations({ subtree: true }).find(a => a.id === 'card-flip')!;
    flip.pause(); flip.currentTime = Number(flip.effect!.getTiming().delay) + 160;
  });
  await page.screenshot({ path: testInfo.outputPath('dealer-flip.png'), fullPage: true });
  await expect(page.getByRole('status')).toContainText('chips');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
