import { expect, type Page } from '@playwright/test';

/** Changes browser RNG only; production has no seed control or fixture endpoint. */
export async function rigShoe(page: Page, ranks: string[]) {
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

export async function expectOneScreen(page: Page) {
  const size = await page.evaluate(() => ({ height: innerHeight, width: innerWidth, scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, y: scrollY }));
  expect(size.scrollHeight, 'document must not scroll vertically').toBeLessThanOrEqual(size.height + 1);
  expect(size.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(size.width + 1);
  expect(size.y).toBe(0);
  for (const locator of [page.getByRole('region', { name: 'Blackjack table' }), page.getByRole('region', { name: 'Your seat' }), page.getByRole('region', { name: 'Game controls' })]) {
    if (!(await locator.isVisible())) continue;
    const bounds = await locator.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
    const overflow = await locator.evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, width: el.clientWidth, scrollWidth: el.scrollWidth }));
    expect(overflow.scrollHeight, 'game content must fit its allocated area').toBeLessThanOrEqual(overflow.height + 1);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 1);
  }
  for (const button of await page.getByRole('region', { name: 'Game controls' }).getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const bounds = await button.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
  }
}
