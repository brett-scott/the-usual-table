import { expect, test } from '@playwright/test';
import { expectOneScreen, openTableEntry } from './fixtures';

test('desktop table, controls and chat fit laptop screens with four players', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific layout matrix.');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openTableEntry(page);
  await page.getByLabel('What should we call you?').fill('A long host display name'); await page.getByRole('button', { name: 'Create table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open betting' })).toBeEnabled();
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })));
  const peers = await Promise.all(contexts.map(context => context.newPage()));
  const pages = [page, ...peers];
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
    for (const [index, peer] of peers.entries()) {
      await peer.goto(page.url()); await peer.getByLabel('What should we call you?').fill(`Desktop guest ${index + 1}`);
      await peer.getByRole('button', { name: 'Join table', exact: true }).click(); await expect(peer.locator('[data-chat-ready]')).toHaveAttribute('data-chat-ready', 'true');
    }
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
      await Promise.all(pages.map(view => view.setViewportSize(viewport))); await fit();
    }
    await Promise.all(pages.map(view => view.setViewportSize({ width: 1280, height: 720 })));
    await page.getByRole('button', { name: 'Open betting' }).click();
    for (const view of pages) await view.getByRole('button', { name: /^Ready/ }).click();
    await expect(page.getByRole('button', { name: /^Ready/ })).toHaveCount(0); await fit();
    for (const view of pages) {
      const insurance = view.getByRole('button', { name: 'No insurance' }); if (await insurance.isVisible()) await insurance.click();
    }
    for (const view of pages) {
      const stand = view.getByRole('button', { name: 'Stand', exact: true });
      if (await stand.isVisible() && await stand.isEnabled()) await stand.click();
    }
    await fit();
    await page.screenshot({ path: testInfo.outputPath('desktop-table-chat-1280x720.png'), fullPage: true });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
