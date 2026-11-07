import { expect,test,type Page } from '@playwright/test';
import { GAME_CATALOG } from '@casual/protocol';
import { providerFixture } from './authFixture';
const picker=(page:Page)=>page.getByRole('dialog',{name:'Find a Table',exact:true});
async function fits(page:Page){
  const modal=picker(page),size=page.viewportSize()!;
  const bounds=(await modal.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(size.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height+1);
  const overflow=await modal.evaluate(el=>({height:el.clientHeight,sh:el.scrollHeight,width:el.clientWidth,sw:el.scrollWidth,documentFits:document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1}));
  expect(overflow.documentFits).toBe(true);expect(overflow.sh).toBeLessThanOrEqual(overflow.height+1);expect(overflow.sw).toBeLessThanOrEqual(overflow.width+1);
  for(const control of await modal.locator('button,a').all()){
    if(!await control.isVisible())continue;
    // Public tables are the only deliberately scrollable area in the popup.
    if(await control.evaluate(el=>!!el.closest('[aria-label^="Public "]')))continue;
    const r=(await control.boundingBox())!;expect(r.height).toBeGreaterThanOrEqual(44);expect(r.y).toBeGreaterThanOrEqual(bounds.y);expect(r.y+r.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
  }
}

test('each game opens its own table popup over the gallery and closing restores the original game link',async({page},info)=>{
  const requested:string[]=[];
  await page.route('**/api/v1/games/*/lobbies',route=>{const id=new URL(route.request().url()).pathname.split('/')[4]!;requested.push(id);return route.fulfill({json:{gameId:id,lobbies:[{roomId:'a'.repeat(32),gameId:id,hostName:`${id} host`,players:1,capacity:id==='blackjack'?4:8,phase:'waiting',updatedAt:Date.now()}]}});});
  await page.goto('./#/games');if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  for(const game of GAME_CATALOG.filter(game=>game.status==='available')){
    const link=page.getByRole('article',{name:game.name,exact:true}).getByRole('link',{name:'Find a Table',exact:true});await link.click();
    await expect(picker(page)).toBeVisible();await expect(picker(page).getByRole('region',{name:`Public ${game.name} tables`})).toContainText(`${game.id} host`);await expect(page).toHaveURL(new RegExp(`#/games/${game.id}$`));
    await expect(page.locator('main h1')).toHaveText('Take your pick.');await expect(page.locator('[inert]')).toHaveAttribute('aria-hidden','true');await fits(page);
    if(game.id==='roulette')await page.screenshot({path:info.outputPath('find-table-popup.png')});
    await page.keyboard.press('Escape');await expect(picker(page)).toHaveCount(0);await expect(link).toBeFocused();await expect(page).toHaveURL(/#\/games$/);
  }
  expect(new Set(requested)).toEqual(new Set(['blackjack','baccarat','roulette','duck-race','crash']));
});

test('public and private popup choices prefill creation, preserve the guest draft and return without stacked modals',async({page})=>{
  await page.route('**/api/v1/games/*/lobbies',route=>{const id=new URL(route.request().url()).pathname.split('/')[4]!;return route.fulfill({json:{gameId:id,lobbies:[]}});});
  await page.goto('./#/games/blackjack');
  for(const visibility of ['public','private']){
    await picker(page).getByRole('radio',{name:visibility==='public'?'Public':'Private',exact:true}).check();await picker(page).getByRole('button',{name:'Create a table',exact:true}).click();
    const form=page.getByRole('dialog',{name:'Create a table',exact:true});await expect(form).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(form.getByRole('heading',{name:visibility==='public'?'Public table':'Private table',exact:true})).toBeVisible();await expect(form.getByLabel('Table visibility')).toHaveCount(0);
    await form.getByLabel('What should we call you?').fill('Popup guest');await form.getByRole('button',{name:'Cancel',exact:true}).click();await expect(picker(page)).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(picker(page).getByRole('button',{name:'Create a table',exact:true})).toBeFocused();await expect(picker(page).getByRole('radio',{name:visibility==='public'?'Public':'Private',exact:true})).toBeChecked();
  }
  await page.keyboard.press('Escape');await page.getByRole('article',{name:'Crash',exact:true}).getByRole('link',{name:'Find a Table',exact:true}).click();await picker(page).getByRole('button',{name:'Create a table',exact:true}).click();await expect(page.getByLabel('What should we call you?')).toHaveValue('Popup guest');await expect(page.getByRole('heading',{name:'Private table',exact:true})).toBeVisible();
});

test('long public lists stay inside the popup and direct game links reopen it after reload',async({page},info)=>{
  await page.route('**/api/v1/games/roulette/lobbies',route=>route.fulfill({json:{gameId:'roulette',lobbies:Array.from({length:50},(_,i)=>({roomId:i.toString(16).padStart(32,'0'),gameId:'roulette',hostName:`Guest ${i}`,players:1,capacity:8,phase:i%2?'waiting':'playing',updatedAt:Date.now()}))}}));
  await page.goto('./#/games/roulette/lobbies');if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  const list=picker(page).getByRole('region',{name:'Public Roulette tables'});await expect(list.getByRole('article')).toHaveCount(50);await fits(page);await list.getByRole('link',{name:'Join Guest 49’s table',exact:true}).scrollIntoViewIfNeeded();await expect(list.getByRole('link',{name:'Join Guest 49’s table',exact:true})).toBeInViewport();await fits(page);await page.screenshot({path:info.outputPath('find-table-long-list.png')});
  await page.reload();await expect(picker(page)).toBeVisible();await expect(list.getByRole('article')).toHaveCount(50);await fits(page);
  await picker(page).getByRole('link',{name:'All games',exact:true}).click();await expect(picker(page)).toHaveCount(0);await expect(page.getByRole('heading',{name:'Take your pick.'})).toBeVisible();
});

test('signed-in popup keeps the real wallet visible and preserves saved-chip creation',async({page},info)=>{
  await providerFixture(page,'google','success','A very long gallery name');
  await page.route('**/api/v1/games/roulette/lobbies',route=>route.fulfill({json:{gameId:'roulette',lobbies:[]}}));
  await page.goto('./#/games/roulette');if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  await picker(page).getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();
  await expect(picker(page)).toBeVisible();await expect(picker(page).getByRole('group',{name:'Available wallet balance'})).toContainText('1,234.56');await expect(page.getByRole('button',{name:'Account menu for A very long gallery name'})).toHaveCount(1);await fits(page);await page.screenshot({path:info.outputPath('find-table-saved-wallet.png')});
  await picker(page).getByRole('radio',{name:'Public',exact:true}).check();await picker(page).getByRole('button',{name:'Create a table',exact:true}).click();
  const creation=page.getByRole('dialog',{name:'Create a table',exact:true});await expect(creation.getByRole('heading',{name:'Public table',exact:true})).toBeVisible();await expect(creation.getByLabel('Play with', {exact:true})).toHaveValue('account');await expect(creation.getByLabel('Buy-in (chips)')).toHaveValue('1000');await expect(creation).toContainText('1,234.56 chips available');
  await creation.getByRole('button',{name:'Cancel',exact:true}).click();await expect(picker(page)).toBeVisible();await fits(page);await picker(page).getByRole('link',{name:'All games',exact:true}).click();await expect(page.getByRole('group',{name:'Available wallet balance'})).toContainText('1,234.56');
});
