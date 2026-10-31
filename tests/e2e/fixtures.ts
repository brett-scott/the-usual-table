import { expect, type Page } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

let engineBundle: Promise<Map<string, string>> | undefined;
const enginePages = new WeakSet<Page>();
export async function installEngineFixture(page: Page) {
  if (enginePages.has(page)) return;
  enginePages.add(page);
  const base = process.env.E2E_BASE_PATH || '/'; const fixtureBase = `${base}__engine_fixture/`;
  engineBundle ??= build({ configFile: false, plugins: [react()], base: fixtureBase, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
    build: { write: false, minify: true, lib: { entry: resolve('tests/e2e/engineFixture.tsx'), formats: ['es'], fileName: 'fixture', cssFileName: 'fixture' },
      rolldownOptions: { output: { codeSplitting: false } } },
  }).then(result => {
    const bundles = Array.isArray(result) ? result : [result];
    return new Map(bundles.flatMap(bundle => {
      if (!('output' in bundle)) throw new Error('Unexpected fixture bundle');
      return bundle.output.map(file => [file.fileName, file.type === 'chunk' ? file.code : String(file.source)] as [string, string]);
    }));
  });
  const files = await engineBundle;
  await page.route(url => url.pathname.startsWith(fixtureBase) || url.pathname === base, async route => {
    const name = new URL(route.request().url()).pathname.slice(fixtureBase.length);
    const source = files.get(name);
    if (source !== undefined) { await route.fulfill({ body: source, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' }); return; }
    await route.fulfill({ contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${fixtureBase}fixture.css"></head><body><div id="root"></div><script type="module" src="${fixtureBase}fixture.js"></script></body></html>` });
  });
}

export async function openTableEntry(page: Page) {
  await page.goto('./#/games/blackjack');
  const create = page.getByRole('button', { name: 'Create a table', exact: true });
  if (!enginePages.has(page)) await create.click();
}

/** Changes browser RNG only; production has no seed control or fixture endpoint. */
export async function rigShoe(page: Page, ranks: string[]) {
  await installEngineFixture(page);
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
